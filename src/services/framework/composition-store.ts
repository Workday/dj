import { jsonParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import {
  CompositionRegistry,
  resolveModelComposition,
  type ResolveOptions,
  type ResolveResult,
  type SharedFileKind,
  sharedFileKindForPath,
} from '@shared/framework/composition';
import * as path from 'path';

export interface SharedFileChange {
  kind: SharedFileKind;
  /** Names whose models need re-syncing: the old and the new name. */
  names: string[];
  parseError?: string;
}

/**
 * Model names a template `model_ref` parameter may point at: every model in
 * the manifest plus every `.model.json` file on disk (new models are not in
 * the manifest until the next parse).
 */
export function modelExistsFor(
  project: DbtProject,
  modelFileNames: Iterable<string> = [],
): (name: string) => boolean {
  const names = new Set(modelFileNames);
  const prefix = `model.${project.name}.`;
  return (name) =>
    names.has(name) || !!project.manifest?.nodes?.[`${prefix}${name}`];
}

/** Model name implied by a `.model.json` path. */
export function modelNameFromPath(pathJson: string): string {
  return path.basename(pathJson).replace(/\.model\.json$/, '');
}

/**
 * Per-project fragment and template registries for the extension host.
 * Holds the shared-file text so diagnostics can be positioned inside it, and
 * tracks whether the reverse index is complete (a full discovery pass has
 * resolved every model in the project).
 */
export class CompositionStore {
  private readonly registries = new Map<string, CompositionRegistry>();
  private readonly texts = new Map<string, string>();
  private readonly indexedProjects = new Set<string>();

  registryFor(project: Pick<DbtProject, 'name'>): CompositionRegistry {
    let registry = this.registries.get(project.name);
    if (!registry) {
      registry = new CompositionRegistry();
      this.registries.set(project.name, registry);
    }
    return registry;
  }

  /** Replace a project's shared files with `files`. */
  load(
    project: Pick<DbtProject, 'name'>,
    files: { filePath: string; text: string }[],
  ): void {
    const registry = this.registryFor(project);
    const keep = new Set(files.map((f) => f.filePath));
    for (const entry of [
      ...registry.listFragments(),
      ...registry.listTemplates(),
    ]) {
      if (!keep.has(entry.filePath)) {
        registry.remove(entry.filePath);
        this.texts.delete(entry.filePath);
      }
    }
    for (const file of files) {
      this.upsertFile(project, file.filePath, file.text);
    }
  }

  upsertFile(
    project: Pick<DbtProject, 'name'>,
    filePath: string,
    text: string,
  ): SharedFileChange | undefined {
    const kind = sharedFileKindForPath(filePath);
    if (!kind) {
      return undefined;
    }
    const registry = this.registryFor(project);
    this.texts.set(filePath, text);
    let definition: unknown;
    let parseError: string | undefined;
    try {
      definition = jsonParse(text);
    } catch (err: unknown) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    const result = registry.upsert({ filePath, text, definition });
    const names = [result.previousName, result.entry?.name].filter(
      (n): n is string => !!n,
    );
    return {
      kind,
      names: [...new Set(names)],
      parseError: parseError ?? result.error,
    };
  }

  removeFile(
    project: Pick<DbtProject, 'name'>,
    filePath: string,
  ): SharedFileChange | undefined {
    const kind = sharedFileKindForPath(filePath);
    if (!kind) {
      return undefined;
    }
    this.texts.delete(filePath);
    const name = this.registryFor(project).remove(filePath);
    return { kind, names: name ? [name] : [] };
  }

  getText(filePath: string): string | undefined {
    return this.texts.get(filePath);
  }

  /** Every loaded shared file under `dirPath`, including ones that failed to parse. */
  filePathsUnder(dirPath: string): string[] {
    return [...this.texts.keys()].filter((p) => p.startsWith(dirPath)).sort();
  }

  markIndexed(project: Pick<DbtProject, 'name'>): void {
    this.indexedProjects.add(project.name);
  }

  isIndexed(project: Pick<DbtProject, 'name'>): boolean {
    return this.indexedProjects.has(project.name);
  }

  /** Model file paths that use any of `names` (directly or through other shared files). */
  dependentModelPaths(
    project: Pick<DbtProject, 'name'>,
    kind: SharedFileKind,
    names: string[],
  ): string[] {
    const registry = this.registryFor(project);
    const out = new Set<string>();
    for (const name of names) {
      for (const modelPath of registry.usedBy(kind, name)) {
        out.add(modelPath);
      }
    }
    return [...out].sort();
  }

  resolve<TModel = Record<string, unknown>>(
    project: DbtProject,
    model: unknown,
    options: ResolveOptions = {},
  ): ResolveResult<TModel> {
    return resolveModelComposition<TModel>(model, this.registryFor(project), {
      modelExists: modelExistsFor(project),
      ...options,
    });
  }
}
