import {
  filterBulkSelectColumns,
  isAggregateExpr,
  isConstantExpr,
  isJinjaExpr,
  isWindowFunctionExpr,
} from '@services/framework/utils/column-utils';
import {
  BULK_CTE_TYPES,
  DEFAULT_INCREMENTAL_STRATEGY,
} from '@shared/framework/constants';
import type { FrameworkColumn } from '@shared/framework/types';
import type { ValidateFunction } from 'ajv';
import type { ErrorObject } from 'ajv';

import type { ValidationErrorDetail } from './sync/types';

/**
 * Maps model types to their specific schema file names
 */
const MODEL_TYPE_SCHEMA_MAP: Record<string, string> = {
  stg_select_source: 'model.type.stg_select_source.schema.json',
  stg_select_model: 'model.type.stg_select_model.schema.json',
  stg_union_sources: 'model.type.stg_union_sources.schema.json',
  int_select_model: 'model.type.int_select_model.schema.json',
  int_join_column: 'model.type.int_join_column.schema.json',
  int_join_models: 'model.type.int_join_models.schema.json',
  int_lookback_model: 'model.type.int_lookback_model.schema.json',
  int_rollup_model: 'model.type.int_rollup_model.schema.json',
  int_union_models: 'model.type.int_union_models.schema.json',
  mart_select_model: 'model.type.mart_select_model.schema.json',
  mart_join_models: 'model.type.mart_join_models.schema.json',
};

/**
 * Gets the specific schema validator for a given model type
 */
export function getValidatorForType(
  ajv: any,
  type: string,
): ValidateFunction | null {
  const schemaId = MODEL_TYPE_SCHEMA_MAP[type];
  if (!schemaId) {
    return null;
  }

  try {
    return ajv.getSchema(schemaId);
  } catch {
    return null;
  }
}

/**
 * Formats validation errors into human-readable messages
 * @param errors - Array of AJV validation errors
 * @param context - Either 'model' or 'source'
 * @param type - For models: the model type (required). For sources: undefined
 */
export function formatValidationErrors(
  errors: ErrorObject[] | null | undefined,
  context: 'model' | 'source' | 'python-model',
  type?: string,
): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  const messages: string[] = [];

  // Group errors by type for better presentation
  const requiredErrors: ErrorObject[] = [];
  const additionalPropErrors: ErrorObject[] = [];
  const typeErrors: ErrorObject[] = [];
  const otherErrors: ErrorObject[] = [];

  for (const error of errors) {
    if (error.keyword === 'required') {
      requiredErrors.push(error);
    } else if (error.keyword === 'additionalProperties') {
      additionalPropErrors.push(error);
    } else if (error.keyword === 'type' || error.keyword === 'const') {
      typeErrors.push(error);
    } else {
      otherErrors.push(error);
    }
  }

  // Add header based on context
  if (context === 'model') {
    if (type) {
      messages.push(`Validation errors for model type "${type}":\n`);
    } else {
      messages.push(`Validation errors for model:\n`);
    }
  } else if (context === 'source') {
    messages.push(`Validation errors for source:\n`);
  }

  // Format required field errors
  if (requiredErrors.length > 0) {
    const missingFields = requiredErrors
      .map((e) => e.params?.missingProperty)
      .filter(Boolean);
    if (missingFields.length > 0) {
      messages.push(`Missing required fields: ${missingFields.join(', ')}`);
    }
  }

  // Format additional properties errors
  if (additionalPropErrors.length > 0) {
    const extraFields = additionalPropErrors
      .map((e) => e.params?.additionalProperty)
      .filter(Boolean);
    if (extraFields.length > 0) {
      messages.push(`Invalid fields: ${extraFields.join(', ')}`);
      if (context === 'model' && type) {
        messages.push(
          `   These fields are not allowed for "${type}" models. Please remove them or change the model type.`,
        );
      } else {
        messages.push(
          `   These fields are not allowed. Please remove them or check the schema.`,
        );
      }
    }
  }

  // Format type errors
  for (const error of typeErrors) {
    messages.push(`${formatSingleError(error)}`);
  }

  // Format other errors
  for (const error of otherErrors) {
    messages.push(`${formatSingleError(error)}`);
  }

  return messages;
}

/**
 * Validates CTE-specific constraints that cannot be expressed in JSON Schema alone:
 * - Unique CTE names within the model
 * - Forward-reference enforcement (CTEs can only reference earlier entries,
 *   which implicitly prevents cycles)
 * - CTE from.cte must reference a valid CTE name
 * - Main model from.cte must reference a valid CTE name
 */
