import type { SchemaFragment } from '@shared/schema/types/fragment.schema';
import type { SchemaTemplate } from '@shared/schema/types/template.schema';

import { hashText, isPlainObject } from './json';
import type {
  CompositionDependencies,
  FragmentEntry,
  SharedFileEntry,
  SharedFileKind,
  TemplateEntry,
} from './types';

export const FRAGMENT_FILE_SUFFIX = '.fragment.json';
export const TEMPLATE_FILE_SUFFIX = '.template.json';

export function sharedFileKindForPath(
  filePath: string,
): SharedFileKind | undefined {
  if (filePath.endsWith(FRAGMENT_FILE_SUFFIX)) {
    return 'fragment';
  }
  if (filePath.endsWith(TEMPLATE_FILE_SUFFIX)) {
    return 'template';
  }
  return undefined;
}

export type LookupResult<T> =
  | { status: 'found'; entry: T }
  | { status: 'missing' }
  | { status: 'duplicate'; filePaths: string[] };

/**
 * In-memory index of one dbt project's fragment and template files, plus a
 * reverse index from shared names to the models that use them.
 *
 * Model keys are opaque to the registry; callers use the model file path.
 */
export class CompositionRegistry {
  private readonly byPath = new Map<string, SharedFileEntry>();
  private readonly usage = new Map<string, CompositionDependencies>();

  /**
   * Add or replace the entry for `filePath`. Returns the name the file
   * previously registered, so callers can re-sync models that used it.
   */
  upsert(params: { filePath: string; text: string; definition: unknown }): {
    entry?: SharedFileEntry;
    previousName?: string;
    error?: string;
  } {
    const { filePath, text, definition } = params;
    const previousName = this.byPath.get(filePath)?.name;
    const kind = sharedFileKindForPath(filePath);
    if (!kind) {
      return { previousName, error: `Not a fragment or template file` };
    }
    if (!isPlainObject(definition) || typeof definition.name !== 'string') {
      this.byPath.delete(filePath);
      return { previousName, error: `Missing a string "name" field` };
    }
    const entry: SharedFileEntry = {
      kind,
      name: definition.name,
      filePath,
      hash: hashText(text),
      definition: definition as unknown as SchemaFragment | SchemaTemplate,
    };
    this.byPath.set(filePath, entry);
    return { entry, previousName };
  }

  /** Remove the entry for `filePath`, returning its name if it had one. */
  remove(filePath: string): string | undefined {
    const name = this.byPath.get(filePath)?.name;
    this.byPath.delete(filePath);
    return name;
  }

  getByPath(filePath: string): SharedFileEntry | undefined {
    return this.byPath.get(filePath);
  }

  getFragment(name: string): LookupResult<FragmentEntry> {
    return this.lookup<FragmentEntry>('fragment', name);
  }

  getTemplate(name: string): LookupResult<TemplateEntry> {
    return this.lookup<TemplateEntry>('template', name);
  }

  listFragments(): FragmentEntry[] {
    return this.list<FragmentEntry>('fragment');
  }

  listTemplates(): TemplateEntry[] {
    return this.list<TemplateEntry>('template');
  }

  /** Names registered by more than one file of the same kind. */
  duplicates(kind: SharedFileKind): Map<string, string[]> {
    const byName = new Map<string, string[]>();
    for (const entry of this.list(kind)) {
      byName.set(entry.name, [
        ...(byName.get(entry.name) ?? []),
        entry.filePath,
      ]);
    }
    return new Map([...byName].filter(([, paths]) => paths.length > 1));
  }

  recordUsage(modelKey: string, dependencies: CompositionDependencies): void {
    if (
      dependencies.fragments.length === 0 &&
      dependencies.templates.length === 0
    ) {
      this.usage.delete(modelKey);
      return;
    }
    this.usage.set(modelKey, dependencies);
  }

  clearUsage(modelKey: string): void {
    this.usage.delete(modelKey);
  }

  /** Drop the reverse index; callers re-scan models before recording again. */
  clearAllUsage(): void {
    this.usage.clear();
  }

  /** Model keys that use the named fragment or template (transitively). */
  usedBy(kind: SharedFileKind, name: string): string[] {
    const out: string[] = [];
    for (const [modelKey, deps] of this.usage) {
      const names = kind === 'fragment' ? deps.fragments : deps.templates;
      if (names.includes(name)) {
        out.push(modelKey);
      }
    }
    return out.sort();
  }

  /**
   * A string that changes whenever any shared file the model depends on is
   * added, edited, renamed or removed. Combined with the model's own text to
   * form its cache key.
   */
  fingerprint(dependencies: CompositionDependencies): string {
    const parts: string[] = [];
    for (const [kind, names] of [
      ['fragment', dependencies.fragments],
      ['template', dependencies.templates],
    ] as const) {
      for (const name of [...names].sort()) {
        const matches = this.list(kind).filter((e) => e.name === name);
        const hashes = matches.map((e) => e.hash).sort();
        parts.push(`${kind}:${name}=${hashes.join('+') || 'missing'}`);
      }
    }
    return parts.join(';');
  }

  private list<T extends SharedFileEntry>(kind: SharedFileKind): T[] {
    return [...this.byPath.values()]
      .filter((entry): entry is T => entry.kind === kind)
      .sort((a, b) =>
        a.name === b.name
          ? a.filePath.localeCompare(b.filePath)
          : a.name.localeCompare(b.name),
      );
  }

  private lookup<T extends SharedFileEntry>(
    kind: SharedFileKind,
    name: string,
  ): LookupResult<T> {
    const matches = this.list<T>(kind).filter((entry) => entry.name === name);
    if (matches.length === 0) {
      return { status: 'missing' };
    }
    if (matches.length > 1) {
      return { status: 'duplicate', filePaths: matches.map((e) => e.filePath) };
    }
    return { status: 'found', entry: matches[0] };
  }
}
