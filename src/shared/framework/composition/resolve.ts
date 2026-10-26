import type { SchemaModelSelectFragment } from '@shared/schema/types/model.select.fragment.schema';

import {
  cloneJson,
  deepMergeObjects,
  isPlainObject,
  type JsonObject,
  pathStartsWith,
  unionJsonArrays,
} from './json';
import type { CompositionRegistry } from './registry';
import type {
  CompositionIssue,
  CompositionSeverity,
  JsonPath,
  ProvenanceEntry,
  ProvenanceOrigin,
  ResolveOptions,
  ResolveResult,
  SharedLocation,
} from './types';

export const FRAGMENT_SELECT_TYPES = [
  'all_from_fragment',
  'dims_from_fragment',
  'fcts_from_fragment',
] as const;

/** Keys that only exist in authored files and never reach the resolved model. */
export const COMPOSITION_AUTHORING_KEYS = [
  'extends',
  'with',
  'fragments',
  'select_exclude',
  'ctes_exclude',
  'select_mode',
  'ctes_mode',
] as const;

const IDENTITY_KEYS = ['type', 'group', 'topic', 'name'] as const;
const TEMPLATE_FORBIDDEN_KEYS = ['group', 'topic', 'name'] as const;
const FRAGMENT_DOC_KEYS = new Set([
  '$schema',
  'kind',
  'name',
  'description',
  'fragments',
]);
const DEFAULT_MAX_DEPTH = 5;
const AUTHORING_KEY_SET = new Set<string>(COMPOSITION_AUTHORING_KEYS);

export function isFragmentSelect(
  item: unknown,
): item is SchemaModelSelectFragment {
  return (
    isPlainObject(item) &&
    typeof item.type === 'string' &&
    (FRAGMENT_SELECT_TYPES as readonly string[]).includes(item.type)
  );
}

/** True when the model uses `extends`, root `fragments`, or a fragment select. */
export function usesComposition(model: unknown): boolean {
  if (!isPlainObject(model)) {
    return false;
  }
  if (model.extends !== undefined || model.fragments !== undefined) {
    return true;
  }
  const lists: unknown[] = [model.select];
  if (Array.isArray(model.ctes)) {
    for (const cte of model.ctes) {
      if (isPlainObject(cte)) {
        lists.push(cte.select);
      }
    }
  }
  return lists.some(
    (list) =>
      Array.isArray(list) && list.some((item) => isFragmentSelect(item)),
  );
}

/**
 * Identity used to merge a template child's `select` into the template's:
 * the column name for named items, `<type>:<ref>` for bulk selects.
 */
export function selectItemIdentity(item: unknown): string {
  if (typeof item === 'string') {
    return item;
  }
  if (isPlainObject(item)) {
    if (typeof item.name === 'string') {
      return item.name;
    }
    if (typeof item.type === 'string') {
      const ref = item.model ?? item.cte ?? item.source ?? item.fragment;
      return `${item.type}:${typeof ref === 'string' ? ref : ''}`;
    }
  }
  return JSON.stringify(item);
}

export function cteIdentity(cte: unknown): string {
  return isPlainObject(cte) && typeof cte.name === 'string'
    ? cte.name
    : JSON.stringify(cte);
}

function columnNameOf(item: unknown): string | undefined {
  if (typeof item === 'string') {
    return item;
  }
  return isPlainObject(item) && typeof item.name === 'string'
    ? item.name
    : undefined;
}

/**
 * Map a path in the resolved model to the model-file location it should be
 * reported at, plus the shared-file location the value came from.
 */
