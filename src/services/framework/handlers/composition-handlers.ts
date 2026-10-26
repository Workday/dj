import { formatValidationErrorDetails } from '@services/modelValidation';
import type { ValidationErrorDetail } from '@services/sync/types';
import { requireProject } from '@services/types';
import { jsonParse } from '@shared';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { DbtProject } from '@shared/dbt/types';
import {
  FRAGMENT_SELECT_TYPES,
  type SharedFileKind,
  sharedFileKindForPath,
} from '@shared/framework/composition';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  type CompositionStore,
  modelNameFromPath,
  type SharedFileChange,
} from '../composition-store';
import type { FrameworkContext } from '../context';
import { buildPositionedDiagnostics } from '../utils/json-diagnostics';

const SHARED_FILE_GLOB = '**/*.{fragment,template}.json';
const SHARED_FILE_EXCLUDE = '**/{node_modules,dbt_packages,target,.dj}/**';

const SCHEMA_FOR_KIND: Record<SharedFileKind, string> = {
  fragment: 'fragment.schema.json',
  template: 'template.schema.json',
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Fragment and template names a shared file refers to, with their JSON pointers. */
function collectReferences(
  definition: Json,
): { kind: SharedFileKind; name: string; instancePath: string }[] {
  const refs: { kind: SharedFileKind; name: string; instancePath: string }[] =
    [];
  const fromSelect = (select: unknown, pointer: string) => {
    if (!Array.isArray(select)) {
      return;
    }
    select.forEach((item, i) => {
      if (
        isObject(item) &&
        typeof item.type === 'string' &&
        (FRAGMENT_SELECT_TYPES as readonly string[]).includes(item.type) &&
        typeof item.fragment === 'string'
      ) {
        refs.push({
          kind: 'fragment',
          name: item.fragment,
          instancePath: `${pointer}/${i}/fragment`,
        });
      }
    });
  };
  const fromModelBody = (body: Json, pointer: string) => {
    if (typeof body.extends === 'string') {
      refs.push({
        kind: 'template',
        name: body.extends,
        instancePath: `${pointer}/extends`,
      });
    }
    if (Array.isArray(body.fragments)) {
      body.fragments.forEach((name, i) => {
        if (typeof name === 'string') {
          refs.push({
            kind: 'fragment',
            name,
            instancePath: `${pointer}/fragments/${i}`,
          });
        }
      });
    }
    fromSelect(body.select, `${pointer}/select`);
    if (Array.isArray(body.ctes)) {
      body.ctes.forEach((cte, i) => {
        if (isObject(cte)) {
          fromSelect(cte.select, `${pointer}/ctes/${i}/select`);
        }
      });
    }
  };
  if (isObject(definition.model)) {
    fromModelBody(definition.model, '/model');
  } else {
    fromModelBody(definition, '');
  }
  return refs;
}

/**
 * Loads, validates and watches `*.fragment.json` / `*.template.json` files,
 * and re-syncs the models that depend on them when they change.
 */
export class CompositionHandlers {
  private readonly loadedProjects = new Set<string>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly loading = new Map<string, Promise<void>>();

  constructor(private readonly ctx: FrameworkContext) {}

  private get store(): CompositionStore {
    return this.ctx.compositionStore;
  }

  isLoaded(project: DbtProject): boolean {
    return this.loadedProjects.has(project.name);
  }

  /** Load the project's shared files once; concurrent callers share the load. */
  ensureLoaded(project: DbtProject): Promise<void> {
    if (this.isLoaded(project)) {
      return Promise.resolve();
    }
    let loading = this.loading.get(project.name);
    if (!loading) {
      loading = this.loadProject(project).finally(() =>
        this.loading.delete(project.name),
      );
      this.loading.set(project.name, loading);
    }
    return loading;
  }

  projectForPath(filePath: string): DbtProject | undefined {
    for (const project of this.ctx.dbt.projects.values()) {
      if (filePath.startsWith(project.pathSystem + path.sep)) {
        return project;
      }
    }
    return undefined;
  }

  /** Read every shared file in the project into its registry and validate them. */
  async loadProject(project: DbtProject): Promise<void> {
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(project.pathSystem, SHARED_FILE_GLOB),
      SHARED_FILE_EXCLUDE,
    );
    const files = await Promise.all(
      uris.map(async (uri) => ({
        filePath: uri.fsPath,
        text: (await vscode.workspace.fs.readFile(uri)).toString(),
      })),
    );
    const previous = this.store.filePathsUnder(project.pathSystem);
    this.store.load(project, files);
    this.loadedProjects.add(project.name);
    const current = new Set(files.map((f) => f.filePath));
    for (const filePath of previous) {
      if (!current.has(filePath)) {
        this.collectionFor(filePath)?.delete(vscode.Uri.file(filePath));
      }
    }
    this.validateProject(project);
  }

  /** Debounced entry point for watcher events on shared files. */
  handleSharedFileEvent(
    uri: vscode.Uri,
    type: 'change' | 'create' | 'delete',
  ): void {
    const filePath = uri.fsPath;
    const existing = this.pendingTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pendingTimers.delete(filePath);
      void this.processSharedFileEvent(filePath, type).catch((err: unknown) =>
        this.ctx.log.error(`Error handling shared file ${filePath}`, err),
      );
    }, this.ctx.coder.getSyncDebounceMs());
    this.pendingTimers.set(filePath, timer);
  }

  private async processSharedFileEvent(
    filePath: string,
    type: 'change' | 'create' | 'delete',
  ): Promise<void> {
    const project = this.projectForPath(filePath);
    if (!project) {
      return;
    }
    if (!this.isLoaded(project)) {
      await this.loadProject(project);
      this.ctx.framework.syncQueue.enqueueFullSync();
      return;
    }

    let change: SharedFileChange | undefined;
    let text: string | undefined;
    if (type !== 'delete') {
      try {
        text = (
          await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
        ).toString();
      } catch {
        text = undefined;
      }
    }
    if (text === undefined) {
      change = this.store.removeFile(project, filePath);
      this.collectionFor(filePath)?.delete(vscode.Uri.file(filePath));
    } else {
      change = this.store.upsertFile(project, filePath, text);
    }
    this.validateProject(project);
    if (change) {
      this.queueDependents(project, change);
    }
  }

  private queueDependents(project: DbtProject, change: SharedFileChange) {
    const syncQueue = this.ctx.framework.syncQueue;
    if (!this.store.isIndexed(project)) {
      this.ctx.log.info(
        `Shared ${change.kind} changed before the first sync of ${project.name}; running a full sync`,
      );
      syncQueue.enqueueFullSync();
      return;
    }
    const modelPaths = this.store.dependentModelPaths(
      project,
      change.kind,
      change.names,
    );
    this.ctx.log.info(
      `Shared ${change.kind} ${change.names.join(', ') || '(unnamed)'} changed; re-syncing ${modelPaths.length} model(s)`,
    );
    for (const modelPath of modelPaths) {
      syncQueue.enqueue(
        `model.${project.name}.${modelNameFromPath(modelPath)}`,
        modelPath,
      );
    }
  }

  private collectionFor(
    filePath: string,
  ): vscode.DiagnosticCollection | undefined {
    const kind = sharedFileKindForPath(filePath);
    if (kind === 'fragment') {
      return this.ctx.diagnosticFragmentJson;
    }
    if (kind === 'template') {
      return this.ctx.diagnosticTemplateJson;
    }
    return undefined;
  }

  /**
   * Validate every shared file in the project. Runs project-wide because a
   * change to one file (a rename, a new duplicate) can fix or break others.
   */
  validateProject(project: DbtProject): void {
    for (const filePath of this.store.filePathsUnder(project.pathSystem)) {
      const text = this.store.getText(filePath);
      const collection = this.collectionFor(filePath);
      if (text === undefined || !collection) {
        continue;
      }
      const details = this.validateSharedFile(project, filePath, text);
      const uri = vscode.Uri.file(filePath);
      if (details.length === 0) {
        collection.delete(uri);
      } else {
        collection.set(
          uri,
          buildPositionedDiagnostics(
            details,
            text,
            vscode.DiagnosticSeverity.Error,
            (p) => this.store.getText(p),
          ),
        );
      }
    }
  }

  validateSharedFile(
    project: DbtProject,
    filePath: string,
    text: string,
  ): ValidationErrorDetail[] {
    const kind = sharedFileKindForPath(filePath);
    if (!kind) {
      return [];
    }
    let definition: unknown;
    try {
      definition = jsonParse(text);
    } catch (err: unknown) {
      return [
        {
          message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          instancePath: '',
        },
      ];
    }
    const details: ValidationErrorDetail[] = [];
    const validator = this.ctx.ajv.getSchema(SCHEMA_FOR_KIND[kind]);
    if (validator && !validator(definition)) {
      details.push(...formatValidationErrorDetails(validator.errors));
    }
    if (!isObject(definition) || typeof definition.name !== 'string') {
      return details;
    }

    const registry = this.store.registryFor(project);
    const duplicatePaths = registry.duplicates(kind).get(definition.name);
    if (duplicatePaths) {
      const others = duplicatePaths
        .filter((p) => p !== filePath)
        .map((p) => path.relative(project.pathSystem, p));
      details.push({
        message: `Another ${kind} also uses the name "${definition.name}" (${others.join(', ')}). Names must be unique within a project.`,
        instancePath: '/name',
        severity: 'error',
      });
    }
    const expected = path
      .basename(filePath)
      .replace(
        kind === 'fragment' ? /\.fragment\.json$/ : /\.template\.json$/,
        '',
      );
    if (expected !== definition.name) {
      details.push({
        message: `The ${kind} name "${definition.name}" doesn't match its file name "${expected}"; references use the name.`,
        instancePath: '/name',
        severity: 'warning',
      });
    }

    for (const ref of collectReferences(definition)) {
      const lookup =
        ref.kind === 'fragment'
          ? registry.getFragment(ref.name)
          : registry.getTemplate(ref.name);
      if (lookup.status === 'missing') {
        details.push({
          message: `Unknown ${ref.kind} "${ref.name}".`,
          instancePath: ref.instancePath,
          severity: 'error',
        });
      }
    }
    return details;
  }

  private modelNamesUsedBy(
    project: DbtProject,
    kind: SharedFileKind,
    name: string,
  ): string[] {
    return this.store
      .dependentModelPaths(project, kind, [name])
      .map((p) => modelNameFromPath(p))
      .sort();
  }

  private projectFromPayload(projectName: string): DbtProject {
    return requireProject(
      this.ctx.dbt.projects.get(projectName),
      projectName,
      'composition',
    );
  }

  async handleFragmentList(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-fragment-list' }
    >,
  ): Promise<ApiResponse> {
    const project = this.projectFromPayload(payload.request.projectName);
    await this.ensureLoaded(project);
    const items = this.store
      .registryFor(project)
      .listFragments()
      .map((e) => {
        const def = e.definition as Json;
        return {
          name: e.name,
          kind:
            def.kind === 'config' ? ('config' as const) : ('select' as const),
          filePath: e.filePath,
          description:
            typeof def.description === 'string' ? def.description : undefined,
        };
      });
    return apiResponse<typeof payload.type>(items);
  }

  async handleFragmentGet(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-fragment-get' }
    >,
  ): Promise<ApiResponse> {
    const { projectName, name } = payload.request;
    const project = this.projectFromPayload(projectName);
    await this.ensureLoaded(project);
    const lookup = this.store.registryFor(project).getFragment(name);
    if (lookup.status !== 'found') {
      return apiResponse<typeof payload.type>(null);
    }
    const def = lookup.entry.definition as Json;
    return apiResponse<typeof payload.type>({
      name: lookup.entry.name,
      kind: def.kind === 'config' ? 'config' : 'select',
      filePath: lookup.entry.filePath,
      definition: def,
      usedBy: this.modelNamesUsedBy(project, 'fragment', name),
    });
  }

  async handleTemplateList(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-template-list' }
    >,
  ): Promise<ApiResponse> {
    const project = this.projectFromPayload(payload.request.projectName);
    await this.ensureLoaded(project);
    const items = this.store
      .registryFor(project)
      .listTemplates()
      .map((e) => {
        const def = e.definition as unknown as Json;
        const params = isObject(def.params) ? def.params : {};
        return {
          name: e.name,
          filePath: e.filePath,
          description:
            typeof def.description === 'string' ? def.description : undefined,
          paramNames: Object.keys(params).sort(),
        };
      });
    return apiResponse<typeof payload.type>(items);
  }

  async handleTemplateGet(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-template-get' }
    >,
  ): Promise<ApiResponse> {
    const { projectName, name } = payload.request;
    const project = this.projectFromPayload(projectName);
    await this.ensureLoaded(project);
    const lookup = this.store.registryFor(project).getTemplate(name);
    if (lookup.status !== 'found') {
      return apiResponse<typeof payload.type>(null);
    }
    const def = lookup.entry.definition as unknown as Json;
    return apiResponse<typeof payload.type>({
      name: lookup.entry.name,
      filePath: lookup.entry.filePath,
      definition: def,
      usedBy: this.modelNamesUsedBy(project, 'template', name),
    });
  }

  /** Columns from a select fragment (for the visual editor column picker). */
  async handleFragmentColumns(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-fragment-columns' }
    >,
  ): Promise<ApiResponse> {
    const { projectName, name } = payload.request;
    const project = this.projectFromPayload(projectName);
    await this.ensureLoaded(project);
    const lookup = this.store.registryFor(project).getFragment(name);
    if (lookup.status !== 'found') {
      return apiResponse<typeof payload.type>({ columns: [] });
    }
    const def = lookup.entry.definition as Json;
    if (def.kind === 'config' || !Array.isArray(def.select)) {
      return apiResponse<typeof payload.type>({ columns: [] });
    }
    const columns: Array<{
      name: string;
      type?: 'dim' | 'fct';
      description?: string;
    }> = [];
    for (const col of def.select) {
      if (!isObject(col) || typeof col.name !== 'string') {
        continue;
      }
      columns.push({
        name: col.name,
        type:
          col.type === 'fct' ? 'fct' : col.type === 'dim' ? 'dim' : undefined,
        description:
          typeof col.description === 'string' ? col.description : undefined,
      });
    }
    return apiResponse<typeof payload.type>({ columns });
  }
}
