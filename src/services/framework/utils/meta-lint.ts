/**
 * Reserved-key lint pass for model-level and column-level `meta`.
 *
 * Surfaces the collision cases described in the model/column meta schemas
 * (see `schemas/model.meta.schema.json`, `schemas/column.meta.schema.json`)
 * so users don't silently lose authored values at YAML emit time.
 *
 * Two flavours of reserved keys:
 *
 *   1. **Populated-reserved** — the framework writes the value from a
 *      structured sibling field (`lightdash.*`, `tags`, etc.). Any user-
 *      authored key of the same name under `meta` is overwritten. The
 *      effective resolution is a *silent framework-wins*; the warning is
 *      there so the user can move the value to the canonical place.
 *
 *   2. **SQL-internal reserved** — the framework treats these as internal
 *      state flowing between column-processing stages (select-line builder,
 *      group-by builder, inheritance walker, column-name generator). They
 *      are stripped from the emitted YAML and have no effect on SQL when
 *      authored under `meta` -- the framework only reads them from the
 *      top-level sibling on the select item (`select[i].agg`, `.expr`,
 *      `.prefix`, `.lightdash.metrics_merge`, etc.).
 *
 * This module is intentionally pure: it takes parsed model JSON and returns
 * structured warnings. Positioning + severity rendering is the caller's
 * concern (see `framework/index.ts` → `onModelValidationLintWarnings`).
 */

import type { ValidationErrorDetail } from '@services/sync/types';
import type { FrameworkModel } from '@shared/framework/types';

/**
 * Model-level `meta` keys populated by the framework from structured
 * sibling fields on the model. Survive to emitted YAML.
 */
export const MODEL_META_POPULATED_RESERVED_KEYS = [
  'metrics',
  'portal_partition_columns',
  'local_tags',
  'case_sensitive',
] as const;

/**
 * Column-level `meta` keys populated by the framework from `selected.type`
 * / `selected.lightdash.*` / upstream lookup. Survive to emitted YAML.
 */
export const COLUMN_META_POPULATED_RESERVED_KEYS = [
  'type',
  'origin',
  'dimension',
  'metrics',
  'case_sensitive',
] as const;

/**
 * Column-level `meta` keys used by the framework as internal state for SQL
 * generation and column inheritance. Each has a typed sibling on the
 * select item (`select[i].<key>` or `select[i].lightdash.<key>` for
 * `metrics_merge`) which is the canonical authoring location. Stripped
 * from the emitted YAML.
 */
export const COLUMN_META_SQL_INTERNAL_RESERVED_KEYS = [
  'agg',
  'aggs',
  'expr',
  'prefix',
  'exclude_from_group_by',
  'interval',
  'override_suffix_agg',
  'metrics_merge',
] as const;

type PopulatedReservedModelKey =
  (typeof MODEL_META_POPULATED_RESERVED_KEYS)[number];
type PopulatedReservedColumnKey =
  (typeof COLUMN_META_POPULATED_RESERVED_KEYS)[number];
type SqlInternalReservedColumnKey =
  (typeof COLUMN_META_SQL_INTERNAL_RESERVED_KEYS)[number];

const POPULATED_MODEL_KEY_SET: ReadonlySet<string> = new Set(
  MODEL_META_POPULATED_RESERVED_KEYS,
);
const POPULATED_COLUMN_KEY_SET: ReadonlySet<string> = new Set(
  COLUMN_META_POPULATED_RESERVED_KEYS,
);
const SQL_INTERNAL_COLUMN_KEY_SET: ReadonlySet<string> = new Set(
  COLUMN_META_SQL_INTERNAL_RESERVED_KEYS,
);

/**
 * Hint text pointing the user at the canonical authoring location for each
 * populated-reserved column key.
 */
const POPULATED_COLUMN_KEY_HINT: Record<PopulatedReservedColumnKey, string> = {
  type: 'move the value to `type` on the select item',
  origin: 'framework-derived from upstream column lookup; remove from `meta`',
  dimension: 'move the value to `lightdash.dimension` on the select item',
  metrics: 'move the value to `lightdash.metrics` on the select item',
  case_sensitive:
    'move the value to `lightdash.case_sensitive` on the select item',
};

/**
 * Hint text for each populated-reserved model key.
 */
const POPULATED_MODEL_KEY_HINT: Record<PopulatedReservedModelKey, string> = {
  metrics: 'move the value to `lightdash.metrics` on the model',
  portal_partition_columns:
    'framework-inherited from upstream model output; remove from `meta`',
  local_tags:
    'author local-scoped tags via `tags: [{ type: "local", tag: "..." }]` on the model',
  case_sensitive: 'move the value to `lightdash.case_sensitive` on the model',
};

/**
 * Hint text for each SQL-internal reserved column key.
 */
const SQL_INTERNAL_COLUMN_KEY_HINT: Record<
  SqlInternalReservedColumnKey,
  string