export function mapResolvedPath(
  provenance: ProvenanceEntry[],
  path: JsonPath,
): { modelPath: JsonPath; shared?: SharedLocation } {
  let best: ProvenanceEntry | undefined;
  for (const entry of provenance) {
    if (
      pathStartsWith(path, entry.path) &&
      (!best || entry.path.length > best.path.length)
    ) {
      best = entry;
    }
  }
  if (!best) {
    return { modelPath: path };
  }
  const rest = path.slice(best.path.length);
  const { origin } = best;
  if (origin.kind === 'model') {
    return { modelPath: [...origin.path, ...rest] };
  }
  return {
    modelPath: origin.includePath,
    shared: {
      kind: origin.kind,
      name: origin.name,
      filePath: origin.filePath,
      path: [...origin.path, ...rest],
    },
  };
}

interface Annotated {
  value: unknown;
  origin: ProvenanceOrigin;
}

interface AnnotatedCte {
  /** The CTE without its `select`. */
  value: JsonObject;
  select?: Annotated[];
  origin: ProvenanceOrigin;
}

interface Body {
  keys: Map<string, Annotated>;
  select?: Annotated[];
  ctes?: AnnotatedCte[];
}

/** One layer of the model being resolved: the model file or a template. */
interface Level {
  originFor(path: JsonPath): ProvenanceOrigin;
  /** Model-file location that a value at `path` in this layer reports at. */
  anchorFor(path: JsonPath): JsonPath;
  related(path: JsonPath): SharedLocation | undefined;
}

const MODEL_LEVEL: Level = {
  originFor: (path) => ({ kind: 'model', path }),
  anchorFor: (path) => path,
  related: () => undefined,
};

function anchorOf(origin: ProvenanceOrigin): JsonPath {
  return origin.kind === 'model' ? origin.path : origin.includePath;
}

function relatedOf(
  origin: ProvenanceOrigin,
  subPath: JsonPath = [],
): SharedLocation | undefined {
  return origin.kind === 'model'
    ? undefined
    : {
        kind: origin.kind,
        name: origin.name,
        filePath: origin.filePath,
        path: [...origin.path, ...subPath],
      };
}

class Resolver {
  readonly issues: CompositionIssue[] = [];
  readonly fragments = new Set<string>();
  readonly templates = new Set<string>();
  private readonly maxDepth: number;

  constructor(
    private readonly registry: CompositionRegistry | undefined,
    private readonly options: ResolveOptions,
  ) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  report(
    level: Level,
    path: JsonPath,
    message: string,
    severity: CompositionSeverity = 'error',
  ) {
    this.issues.push({
      message,
      severity,
      path: level.anchorFor(path),
      related: level.related(path),
    });
  }

  reportAt(
    origin: ProvenanceOrigin,
    subPath: JsonPath,
    message: string,
    severity: CompositionSeverity = 'error',
  ) {
    this.issues.push({
      message,
      severity,
      path:
        origin.kind === 'model'
          ? [...origin.path, ...subPath]
          : anchorOf(origin),
      related: relatedOf(origin, subPath),
    });
  }

  resolveLevel(
    body: JsonObject,
    level: Level,
    depth: number,
    chain: string[],
  ): Body {
    let base: Body = { keys: new Map() };
    const hasExtends = typeof body.extends === 'string';

    if (hasExtends) {
      const inherited = this.resolveTemplate(
        body.extends as string,
        body.with,
        body.type,
        level,
        depth + 1,
        chain,
      );
      if (inherited) {
        base = inherited;
      }
    } else {
      for (const key of [
        'with',
        'select_exclude',
        'ctes_exclude',
        'select_mode',
        'ctes_mode',
      ]) {
        if (body[key] !== undefined) {
          this.report(
            level,
            [key],
            `"${key}" only applies to a model that uses "extends".`,
          );
        }
      }
    }

    if (body.fragments !== undefined) {
      if (Array.isArray(body.fragments)) {
        body.fragments.forEach((name, i) => {
          if (typeof name !== 'string') {
            return;
          }
          const config = this.resolveConfigFragment(
            name,
            level,
            ['fragments', i],
            depth + 1,
            [],
          );
          for (const [key, annotated] of config) {
            this.overlayKey(base, key, annotated);
          }
        });
      }
    }

    if (hasExtends) {
      this.applyExcludes(base, body, level);
    }

    for (const [key, value] of Object.entries(body)) {
      if (key === '$schema' || AUTHORING_KEY_SET.has(key)) {
        continue;
      }
      if (key === 'select' && Array.isArray(value)) {
        const own = value.map((item, i) => ({
          value: item,
          origin: level.originFor(['select', i]),
        }));
        base.select =
          base.select && body.select_mode !== 'replace'
            ? mergeByIdentity(base.select, own, (a) =>
                selectItemIdentity(a.value),
              )
            : own;
        continue;
      }
      if (key === 'ctes' && Array.isArray(value)) {
        const own = value.map((cte, i) => annotateCte(cte, level, ['ctes', i]));
        base.ctes =
          base.ctes && body.ctes_mode !== 'replace'
            ? mergeByIdentity(base.ctes, own, (c) => cteIdentity(c.value))
            : own;
        continue;
      }
      this.overlayKey(base, key, { value, origin: level.originFor([key]) });
    }

    return base;
  }

