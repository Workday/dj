import type { JsonPath } from './types';

export type JsonObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Structural equality that ignores object key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).filter((k) => a[k] !== undefined);
    const bKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    return aKeys.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

/** Recursive merge where `higher` wins; nested plain objects are merged key by key. */
export function deepMergeObjects(lower: unknown, higher: unknown): unknown {
  if (isPlainObject(lower) && isPlainObject(higher)) {
    const out: JsonObject = { ...lower };
    for (const [key, value] of Object.entries(higher)) {
      out[key] = key in out ? deepMergeObjects(out[key], value) : value;
    }
    return out;
  }
  return higher;
}

/** Array union that keeps first-seen order and compares items structurally. */
export function unionJsonArrays(lower: unknown, higher: unknown): unknown {
  const out: unknown[] = [];
  for (const item of [
    ...(Array.isArray(lower) ? lower : []),
    ...(Array.isArray(higher) ? higher : []),
  ]) {
    if (!out.some((existing) => jsonEqual(existing, item))) {
      out.push(item);
    }
  }
  return out;
}

export function pathStartsWith(path: JsonPath, prefix: JsonPath): boolean {
  return (
    prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg)
  );
}

/** Convert an Ajv `instancePath` (`/select/3/expr`) to a JSON path. */
export function instancePathToJsonPath(instancePath: string): JsonPath {
  if (!instancePath) {
    return [];
  }
  return instancePath
    .split('/')
    .slice(1)
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

export function jsonPathToInstancePath(path: JsonPath): string {
  return path
    .map((seg) => `/${String(seg).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

/** FNV-1a 32-bit hash; deterministic in both Node and the webview. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