> = {
  agg: 'move the value to `agg` on the select item',
  aggs: 'move the value to `aggs` on the select item',
  expr: 'move the value to `expr` on the select item',
  prefix: 'move the value to `prefix` on the select item',
  exclude_from_group_by:
    'move the value to `exclude_from_group_by` on the select item',
  interval: 'move the value to `interval` on the select item',
  override_suffix_agg:
    'move the value to `override_suffix_agg` on the select item',
  metrics_merge:
    'move the value to `lightdash.metrics_merge` on the select item',
};

/**
 * Escape a JSON-pointer segment per RFC 6901 (`~` → `~0`, `/` → `~1`).
 */
function escapePointerSegment(segment: string | number): string {
  if (typeof segment === 'number') {
    return String(segment);
  }
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Walk the model-level `meta` block and emit a warning for every
 * user-authored key that collides with either:
 *   - the static populated-reserved set, or
 *   - a key the framework will spread from `modelJson.lightdash.table`.
 */
function lintModelMeta(
  modelJson: FrameworkModel,
  warnings: ValidationErrorDetail[],
): void {
  if (!('meta' in modelJson) || !modelJson.meta) {
    return;
  }
  const meta = modelJson.meta as Record<string, unknown>;

  // Collect the dynamic reserved keys first -- any key the framework will
  // spread from modelJson.lightdash.table at YAML emit time.
  const dynamicLightdashTableKeys = new Set<string>();
  if ('lightdash' in modelJson) {
    const lightdashTable =
      (
        modelJson as unknown as {
          lightdash?: { table?: Record<string, unknown> };
        }
      ).lightdash?.table ?? null;
    if (lightdashTable && typeof lightdashTable === 'object') {
      for (const key of Object.keys(lightdashTable)) {
        dynamicLightdashTableKeys.add(key);
      }
    }
  }

  for (const key of Object.keys(meta)) {
    if (POPULATED_MODEL_KEY_SET.has(key)) {
      const hint = POPULATED_MODEL_KEY_HINT[key as PopulatedReservedModelKey];
      warnings.push({
        instancePath: `/meta/${escapePointerSegment(key)}`,
        message: `\`meta.${key}\` is a framework-populated reserved key and will be overwritten at YAML emit time. ${hint}.`,
      });
      continue;
    }
    if (dynamicLightdashTableKeys.has(key)) {
      warnings.push({
        instancePath: `/meta/${escapePointerSegment(key)}`,
        message: `\`meta.${key}\` is also authored under \`lightdash.table.${key}\` and will be overwritten by the lightdash.table value at YAML emit time. Remove one of the two declarations.`,
      });
    }
  }
}

/**
 * Walk every select item's `meta` and emit a warning for collisions with
 * the populated-reserved column set or the SQL-internal reserved column set.
 */
function lintColumnMeta(
  modelJson: FrameworkModel,
  warnings: ValidationErrorDetail[],
): void {
  if (!('select' in modelJson) || !Array.isArray(modelJson.select)) {
    return;
  }
  const select = modelJson.select as unknown as Array<Record<string, unknown>>;
  for (let i = 0; i < select.length; i++) {
    const item = select[i];
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !('meta' in item) ||
      !item.meta ||
      typeof item.meta !== 'object' ||
      Array.isArray(item.meta)
    ) {
      continue;
    }
    const meta = item.meta as Record<string, unknown>;
    const selectName =
      typeof item.name === 'string' ? item.name : `select[${i}]`;
    for (const key of Object.keys(meta)) {
      if (POPULATED_COLUMN_KEY_SET.has(key)) {
        const hint =
          POPULATED_COLUMN_KEY_HINT[key as PopulatedReservedColumnKey];
        warnings.push({
          instancePath: `/select/${i}/meta/${escapePointerSegment(key)}`,
          message: `\`meta.${key}\` on select \`${selectName}\` is a framework-populated reserved key and will be overwritten at YAML emit time. ${hint}.`,
        });
        continue;
      }
      if (SQL_INTERNAL_COLUMN_KEY_SET.has(key)) {
        const hint =
          SQL_INTERNAL_COLUMN_KEY_HINT[key as SqlInternalReservedColumnKey];
        warnings.push({
          instancePath: `/select/${i}/meta/${escapePointerSegment(key)}`,
          message: `\`meta.${key}\` on select \`${selectName}\` is a SQL-internal reserved key. Authoring it under \`meta\` has no effect on generated SQL and is stripped from the emitted YAML. ${hint}.`,
        });
      }
    }
  }
}

/**
 * Collect reserved-key lint warnings for a parsed model JSON document.
 *
 * Returns an empty array when no collisions are detected.
 */
export function collectModelMetaLintWarnings(
  modelJson: FrameworkModel,
): ValidationErrorDetail[] {
  const warnings: ValidationErrorDetail[] = [];
  lintModelMeta(modelJson, warnings);
  lintColumnMeta(modelJson, warnings);
  return warnings;
}
