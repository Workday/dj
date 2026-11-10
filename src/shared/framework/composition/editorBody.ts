import { cloneJson, isPlainObject, type JsonObject } from './json';
import { COMPOSITION_AUTHORING_KEYS } from './resolve';

/**
 * Authoring keys the editor keeps from the model file. The webview saves these
 * back as-is; the other authoring keys are recomputed by `diffAgainstTemplate`
 * on save, so the editor drops them.
 */
const EDITOR_AUTHORING_KEYS = new Set<string>(['extends', 'with', 'fragments']);

/**
 * Build the body a model editor is prefilled with: the merged-mode resolved
 * model (template and config fragments applied, column fragment entries kept
 * as authored) plus the editor's authoring keys from the raw file.
 */
export function buildEditorBody(
  raw: unknown,
  resolvedMerged: unknown,
): JsonObject {
  const body: JsonObject = isPlainObject(resolvedMerged)
    ? cloneJson(resolvedMerged)
    : {};
  for (const key of COMPOSITION_AUTHORING_KEYS) {
    if (!EDITOR_AUTHORING_KEYS.has(key)) {
      delete body[key];
    }
  }
  if (!isPlainObject(raw)) {
    return body;
  }
  for (const key of EDITOR_AUTHORING_KEYS) {
    if (raw[key] !== undefined) {
      body[key] = cloneJson(raw[key]);
    } else {
      delete body[key];
    }
  }
  return body;
}