  private applyExcludes(base: Body, body: JsonObject, level: Level) {
    if (Array.isArray(body.select_exclude)) {
      body.select_exclude.forEach((id, i) => {
        const before = base.select?.length ?? 0;
        base.select = (base.select ?? []).filter(
          (item) => selectItemIdentity(item.value) !== id,
        );
        if (base.select.length === before) {
          this.report(
            level,
            ['select_exclude', i],
            `"${String(id)}" does not match an inherited select item.`,
          );
        }
      });
    }
    if (Array.isArray(body.ctes_exclude)) {
      body.ctes_exclude.forEach((name, i) => {
        const before = base.ctes?.length ?? 0;
        base.ctes = (base.ctes ?? []).filter(
          (cte) => cteIdentity(cte.value) !== name,
        );
        if (base.ctes.length === before) {
          this.report(
            level,
            ['ctes_exclude', i],
            `"${String(name)}" does not match an inherited CTE.`,
          );
        }
      });
    }
  }

  overlayKey(base: Body, key: string, annotated: Annotated) {
    const existing = base.keys.get(key);
    if (existing && key === 'tags') {
      base.keys.set(key, {
        value: unionJsonArrays(existing.value, annotated.value),
        origin: annotated.origin,
      });
      return;
    }
    if (existing && key === 'meta') {
      base.keys.set(key, {
        value: deepMergeObjects(existing.value, annotated.value),
        origin: annotated.origin,
      });
      return;
    }
    base.keys.set(key, annotated);
  }

