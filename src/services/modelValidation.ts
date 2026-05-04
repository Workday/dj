import {
  filterBulkSelectColumns,
  isAggregateExpr,
} from '@services/framework/utils/column-utils';
import { BULK_CTE_TYPES } from '@shared/framework/constants';
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
  context: 'model' | 'source',
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
      errors.push({
        message: `Un-aggregated fct column "${sel.name}" with main-model group_by — ${hint}`,
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
      errors.push({
        message: `Un-aggregated fct "${sel.name}" from CTE "${sel.cte}" with main-model group_by — ${hint}`,
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
  if (
    'expr' in sel &&
    typeof sel.expr === 'string' &&
    isAggregateExpr(sel.expr)
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
