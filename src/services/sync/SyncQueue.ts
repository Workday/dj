/**
 * Sync Queue Module
 *
 * State-driven queue for managing sync operations. Replaces timing-based
 * mechanisms (setInterval polling, TTL-based path suppression) with an
 * event-driven architecture.
 *
 * Key features:
 * - Event-driven: processes next item when current sync finishes
 * - Coalescing: batches rapid-fire enqueues (bulk file changes, git ops) via
 *   a resettable delay window before starting, with a hard time cap
 * - Deduplication: same resource ID enqueued multiple times = single sync
 * - Fresh pathJson: queue stores resource IDs with optional pathJson from watcher
 * - Timestamp-based watcher suppression (narrow window, not blanket)
 * - Post-sync cleanup for renamed-old files (Coder tab re-creation bug)
 * - Auto-escalation to full sync when queue exceeds threshold
 * - Status bar integration for user-facing progress
 */

import type { FrameworkSyncOp } from '@shared/framework/types';

import type { DetectedRename, SyncLogger, SyncResult, SyncRoot } from './types';

/** How long to suppress watcher events after a file operation (ms). */
const SUPPRESS_WINDOW_MS = 2000;

/**
 * How long to wait for more items before starting a sync (ms).
 * Each new enqueue resets this window so rapid-fire changes coalesce
 * into a single sync run instead of triggering partial syncs.
 */
const COALESCING_DELAY_MS = 500;

/** Hard cap on total coalescing time to prevent indefinite delay (ms). */
const MAX_COALESCING_MS = 3000;

/**
 * SyncQueue manages the lifecycle of sync operations.
 *
 * Instead of polling with setInterval, it uses an event-driven loop:
 * enqueue() -> processNext() -> onRunSync() -> processNext() -> ...
 *
 * Watcher suppression uses a timestamp-based `managedOps` map. Each file
 * operation records when it happened; events within SUPPRESS_WINDOW_MS are
 * suppressed. Events outside the window pass through to debounce normally.
 * This replaces the old blanket `managedPaths` set that blocked events for
 * the entire sync duration (25+ seconds).
 */
export class SyncQueue {
  private state: 'idle' | 'running' = 'idle';
  private pendingRoots: Map<
    string,
    { id: string; pathJson?: string; queuedAt: number }
  > = new Map();
  private fullSyncPending = false;

  /**
   * Timestamp-based suppression: path -> timestamp of the file operation.
   * Events within SUPPRESS_WINDOW_MS of the operation are suppressed.
   * Events outside the window pass through (they are user edits, not sync artifacts).
   */
  private managedOps: Map<string, number> = new Map();

  /** If more than this many roots are pending, escalate to full sync */
  private readonly ESCALATION_THRESHOLD = 20;

  private coalescingTimer: NodeJS.Timeout | null = null;
  private coalescingStartedAt: number | null = null;

  constructor(
    private readonly onRunSync: (roots?: SyncRoot[]) => Promise<SyncResult>,
    private readonly onStatusChange: (text: string, spinning: boolean) => void,
    private readonly log: SyncLogger,
    private readonly debounceMs: number = 1500,
    /**
     * Called after a sync that produced renames. The callback should:
     * 1. Check if old files still exist (editor may re-create them in Coder)
     * 2. If so, move their content to the new path and delete the old file
     * 3. Close old tabs and open new files
     * 4. Trigger debounced syncs for moved files
     */
    private readonly onCleanupRenamedFiles?: (
      renames: DetectedRename[],
    ) => Promise<void>,
  ) {}

  /**
   * Queue a specific resource for sync. Deduplicates by ID.
   * @param id - Resource ID (e.g., "model.project.stg__group__topic__name")
   * @param pathJson - Optional path to the JSON file on disk. Required for renames
   *   where the ID is derived from the NEW name but the file is still at the OLD path.
   */
  enqueue(id: string, pathJson?: string): void {
    if (this.fullSyncPending) {
      this.log.info(`SyncQueue: enqueue(${id}) skipped — full sync pending`);
      return; // Full sync subsumes everything
    }

    const existing = this.pendingRoots.get(id);
    if (existing) {
      this.log.info(
        `SyncQueue: enqueue(${id}) — replacing existing pending (old pathJson: ${existing.pathJson ?? 'none'}, new pathJson: ${pathJson ?? 'none'})`,
      );
    } else {
      this.log.info(
        `SyncQueue: enqueue(${id}) — state=${this.state}, pending=${this.pendingRoots.size}, pathJson=${pathJson ?? 'none'}`,
      );
    }

    this.pendingRoots.set(id, { id, pathJson, queuedAt: Date.now() });

    if (this.pendingRoots.size > this.ESCALATION_THRESHOLD) {
      this.escalateToFullSync();
      return;
    }

    this.updateStatus();
    this.scheduleProcessNext();
  }

  /** Queue a full sync (all files). Subsumes individual roots. */
  enqueueFullSync(): void {
    this.fullSyncPending = true;
    this.pendingRoots.clear();
    this.updateStatus();
    this.scheduleProcessNext();
  }