  private resolveTemplate(
    name: string,
    withValue: unknown,
    childType: unknown,
    level: Level,
    depth: number,
    chain: string[],
  ): Body | undefined {
    this.templates.add(name);
    if (chain.includes(name)) {
      this.report(
        level,
        ['extends'],
        `Template cycle: ${[...chain, name].join(' -> ')}.`,
      );
      return undefined;
    }
    if (depth > this.maxDepth) {
      this.report(
        level,
        ['extends'],
        `Templates are nested more than ${this.maxDepth} levels deep.`,
      );
      return undefined;
    }
    const lookup = this.registry?.getTemplate(name) ?? {
      status: 'missing' as const,
    };
    if (lookup.status === 'missing') {
      this.report(level, ['extends'], `Unknown template "${name}".`);
      return undefined;
    }
    if (lookup.status === 'duplicate') {
      this.report(
        level,
        ['extends'],
        `Template "${name}" is defined in more than one file: ${lookup.filePaths.join(', ')}.`,
      );
      return undefined;
    }
    const { entry } = lookup;
    const definition = entry.definition;
    if (!isPlainObject(definition.model)) {
      this.report(level, ['extends'], `Template "${name}" has no "model".`);
      return undefined;
    }

    const templateLevel: Level = {
      originFor: (path) => ({
        kind: 'template',
        name,
        filePath: entry.filePath,
        path: ['model', ...path],
        includePath: level.anchorFor(['extends']),
      }),
      anchorFor: () => level.anchorFor(['extends']),
      related: (path) => ({
        kind: 'template',
        name,
        filePath: entry.filePath,
        path: ['model', ...path],
      }),
    };

    const templateModel = definition.model as JsonObject;
    if (templateModel.type !== childType) {
      this.report(
        level,
        ['type'],
        `Model type "${String(childType)}" does not match template "${name}", which has type "${String(templateModel.type)}".`,
      );
      return undefined;
    }

    const declared = definition.params ?? {};
    const provided = isPlainObject(withValue) ? withValue : {};
    for (const key of Object.keys(provided)) {
      if (!(key in declared)) {
        this.report(
          level,
          ['with', key],
          `Template "${name}" has no parameter "${key}".`,
        );
      }
    }
    const values: Record<string, string> = {};
    for (const [key, param] of Object.entries(declared)) {
      if (!param) {
        continue;
      }
      const fromWith = provided[key];
      const value = typeof fromWith === 'string' ? fromWith : param.default;
      const reportPath =
        typeof fromWith === 'string' ? ['with', key] : ['extends'];
      if (value === undefined) {
        this.report(
          level,
          reportPath,
          `Template "${name}" requires parameter "${key}".`,
        );
        continue;
      }
      if (
        param.type === 'model_ref' &&
        this.options.modelExists &&
        !this.options.modelExists(value)
      ) {
        this.report(
          level,
          reportPath,
          `Parameter "${key}" names model "${value}", which does not exist.`,
        );
      }
      values[key] = value;
    }

    const body = substituteParams(
      cloneJson(templateModel),
      values,
      (param, path) => {
        if (param in declared) {
          return;
        }
        this.report(
          templateLevel,
          path,
          `Template "${name}" uses undeclared parameter "${param}".`,
        );
      },
    ) as JsonObject;
    for (const key of TEMPLATE_FORBIDDEN_KEYS) {
      if (key in body) {
        this.report(
          templateLevel,
          [key],
          `Templates can't set "${key}"; it belongs to each model that extends the template.`,
        );
        delete body[key];
      }
    }
    return this.resolveLevel(body, templateLevel, depth, [...chain, name]);
  }

  private resolveConfigFragment(
    name: string,
    level: Level,
    path: JsonPath,
    depth: number,
    stack: string[],
  ): Map<string, Annotated> {
    const result = new Map<string, Annotated>();
    this.fragments.add(name);
    if (stack.includes(name)) {
      this.report(
        level,
        path,
        `Fragment cycle: ${[...stack, name].join(' -> ')}.`,
      );
      return result;
    }
    if (depth > this.maxDepth) {
      this.report(
        level,
        path,
        `Fragments are nested more than ${this.maxDepth} levels deep.`,
      );
      return result;
    }
    const lookup = this.registry?.getFragment(name) ?? {
      status: 'missing' as const,
    };
    if (lookup.status === 'missing') {
      this.report(level, path, `Unknown fragment "${name}".`);
      return result;
    }
    if (lookup.status === 'duplicate') {
      this.report(
        level,
        path,
        `Fragment "${name}" is defined in more than one file: ${lookup.filePaths.join(', ')}.`,
      );
      return result;
    }
    const { entry } = lookup;
    const definition = entry.definition as JsonObject;
    if (definition.kind !== 'config') {
      this.report(
        level,
        path,
        `Fragment "${name}" is a column fragment; include it in "select" with all_from_fragment instead.`,
      );
      return result;
    }
    const overlay = (key: string, annotated: Annotated) => {
      const existing = result.get(key);
      if (existing && key === 'tags') {
        annotated = {
          ...annotated,
          value: unionJsonArrays(existing.value, annotated.value),
        };
      } else if (existing && key === 'meta') {
        annotated = {
          ...annotated,
          value: deepMergeObjects(existing.value, annotated.value),
        };
      }
      result.set(key, annotated);
    };
    if (Array.isArray(definition.fragments)) {
      for (const nested of definition.fragments) {
        if (typeof nested === 'string') {
          for (const [key, annotated] of this.resolveConfigFragment(
            nested,
            level,
            path,
            depth + 1,
            [...stack, name],
          )) {
            overlay(key, annotated);
          }
        }
      }
    }
    for (const [key, value] of Object.entries(definition)) {
      if (FRAGMENT_DOC_KEYS.has(key)) {
        continue;
      }
      overlay(key, {
        value: cloneJson(value),
        origin: {
          kind: 'fragment',
          name,
          filePath: entry.filePath,
          path: [key],
          includePath: level.anchorFor(path),
        },
      });
    }
    return result;
  }

