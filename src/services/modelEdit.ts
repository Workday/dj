import type { Coder } from '@services/coder';
import { COMMAND_ID, VIEW_ID } from '@services/constants';
import { frameworkGetModelName } from '@services/framework/utils';
import type { DJService } from '@services/types';
import { getHtml } from '@services/webview/utils';
import { usesComposition } from '@shared/framework/composition';
import type { FrameworkAuthoredModel } from '@shared/framework/types';
import * as vscode from 'vscode';

/**
 * ModelEditService - Manages model editing, cloning, and draft functionality
 * Handles webview panels and state management for model editing workflows
 */
export class ModelEditService implements DJService {
  private coder: Coder;
  private editPanels: Map<string, vscode.WebviewPanel> = new Map();

  constructor(coder: Coder) {
    this.coder = coder;
  }

  activate(context: vscode.ExtensionContext): void {
    this.registerCommands(context);
    this.coder.log.info('ModelEdit service activated');
  }

  registerCommands(context: vscode.ExtensionContext): void {
    // Model Edit Command - opens editor for existing model
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.MODEL_EDIT, async () =>
        this.handleModelEdit(),
      ),
    );

    // Model Clone Command - clones existing model to create new one
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.MODEL_CLONE, async () =>
        this.handleModelClone(),
      ),
    );

    // Open Edit Draft Command - reopens a saved draft
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.OPEN_EDIT_DRAFT,
        (formType: string, modelName: string) =>
          this.handleOpenEditDraft(formType, modelName),
      ),
    );

    // Discard Edit Draft Command - removes a saved draft
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.DISCARD_EDIT_DRAFT,
        async (treeItem: any) => this.handleDiscardEditDraft(treeItem),
      ),
    );
  }

  /**
   * Handle MODEL_EDIT command - opens editor for existing model
   */
  async handleModelEdit(): Promise<void> {
    try {
      this.coder.log.info('Edit Model command triggered');

      // Get current file info
      const info = await this.coder.fetchCurrentInfo();
      if (!(info && 'model' in info && info.model)) {
        if (info?.type === 'framework-model' && info.modelJson) {
          const modelName = frameworkGetModelName(info.modelJson);

          // Check if there's already an open panel for this model
          const existingPanel = this.editPanels.get(modelName);
          if (existingPanel) {
            existingPanel.reveal();
            return;
          }

          const editFormType = `model-${modelName}`;

          await this.coder.stateManager.clearModelEditDraft(modelName);
          await this.coder.stateManager.createModelEditTempFile(modelName);

          const modelData: any = {
            ...info.modelJson,
            name: info.modelJson.name,
            group: info.modelJson.group,
            topic: info.modelJson.topic,
            type: info.modelJson.type,
            originalModelPath: info.filePath,
            projectName: info.project.name,
            // Include all model configuration for data modeling prefill
            // Use safe property access to avoid TypeScript errors
            from: (info.modelJson as any).from,
            select: (info.modelJson as any).select,
            join: (info.modelJson as any).join,
            rollup: (info.modelJson as any).rollup,
            lookback: (info.modelJson as any).lookback,
            union: (info.modelJson as any).union,
            where: (info.modelJson as any).where,
            group_by: (info.modelJson as any).group_by,
            having: (info.modelJson as any).having,
            materialized: (info.modelJson as any).materialized,
            materialization: (info.modelJson as any).materialization,
          };

          // Derive source from type for UI compatibility
          const derivedSource = this.deriveSourceFromType(modelData.type);
          if (derivedSource) {
            modelData.source = derivedSource;
          }

          try {
            await this.coder.stateManager.saveFormState(
              editFormType,
              modelData,
            );
          } catch (error: unknown) {
            this.coder.log.error(
              'Failed to save fresh state for edit model:',
              error,
            );
          }

          // Create and setup the edit model panel
          this.createEditPanel(modelName, modelData, editFormType);

          return;
        }

        vscode.window.showWarningMessage('No model found in current context');
        return;
      }

      const model = info.model;

      const existingPanel = this.editPanels.get(model.name);
      if (existingPanel) {
        existingPanel.reveal();
        return;
      }

      // Create model-specific form type and temp file immediately
      const editFormType = `model-${model.name}`;

      await this.coder.stateManager.clearModelEditDraft(model.name);
      await this.coder.stateManager.createModelEditTempFile(model.name);

      let modelData: any = {};

      // Find the project that contains this model
      let project = null;
      for (const [, _project] of this.coder.framework.dbt.projects) {
        if (model.pathSystemFile.startsWith(_project.pathSystem)) {
          project = _project;
          break;
        }
      }

      if (info.type === 'framework-model' && info.modelJson) {
        const baseData = {
          projectName: project?.name ?? '',
          name: model.name,
          originalModelPath: info.filePath, // Track original file path for updates
        };

        const rawModel = info.modelJson as FrameworkAuthoredModel;
        let body: Record<string, unknown> = {
          ...(rawModel as unknown as Record<string, unknown>),
        };
        if (project && usesComposition(rawModel)) {
          await this.coder.framework.compositionHandlers.ensureLoaded(project);
          const resolved = this.coder.framework.sharedCompositionStore.resolve(
            project,
            rawModel,
            { mode: 'merged' },
          ).resolved;
          const raw = rawModel as unknown as Record<string, unknown>;
          body = {
            ...resolved,
            extends: raw.extends,
            with: raw.with,
            fragments: raw.fragments,
            select_exclude: raw.select_exclude,
            ctes_exclude: raw.ctes_exclude,
            select_mode: raw.select_mode,
            ctes_mode: raw.ctes_mode,
          };
        }
        modelData = JSON.parse(
          JSON.stringify({
            ...baseData,
            ...body,
          }),
        );

        // Derive source from type for UI compatibility
        const derivedSource = this.deriveSourceFromType(modelData.type);
        if (derivedSource) {
          modelData.source = derivedSource;
        }

        // Ensure all commonly used fields are present
        modelData.group = modelData.group ?? '';
        modelData.topic = modelData.topic ?? '';
        modelData.name = modelData.name || model.name;

        if (modelData.materialized) {
          modelData.materialized = String(modelData.materialized);
        }
      } else {
        modelData = {
          projectName: project?.name ?? '',
          name: model.name,
          type: '',
          group: '',
          topic: '',
          source: '',
          originalModelPath: model.pathSystemFile, // Track original file path
        };
      }

      // CRITICAL: Save state immediately BEFORE webview loads so form can populate from state
      try {
        await this.coder.stateManager.saveFormState(editFormType, modelData);
      } catch (error: unknown) {
        this.coder.log.error(
          'Failed to save fresh state for regular edit model:',
          error,
        );
      }

      // Create and setup the edit model panel
      this.createEditPanel(model.name, modelData, editFormType);
    } catch (err: unknown) {
      this.coder.log.error('ERROR IN EDIT MODEL: ', err);
      vscode.window.showErrorMessage('Failed to edit model');
    }
  }

  /**
   * Handle MODEL_CLONE command - clones existing model to create new one
   */
  async handleModelClone(): Promise<void> {
    try {
      this.coder.log.info('Clone Model command triggered');

      // Get current file info
      const info = await this.coder.fetchCurrentInfo();
      if (!(info && 'model' in info && info.model)) {
        if (info?.type === 'framework-model' && info.modelJson) {
          // Handle framework model cloning
          // Extract model name from file path (e.g., 'stg__analytics__sales__orders.model.json' -> 'stg__analytics__sales__orders')
          const sourceModelName =
            info.filePath.split('/').pop()?.replace('.model.json', '') ??
            'Unknown';

          const modelData: any = {
            ...info.modelJson,
            projectName: info.project.name,
            // Clear the name so user can provide a new one
            name: '',
            topic: '',
            materialization: '',
            // Flag to indicate this is a clone operation
            isCloningModel: true,
            // Store the source model name for display
            sourceModelName: sourceModelName,
            // Include all model configuration for data modeling prefill
            from: (info.modelJson as any).from,
            select: (info.modelJson as any).select,
            join: (info.modelJson as any).join,
            rollup: (info.modelJson as any).rollup,
            lookback: (info.modelJson as any).lookback,
            union: (info.modelJson as any).union,
            where: (info.modelJson as any).where,
            group_by: (info.modelJson as any).group_by,
            having: (info.modelJson as any).having,
            materialized: (info.modelJson as any).materialized,
          };

          // Derive source from type for UI compatibility
          const derivedSource = this.deriveSourceFromType(modelData.type);
          if (derivedSource) {
            modelData.source = derivedSource;
          }

          // Save to model-create temp file
          try {
            await this.coder.stateManager.saveFormState(
              'model-create',
              modelData,
            );
          } catch (error: unknown) {
            this.coder.log.error(
              'Failed to save state for clone model:',
              error,
            );
          }

          // Create model create panel
          const panel = vscode.window.createWebviewPanel(
            VIEW_ID.MODEL_CREATE,
            'Create Model (Clone)',
            vscode.ViewColumn.Active,
            { enableScripts: true },
          );

          panel.onDidDispose(() => {
            this.coder.framework.webviewPanelModelCreate = undefined;
          });
          this.coder.framework.webviewPanelModelCreate = panel;

          const html = getHtml({
            extensionUri: this.coder.context.extensionUri,
            route: '/model/create',
            webview: panel.webview,
          });
          panel.webview.html = html;

          // Handle webview messages including state management
          panel.webview.onDidReceiveMessage(
            this.coder.createWebviewMessageHandler(panel, 'model-create'),
          );

          return;
        }

        vscode.window.showWarningMessage('No model found in current context');
        return;
      }

      const model = info.model;

      // Find the project that contains this model
      let project = null;
      for (const [, _project] of this.coder.framework.dbt.projects) {
        if (model.pathSystemFile.startsWith(_project.pathSystem)) {
          project = _project;
          break;
        }
      }

      let modelData: any = {};

      if (info.type === 'framework-model' && info.modelJson) {
        // Extract model name from file path (e.g., 'stg__analytics__sales__orders.model.json' -> 'stg__analytics__sales__orders')
        const sourceModelName =
          info.filePath.split('/').pop()?.replace('.model.json', '') ??
          model.name;

        modelData = JSON.parse(
          JSON.stringify({
            ...info.modelJson,
            projectName: project?.name ?? '',
            // Clear the name so user can provide a new one
            name: '',
            // Flag to indicate this is a clone operation
            isCloningModel: true,
            // Store the source model name for display
            sourceModelName: sourceModelName,
          }),
        );

        // Derive source from type for UI compatibility
        const derivedSource = this.deriveSourceFromType(modelData.type);
        if (derivedSource) {
          modelData.source = derivedSource;
        }

        // Ensure all commonly used fields are present
        modelData.group = modelData.group ?? '';
        modelData.topic = modelData.topic ?? '';

        if (modelData.materialized) {
          modelData.materialized = String(modelData.materialized);
        }
      } else {
        modelData = {
          projectName: project?.name ?? '',
          name: '',
          type: '',
          group: '',
          topic: '',
          source: '',
        };
      }

      // Save to model-create temp file
      try {
        await this.coder.stateManager.saveFormState('model-create', modelData);
      } catch (error: unknown) {
        this.coder.log.error('Failed to save state for clone model:', error);
      }

      // Create model create panel
      const panel = vscode.window.createWebviewPanel(
        VIEW_ID.MODEL_CREATE,
        'Create Model (Clone)',
        vscode.ViewColumn.Active,
        { enableScripts: true },
      );

      panel.onDidDispose(() => {
        this.coder.framework.webviewPanelModelCreate = undefined;
      });
      this.coder.framework.webviewPanelModelCreate = panel;

      const html = getHtml({
        extensionUri: this.coder.context.extensionUri,
        route: '/model/create',
        webview: panel.webview,
      });
      panel.webview.html = html;

      // Handle webview messages including state management
      panel.webview.onDidReceiveMessage(
        this.coder.createWebviewMessageHandler(panel, 'model-create'),
      );
    } catch (err: unknown) {
      this.coder.log.error('ERROR IN CLONE MODEL: ', err);
      vscode.window.showErrorMessage('Failed to clone model');
    }
  }

  /**
   * Handle OPEN_EDIT_DRAFT command - reopens a saved draft
   */
  handleOpenEditDraft(formType: string, modelName: string): void {
    try {
      this.coder.log.info('Opening edit draft:', formType, modelName);

      // Check if there's already an open panel for this model
      const existingPanel = this.editPanels.get(modelName);
      if (existingPanel) {
        // Focus the existing panel instead of creating a new one
        existingPanel.reveal();
        this.coder.log.info('Focused existing edit panel for:', modelName);
        return;
      }

      // Create webview panel for the draft
      const panel = vscode.window.createWebviewPanel(
        VIEW_ID.MODEL_EDIT,
        `Edit Model: ${modelName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      // Track the panel for this model
      this.editPanels.set(modelName, panel);

      // Set HTML content
      panel.webview.html = getHtml({
        extensionUri: this.coder.context.extensionUri,
        route: '/model/edit',
        webview: panel.webview,
      });

      // Set up message handler
      panel.webview.onDidReceiveMessage(
        this.coder.createWebviewMessageHandler(panel, VIEW_ID.MODEL_EDIT),
      );

      // Send the form type to the webview for proper state loading
      panel.webview.onDidReceiveMessage((message) => {
        if (message.type === 'get-current-model-data') {
          panel.webview.postMessage({
            type: 'current-model-data',
            modelName,
            formType,
          });
        }
      });

      // Clean up when panel is closed
      panel.onDidDispose(() => {
        this.editPanels.delete(modelName);
        this.coder.log.info('Edit panel closed for:', modelName);
      });

      this.coder.log.info('Edit draft panel opened successfully');
    } catch (err: unknown) {
      this.coder.log.error('ERROR OPENING EDIT DRAFT:', err);
      vscode.window.showErrorMessage('Failed to open edit draft');
    }
  }

  /**
   * Handle DISCARD_EDIT_DRAFT command - removes a saved draft
   */
  async handleDiscardEditDraft(treeItem: any): Promise<void> {
    try {
      const modelName = treeItem.label;

      const result = await vscode.window.showWarningMessage(
        `Are you sure you want to discard the edit draft for "${modelName}"?`,
        { modal: true },
        'Discard',
      );

      if (result === 'Discard') {
        // Check if there's an open panel for this model and close it
        const existingPanel = this.editPanels.get(modelName);
        if (existingPanel) {
          this.coder.log.info('Closing open edit panel for:', modelName);
          existingPanel.dispose(); // This will trigger onDidDispose which handles cleanup
        } else {
          // No open panel, just clear the draft manually
          await this.coder.stateManager.clearModelEditDraft(modelName);
          await this.coder.framework.dbt.updateEditDraftsView();
        }

        vscode.window.showInformationMessage(
          `Edit draft for "${modelName}" has been discarded.`,
        );
      }
    } catch (err: unknown) {
      this.coder.log.error('ERROR DISCARDING EDIT DRAFT:', err);
      vscode.window.showErrorMessage('Failed to discard edit draft');
    }
  }

  /**
   * Creates and sets up an edit model panel with all necessary handlers
   */
  private createEditPanel(
    modelName: string,
    modelData: any,
    editFormType: string,
  ): vscode.WebviewPanel {
    // Create webview panel for model editing
    const panel = vscode.window.createWebviewPanel(
      VIEW_ID.MODEL_EDIT,
      `Edit Model: ${modelName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Track the panel for this model
    this.editPanels.set(modelName, panel);
    let isSaveDraftClosure = false;

    // Update the edit drafts view immediately since we now have an active edit session
    void this.coder.framework.dbt.updateEditDraftsView();

    // Set HTML content
    panel.webview.html = getHtml({
      extensionUri: this.coder.context.extensionUri,
      route: '/model/edit',
      webview: panel.webview,
    });

    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (
        message.type === 'save-draft-and-close' &&
        message.panelType === VIEW_ID.MODEL_EDIT
      ) {
        isSaveDraftClosure = true;
        panel.dispose();
        return;
      }

      if (
        message.type === 'close-panel' &&
        message.panelType === 'model-edit'
      ) {
        panel.dispose();
        return;
      }

      if (message.type === 'get-current-model-data') {
        panel.webview.postMessage({
          type: 'model-data-response',
          data: modelData,
          editFormType: editFormType,
          isEditMode: true,
        });

        void this.coder.framework.dbt.updateEditDraftsView();
        return;
      }

      // Handle all other messages through default handler
      const defaultHandler = this.coder.createWebviewMessageHandler(
        panel,
        VIEW_ID.MODEL_EDIT,
      );
      await defaultHandler(message);
    });

    panel.onDidDispose(async () => {
      this.editPanels.delete(modelName);

      if (!isSaveDraftClosure) {
        try {
          await this.coder.stateManager.clearModelEditDraft(modelName);
          await this.coder.framework.dbt.updateEditDraftsView();
        } catch (error: unknown) {
          this.coder.log.warn('Error cleaning up edit draft:', error);
        }
      } else {
        await this.coder.framework.dbt.updateEditDraftsView();
      }
    });

    return panel;
  }

  /**
   * Derives the source field from model type for UI compatibility
   */
  private deriveSourceFromType(type: string): string | undefined {
    if (!type) {
      return undefined;
    }

    if (type.includes('stg_') || type.startsWith('stg_')) {
      return 'staging';
    } else if (type.includes('int_') || type.startsWith('int_')) {
      return 'intermediate';
    } else if (type.includes('mart_') || type.startsWith('mart_')) {
      return 'marts';
    }

    return undefined;
  }

  deactivate(): void {
    // Close all open edit panels
    for (const [modelName, panel] of this.editPanels) {
      this.coder.log.info('Closing edit panel for:', modelName);
      panel.dispose();
    }
    this.editPanels.clear();
    this.coder.log.info('ModelEdit service deactivated');
  }
}