  /**
   * Determine how to handle a watcher event.
   *
   * This is the single decision-maker for all watcher events. The watcher
   * handler in Coder should call this and act on the result — no other
   * suppression logic should exist outside this method.
   *
   * Returns:
   * - 'suppress': ignore the event (sync artifact within suppression window)
   * - 'debounce': pass to debounceFrameworkSync (user edit or expired window)
   * - 'pass': not a framework file, handle normally
   */
  shouldProcessEvent(
    fsPath: string,
    type: 'change' | 'create' | 'delete',
  ): 'suppress' | 'debounce' | 'pass' {
    const isFrameworkJson =
      fsPath.endsWith('.model.json') || fsPath.endsWith('.source.json');

    const opTimestamp = this.managedOps.get(fsPath);
    const now = Date.now();
    const withinWindow =
      opTimestamp !== undefined && now - opTimestamp < SUPPRESS_WINDOW_MS;

    if (withinWindow) {
      // Within suppression window — this is likely a sync artifact.
      // Suppress all event types for all file types.
      return 'suppress';
    }

    // Outside suppression window (or path was never managed).
    // Framework JSON files go to debounce; everything else passes through.
    if (isFrameworkJson && (type === 'change' || type === 'create')) {
      return 'debounce';
    }

    return 'pass';
  }

  /**
   * Record file operations for timestamp-based suppression.
   * Called BEFORE file operations execute via the onBeforeFileOps callback.
   */
  recordOpsForSuppression(operations: FrameworkSyncOp[]): void {
    const now = Date.now();
    for (const op of operations) {
      if (op.type === 'rename') {
        this.managedOps.set(op.oldPath, now);
        this.managedOps.set(op.newPath, now);
      } else if (op.type === 'write') {
        this.managedOps.set(op.path, now);
      } else if (op.type === 'delete') {
        this.managedOps.set(op.path, now);
      }
    }
  }

  /** Get all currently managed paths (for clearing external debounce timers). */
  getManagedPaths(): string[] {
    return Array.from(this.managedOps.keys());
  }

  /** Is a sync currently running? */
  isSyncing(): boolean {
    return this.state === 'running';
  }

  /** Are there items waiting? */
  hasPending(): boolean {
    return this.fullSyncPending || this.pendingRoots.size > 0;
  }

  /**
   * Schedule processNext with a coalescing delay. Each call resets the
   * delay so rapid-fire enqueues batch into one sync. If a sync is already
   * running, new items simply accumulate and will be picked up when the
   * current run finishes (processNext re-calls itself in `finally`).
   */
  private scheduleProcessNext(): void {
    if (this.state === 'running') {
      return;
    }

    const now = Date.now();

    if (this.coalescingStartedAt === null) {
      this.coalescingStartedAt = now;
    }

    const elapsed = now - this.coalescingStartedAt;
    if (elapsed >= MAX_COALESCING_MS) {
      this.clearCoalescingTimer();
      void this.processNext();
      return;
    }

    if (this.coalescingTimer !== null) {
      clearTimeout(this.coalescingTimer);
    }

    const remaining = Math.min(
      COALESCING_DELAY_MS,
      MAX_COALESCING_MS - elapsed,
    );

    this.coalescingTimer = setTimeout(() => {
      this.clearCoalescingTimer();
      void this.processNext();
    }, remaining);
  }