  expandList(list: Annotated[], inCte: boolean): Annotated[] {
    const out: Annotated[] = [];
    for (const item of list) {
      if (isFragmentSelect(item.value)) {
        out.push(...this.expandInclude(item.value, item.origin, inCte, 1, []));
      } else {
        out.push(item);
      }
    }
    const seen = new Map<string, Annotated>();
    for (const item of out) {
      const name = columnNameOf(item.value);
      if (!name) {
        continue;
      }
      const previous = seen.get(name);
      if (
        previous &&
        (item.origin.kind === 'fragment' || previous.origin.kind === 'fragment')
      ) {
        this.reportAt(
          item.origin,
          [],
          `Column "${name}" is selected more than once after expanding fragments.`,
        );
        continue;
      }
      seen.set(name, item);
    }
    return out;
  }

  private expandInclude(
    include: SchemaModelSelectFragment,
    includeOrigin: ProvenanceOrigin,
    inCte: boolean,
    depth: number,
    stack: string[],
  ): Annotated[] {
    const name = include.fragment;
    const report = (
      subPath: JsonPath,
      message: string,
      severity: CompositionSeverity = 'error',
    ) => this.reportAt(includeOrigin, subPath, message, severity);

    this.fragments.add(name);
    if (stack.includes(name)) {
      report(['fragment'], `Fragment cycle: ${[...stack, name].join(' -> ')}.`);
      return [];
    }
    if (depth > this.maxDepth) {
      report(
        ['fragment'],
        `Fragments are nested more than ${this.maxDepth} levels deep.`,
      );
      return [];
    }
    const lookup = this.registry?.getFragment(name) ?? {
      status: 'missing' as const,
    };
    if (lookup.status === 'missing') {
      report(['fragment'], `Unknown fragment "${name}".`);
      return [];
    }
    if (lookup.status === 'duplicate') {
      report(
        ['fragment'],
        `Fragment "${name}" is defined in more than one file: ${lookup.filePaths.join(', ')}.`,
      );
      return [];
    }
    const { entry } = lookup;
    const definition = entry.definition as JsonObject;
    if (definition.kind !== 'select' || !Array.isArray(definition.select)) {
      report(
        ['fragment'],
        `Fragment "${name}" is a config fragment; list it in the model's root "fragments" instead.`,
      );
      return [];
    }

    const includePath = anchorOf(includeOrigin);
    let columns: Annotated[] = [];
    definition.select.forEach((item, k) => {
      const origin: ProvenanceOrigin = {
        kind: 'fragment',
        name,
        filePath: entry.filePath,
        path: ['select', k],
        includePath,
      };
      if (isFragmentSelect(item)) {
        columns.push(
          ...this.expandInclude(item, origin, inCte, depth + 1, [
            ...stack,
            name,
          ]),
        );
      } else {
        columns.push({ value: cloneJson(item), origin });
      }
    });

    const allNames = new Set(
      columns.map((c) => columnNameOf(c.value)).filter(Boolean) as string[],
    );

    if (include.type !== 'all_from_fragment') {
      const wanted = include.type === 'dims_from_fragment' ? 'dim' : 'fct';
      columns = columns.filter((column) => {
        if (typeof column.value === 'string') {
          report(
            ['type'],
            `Column "${column.value}" in fragment "${name}" has no explicit type, so ${include.type} can't classify it. Give it a type in the fragment or use all_from_fragment.`,
          );
          return false;
        }
        const type = isPlainObject(column.value)
          ? column.value.type ?? 'dim'
          : undefined;
        return type === wanted;
      });
    }
    const keptNames = new Set(
      columns.map((c) => columnNameOf(c.value)).filter(Boolean) as string[],
    );

    if (include.include) {
      include.include.forEach((col, i) => {
        if (!allNames.has(col)) {
          report(['include', i], `Fragment "${name}" has no column "${col}".`);
        } else if (!keptNames.has(col)) {
          report(
            ['include', i],
            `Column "${col}" isn't selected by ${include.type}.`,
          );
        }
      });
      const wanted = new Set<string>(include.include);
      columns = columns.filter((c) => wanted.has(columnNameOf(c.value) ?? ''));
    }
    if (include.exclude) {
      include.exclude.forEach((col, i) => {
        if (!allNames.has(col)) {
          report(['exclude', i], `Fragment "${name}" has no column "${col}".`);
        }
      });
      const dropped = new Set<string>(include.exclude);
      columns = columns.filter(
        (c) => !dropped.has(columnNameOf(c.value) ?? ''),
      );
    }

    if (include.overrides) {
      const finalNames = new Set(
        columns.map((c) => columnNameOf(c.value)).filter(Boolean) as string[],
      );
      for (const [col, override] of Object.entries(include.overrides)) {
        if (!override) {
          continue;
        }
        if (!allNames.has(col)) {
          report(
            ['overrides', col],
            `Fragment "${name}" has no column "${col}".`,
          );
          continue;
        }
        if (!finalNames.has(col)) {
          report(
            ['overrides', col],
            `Override for "${col}" has no effect because the column isn't included.`,
            'warning',
          );
          continue;
        }
        columns = columns.map((column) => {
          if (columnNameOf(column.value) !== col) {
            return column;
          }
          const baseValue =
            typeof column.value === 'string'
              ? { name: column.value }
              : (column.value as JsonObject);
          return {
            ...column,
            value: { ...baseValue, ...cloneJson(override) },
          };
        });
      }
    }

    if (inCte) {
      columns = columns.map((column) => {
        if (isPlainObject(column.value) && 'lightdash' in column.value) {
          const { lightdash: _lightdash, ...rest } = column.value;
          return { ...column, value: rest };
        }
        return column;
      });
    }

    if (columns.length === 0) {
      report(
        [],
        `Fragment "${name}" adds no columns after filters.`,
        'warning',
      );
    }
    return columns;
  }
}

