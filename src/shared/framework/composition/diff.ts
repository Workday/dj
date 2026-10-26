import { isPlainObject, jsonEqual, type JsonObject } from './json';
import type { CompositionRegistry } from './registry';
import {
  COMPOSITION_AUTHORING_KEYS,
  cteIdentity,
  resolveModelComposition,
  selectItemIdentity,
} from './resolve';
import type { DiffAgainstTemplateResult, ResolveOptions } from './types';

const IDENTITY_KEYS = ['type', 'group', 'topic', 'name'];
const AUTHORING_KEYS = new Set<string>(COMPOSITION_AUTHORING_KEYS);

function stripAuthoring(model: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(model)) {
    if (!AUTHORING_KEYS.has(key) && key !== '$schema') {
      out[key] = value;
    }
  }
  return out;
}

/** Tag order carries no meaning, so compare tags as a set. */
function normalizeForCompare(model: JsonObject): JsonObject {
  const out = stripAuthoring(model);
  if (Array.isArray(out.tags)) {
    out.tags = [...out.tags].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return out;
}

interface ListDiff {
  items?: unknown[];
  exclude?: string[];
  replace: boolean;
}

function diffList(
  base: unknown[],
  target: unknown[],
  identity: (item: unknown) => string,
): ListDiff {
  const baseIds = base.map(identity);
  const targetIds = target.map(identity);
  if (
    new Set(baseIds).size !== baseIds.length ||
    new Set(targetIds).size !== targetIds.length
  ) {
    return { replace: true };
  }
  const baseSet = new Set(baseIds);
  const targetSet = new Set(targetIds);
  const commonInTarget = targetIds.filter((id) => baseSet.has(id));
  const commonInBase = baseIds.filter((id) => targetSet.has(id));
  if (commonInTarget.join('\u0000') !== commonInBase.join('\u0000')) {
    return { replace: true };
  }
  // Merging appends new items at the end, so a new item placed before an
  // inherited one can only be expressed with a full replacement.
  const lastCommon = Math.max(
    -1,
    ...targetIds.map((id, i) => (baseSet.has(id) ? i : -1)),
  );
  const firstNew = targetIds.findIndex((id) => !baseSet.has(id));
  if (firstNew !== -1 && firstNew < lastCommon) {
    return { replace: true };
  }
  const items: unknown[] = [];
  target.forEach((item, i) => {
    const id = targetIds[i];
    if (!baseSet.has(id)) {
      items.push(item);
      return;
    }
    if (!jsonEqual(item, base[baseIds.indexOf(id)])) {
      items.push(item);
    }
  });
  const exclude = baseIds.filter((id) => !targetSet.has(id));
  return {
    items: items.length > 0 ? items : undefined,
    exclude: exclude.length > 0 ? exclude : undefined,
    replace: false,
  };
}

function diffObject(
  base: JsonObject,
  target: JsonObject,
  path: string,
  warnings: string[],
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(target)) {
    if (!(key in base)) {
      out[key] = value;
    } else if (isPlainObject(base[key]) && isPlainObject(value)) {
      const nested = diffObject(base[key], value, `${path}.${key}`, warnings);
      if (Object.keys(nested).length > 0) {
        out[key] = nested;
      }
    } else if (!jsonEqual(base[key], value)) {
      out[key] = value;
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in target)) {
      warnings.push(
        `Can't remove inherited "${path}.${key}": a model can only add or change meta keys.`,
      );
    }
  }
  return out;
}

function applyListDiff(
  child: JsonObject,
  diff: ListDiff,
  target: unknown[],
  keys: { list: string; exclude: string; mode: string },
) {
  if (diff.replace) {
    child[keys.list] = target;
    child[keys.mode] = 'replace';
    return;
  }
  if (diff.items) {
    child[keys.list] = diff.items;
  }
  if (diff.exclude) {
    child[keys.exclude] = diff.exclude;
  }
}

