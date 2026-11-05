import { jsonParse } from '@shared';
import * as fs from 'fs';

import { resolveModelJson } from './provider';
import type { ResolveOptions, ResolveResult } from './types';

export interface LoadedModelJson<TModel> extends ResolveResult<TModel> {
  /** The model exactly as authored; the only shape ever written back. */
  raw: unknown;
}

/**
 * Read a `.model.json` and resolve its fragments and templates. Analysis
 * surfaces (lineage, catalog search, previews) read models through this so
 * shared definitions look the same as inline ones. Returns null when the file
 * is missing or not valid JSON.
 *
 * Node-only: import from `@shared/framework/composition/node`.
 */
export function loadResolvedModelJson<TModel = Record<string, unknown>>(
  modelFilePath: string,
  options?: ResolveOptions,
): LoadedModelJson<TModel> | null {
  let raw: unknown;
  try {
    raw = jsonParse(fs.readFileSync(modelFilePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return { raw, ...resolveModelJson<TModel>(raw, modelFilePath, options) };
}

export async function loadResolvedModelJsonAsync<
  TModel = Record<string, unknown>,
>(
  modelFilePath: string,
  options?: ResolveOptions,
): Promise<LoadedModelJson<TModel> | null> {
  let raw: unknown;
  try {
    raw = jsonParse(await fs.promises.readFile(modelFilePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return { raw, ...resolveModelJson<TModel>(raw, modelFilePath, options) };
}