function annotateCte(cte: unknown, level: Level, path: JsonPath): AnnotatedCte {
  const origin = level.originFor(path);
  if (!isPlainObject(cte)) {
    return { value: {}, origin };
  }
  const { select, ...rest } = cte;
  return {
    value: rest,
    select: Array.isArray(select)
      ? select.map((item, j) => ({
          value: item,
          origin: level.originFor([...path, 'select', j]),
        }))
      : undefined,
    origin,
  };
}

function mergeByIdentity<T>(
  inherited: T[],
  own: T[],
  identity: (item: T) => string,
): T[] {
  const result = [...inherited];
  for (const item of own) {
    const id = identity(item);
    const index = result.findIndex((existing) => identity(existing) === id);
    if (index >= 0) {
      result[index] = item;
    } else {
      result.push(item);
    }
  }
  return result;
}

const PARAM_PATTERN = /\$\$\{|\$\{([^}]*)\}/g;

function substituteParams(
  value: unknown,
  params: Record<string, string>,
  onUnknown: (param: string, path: JsonPath) => void,
  path: JsonPath = [],
): unknown {
  if (typeof value === 'string') {
    return value.replace(PARAM_PATTERN, (match, param: string | undefined) => {
      if (match === '$${') {
        return '${';
      }
      if (param !== undefined && param in params) {
        return params[param];
      }
      onUnknown(param ?? '', path);
      return match;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      substituteParams(item, params, onUnknown, [...path, i]),
    );
  }
  if (isPlainObject(value)) {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteParams(item, params, onUnknown, [...path, key]);
    }
    return out;
  }
  return value;
}

