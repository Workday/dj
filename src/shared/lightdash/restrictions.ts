/**
 * Pure helpers for resolving Lightdash upload restriction policy.
 *
 * The DJ extension lets workspace owners flag specific Lightdash project
 * UUIDs as restricted for the Dashboards-as-Code Upload flow:
 *
 *   - `block` — the Upload tab refuses to spawn `lightdash upload`.
 *   - `warn`  — the Upload tab requires an explicit user confirmation
 *               (passed back as `acknowledgedWarning: true`) before
 *               spawning the CLI.
 *
 * The setting only affects DJ-initiated uploads. Users with the right
 * permissions can still run `lightdash upload` directly from a terminal.
 *
 * This module is intentionally `@shared/` so the same resolution code
 * runs in the extension host (defense-in-depth backend enforcement)
 * and in the webview (UX pre-flight).
 */

export type LightdashRestrictionMode = 'block' | 'warn';

export type LightdashRestrictedProject = {
  /** Lightdash project UUID to restrict. Matched case-insensitively. */
  uuid: string;
  /** `block` = hard refuse; `warn` = require user confirmation. */
  mode: LightdashRestrictionMode;
  /** Optional friendly name surfaced in error/confirmation messages. */
  label?: string;
};

export type LightdashRestrictionStatus =
  | { status: 'allow' }
  | {
      status: LightdashRestrictionMode;
      mode: LightdashRestrictionMode;
      uuid: string;
      label?: string;
      message?: string;
    };

/**
 * Resolve the upload restriction for a given Lightdash project UUID.
 *
 * - Trims and lower-cases both sides so cut-and-paste UUIDs and
 *   capitalised labels resolve consistently.
 * - Skips malformed list entries (missing `uuid` / unknown `mode`).
 * - Returns the first matching entry; downstream callers should not
 *   rely on a specific order beyond "first match wins".
 */
export function resolveLightdashUploadRestriction(
  uuid: string,
  list: LightdashRestrictedProject[] | undefined,
): LightdashRestrictionStatus {
  const target = (uuid ?? '').trim().toLowerCase();
  if (!target || !Array.isArray(list) || list.length === 0) {
    return { status: 'allow' };
  }

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const entryUuid = (entry.uuid ?? '').trim().toLowerCase();
    if (!entryUuid || entryUuid !== target) {
      continue;
    }
    if (entry.mode !== 'block' && entry.mode !== 'warn') {
      continue;
    }
    return {
      status: entry.mode,
      mode: entry.mode,
      uuid: entry.uuid.trim(),
      label: entry.label?.trim() || undefined,
    };
  }

  return { status: 'allow' };
}

/**
 * Build a user-facing message for a restriction status. Centralized so
 * the backend response and the webview confirmation dialog stay in
 * sync.
 */
export function describeLightdashRestriction(
  status: LightdashRestrictionStatus,
): string | undefined {
  if (status.status === 'allow') {
    return undefined;
  }
  const friendly = status.label
    ? `'${status.label}' (${status.uuid})`
    : status.uuid;
  if (status.status === 'block') {
    return (
      `Upload blocked: Lightdash project ${friendly} is on the DJ restricted list (mode=block). ` +
      `Update 'dj.lightdash.restrictedProjects' to change this, or run 'lightdash upload' directly ` +
      `from a terminal if you have the necessary permissions.`
    );
  }
  return (
    `Lightdash project ${friendly} is on the DJ restricted list (mode=warn). ` +
    `Confirm to continue with the upload.`
  );
}
