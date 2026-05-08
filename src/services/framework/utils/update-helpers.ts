/**
 * Pure helpers used by the model-update API handler.
 *
 * These live in their own module (rather than inside
 * `handlers/model-crud-handlers.ts`) so the merge logic can be unit-tested
 * without dragging the VS Code / Ajv / FS plumbing required by the handler
 * class.
 */

/**
 * Reconciles the incoming `select[]` from the UI with the existing model JSON
 * on disk, preserving per-column free-form `meta` keys the UI doesn't surface.
 *
 * The UI replaces `select[]` wholesale on save. Without this pass, any
 * hand-authored column meta keys (owner, pii, compliance, etc.) would be
 * dropped on the first UI save. For each incoming select item we find the
 * matching existing item by `name` and shallow-merge the existing `meta` so
 * free-form keys survive; keys present on the incoming meta still win on
 * collision (the UI is authoritative for anything it does populate).
 *
 * Mutates `incomingBase.select` in place when preservation is needed.
 */
export function preserveColumnMetaOnUpdate(
  existingModelJson: Record<string, unknown>,
  incomingBase: Record<string, unknown>,
): void {
  const existingSelect = existingModelJson.select;
  const incomingSelect = incomingBase.select;
  if (!Array.isArray(existingSelect) || !Array.isArray(incomingSelect)) {
    return;
  }
  const existingMetaByName = new Map<string, Record<string, unknown>>();
  for (const existingItem of existingSelect) {
    if (
      existingItem &&
      typeof existingItem === 'object' &&
      !Array.isArray(existingItem) &&
      typeof (existingItem as Record<string, unknown>).name === 'string' &&
      (existingItem as Record<string, unknown>).meta &&
      typeof (existingItem as Record<string, unknown>).meta === 'object'
    ) {
      const castItem = existingItem as Record<string, unknown>;
      existingMetaByName.set(
        castItem.name as string,
        castItem.meta as Record<string, unknown>,
      );
    }
  }
  if (!existingMetaByName.size) {
    return;
  }
  incomingBase.select = incomingSelect.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof (item as Record<string, unknown>).name !== 'string'
    ) {
      return item;
    }
    const castItem = item as Record<string, unknown>;
    const existingMeta = existingMetaByName.get(castItem.name as string);
    if (!existingMeta) {
      return item;
    }
    const incomingMeta =
      castItem.meta &&
      typeof castItem.meta === 'object' &&
      !Array.isArray(castItem.meta)
        ? (castItem.meta as Record<string, unknown>)
        : {};
    const mergedMeta = { ...existingMeta, ...incomingMeta };
    if (Object.keys(mergedMeta).length === 0) {
      return item;
    }
    return { ...castItem, meta: mergedMeta };
  });
}