/**
 * Resolve a model's templates and fragments into a concrete model.
 *
 * Pure: reads only the registry and the given model, never the filesystem.
 * Models without composition are returned as-is (`composed: false`).
 */
export function resolveModelComposition<TModel = Record<string, unknown>>(
  model: unknown,
  registry: CompositionRegistry | undefined,
  options: ResolveOptions = {},
): ResolveResult<TModel> {
  if (!usesComposition(model) || !isPlainObject(model)) {
    return {
      resolved: model as TModel,
      composed: false,
      provenance: [],
      dependencies: { fragments: [], templates: [] },
      issues: [],
      hasErrors: false,
    };
  }

  const mode = options.mode ?? 'full';
  const resolver = new Resolver(registry, options);
  const body = resolver.resolveLevel(model, MODEL_LEVEL, 0, []);

  const materialized = body.keys.get('materialized');
  const materialization = body.keys.get('materialization');
  if (
    materialized?.origin.kind === 'model' &&
    materialization &&
    materialization.origin.kind !== 'model'
  ) {
    resolver.issues.push({
      message:
        'Remove the legacy "materialized" field: a fragment or template already sets "materialization".',
      severity: 'error',
      path: ['materialized'],
      related: relatedOf(materialization.origin),
    });
  }

  if (mode === 'full') {
    if (body.select) {
      body.select = resolver.expandList(body.select, false);
    }
    for (const cte of body.ctes ?? []) {
      if (cte.select) {
        cte.select = resolver.expandList(cte.select, true);
      }
    }
  }

  const resolved: JsonObject = {};
  const provenance: ProvenanceEntry[] = [];
  const orderedKeys = [
    ...IDENTITY_KEYS.filter((key) => body.keys.has(key)),
    ...[...body.keys.keys()].filter(
      (key) => !(IDENTITY_KEYS as readonly string[]).includes(key),
    ),
  ];
  for (const key of orderedKeys) {
    const annotated = body.keys.get(key)!;
    resolved[key] = annotated.value;
    provenance.push({ path: [key], origin: annotated.origin });
  }
  if (mode === 'merged') {
    for (const key of ['extends', 'with', 'fragments']) {
      if (model[key] !== undefined) {
        resolved[key] = model[key];
        provenance.push({
          path: [key],
          origin: { kind: 'model', path: [key] },
        });
      }
    }
  }
  if (body.ctes) {
    resolved.ctes = body.ctes.map((cte, i) => {
      provenance.push({ path: ['ctes', i], origin: cte.origin });
      const out: JsonObject = { ...cte.value };
      if (cte.select) {
        out.select = cte.select.map((item, j) => {
          provenance.push({
            path: ['ctes', i, 'select', j],
            origin: item.origin,
          });
          return item.value;
        });
      }
      return out;
    });
  }
  if (body.select) {
    resolved.select = body.select.map((item, j) => {
      provenance.push({ path: ['select', j], origin: item.origin });
      return item.value;
    });
  }

  return {
    resolved: resolved as TModel,
    composed: true,
    provenance,
    dependencies: {
      fragments: [...resolver.fragments].sort(),
      templates: [...resolver.templates].sort(),
    },
    issues: resolver.issues,
    hasErrors: resolver.issues.some((issue) => issue.severity === 'error'),
  };
}