export function validateCtes(modelJson: any): string[] {
  const errors: string[] = [];
  if (!modelJson?.ctes || !Array.isArray(modelJson.ctes)) {
    return errors;
  }

  const cteNames = new Set<string>();

  for (let i = 0; i < modelJson.ctes.length; i++) {
    const cte = modelJson.ctes[i];
    const cteName = cte.name;

    // Unique name check
    if (cteNames.has(cteName)) {
      errors.push(
        `ctes[${i}]: duplicate CTE name "${cteName}". CTE names must be unique within the model.`,
      );
    }

    // Forward reference check
    if (cte.from) {
      if ('cte' in cte.from && cte.from.cte) {
        const refName = cte.from.cte;
        if (!cteNames.has(refName)) {
          errors.push(
            `ctes[${i}] ("${cteName}"): references CTE "${refName}" which is not defined earlier in the array. CTEs can only reference previously defined CTEs.`,
          );
        }
      }
      if ('union' in cte.from && cte.from.union?.ctes) {
        for (const unionCte of cte.from.union.ctes) {
          if (!cteNames.has(unionCte)) {
            errors.push(
              `ctes[${i}] ("${cteName}"): union references CTE "${unionCte}" which is not defined earlier in the array.`,
            );
          }
        }
      }
      if ('join' in cte.from && Array.isArray(cte.from.join)) {
        for (const j of cte.from.join) {
          if ('cte' in j && j.cte && !cteNames.has(j.cte)) {
            errors.push(
              `ctes[${i}] ("${cteName}"): join references CTE "${j.cte}" which is not defined earlier in the array.`,
            );
          }
        }
      }
    }

    // Check select references
    if (cte.select) {
      for (const sel of cte.select) {
        if (typeof sel === 'object' && 'cte' in sel && sel.cte) {
          if (!cteNames.has(sel.cte)) {
            errors.push(
              `ctes[${i}] ("${cteName}"): select references CTE "${sel.cte}" which is not defined earlier in the array.`,
            );
          }
        }
      }
    }

    // WHERE on a union CTE is silently ignored in SQL generation because
    // SQL requires each UNION branch to have its own WHERE clause.
    if (cte.where && cte.from && 'union' in cte.from) {
      errors.push(
        `ctes[${i}] ("${cteName}"): "where" is not supported on union CTEs because it cannot be applied across UNION ALL branches. Apply filters to the individual CTEs before the union instead.`,
      );
    }

    errors.push(...validateCteGroupBy(cte, i));

    cteNames.add(cteName);
  }

  // Validate main model from.cte reference
  if (modelJson.from && 'cte' in modelJson.from && modelJson.from.cte) {
    if (!cteNames.has(modelJson.from.cte)) {
      errors.push(
        `from.cte: references CTE "${modelJson.from.cte}" which is not defined in the ctes array.`,
      );
    }
  }

  // Validate main model from.join CTE references
  if (
    modelJson.from &&
    'join' in modelJson.from &&
    Array.isArray(modelJson.from.join)
  ) {
    for (const j of modelJson.from.join) {
      if ('cte' in j && j.cte && !cteNames.has(j.cte)) {
        errors.push(
          `from.join: references CTE "${j.cte}" which is not defined in the ctes array.`,
        );
      }
    }
  }

  // Validate main model select CTE references
  if (modelJson.select) {
    for (const sel of modelJson.select) {
      if (typeof sel === 'object' && 'cte' in sel && sel.cte) {
        if (!cteNames.has(sel.cte)) {
          errors.push(
            `select: references CTE "${sel.cte}" which is not defined in the ctes array.`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Rejects `lightdash.metrics` / `lightdash.metrics_merge` declared inside
 * `ctes[].select[]`. The schema permits those fields on any select item, but
 * the framework only materializes Lightdash metrics from the main-model
 * `select` (via `lightdashBuildMetrics`). Metrics placed on CTE select items
 * are silently dropped, producing YAML with missing measures and no
 * diagnostic -- exactly the foot-gun that motivated this check.
 *
 * `lightdash.dimension` (label, type, hidden, ...) is still supported on CTE
 * select items because it is forwarded through CTE meta propagation; only the
 * metric-shaped fields are rejected here.
 */
export function validateCteLightdashMetrics(
  modelJson: any,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  if (!Array.isArray(modelJson?.ctes)) {
    return errors;
  }

  for (let i = 0; i < modelJson.ctes.length; i++) {
    const cte = modelJson.ctes[i];
    if (!Array.isArray(cte?.select)) {
      continue;
    }

    for (let j = 0; j < cte.select.length; j++) {
      const sel = cte.select[j];
      if (!sel || typeof sel !== 'object') {
        continue;
      }
      const ld = sel.lightdash;
      if (!ld || typeof ld !== 'object') {
        continue;
      }

      const badFields: string[] = [];
      if ('metrics' in ld && ld.metrics !== undefined && ld.metrics !== null) {
        badFields.push('lightdash.metrics');
      }
      if (
        'metrics_merge' in ld &&
        ld.metrics_merge !== undefined &&
        ld.metrics_merge !== null
      ) {
        badFields.push('lightdash.metrics_merge');
      }
      if (badFields.length === 0) {
        continue;
      }

      const ident =
        'name' in sel && typeof sel.name === 'string'
          ? `"${sel.name}"`
          : `select[${j}]`;
      // JSON Pointer targets the offending `lightdash` block so VS Code can
      // highlight the exact range in the editor rather than falling back to
      // line 1.
      errors.push({
        message: `CTE "${cte.name}" select ${ident}: ${badFields.join(' and ')} is not supported on CTE select items. Move the metric definition to the main-model select.`,
        instancePath: `/ctes/${i}/select/${j}/lightdash`,
      });
    }
  }

  return errors;
}

/**
 * Resolves the effective `exclude_datetime` value for a single scope (model
 * or CTE) without inheritance. Used by both the model-level and CTE-level
 * branches of `validateExcludeDatetimeRollupConflict`.
 *
 * Mirrors the within-scope half of `frameworkResolveExcludeFlag`:
 * the individual `exclude_datetime` flag wins over the combined
 * `exclude_framework_artifacts` enum at the same scope. Cross-scope
 * inheritance (CTE > model) is intentionally NOT applied here because the
 * conflict is reported at the scope that actually authored the strip --
 * inheriting a model-level `exclude_datetime` into a CTE that itself has
 * `from.rollup` would still emit the conflict at the model level via the
 * top-level call.
 */
function resolveExcludeDatetimeAtScope(scope: any): {
  effective: boolean;
  individualExcludeDatetime: unknown;
  combined: unknown;
} {
  const individualExcludeDatetime = scope?.exclude_datetime;
  const combined = scope?.exclude_framework_artifacts;
  const combinedImpliesDatetime = combined === 'all' || combined === 'columns';

  let effective: boolean;
  if (individualExcludeDatetime !== undefined) {
    effective = Boolean(individualExcludeDatetime);
  } else if (combinedImpliesDatetime) {
    effective = true;
  } else {
    effective = false;
  }
  return { effective, individualExcludeDatetime, combined };
}

/**
 * Validates that the effective `exclude_datetime` opt-out is not combined
 * with `from.rollup` at the model level. Rollup exists to produce a
 * `datetime` column at a coarser grain; excluding datetime would defeat the
 * rollup's whole purpose, and the user almost certainly meant only one of
 * the two.
 *
 * The effective check honors the combined `exclude_framework_artifacts`
 * enum: `"all"` and `"columns"` both imply `exclude_datetime`, so either
 * paired with `from.rollup` triggers the error. The user can opt back in
 * with an explicit `exclude_datetime: false`, which beats the combined
 * flag at the same scope and silences the error.
 *
 * The diagnostic pointer prefers the most specific source -- the explicit
 * `exclude_datetime` field when set, otherwise the combined
 * `exclude_framework_artifacts` field -- so the Problems-panel marker
 * lands on the field the user actually authored.
 *
 * CTE-level flags are not checked here. CTEs cannot have `from.rollup`
 * themselves (schema-enforced) and a model's `from.rollup` operates on
 * `modelJson.from.model`, not on CTE pipelines -- a CTE that excludes
 * datetime while the parent model has rollup is structurally coherent
 * because the CTE's output is independent of the rollup chain. If the
 * model has both flags set at the model level, the single error here
 * captures the conflict; CTEs inheriting the model's value don't produce
 * duplicate diagnostics.
 */
export function validateExcludeDatetimeRollupConflict(
  modelJson: any,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  const buildConflict = (
    pathPrefix: string,
    scope: any,
    scopeLabel: string,
  ): void => {
    const hasRollup = !!(
      scope?.from &&
      typeof scope.from === 'object' &&
      'rollup' in scope.from &&
      scope.from.rollup
    );
    if (!hasRollup) {
      return;
    }

    const { effective, individualExcludeDatetime, combined } =
      resolveExcludeDatetimeAtScope(scope);
    if (!effective) {
      return;
    }

    const pointer =
      individualExcludeDatetime === true
        ? `${pathPrefix}/exclude_datetime`
        : `${pathPrefix}/exclude_framework_artifacts`;
    const triggeringFlag =
      individualExcludeDatetime === true
        ? '`exclude_datetime`'
        : `\`exclude_framework_artifacts: "${combined}"\``;

    errors.push({
      message: `${scopeLabel}: ${triggeringFlag} cannot be combined with from.rollup -- rollup exists to produce a datetime column. Remove one of the two, or set \`exclude_datetime: false\` to opt datetime back in.`,
      instancePath: pointer,
    });
  };

  buildConflict('', modelJson, 'Model');

  if (Array.isArray(modelJson?.ctes)) {
    for (let i = 0; i < modelJson.ctes.length; i++) {
      const cte = modelJson.ctes[i];
      const cteName = cte?.name ?? `[${i}]`;
      buildConflict(`/ctes/${i}`, cte, `CTE "${cteName}"`);
    }
  }

  return errors;
}

/**
 * Validates that a CTE declaring `from.rollup` has a source that actually
 * produces a `datetime` column. Catches the foot-gun where a CTE rolls up
 * from another CTE that itself stripped datetime via `exclude_datetime` or
 * `exclude_framework_artifacts`.
 *
 * Scope: only the structural `from: { cte }` case is checked because the
 * upstream shape is fully determined by the model JSON. The
 * `from: { model }` case is not checked here -- detecting whether a manifest
 * model exposes `datetime` requires runtime context (project + manifest)
 * that this validator does not have. A missing-datetime there surfaces as a
 * `dbt compile` error at run time.
 */
export function validateCteRollupSource(
  modelJson: any,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  if (!Array.isArray(modelJson?.ctes)) {
    return errors;
  }

  // Index CTEs by name so the upstream lookup is O(1). Forward-reference
  // checks already live in `validateCtes`; here we only care about the
  // shape of the upstream CTE.
  const cteByName = new Map<string, any>();
  for (const c of modelJson.ctes) {
    if (c?.name) {
      cteByName.set(c.name, c);
    }
  }

  for (let i = 0; i < modelJson.ctes.length; i++) {
    const cte = modelJson.ctes[i];
    const rollup = cte?.from?.rollup;
    if (!rollup) {
      continue;
    }
    const upstreamCteName =
      'cte' in cte.from && cte.from.cte ? cte.from.cte : null;
    if (!upstreamCteName) {
      continue;
    }
    const upstream = cteByName.get(upstreamCteName);
    if (!upstream) {
      continue;
    }
    // Upstream CTE that itself rolls up always produces a datetime, so the
    // `exclude_datetime: false` opt-in is implied.
    if (upstream?.from?.rollup) {
      continue;
    }
    const upstreamScope = resolveExcludeDatetimeAtScope(upstream);
    if (upstreamScope.effective) {
      errors.push({
        message: `CTE "${cte.name ?? `[${i}]`}" rolls up from CTE "${upstreamCteName}", but the upstream CTE excludes datetime. Rollup requires a datetime column from its source -- set \`exclude_datetime: false\` on "${upstreamCteName}" or drop \`from.rollup\` on this CTE.`,
        instancePath: `/ctes/${i}/from/rollup`,
      });
    }
  }

  return errors;
}

/**
 * Validates that a CTE declaring `from.rollup` provides an explicit `select`.
 *
 * Without a `select`, the SQL generator falls through to `select *` and
 * rollup defaults `group_by` to `'dims'`, producing `GROUP BY <every
 * upstream column>`. The rollup rewrite (datetime truncation, suffix-agg
 * wrapping) and registry transform also live inside the explicit-select
 * branch, so a no-select rollup CTE silently emits broken SQL and breaks
 * downstream CTEs that read its registry.
 *
 * Auto-discovering dims/facts from upstream is not viable here -- typical
 * upstream marts/staging have many columns, and grouping by all of them is
 * never the user's intent. This rule mirrors the model-level shape: both
 * `int_select_model` and `int_join_models` already require `select`
 * alongside `from.rollup`.
 */
export function validateCteRollupRequiresSelect(
  modelJson: any,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  if (!Array.isArray(modelJson?.ctes)) {
    return errors;
  }

  for (let i = 0; i < modelJson.ctes.length; i++) {
    const cte = modelJson.ctes[i];
    const hasRollup =
      cte?.from && typeof cte.from === 'object' && cte.from.rollup;
    if (!hasRollup) {
      continue;
    }
    const hasSelect = Array.isArray(cte.select) && cte.select.length > 0;
    if (hasSelect) {
      continue;
    }
    const cteName = typeof cte?.name === 'string' ? cte.name : `[${i}]`;
    errors.push({
      message: `CTE "${cteName}": \`from.rollup\` requires an explicit \`select\`. Without it, GROUP BY would include every column from the upstream source. List the dims and facts you want; rollup auto-truncates \`datetime\` and auto-wraps facts with their suffix aggregate, so the select is usually shorter than the manual DATE_TRUNC + sum() shape it replaces.`,
      instancePath: `/ctes/${i}`,
    });
  }

  return errors;
}

/**
 * Validates that CTE group_by entries do not use bare string aliases for
 * computed columns (those with an `expr` in the CTE's select). String aliases
 * produce invalid SQL because Trino's GROUP BY references source columns, not
 * SELECT aliases. Use "dims", [{ "type": "dims" }], or { "expr": "..." } instead.
 */
export function validateCteGroupBy(cte: any, cteIndex: number): string[] {
  const errors: string[] = [];
  if (
    !Array.isArray(cte.select) ||
    typeof cte.group_by === 'string' ||
    !Array.isArray(cte.group_by)
  ) {
    return errors;
  }

  const computedExprs = new Map<string, string>();
  for (const sel of cte.select) {
    if (
      typeof sel === 'object' &&
      sel &&
      'name' in sel &&
      'expr' in sel &&
      sel.expr
    ) {
      computedExprs.set(sel.name, sel.expr);
    }
  }

  if (computedExprs.size === 0) {
    return errors;
  }

  for (const gb of cte.group_by) {
    if (typeof gb !== 'string') {
      continue;
    }
    const expr = computedExprs.get(gb);
    if (expr) {
      errors.push(
        `ctes[${cteIndex}] ("${cte.name}"): group_by contains string alias "${gb}" which references a computed expression (${expr}). String aliases are not valid SQL GROUP BY targets. Use [{ "type": "dims" }] to automatically group by all dimension expressions, or use { "expr": "${expr}" } to specify the expression directly.`,
      );
    }
  }

  return errors;
}

/**
 * Validates that exclude/include column names in bulk CTE directives
 * actually exist in the referenced CTE. Requires a pre-built CTE column
 * registry and is therefore a separate pass from validateCtes (which only
 * performs structural checks).
 */
export function validateCteColumnReferences(
  modelJson: any,
  cteColumnRegistry: ReadonlyMap<
    string,
    { name: string; meta?: { type?: string } }[]
  >,
): string[] {
  const errors: string[] = [];
  if (!cteColumnRegistry || cteColumnRegistry.size === 0) {
    return errors;
  }

  function checkBulkDirective(
    sel: any,
    path: string,
    availableColumns: string[],
  ): void {
    if (sel.exclude && Array.isArray(sel.exclude)) {
      for (const colName of sel.exclude) {
        if (!availableColumns.includes(colName)) {
          errors.push(
            `${path}: exclude references column "${colName}" which does not exist in CTE "${sel.cte}". Available columns: ${availableColumns.join(', ')}`,
          );
        }
      }
    }
    if (sel.include && Array.isArray(sel.include)) {
      for (const colName of sel.include) {
        if (!availableColumns.includes(colName)) {
          errors.push(
            `${path}: include references column "${colName}" which does not exist in CTE "${sel.cte}". Available columns: ${availableColumns.join(', ')}`,
          );
        }
      }
    }
    const effectiveExclude = Array.isArray(sel.exclude) ? sel.exclude : [];
    const effectiveInclude = Array.isArray(sel.include) ? sel.include : [];
    const remaining = availableColumns.filter((c) => {
      if (effectiveExclude.length && effectiveExclude.includes(c)) {
        return false;
      }
      if (effectiveInclude.length && !effectiveInclude.includes(c)) {
        return false;
      }
      return true;
    });
    if (remaining.length === 0 && availableColumns.length > 0) {
      errors.push(
        `${path}: exclude/include combination results in zero columns from CTE "${sel.cte}".`,
      );
    }
  }

  // Check CTE select items
  if (Array.isArray(modelJson?.ctes)) {
    for (let i = 0; i < modelJson.ctes.length; i++) {
      const cte = modelJson.ctes[i];
      if (!Array.isArray(cte.select)) {
        continue;
      }
      for (let j = 0; j < cte.select.length; j++) {
        const sel = cte.select[j];
        if (
          typeof sel !== 'object' ||
          !sel ||
          !('cte' in sel) ||
          !BULK_CTE_TYPES.has(sel.type)
        ) {
          continue;
        }
        const refCols = cteColumnRegistry.get(sel.cte);
        if (!refCols) {
          continue;
        }
        const availableColumns = filterBulkSelectColumns(refCols, sel.type).map(
          (c) => c.name,
        );
        checkBulkDirective(
          sel,
          `ctes[${i}] ("${cte.name}").select[${j}]`,
          availableColumns,
        );
      }
    }
  }

  // Check main model select items
  if (Array.isArray(modelJson?.select)) {
    for (let j = 0; j < modelJson.select.length; j++) {
      const sel = modelJson.select[j];
      if (
        typeof sel !== 'object' ||
        !sel ||
        !('cte' in sel) ||
        !BULK_CTE_TYPES.has(sel.type)
      ) {
        continue;
      }
      const refCols = cteColumnRegistry.get(sel.cte);
      if (!refCols) {
        continue;
      }
      const availableColumns = filterBulkSelectColumns(refCols, sel.type).map(
        (c) => c.name,
      );
      checkBulkDirective(sel, `select[${j}]`, availableColumns);
    }
  }

  return errors;
}

/**
 * Bulk CTE select types (main-model) that pull fct columns through without
 * re-aggregation. Kept in sync with `BULK_CTE_TYPES` but narrowed to the
 * variants that can carry fcts (`dims_from_cte` is safe).
 */
const BULK_CTE_FCT_CARRIERS = new Set(['all_from_cte', 'fcts_from_cte']);

/**
 * Validates main-model fct columns against the model's `group_by`. Fct
 * columns in the outer SELECT must either be framework-aggregated
 * (`agg` / `aggs`), wrap an aggregate in `expr`, or be explicitly opted out
 * via `exclude_from_group_by: true`. Bare fct references plus a non-empty
 * `group_by` produce invalid Trino SQL ("column must appear in GROUP BY").
 *
 * Two failure modes are caught here, before `dj sync` writes the .sql file:
 * - Named select items (`{ name, type: "fct" }` with no aggregation wiring).
 * - Bulk `all_from_cte` / `fcts_from_cte` that drag fct columns through from
 *   a pre-aggregated CTE. Detected only when the CTE column registry is
 *   supplied (i.e. when called from ModelProcessor).
 *
 * Models with `rollup` or `lookback` FROM clauses skip this check because
 * their aggregation semantics are implicit rather than expressed via
 * `group_by`.
 */
export function validateMainModelAggregation(
  modelJson: any,
  cteColumnRegistry?: ReadonlyMap<string, FrameworkColumn[]>,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  if (!modelJson || typeof modelJson !== 'object') {
    return errors;
  }

  const groupBy = modelJson.group_by;
  const hasGroupBy =
    (typeof groupBy === 'string' && groupBy.length > 0) ||
    (Array.isArray(groupBy) && groupBy.length > 0);
  if (!hasGroupBy) {
    return errors;
  }

  if (!Array.isArray(modelJson.select)) {
    return errors;
  }

  // Compact shared hint appended to each diagnostic so every offender is
  // self-describing without requiring the user to scroll to a sibling
  // "summary" diagnostic.
  const hint =
    'set "agg"/"aggs", wrap an aggregate in "expr", or set "exclude_from_group_by": true.';
  // Window-function-specific hint: `agg`/`aggs` are not applicable to a
  // window function (it's a row-wise transform). The real failure mode is
  // that the inner argument must resolve through GROUP BY.
  const windowHint =
    'ensure window-partition columns are a superset of "group_by" (or wrap the inner argument in an aggregate / set "exclude_from_group_by": true).';

  const isWindow = (sel: any): boolean =>
    typeof sel?.expr === 'string' && isWindowFunctionExpr(sel.expr);

  for (let j = 0; j < modelJson.select.length; j++) {
    const sel = modelJson.select[j];
    if (!sel || typeof sel !== 'object') {
      continue;
    }

    if ('exclude_from_group_by' in sel && sel.exclude_from_group_by === true) {
      continue;
    }

    // Named scalar select: { name, type: "fct", ... }
    if ('name' in sel && sel.type === 'fct' && !('cte' in sel)) {
      if (columnIsAggregated(sel)) {
        continue;
      }
      const message = isWindow(sel)
        ? `Window function "${sel.name}" in main-model select with group_by — ${windowHint}`
        : `Un-aggregated fct column "${sel.name}" with main-model group_by — ${hint}`;
      errors.push({
        message,
        instancePath: `/select/${j}`,
      });
      continue;
    }

    // Scalar CTE fct ref: { cte, name, type: "fct" } — always bare passthrough
    if (
      'cte' in sel &&
      'name' in sel &&
      sel.type === 'fct' &&
      !columnIsAggregated(sel)
    ) {
      const message = isWindow(sel)
        ? `Window function "${sel.name}" from CTE "${sel.cte}" in main-model select with group_by — ${windowHint}`
        : `Un-aggregated fct "${sel.name}" from CTE "${sel.cte}" with main-model group_by — ${hint}`;
      errors.push({
        message,
        instancePath: `/select/${j}`,
      });
      continue;
    }

    // Bulk CTE carriers: all_from_cte / fcts_from_cte
    if (
      'cte' in sel &&
      typeof sel.cte === 'string' &&
      BULK_CTE_FCT_CARRIERS.has(sel.type) &&
      cteColumnRegistry
    ) {
      const cteCols = cteColumnRegistry.get(sel.cte);
      if (!cteCols) {
        continue;
      }
      const fctNames = cteCols
        .filter((c) => c.meta?.type === 'fct')
        .map((c) => c.name);
      if (fctNames.length === 0) {
        continue;
      }
      const excludeList = Array.isArray(sel.exclude) ? sel.exclude : [];
      const includeList = Array.isArray(sel.include) ? sel.include : null;
      const leftover = fctNames.filter(
        (n) =>
          !excludeList.includes(n) && (!includeList || includeList.includes(n)),
      );
      if (leftover.length > 0) {
        errors.push({
          message: `${sel.type} from CTE "${sel.cte}" carries un-aggregated fct column(s): ${leftover.join(', ')} — re-aggregate each in the main-model select or add to "exclude".`,
          instancePath: `/select/${j}`,
        });
      }
    }
  }

  return errors;
}

function columnIsAggregated(sel: any): boolean {
  if (!sel || typeof sel !== 'object') {
    return false;
  }
  if ('agg' in sel && sel.agg) {
    return true;
  }
  if ('aggs' in sel && Array.isArray(sel.aggs) && sel.aggs.length > 0) {
    return true;
  }
  // Constants (literals, NULL, CAST(<literal> AS X)) have no column
  // dependencies and can never conflict with GROUP BY. Jinja expressions
  // (`{{ macro() }}`) are opaque -- the macro may expand to an aggregate,
  // so we conservatively treat them as aggregated to avoid false positives.
  if (
    'expr' in sel &&
    typeof sel.expr === 'string' &&
    (isAggregateExpr(sel.expr) ||
      isConstantExpr(sel.expr) ||
      isJinjaExpr(sel.expr))
  ) {
    return true;
  }
  return false;
}

/**
 * Detects "dead outer layer" main models: `from: { cte: X }` + main `select`
 * that is a single `all_from_cte` / `dims_from_cte` passthrough of that same
 * CTE + main `group_by` that matches the CTE's group_by. In that shape the
 * outer query adds no new projection, no new filtering, and no new
 * aggregation -- it's pure overhead. Emitted as a warning so users can drop
 * the outer layer or add meaningful work to it.
 *
 * Returns warning strings; the caller decides severity.
 */
export function validateDeadOuterLayer(
  modelJson: any,
): ValidationErrorDetail[] {
  const warnings: ValidationErrorDetail[] = [];
  if (!modelJson || typeof modelJson !== 'object') {
    return warnings;
  }
  const from = modelJson.from;
  if (!from || typeof from !== 'object' || !('cte' in from) || !from.cte) {
    return warnings;
  }
  if ('join' in from && Array.isArray(from.join) && from.join.length > 0) {
    return warnings;
  }
  const cteName = from.cte;

  if (!Array.isArray(modelJson.select) || modelJson.select.length !== 1) {
    return warnings;
  }
  const sole = modelJson.select[0];
  if (
    !sole ||
    typeof sole !== 'object' ||
    !('cte' in sole) ||
    sole.cte !== cteName
  ) {
    return warnings;
  }
  if (sole.type !== 'all_from_cte' && sole.type !== 'dims_from_cte') {
    return warnings;
  }
  if (
    (Array.isArray(sole.exclude) && sole.exclude.length > 0) ||
    (Array.isArray(sole.include) && sole.include.length > 0)
  ) {
    return warnings;
  }

  // Passthrough of a single CTE. Compare group_by shapes.
  const ctes = Array.isArray(modelJson.ctes) ? modelJson.ctes : [];
  const cte = ctes.find((c: any) => c?.name === cteName);
  if (!cte) {
    return warnings;
  }

  const mainGB = normalizeGroupBy(modelJson.group_by);
  const cteGB = normalizeGroupBy(cte.group_by);
  if (mainGB === 'none' || cteGB === 'none') {
    return warnings;
  }
  if (mainGB !== cteGB) {
    return warnings;
  }

  // Also require that the main model adds no where / having / limit / distinct
  // / order_by on top -- those justify a wrapper even with identical group_by.
  const hasWhere =
    modelJson.where &&
    typeof modelJson.where === 'object' &&
    Object.keys(modelJson.where).length > 0;
  const hasHaving =
    modelJson.having &&
    typeof modelJson.having === 'object' &&
    Object.keys(modelJson.having).length > 0;
  const hasOrder =
    Array.isArray(modelJson.order_by) && modelJson.order_by.length > 0;
  const hasLimit = typeof modelJson.limit === 'number';
  const hasDistinct = modelJson.distinct === true;
  if (hasWhere || hasHaving || hasOrder || hasLimit || hasDistinct) {
    return warnings;
  }

  warnings.push({
    message: `Main-model outer layer is a no-op: select is a single ${sole.type} passthrough of CTE "${cteName}" with the same group_by as the CTE and no extra filters / limits. Consider dropping the outer wrapper and moving the CTE's select into the main model, or adding new projection / filtering on top.`,
    instancePath: `/select/0`,
  });
  return warnings;
}

function normalizeGroupBy(groupBy: any): string {
  if (!groupBy) {
    return 'none';
  }
  if (typeof groupBy === 'string') {
    return groupBy === 'dims' ? 'dims' : `string:${groupBy}`;
  }
  if (Array.isArray(groupBy)) {
    if (groupBy.length === 0) {
      return 'none';
    }
    // Canonicalize: "[{type:'dims'}]" == "dims"
    if (
      groupBy.length === 1 &&
      typeof groupBy[0] === 'object' &&
      groupBy[0]?.type === 'dims'
    ) {
      return 'dims';
    }
    return `array:${JSON.stringify(groupBy)}`;
  }
  return 'none';
}

/**
 * Validates that the `dj_iceberg_partition_overwrite` incremental strategy
 * is only used on Iceberg tables.
 *
 * The DJ-shipped macro `get_incremental_dj_iceberg_partition_overwrite_sql`
 * (in `macros/strategies.sql`) reads `properties.partitioning`, which
 * `frameworkGenerateModelOutput` only emits on Iceberg-format models. On
 * Delta Lake / Hive (where only `partitioned_by` is emitted), the macro
 * silently degrades to a full-table refresh -- almost certainly not what
 * the author intended. We surface this as a Problems-tab error so users
 * notice immediately.
 *
 * Format resolution mirrors the SQL generator: model-level
 * `materialization.format` wins, then project-level `storage_type`, then
 * neither (Delta/Hive default).
 *
 * Emits the detail with `severity: 'error'` so it can ride the existing
 * post-generation warning channel without overwriting other warnings on
 * the same URI.
 */
export function validateDjIcebergPartitionOverwrite(
  modelJson: any,
  storageType?: string | null,
): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  if (!modelJson || typeof modelJson !== 'object') {
    return errors;
  }

  const materialization = modelJson.materialization;
  if (!materialization || typeof materialization !== 'object') {
    return errors;
  }
  const strategy = materialization.strategy;
  if (
    !strategy ||
    typeof strategy !== 'object' ||
    strategy.type !== 'dj_iceberg_partition_overwrite'
  ) {
    return errors;
  }

  const modelFormat =
    typeof materialization.format === 'string' ? materialization.format : null;
  const resolvedFormat =
    modelFormat || (storageType === 'iceberg' ? 'iceberg' : null);

  if (resolvedFormat !== 'iceberg') {
    errors.push({
      message:
        "incremental_strategy 'dj_iceberg_partition_overwrite' requires Iceberg format. " +
        "Set materialization.format to 'iceberg' or the project var storage_type to 'iceberg'. " +
        "On Delta Lake / Hive use 'delete+insert' instead -- DJ auto-derives unique_key from the partition column.",
      instancePath: '/materialization/strategy/type',
      severity: 'error',
    });
  }

  return errors;
}

const PARTITION_NEEDING_STRATEGIES = new Set([
  'overwrite_existing_partitions',
  'dj_iceberg_partition_overwrite',
]);

const PARTITION_BULK_SELECT_TYPES = new Set([
  'all_from_model',
  'all_from_cte',
  'dims_from_model',
  'dims_from_cte',
]);

function isModelMaterializedIncremental(modelJson: any): boolean {
  if (modelJson?.materialization) {
    if (typeof modelJson.materialization === 'string') {
      return modelJson.materialization === 'incremental';
    }
    if (typeof modelJson.materialization === 'object') {
      return modelJson.materialization.type === 'incremental';
    }
  }
  return modelJson?.materialized === 'incremental';
}

/**
 * Resolve the incremental strategy the SQL generator will pick, mirroring
 * the priority chain in `frameworkGenerateModelOutput`:
 *   `materialization.strategy.type` > legacy `incremental_strategy` >
 *   `dj.config.materializationDefaultIncrementalStrategy` > shared default.
 *
 * Returns the resolved strategy and the JSON Pointer that should anchor the
 * diagnostic (the strongest user-authored field, or `materialized` /
 * `materialization` when only the default applies).
 */
function resolveIncrementalStrategy(
  modelJson: any,
  defaultStrategy: string | undefined,
): { strategy: string; instancePath: string } {
  const mat = modelJson?.materialization;
  if (
    mat &&
    typeof mat === 'object' &&
    mat.strategy &&
    typeof mat.strategy === 'object' &&
    typeof mat.strategy.type === 'string'
  ) {
    return {
      strategy: mat.strategy.type,
      instancePath: '/materialization/strategy/type',
    };
  }
  const legacy = modelJson?.incremental_strategy;
  if (typeof legacy === 'string') {
    return { strategy: legacy, instancePath: '/incremental_strategy' };
  }
  if (legacy && typeof legacy === 'object' && typeof legacy.type === 'string') {
    return {
      strategy: legacy.type,
      instancePath: '/incremental_strategy/type',
    };
  }
  // Fall back to the workspace setting
  // (`dj.materialization.defaultIncrementalStrategy`) when the model JSON
  // declares no strategy. The shared `DEFAULT_INCREMENTAL_STRATEGY`
  // constant is the last-resort default if the setting itself is unset --
  // routing through it (instead of a hardcoded literal) keeps this
  // validator in sync when the constant flips, mirroring every other
  // fallback site in the codebase.
  const fallback = defaultStrategy ?? DEFAULT_INCREMENTAL_STRATEGY;
  // Pin the diagnostic to the strongest user-authored anchor available. If
  // the user used the legacy string form (`materialized: "incremental"`),
  // point there; otherwise the structured object root.
  const instancePath =
    typeof mat === 'string' || mat == null
      ? '/materialized'
      : '/materialization';
  return { strategy: fallback, instancePath };
}

/**
 * Pre-generation heuristic for whether the resolved column shape will
 * carry any partition column. Mirrors the decision points in
 * `frameworkBuildColumns` without re-running it:
 *   - `materialization.partitions: [...]` -> partitions present
 *   - `select` includes a `portal_partition_*` (scalar or bulk passthrough)
 *     -> partitions present
 *   - `from.lookback` -> partitions present (framework forces
 *     `portal_partition_daily`)
 *   - `from: { source }` -> partitions present (source date columns auto-injected)
 *   - `from: { model }` -> partitions present unless the model opts out
 *     via `exclude_portal_partition_columns` or `exclude_framework_artifacts`
 *   - `from: { cte }` -> partitions present iff the CTE chain terminates at
 *     a `from: { model | source }` head with no partition opt-out
 *     (`exclude_portal_partition_columns` / `exclude_framework_artifacts:
 *     "all" | "columns"`) along any link, mirroring the chain auto-inject
 *     in `frameworkShouldAutoInjectCteFrameworkDims`.
 *   - `from: { union }` -> no auto-injection at the main-model level
 *
 * Biases toward "yes" so the warning does not fire on the common
 * `from: { model }` shape; the negative case fires only when every signal
 * points at "no partition output."
 */
function modelLikelyOutputsPartitionColumn(modelJson: any): boolean {
  const mat = modelJson?.materialization;
  if (
    mat &&
    typeof mat === 'object' &&
    Array.isArray(mat.partitions) &&
    mat.partitions.length > 0
  ) {
    return true;
  }

  const select = Array.isArray(modelJson?.select) ? modelJson.select : [];
  for (const item of select) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (
      typeof item.name === 'string' &&
      item.name.startsWith('portal_partition_')
    ) {
      return true;
    }
    if (PARTITION_BULK_SELECT_TYPES.has(item.type)) {
      return true;
    }
  }

  const from = modelJson?.from;
  if (from && typeof from === 'object') {
    if (from.lookback) {
      return true;
    }
    const excludesPartitions =
      modelJson.exclude_portal_partition_columns === true ||
      modelJson.exclude_framework_artifacts === 'all' ||
      modelJson.exclude_framework_artifacts === 'columns';
    if (!excludesPartitions) {
      if ('source' in from) {
        return true;
      }
      if ('model' in from) {
        return true;
      }
      if ('cte' in from && typeof from.cte === 'string' && !('union' in from)) {
        return cteChainExposesPartitions(modelJson, from.cte);
      }
    }
  }
  return false;
}

/**
 * Walks the CTE chain backwards from `cteName`, returning true when the
 * chain terminates at a `from: { model }` or `from: { source }` head with
 * no partition opt-out breaking any link. Mirrors the runtime auto-inject
 * (`frameworkShouldAutoInjectCteFrameworkDims`): `portal_partition_*`
 * cascades through every `from: { cte }` hop by inheriting from the upstream
 * CTE registry, so the consumer at the end of the chain emits a partition
 * iff the head is a model/source and no link opts out.
 *
 * Short-circuits to "yes" on any link that explicitly selects a
 * `portal_partition_*` column or a partition-bearing bulk select
 * (`all_from_*`, `dims_from_*`) -- those guarantee the column lands in the
 * CTE registry regardless of upstream shape. Cycle-protected, but the
 * `validateCtes` schema check rejects cycles upstream so this is defensive.
 */
function cteChainExposesPartitions(
  modelJson: any,
  cteName: string,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(cteName)) {
    return false;
  }
  visited.add(cteName);
  const ctes = Array.isArray(modelJson?.ctes) ? modelJson.ctes : [];
  const cte = ctes.find((c: any) => c?.name === cteName);
  if (!cte) {
    return false;
  }

  const cteSelect = Array.isArray(cte.select) ? cte.select : [];
  for (const item of cteSelect) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (
      typeof item.name === 'string' &&
      item.name.startsWith('portal_partition_')
    ) {
      return true;
    }
    if (PARTITION_BULK_SELECT_TYPES.has(item.type)) {
      return true;
    }
  }

  const cteExcludes =
    cte.exclude_portal_partition_columns === true ||
    cte.exclude_framework_artifacts === 'all' ||
    cte.exclude_framework_artifacts === 'columns';
  if (cteExcludes) {
    return false;
  }

  const cteFrom = cte.from;
  if (!cteFrom || typeof cteFrom !== 'object' || 'union' in cteFrom) {
    return false;
  }
  if ('source' in cteFrom || 'model' in cteFrom) {
    return true;
  }
  if ('cte' in cteFrom && typeof cteFrom.cte === 'string') {
    return cteChainExposesPartitions(modelJson, cteFrom.cte, visited);
  }
  return false;
}

function describeFromForDiagnostic(modelJson: any): string {
  const from = modelJson?.from;
  if (!from || typeof from !== 'object') {
    return "the model's from clause";
  }
  if ('cte' in from) {
    return `from { cte: "${from.cte}" }`;
  }
  if ('union' in from) {
    return 'from { union: [...] }';
  }
  if ('source' in from) {
    return 'from { source: ... } with auto-inject opted out';
  }
  if ('model' in from) {
    return `from { model: "${from.model}" } with partition auto-inject opted out`;
  }
  return "the model's from clause";
}

/**
 * Warns when an incremental model uses a partition-based strategy
 * (`overwrite_existing_partitions` or `dj_iceberg_partition_overwrite`)
 * but the resolved column shape carries no partition column.
 *
 * Both strategies derive their work scope from the new slice's partition
 * columns: `overwrite_existing_partitions` iterates partition values via a
 * consumer macro, and `dj_iceberg_partition_overwrite` reads
 * `properties.partitioning`. Without partitions, dbt-trino either errors
 * at run time or silently no-ops (full refresh / duplicates).
 *
 * Common triggers: `from: { cte | union }` with a non-partition `select`,
 * or any `from` where `exclude_portal_partition_columns` /
 * `exclude_framework_artifacts: "all" | "columns"` suppresses auto-injection
 * and the user did not expose a partition column themselves.
 *
 * Warning (not error) so users can still iterate; partitioning may be
 * wired through a project-level dbt config the framework cannot observe.
 */
export function validatePartitionStrategyWithoutPartitions(
  modelJson: any,
  defaultStrategy?: string,
): ValidationErrorDetail[] {
  const warnings: ValidationErrorDetail[] = [];
  if (!modelJson || typeof modelJson !== 'object') {
    return warnings;
  }
  if (!isModelMaterializedIncremental(modelJson)) {
    return warnings;
  }

  const { strategy, instancePath } = resolveIncrementalStrategy(
    modelJson,
    defaultStrategy,
  );
  if (!PARTITION_NEEDING_STRATEGIES.has(strategy)) {
    return warnings;
  }

  if (modelLikelyOutputsPartitionColumn(modelJson)) {
    return warnings;
  }

  warnings.push({
    message:
      `Strategy "${strategy}" needs a partition column; this model emits ` +
      `none (${describeFromForDiagnostic(modelJson)}, no portal_partition_* ` +
      `in select, no materialization.partitions). At run time the strategy ` +
      `silently no-ops or fails. Fix: switch to "delete+insert" / "merge" ` +
      `/ "append"; set materialization.partitions; expose a ` +
      `portal_partition_*; or use "ephemeral". Ignore if this is what ` +
      `you intend (e.g. partitioning is wired through a project-level ` +
      `dbt config).`,
    instancePath,
  });
  return warnings;
}

// Bulk-select directives that could plausibly expand to include any
// upstream column name. When any of these is present in `select`, the
// `materialization.partitions` existence check skips that select item
// (and therefore the model) rather than risk a false positive.
const BULK_SELECT_TYPES = new Set([
  'all_from_model',
  'all_from_cte',
  'all_from_source',
  'dims_from_model',
  'dims_from_cte',
  'dims_from_source',
  'fcts_from_model',
  'fcts_from_cte',
  'fcts_from_source',
]);

/**
 * Warns when names listed in `materialization.partitions` do not appear
 * as scalar select items in the model's `select`.
 *
 * The SQL generator builds `partitioned_by` / `partitioning` only from
 * names that exist on the materialized table (see the filter loop in
 * `frameworkGenerateModelOutput`); names that don't match are silently
 * dropped from the dbt config, leaving the table unpartitioned. The
 * incremental strategy then no-ops or runs destructively at run time.
 *
 * Conservative: a present bulk select (`all_from_*`, `dims_from_*`,
 * `fcts_from_*`) could plausibly expand to the named column, so this
 * validator skips when one is present rather than risk a false positive.
 * That gap is acceptable -- the SQL generator's filter still prunes
 * mismatches at sync time; this validator only catches the common
 * scalar-only authoring mistake.
 */
export function validateMaterializationPartitionsExist(
  modelJson: any,
): ValidationErrorDetail[] {
  const warnings: ValidationErrorDetail[] = [];
  const mat = modelJson?.materialization;
  if (
    !mat ||
    typeof mat !== 'object' ||
    !Array.isArray(mat.partitions) ||
    mat.partitions.length === 0
  ) {
    return warnings;
  }

  const select = Array.isArray(modelJson?.select) ? modelJson.select : [];
  const scalarSelectNames = new Set<string>();
  let hasBulkSelect = false;
  for (const item of select) {
    if (typeof item === 'string') {
      scalarSelectNames.add(item);
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (typeof item.type === 'string' && BULK_SELECT_TYPES.has(item.type)) {
      hasBulkSelect = true;
      continue;
    }
    if (typeof item.name === 'string') {
      scalarSelectNames.add(item.name);
    }
  }

  if (hasBulkSelect) {
    return warnings;
  }

  for (let i = 0; i < mat.partitions.length; i++) {
    const p = mat.partitions[i];
    if (typeof p !== 'string') {
      continue;
    }
    if (scalarSelectNames.has(p)) {
      continue;
    }
    warnings.push({
      message: `Column "${p}" listed in \`materialization.partitions\` is not in the model's \`select\` output. The partition declaration will be silently dropped and the materialized table will not be partitioned on this column.`,
      instancePath: `/materialization/partitions/${i}`,
    });
  }

  return warnings;
}

const EXISTS_OPERATORS = new Set(['exists', 'not_exists']);

/**
 * Validates subquery-specific constraints that cannot be expressed in JSON Schema alone:
 * - exists/not_exists operators must not have a "column" field (it has no effect)
 * - Subqueries referencing CTEs via from.cte must reference a CTE defined in the model
 */
export function validateSubqueries(modelJson: any): string[] {
  const errors: string[] = [];
  const cteNames = new Set<string>(
    (modelJson?.ctes ?? []).map((c: any) => c?.name).filter(Boolean),
  );

  function checkSubquery(subquery: any, path: string): void {
    if (!subquery || typeof subquery !== 'object') {
      return;
    }

    if (EXISTS_OPERATORS.has(subquery.operator) && subquery.column) {
      errors.push(
        `${path}: "column" is not applicable for "${subquery.operator}" operator and should be removed.`,
      );
    }

    if (
      subquery.from &&
      'cte' in subquery.from &&
      subquery.from.cte &&
      cteNames.size > 0 &&
      !cteNames.has(subquery.from.cte)
    ) {
      errors.push(
        `${path}: references CTE "${subquery.from.cte}" which is not defined in the ctes array.`,
      );
    }

    if (subquery.where) {
      walkConditions(subquery.where, `${path}.where`);
    }
  }

  function walkConditions(conditions: any, path: string): void {
    if (!conditions || typeof conditions !== 'object') {
      return;
    }
    for (const key of ['and', 'or'] as const) {
      if (!Array.isArray(conditions[key])) {
        continue;
      }
      for (let i = 0; i < conditions[key].length; i++) {
        const item = conditions[key][i];
        if (!item || typeof item !== 'object') {
          continue;
        }
        if (item.subquery) {
          checkSubquery(item.subquery, `${path}.${key}[${i}].subquery`);
        }
        if (item.group) {
          walkConditions(item.group, `${path}.${key}[${i}].group`);
        }
      }
    }
  }

  function walkJoinOn(joins: any[], basePath: string): void {
    if (!Array.isArray(joins)) {
      return;
    }
    for (let j = 0; j < joins.length; j++) {
      const join = joins[j];
      if (!join?.on?.and) {
        continue;
      }
      for (let k = 0; k < join.on.and.length; k++) {
        const cond = join.on.and[k];
        if (cond && typeof cond === 'object' && 'subquery' in cond) {
          checkSubquery(
            cond.subquery,
            `${basePath}[${j}].on.and[${k}].subquery`,
          );
        }
      }
    }
  }

  // Walk model-level where, having, and join ON
  if (modelJson.where) {
    walkConditions(modelJson.where, 'where');
  }
  if (modelJson.having) {
    walkConditions(modelJson.having, 'having');
  }
  if (modelJson.from?.join) {
    walkJoinOn(modelJson.from.join, 'from.join');
  }

  // Walk CTE-level where, having, and join ON
  if (Array.isArray(modelJson.ctes)) {
    for (let i = 0; i < modelJson.ctes.length; i++) {
      const cte = modelJson.ctes[i];
      const prefix = `ctes[${i}]`;
      if (cte.where) {
        walkConditions(cte.where, `${prefix}.where`);
      }
      if (cte.having) {
        walkConditions(cte.having, `${prefix}.having`);
      }
      if (cte.from?.join) {
        walkJoinOn(cte.from.join, `${prefix}.from.join`);
      }
    }
  }

  return errors;
}

/**
 * Maps each AJV error to a `ValidationErrorDetail` with a human-readable
 * message and a resolved JSON pointer path for diagnostic positioning.
 *
 * Applies "best match" filtering for `oneOf`/`anyOf` schemas so that only
 * errors from the branch the user most likely intended are shown.
 *
 * Path resolution per error keyword:
 * - `required`: parent path + missing property name (points to the object that should contain it)
 * - `additionalProperties`: parent path + extra property name
 * - All others: the error's own `instancePath`
 */
export function formatValidationErrorDetails(
  errors: ErrorObject[] | null | undefined,
): ValidationErrorDetail[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  const filtered = filterOneOfNoise(errors);

  return filtered.map((error) => {
    let instancePath = error.instancePath ?? '';

    if (error.keyword === 'required' && error.params?.missingProperty) {
      const suffix = `/${error.params.missingProperty}`;
      instancePath = instancePath ? `${instancePath}${suffix}` : suffix;
    } else if (
      error.keyword === 'additionalProperties' &&
      error.params?.additionalProperty
    ) {
      const suffix = `/${error.params.additionalProperty}`;
      instancePath = instancePath ? `${instancePath}${suffix}` : suffix;
    }

    return {
      message: formatSingleError(error),
      instancePath,
    };
  });
}

/**
 * Deterministic "best match" filter for `oneOf`/`anyOf` validation noise.
 *
 * AJV validates all branches of `oneOf`/`anyOf` and reports errors from every
 * branch that failed. This produces confusing diagnostics — e.g. "should be null"
 * alongside "filter: should be string" when the user clearly intended the object
 * branch. This function uses `schemaPath` to group errors by branch and keeps
 * only errors from the branch that matched deepest (the "best match").
 *
 * Algorithm per wrapper (processed deepest-first for nested oneOf/anyOf):
 * 1. Remove the wrapper error itself
 * 2. Group related errors by branch using `schemaPath`
 * 3. If any branch has errors deeper than the wrapper level, suppress
 *    branches with only surface-level errors (non-matching branches)
 * 4. If all branches have errors only at the wrapper level (total type
 *    mismatch), keep all of them — they represent valid alternatives
 */
function filterOneOfNoise(errors: ErrorObject[]): ErrorObject[] {
  const wrappers: ErrorObject[] = [];
  let remaining = errors.filter((e) => {
    if (e.keyword === 'oneOf' || e.keyword === 'anyOf') {
      wrappers.push(e);
      return false;
    }
    return true;
  });

  if (wrappers.length === 0) {
    return errors;
  }

  // Process deepest wrappers first so nested oneOf/anyOf resolve before parents
  wrappers.sort(
    (a, b) => (b.instancePath ?? '').length - (a.instancePath ?? '').length,
  );

  for (const wrapper of wrappers) {
    const wrapperPath = wrapper.instancePath ?? '';
    const wrapperSchemaPath = wrapper.schemaPath;

    const related: ErrorObject[] = [];
    const unrelated: ErrorObject[] = [];
    for (const err of remaining) {
      if ((err.instancePath ?? '').startsWith(wrapperPath)) {
        related.push(err);
      } else {
        unrelated.push(err);
      }
    }

    if (related.length === 0) {
      remaining = unrelated;
      continue;
    }

    const hasDeepErrors = related.some(
      (e) => (e.instancePath ?? '').length > wrapperPath.length,
    );

    if (!hasDeepErrors) {
      // All branches failed at the same depth — keep everything (valid alternatives)
      remaining = [...unrelated, ...related];
      continue;
    }

    // Group errors by branch, then keep only branches with deep errors
    const branches = new Map<string, ErrorObject[]>();
    for (const err of related) {
      const key = identifyBranch(err.schemaPath, wrapperSchemaPath);
      if (!branches.has(key)) {
        branches.set(key, []);
      }
      branches.get(key)!.push(err);
    }

    const kept: ErrorObject[] = [];
    for (const branchErrors of branches.values()) {
      const branchMaxDepth = Math.max(
        ...branchErrors.map((e) => (e.instancePath ?? '').length),
      );
      if (branchMaxDepth > wrapperPath.length) {
        kept.push(...branchErrors);
      }
    }

    remaining = [...unrelated, ...kept];
  }

  return remaining;
}

/**
 * Identify which `oneOf`/`anyOf` branch an error originates from.
 *
 * AJV's `schemaPath` deterministically encodes the source:
 * - Inline schemas: path starts with the wrapper's schemaPath + "/N/..."
 *   (e.g. `#/properties/freshness/oneOf/1/type` → branch `inline:1`)
 * - `$ref` schemas: path starts with the referenced schema's `$id`
 *   (e.g. `freshness.json/properties/filter/type` → branch `ref:freshness.json`)
 */
function identifyBranch(
  errorSchemaPath: string,
  wrapperSchemaPath: string,
): string {
  if (errorSchemaPath.startsWith(wrapperSchemaPath + '/')) {
    const afterBase = errorSchemaPath.slice(wrapperSchemaPath.length + 1);
    const branchIndex = afterBase.split('/')[0];
    return `inline:${branchIndex}`;
  }

  // $ref branch — use the schema $id as the group key
  const slashIdx = errorSchemaPath.indexOf('/');
  const schemaId =
    slashIdx >= 0 ? errorSchemaPath.slice(0, slashIdx) : errorSchemaPath;
  return `ref:${schemaId}`;
}

/**
 * Formats a single error object into a human-readable message
 */
function formatSingleError(error: ErrorObject): string {
  const path = error.instancePath ?? 'root';
  const field = path.replace(/^\//, '').replace(/\//g, '.') || 'model';

  switch (error.keyword) {
    case 'required':
      return `${field}: missing required property "${error.params?.missingProperty}"`;
    case 'additionalProperties':
      return `${field}: unexpected property "${error.params?.additionalProperty}"`;
    case 'type':
      return `${field}: should be ${error.params?.type}`;
    case 'const':
      return `${field}: must be "${error.params?.allowedValue}"`;
    case 'enum':
      return `${field}: must be one of: ${error.params?.allowedValues?.join(', ')}`;
    case 'minItems':
      return `${field}: must have at least ${error.params?.limit} items`;
    case 'maxItems':
      return `${field}: must have at most ${error.params?.limit} items`;
    case 'minimum':
      return `${field}: must be >= ${error.params?.limit}`;
    case 'maximum':
      return `${field}: must be <= ${error.params?.limit}`;
    case 'pattern':
      return `${field}: must match pattern ${error.params?.pattern}`;
    default:
      return `${field}: ${error.message || 'validation failed'}`;
  }
}
