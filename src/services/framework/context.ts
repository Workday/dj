/**
 * FrameworkContext - Facade for handler access to Framework dependencies
 *
 * This context object solves several problems:
 * 1. Reduces constructor arguments from 13+ to just 1 for all handlers
 * 2. Provides a clean API boundary between Framework and handlers
 * 3. Encapsulates access to Framework's private properties
 * 4. Makes it easy to share common dependencies across all handler classes
 *
 * Instead of passing individual dependencies to each handler:
 *   new UIHandlers(api, dbt, log, state, ...) // 13 args!
 *   new ModelHandlers(api, dbt, log, state, ...) // Duplicated!
 *
 * We pass a single context:
 *   new UIHandlers(ctx) // 1 arg
 *   new ModelHandlers(ctx) // Same context, no duplication
 */

import type { Api } from '@services/api';
import type { Coder } from '@services/coder';
import type { CoderFileInfo } from '@services/coder/types';
import type { Dbt } from '@services/dbt';
import type { DJLogger } from '@services/djLogger';
import type { StateManager } from '@services/statemanager';
import type { Ajv, ValidateFunction } from 'ajv';
import type * as vscode from 'vscode';

import type { FrameworkState } from './FrameworkState';
import type { Framework } from './index';

/**
 * Context providing handler access to Framework dependencies.
 *
 * This is a facade pattern that:
 * - Exposes readonly access to Framework's dependencies
 * - Provides getter/setter for mutable properties
 * - Hides Framework's internal implementation details
 */
export class FrameworkContext {
  constructor(private readonly frameworkInstance: Framework) {}

  // ========================================
  // Core Dependencies (readonly)
  // ========================================

  get api(): Api {
    return this.frameworkInstance['getApi']();
  }

  get dbt(): Dbt {
    return this.frameworkInstance['dbt'];
  }

  get coder(): Coder {
    return this.frameworkInstance['coder'];
  }

  get log(): DJLogger {
    return this.frameworkInstance['log'];
  }

  get state(): FrameworkState {
    return this.frameworkInstance['state'];
  }

  get stateManager(): StateManager {
    return this.frameworkInstance['stateManager'];
  }

  // ========================================
  // Validation & Diagnostics
  // ========================================

  get ajv(): Ajv {
    return this.frameworkInstance['ajv'];
  }

  get validateSourceJson(): ValidateFunction | undefined {
    return this.frameworkInstance['validateSourceJson'];
  }

  get diagnosticModelJson(): vscode.DiagnosticCollection {
    return this.frameworkInstance['diagnosticModelJson'];
  }

  get diagnosticSourceJson(): vscode.DiagnosticCollection {
    return this.frameworkInstance['diagnosticSourceJson'];
  }

  // ========================================
  // Mutable State (with getters/setters)
  // ========================================

  get webviewPanelModelCreate(): vscode.WebviewPanel | undefined {
    return this.frameworkInstance.webviewPanelModelCreate;
  }

  set webviewPanelModelCreate(panel: vscode.WebviewPanel | undefined) {
    this.frameworkInstance.webviewPanelModelCreate = panel;
  }

  get lockedModelFiles(): Set<string> {
    return this.frameworkInstance['lockedModelFiles'];
  }

  // ========================================
  // Framework Reference (for accessing methods)
  // ========================================

  /**
   * Get the Framework instance itself (needed for some methods like isSyncing)
   */
  get framework(): Framework {
    return this.frameworkInstance;
  }

  // ========================================
  // Framework Utility Methods
  // ========================================

  /**
   * Fetch and parse a model.json file
   */
  async fetchModelJson(uri: vscode.Uri): Promise<unknown> {
    return await this.frameworkInstance.fetchModelJson(uri);
  }

  /**
   * Fetch and parse a source.json file
   */
  async fetchSourceJson(uri: vscode.Uri): Promise<unknown> {
    return await this.frameworkInstance.fetchSourceJson(uri);
  }

  /**
   * Check if any sync is currently running
   */
  isSyncing(): boolean {
    return this.frameworkInstance.isSyncing();
  }

  waitForSyncIdle(timeoutMs?: number) {
    return this.frameworkInstance.waitForSyncIdle(timeoutMs);
  }

  /**
   * Generate model files (SQL, YAML) from model.json
   */
  async handleGenerateModelFiles(info: CoderFileInfo): Promise<void> {
    return await this.frameworkInstance.handleGenerateModelFiles(info);
  }
}