/**
 * Compute the smallest template child that resolves (in `merged` mode) to
 * `edited`. `edited` is a template child's full body as shown in an editor:
 * identity, `extends`, `with`, optional root `fragments`, and every inherited
 * or overridden key.
 */
export function diffAgainstTemplate(
  edited: JsonObject,
  registry: CompositionRegistry | undefined,
  options: ResolveOptions = {},
): DiffAgainstTemplateResult {
  if (typeof edited.extends !== 'string') {
    return { child: edited, exact: true, warnings: [] };
  }
  const warnings: string[] = [];
  const child: JsonObject = {};
  for (const key of [...IDENTITY_KEYS, 'extends', 'with', 'fragments']) {
    if (edited[key] !== undefined) {
      child[key] = edited[key];
    }
  }
  const mergedOptions: ResolveOptions = { ...options, mode: 'merged' };
  const base = stripAuthoring(
    resolveModelComposition<JsonObject>(child, registry, mergedOptions)
      .resolved,
  );
  const target = stripAuthoring(edited);

  for (const [key, value] of Object.entries(target)) {
    if (IDENTITY_KEYS.includes(key) || value === undefined) {
      continue;
    }
    const inherited = base[key];
    if (key === 'select' && Array.isArray(value)) {
      applyListDiff(
        child,
        diffList(
          Array.isArray(inherited) ? inherited : [],
          value,
          selectItemIdentity,
        ),
        value,
        { list: 'select', exclude: 'select_exclude', mode: 'select_mode' },
      );
      continue;
    }
    if (key === 'ctes' && Array.isArray(value)) {
      applyListDiff(
        child,
        diffList(Array.isArray(inherited) ? inherited : [], value, cteIdentity),
        value,
        { list: 'ctes', exclude: 'ctes_exclude', mode: 'ctes_mode' },
      );
      continue;
    }
    if (key === 'tags' && Array.isArray(value) && Array.isArray(inherited)) {
      const extras = value.filter(
        (tag) => !inherited.some((existing) => jsonEqual(existing, tag)),
      );
      if (inherited.some((tag) => !value.some((t) => jsonEqual(t, tag)))) {
        warnings.push(
          `Can't remove inherited tags: tags from the template and fragments are always kept.`,
        );
      }
      if (extras.length > 0) {
        child.tags = extras;
      }
      continue;
    }
    if (key === 'meta' && isPlainObject(value) && isPlainObject(inherited)) {
      const metaDiff = diffObject(inherited, value, 'meta', warnings);
      if (Object.keys(metaDiff).length > 0) {
        child.meta = metaDiff;
      }
      continue;
    }
    if (!jsonEqual(inherited, value)) {
      child[key] = value;
    }
  }
  for (const key of Object.keys(base)) {
    if (!IDENTITY_KEYS.includes(key) && !(key in target)) {
      if (key === 'select') {
        child.select_exclude = (base.select as unknown[]).map(
          selectItemIdentity,
        );
      } else if (key === 'ctes') {
        child.ctes_exclude = (base.ctes as unknown[]).map(cteIdentity);
      } else {
        warnings.push(
          `Can't remove inherited "${key}"; set it to a different value instead.`,
        );
      }
    }
  }

  const reproduces = (candidate: JsonObject) =>
    jsonEqual(
      normalizeForCompare(
        resolveModelComposition<JsonObject>(candidate, registry, mergedOptions)
          .resolved,
      ),
      normalizeForCompare(edited),
    );

  let exact = reproduces(child);
  if (!exact) {
    for (const keys of [
      { list: 'select', exclude: 'select_exclude', mode: 'select_mode' },
      { list: 'ctes', exclude: 'ctes_exclude', mode: 'ctes_mode' },
    ]) {
      const value = target[keys.list];
      if (Array.isArray(value) && child[keys.mode] !== 'replace') {
        delete child[keys.exclude];
        child[keys.list] = value;
        child[keys.mode] = 'replace';
      }
    }
    exact = reproduces(child);
  }
  return { child, exact, warnings };
}