  private clearCoalescingTimer(): void {
    if (this.coalescingTimer !== null) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }
    this.coalescingStartedAt = null;
  }

  /**
   * Core event loop. Called after enqueue or after a sync finishes.
   * If already running, returns immediately — will be called again
   * when the current sync finishes.
   */
  private async processNext(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    if (!this.fullSyncPending && this.pendingRoots.size === 0) {
      this.goIdle();
      return;
    }

    this.state = 'running';

    // Snapshot and clear pending items
    const isFullSync = this.fullSyncPending;
    const pendingSnapshot = isFullSync
      ? undefined
      : Array.from(this.pendingRoots.values());
    this.fullSyncPending = false;
    this.pendingRoots.clear();

    if (!isFullSync && pendingSnapshot) {
      this.log.info(
        `SyncQueue: processNext snapshot — ${pendingSnapshot.length} root(s): ${JSON.stringify(pendingSnapshot.map((r) => ({ id: r.id, pathJson: r.pathJson })))}`,
      );
    }

    this.updateStatus();

    try {
      // Pass IDs with pathJson when available. pathJson is needed for renames
      // where the ID is derived from the NEW name but the file is still at the OLD path.
      const roots = pendingSnapshot?.map((item) => ({
        id: item.id,
        ...(item.pathJson ? { pathJson: item.pathJson } : {}),
      }));
      const rootCount = pendingSnapshot?.length ?? 0;
      const statusMsg = isFullSync
        ? 'DJ Sync: Running (all files)'
        : `DJ Sync: Running (${rootCount} file${rootCount > 1 ? 's' : ''})`;
      this.onStatusChange(statusMsg, true);

      this.log.info(
        `SyncQueue: Starting sync - ${isFullSync ? 'full sync' : `${rootCount} root(s): ${pendingSnapshot!.map((r) => r.id).join(', ')}`}`,
      );

      const result = await this.onRunSync(roots);

      this.log.info(
        `SyncQueue: Sync finished — success=${result.success}, renames=${result.renames.length}, errors=${result.errors.length}, pendingAfter=${this.pendingRoots.size}, fullSyncPending=${this.fullSyncPending}`,
      );

      if (result.renames.length > 0) {
        for (const rename of result.renames) {
          this.log.info(
            `SyncQueue: Rename detected — old=${rename.oldName} (${rename.pathJson}) -> new=${rename.newName} (${rename.newPathJson ?? 'unknown'})`,
          );
        }

        // Update pathJson in pending roots that reference old (pre-rename) paths.
        this.updatePendingPathsAfterRenames(result.renames);

        // Post-sync cleanup: handle old files that the editor may have re-created
        // (Coder tab re-creation bug). This runs at a deterministic point — after
        // the sync's file I/O is complete, so there's no race with sync writes.
        if (this.onCleanupRenamedFiles) {
          try {
            await this.onCleanupRenamedFiles(result.renames);
          } catch (cleanupErr) {
            this.log.error(
              'SyncQueue: Error during post-sync rename cleanup',
              cleanupErr,
            );
          }
        }
      }

      if (this.pendingRoots.size > 0) {
        this.log.info(
          `SyncQueue: Pending roots after sync: ${JSON.stringify(Array.from(this.pendingRoots.values()).map((r) => ({ id: r.id, pathJson: r.pathJson })))}`,
        );
      }
    } catch (err) {
      this.log.error('SyncQueue: Error during sync', err);
    } finally {
      this.state = 'idle';
      // Drain any work enqueued during this run. Use processNext directly
      // (no coalescing) since items have already been waiting.
      void this.processNext();
    }
  }

  /** Transition to idle state. */
  private goIdle(): void {
    this.state = 'idle';
    this.onStatusChange('DJ Sync: Idle', false);
    // Prune expired entries from managedOps to prevent unbounded growth.
    this.pruneExpiredOps();
  }

  /** Remove managedOps entries older than SUPPRESS_WINDOW_MS. */
  private pruneExpiredOps(): void {
    const now = Date.now();
    for (const [path, timestamp] of this.managedOps) {
      if (now - timestamp >= SUPPRESS_WINDOW_MS) {
        this.managedOps.delete(path);
      }
    }
  }

  /** Escalate pending individual roots to a full sync. */
  private escalateToFullSync(): void {
    this.log.info(
      `SyncQueue: Escalated to full sync (>${this.ESCALATION_THRESHOLD} pending roots)`,
    );
    this.fullSyncPending = true;
    this.pendingRoots.clear();
    this.updateStatus();
    this.scheduleProcessNext();
  }

  /** Update the status bar with current queue state. */
  private updateStatus(): void {
    if (this.state === 'running') {
      const pending = this.fullSyncPending
        ? '(full sync queued)'
        : this.pendingRoots.size > 0
          ? `(${this.pendingRoots.size} queued)`
          : '';
      this.onStatusChange(`DJ Sync: Running ${pending}`, true);
    } else if (this.fullSyncPending || this.pendingRoots.size > 0) {
      const count = this.fullSyncPending
        ? 'full sync'
        : `${this.pendingRoots.size} file(s)`;
      this.onStatusChange(`DJ Sync: ${count} queued`, false);
    }
  }

  /**
   * After a sync with renames, update any pending roots whose pathJson
   * points to an old (pre-rename) path. This handles the case where a
   * watcher event fires during a sync and enqueues an item with the old
   * pathJson — by the time the next sync runs, the file has been renamed.
   */
  private updatePendingPathsAfterRenames(renames: DetectedRename[]): void {
    if (this.pendingRoots.size === 0 || renames.length === 0) {
      return;
    }

    // Build a map of oldPath -> newPath for .model.json renames
    const pathMap = new Map<string, string>();
    for (const rename of renames) {
      if (rename.newPathJson) {
        pathMap.set(rename.pathJson, rename.newPathJson);
      }
    }

    if (pathMap.size === 0) {
      return;
    }

    // Update pending roots whose pathJson matches an old rename path
    for (const [id, item] of this.pendingRoots) {
      if (item.pathJson && pathMap.has(item.pathJson)) {
        const newPath = pathMap.get(item.pathJson)!;
        this.log.info(
          `SyncQueue: Updated pending root pathJson: ${item.pathJson} -> ${newPath}`,
        );
        this.pendingRoots.set(id, { ...item, pathJson: newPath });
      }
    }
  }

  /** Clean up on deactivation. */
  dispose(): void {
    this.clearCoalescingTimer();
    this.pendingRoots.clear();
    this.managedOps.clear();
  }
}
