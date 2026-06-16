/**
 * SQL Generation Utilities
 *
 * All SQL-related functions in one module:
 * - SQL clause generators (FROM, SELECT, WHERE, GROUP BY, HAVING)
 * - Complete SQL output generation for models and sources
 * - Filter building
 * - Table function SQL
 */

import {
  FRAMEWORK_PARTITIONS,
  PARTITION_DAILY,
  PARTITION_HOURLY,
  PARTITION_MONTHLY,
} from '@services/framework/constants';
import { COLUMN_META_SQL_INTERNAL_RESERVED_KEYS } from '@services/framework/utils/meta-lint';
import { lightdashConvertDimensionType } from '@services/lightdash/utils';
import type { DJ } from '@shared';
import {
  assertExhaustive,
  orderKeys,
  removeEmpty,
  textToStartCase,
  yamlStringify,
} from '@shared';
import type { Api } from '@shared/api/types';
import type {
  DbtModelConfig,
  DbtModelProperties,
  DbtModelPropertiesColumn,
  DbtProject,
  DbtProjectManifest,
  DbtProjectManifestNode,
  DbtProjectManifestSourceColumn,
  DbtProjectManifestSourceColumns,
  DbtSourceProperties,
  DbtSourceTable,
  DbtSourceTableColumn,
} from '@shared/dbt/types';
import { getDbtModelId } from '@shared/dbt/utils';
import {
  BULK_CTE_TYPES,
  BULK_MODEL_TYPES,
  DEFAULT_INCREMENTAL_STRATEGY,
  JOIN_ON_DIMS,
  normalizeGroupBy,
} from '@shared/framework/constants';
import type {
  FrameworkColumn,
  FrameworkColumnAgg,
  FrameworkCTE,
  FrameworkInterval,
  FrameworkModel,
  FrameworkModelHaving,
  FrameworkModelWhere,
  FrameworkPartitionName,
  FrameworkSource,
  FrameworkSourceMeta,
} from '@shared/framework/types';
import type { LightdashDimension } from '@shared/lightdash/types';
import type { SchemaModelFromJoinModels } from '@shared/schema/types/model.from.join.models.schema';
import type {
  SchemaModelTypeIntJoinColumn,
  SchemaModelTypeIntJoinModels,
  SchemaModelTypeIntLookbackModel,
  SchemaModelTypeIntRollupModel,
  SchemaModelTypeIntSelectModel,
  SchemaModelTypeIntUnionModels,
  SchemaModelTypeMartJoinModels,
  SchemaModelTypeMartSelectModel,
  SchemaModelTypeStgSelectModel,
  SchemaModelTypeStgSelectSource,
  SchemaModelTypeStgUnionSources,
} from '@shared/schema/types/model.schema';
import type { SchemaModelSubquery } from '@shared/schema/types/model.subquery.schema';
import { sqlCleanLine, sqlFormat } from '@shared/sql/utils';
import * as _ from 'lodash';

import {
  type CteColumnRegistry,
  filterBulkSelectColumns,
  frameworkBuildColumns,
  frameworkBuildCteColumnRegistry,
  frameworkBuildDatetimeColumn,
  frameworkColumnName,
  frameworkColumnSelect,
  frameworkGetCteDatetimeSourceInterval,
  frameworkGetModelPartitions,
  frameworkGetNodeColumns,
  frameworkGetPartitionColumnNames,
  frameworkResolveAgg,
  frameworkResolveExcludeFlag,
  frameworkShouldAutoInjectCteFrameworkDims,
  frameworkShouldAutoInjectCtePortalSourceCount,
  frameworkSuffixAgg,
  sortColumnsWithPartitionsLast,
} from './column-utils';
import {
  frameworkBuildModelTags,
  frameworkGetModelChildMap,
  frameworkGetModelLayer,
  frameworkGetModelMeta,
  frameworkGetModelName,
  resolveCteRootFrom,
} from './model-utils';
import {
  frameworkGetSource,
  frameworkGetSourceId,
  frameworkGetSourceMeta,
  frameworkGetSourceRef,
  frameworkMakeSourceName,
} from './source-utils';

// ========================================================================
// Lightdash Dimension Helpers
// ========================================================================

/**
 * Normalize a `time_intervals` value coming from a Lightdash dimension meta.
 *
 * Per the schema, valid inputs are the literal string "OFF" or an array of
 * interval strings. In practice we have to be defensive here because:
 *
 *   1. The framework writes YAML which dbt then loads with PyYAML (YAML 1.1).
 *      Older YAML files on disk may contain an unquoted `time_intervals: OFF`
 *      that PyYAML parses as the boolean `false`. When the manifest is then
 *      consumed back into the framework, the column's `time_intervals` is
 *      `false` rather than `"OFF"`. The emit-side fix in `yamlStringify`
 *      prevents new YAML from being written this way, but existing manifests
 *      on disk in user projects can still carry the corrupted value.
 *   2. A handcrafted JSON model could put any value here. Without coercion
 *      the spread operator below crashes generation for the entire model
 *      (and any descendant whose parent meta we needed).
 *
 * Behaviour:
 *   - undefined / null            -> `[]`
 *   - "OFF"                       -> "OFF" (passed through)
 *   - boolean false               -> "OFF" (preserve original user intent)
 *   - boolean true                -> `[]`  (treat as a default / unset signal)
 *   - array                       -> sorted, de-duplicated copy
 *   - any other type              -> `[]`, with a console warning that names
 *     the model + column so the source of the bad value is debuggable
 */
export function normalizeTimeIntervals(
  value: unknown,
  context: { modelName: string; columnName: string },
): LightdashDimension['time_intervals'] {
  type TimeIntervals = NonNullable<LightdashDimension['time_intervals']>;
  if (value === undefined || value === null) {
    return [] as TimeIntervals;
  }
  if (value === 'OFF' || value === false) {
    // YAML 1.1 turns the string "OFF" into a boolean false during dbt's
    // manifest load, so accept either form as the user-intended "OFF".
    return 'OFF';
  }
  if (value === true) {
    // `true` is not a valid time_intervals value but is the symmetric
    // YAML 1.1 token for "ON" -- fall back to the empty default rather
    // than crashing.
    return [] as TimeIntervals;
  }
  if (Array.isArray(value)) {
    return _.chain([...value])
      .sort()
      .uniq()
      .value() as TimeIntervals;
  }

  console.warn(
    `[dj] Ignoring unsupported time_intervals value on ${context.modelName}.${context.columnName}: ` +
      `expected "OFF" or an array of strings, got ${typeof value} (${JSON.stringify(value)}).`,
  );
  return [] as TimeIntervals;
}

// ========================================================================
// SQL Clause Generators
// ========================================================================

/**
 * Converts a structured subquery definition into a SQL condition string.
 * Handles IN, NOT IN, EXISTS, NOT EXISTS, and scalar comparison operators.
 */
export function buildSubquerySql(subquery: SchemaModelSubquery): string {
  const selectSql = subquery.select.join(', ');

  let fromSql: string;
  if ('model' in subquery.from) {
    fromSql = `{{ ref('${subquery.from.model}') }}`;
  } else if ('source' in subquery.from) {
    fromSql = `{{ source('${subquery.from.source.split('.').join("','")}') }}`;
  } else {
    fromSql = subquery.from.cte;
  }

  let innerSql = `SELECT ${selectSql} FROM ${fromSql}`;
  if (subquery.where) {
    const whereSql = buildConditionsSql(subquery.where);
    if (whereSql) {
      innerSql += ` WHERE ${whereSql}`;
    }
  }

  const operatorMap: Record<string, string> = {
    in: 'IN',
    not_in: 'NOT IN',
    eq: '=',
    neq: '!=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };

  if (subquery.operator === 'exists') {
    return `EXISTS (${innerSql})`;
  }
  if (subquery.operator === 'not_exists') {
    return `NOT EXISTS (${innerSql})`;
  }

  const sqlOp = operatorMap[subquery.operator] || subquery.operator;
  return `${subquery.column} ${sqlOp} (${innerSql})`;
}

/**
 * Builds SQL for join/where/having conditions with support for nested OR groups.
 * Handles both string clauses and structured { and?, or? } with optional { expr?, group? }.
 */
export function buildConditionsSql(
  clause: FrameworkModelWhere | FrameworkModelHaving,
): string {
  if (typeof clause === 'string') {
    return clause;
  }

  const resolveCondition = (c: {
    expr?: string;
    group?: FrameworkModelWhere | FrameworkModelHaving;
    subquery?: SchemaModelSubquery;
  }): string | null => {
    if (c.expr) {
      return c.expr;
    }
    if (c.group) {
      return `(${buildConditionsSql(c.group)})`;
    }
    if (c.subquery) {
      return buildSubquerySql(c.subquery);
    }
    return null;
  };

  const parts: string[] = [];

  if (clause.and?.length) {
    const andParts = clause.and
      .map(resolveCondition)
      .filter(Boolean) as string[];
    if (andParts.length) {
      parts.push(andParts.join(' and '));
    }
  }

  if (clause.or?.length) {
    const orParts = clause.or.map(resolveCondition).filter(Boolean) as string[];
    if (orParts.length) {
      const orSql = orParts.join(' or ');
      parts.push(parts.length > 0 ? `(${orSql})` : orSql);
    }
  }

  return parts.join(' and ');
}

/**
 * Resolves the dimension column names for a join side (model or CTE).
 * For models, uses the manifest via frameworkGetNodeColumns.
 * For CTEs, uses the CteColumnRegistry built during sync.
 */
function getJoinSideDimNames({
  ref,
  project,
  cteRegistry,
}: {
  ref: { model?: string; cte?: string };
  project: DbtProject;
  cteRegistry?: CteColumnRegistry;
}): string[] {
  if (ref.model) {
    return frameworkGetNodeColumns({
      from: { model: ref.model },
      project,
    }).dimensions.map((c) => c.name);
  }
  if (ref.cte && cteRegistry) {
    return (cteRegistry.get(ref.cte) ?? [])
      .filter((c) => c.meta?.type !== 'fct')
      .map((c) => c.name);
  }
  return [];
}

/**
 * Resolves join ON conditions into SQL fragments.
 *
 * When `on` is `"dims"`, computes the intersection of dimension column names
 * between the base and join sides and emits equi-join conditions.
 * When `on` is the object form `{ and: [...] }`, processes each element
 * (string, expr, subquery) as before.
 */
export function resolveJoinOnSql({
  on,
  baseAlias,
  joinAlias,
  project,
  cteRegistry,
  baseRef,
  joinRef,
}: {
  on:
    | 'dims'
    | {
        and?: Array<
          string | { expr: string } | { subquery: SchemaModelSubquery }
        >;
      };
  baseAlias: string;
  joinAlias: string;
  project: DbtProject;
  cteRegistry?: CteColumnRegistry;
  baseRef: { model?: string; cte?: string };
  joinRef: { model?: string; cte?: string };
}): string[] {
  if (on === JOIN_ON_DIMS) {
    const baseDims = getJoinSideDimNames({
      ref: baseRef,
      project,
      cteRegistry,
    });
    const joinDims = new Set(
      getJoinSideDimNames({ ref: joinRef, project, cteRegistry }),
    );
    const shared = baseDims.filter((d) => joinDims.has(d));
    return shared.map((col) => `${baseAlias}.${col}=${joinAlias}.${col}`);
  }

  const parts: string[] = [];
  if (on.and) {
    for (const cond of on.and) {
      if (typeof cond === 'string') {
        parts.push(`${baseAlias}.${cond}=${joinAlias}.${cond}`);
      } else if ('subquery' in cond && cond.subquery) {
        parts.push(buildSubquerySql(cond.subquery));
      } else if ('expr' in cond) {
        parts.push(cond.expr);
      }
    }
  }
  return parts;
}

/**
 * Generate SQL FROM clause
 *
 * @see utils.ts:2839-2954
 */
export function frameworkModelFrom({
  cteRegistry,
  datetimeInterval,
  dj,
  modelJson,
  project,
}: {
  cteRegistry?: CteColumnRegistry;
  datetimeInterval: FrameworkInterval | null;
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
}): { comments: string[]; sql: string } {
  const comments: string[] = [];
  let sql: string = '';
  const appendSql = (line: string) =>
    sql ? (sql += `\n${line}`) : (sql = line);

  // We don't add a from block here for unions
  if ('union' in modelJson.from && modelJson.from.union) {
    return { comments, sql };
  }

  if (
    modelJson.type === 'int_join_column' &&
    'from' in modelJson &&
    'join' in modelJson.from &&
    'column' in modelJson.from.join &&
    'type' in modelJson.from.join
  ) {
    // Handle model join to a column
    const baseModel = modelJson.from.model;
    appendSql('from');
    appendSql(`{{ ref('${baseModel}') }} ${baseModel}`);
    switch (modelJson.from.join.type) {
      case 'cross_join_unnest': {
        appendSql(
          `cross join unnest(${modelJson.from.join.column}) as t(${modelJson.from.join.fields?.join(',')})`,
        );
        break;
      }
    }
  } else if (
    modelJson.type !== 'int_join_column' &&
    'from' in modelJson &&
    'join' in modelJson.from &&
    'cte' in modelJson.from
  ) {
    // CTE as the base table with model or CTE joins (e.g. from.cte + from.join)
    const cteFrom = modelJson.from as {
      cte: string;
      join?: SchemaModelFromJoinModels;
    };
    const baseCte = cteFrom.cte;
    appendSql('from');
    appendSql(`${baseCte} ${baseCte}`);
    for (const joinTo of cteFrom.join || []) {
      const isCteJoin = 'cte' in joinTo;
      const target = isCteJoin
        ? (joinTo as { cte: string }).cte
        : (joinTo as { model: string }).model;
      if (!target) {
        continue;
      }
      const alias = joinTo.override_alias || target;
      const tableExpr = isCteJoin ? target : `{{ ref('${target}') }}`;
      appendSql(`${joinTo.type || 'inner'} join ${tableExpr} ${alias}`);
      if ('on' in joinTo && joinTo.on) {
        const onParts = resolveJoinOnSql({
          on: joinTo.on,
          baseAlias: baseCte,
          joinAlias: alias,
          project,
          cteRegistry,
          baseRef: { cte: baseCte },
          joinRef: isCteJoin ? { cte: target } : { model: target },
        });
        if (onParts.length) {
          appendSql('on');
          appendSql(onParts.join(' and '));
        }
      }
    }
  } else if (
    modelJson.type !== 'int_join_column' &&
    'from' in modelJson &&
    'join' in modelJson.from &&
    'model' in modelJson.from
  ) {
    // Handle joined model refs (join targets may be models or CTEs)
    const baseModel = modelJson.from.model;
    appendSql('from');
    appendSql(`{{ ref('${baseModel}') }} ${baseModel}`);
    for (const joinTo of modelJson.from.join ?? []) {
      const isCteJoin = 'cte' in joinTo;
      const target = isCteJoin
        ? (joinTo as { cte: string }).cte
        : (joinTo as { model: string }).model;
      if (!target) {
        continue;
      }
      const alias = joinTo.override_alias || target;
      const tableExpr = isCteJoin ? target : `{{ ref('${target}') }}`;
      appendSql(`${joinTo.type || 'inner'} join ${tableExpr} ${alias}`);
      if ('on' in joinTo && joinTo.on) {
        const onParts = resolveJoinOnSql({
          on: joinTo.on,
          baseAlias: baseModel,
          joinAlias: alias,
          project,
          cteRegistry,
          baseRef: { model: baseModel },
          joinRef: isCteJoin ? { cte: target } : { model: target },
        });
        if (onParts.length) {
          appendSql('on');
          appendSql(onParts.join(' and '));
        }
      }
    }
  } else if ('lookback' in modelJson.from && modelJson.from.lookback) {
    // Handle lookback
    const baseModel = modelJson.from.model;
    const lookbackDays = modelJson.from.lookback.days ?? 0;
    appendSql('FROM {{ _ext_event_dates_table() }}');
    appendSql(`INNER JOIN {{ ref('${baseModel}') }}`);
    if (modelJson.from.lookback.exclude_event_date) {
      appendSql('ON portal_partition_daily < _ext_event_date');
    } else {
      appendSql('ON portal_partition_daily <= _ext_event_date');
    }
    appendSql(
      `AND portal_partition_daily >= date_add('day', -${lookbackDays}, _ext_event_date)`,
    );
  } else if ('from' in modelJson) {
    appendSql('from');
    if (
      'source' in modelJson.from &&
      typeof modelJson.from.source === 'string'
    ) {
      const sourceRef = frameworkGetSourceRef(modelJson);
      const sourceJinja = `{{ source('${sourceRef?.split('.').join("','")}') }}`;
      const tableFunction = frameworkModelTableFunction({ modelJson, project });
      if (tableFunction) {
        const tableFunctionSql = frameworkTableFunctionSql({
          datetimeInterval,
          dj,
          modelJson,
          project,
        });
        appendSql(tableFunctionSql);
        comments.push(`depends_on: ${sourceJinja}`);
      } else {
        appendSql(sourceJinja);
      }
    } else if (
      'model' in modelJson.from &&
      typeof modelJson.from.model === 'string'
    ) {
      appendSql(`{{ ref('${modelJson.from.model}') }}`);
    } else if (
      'cte' in modelJson.from &&
      typeof modelJson.from.cte === 'string'
    ) {
      appendSql(modelJson.from.cte);
    }
  }

  // Auto-join CTEs referenced in select but not already in the FROM clause.
  // Uses CROSS JOIN because CTEs consumed this way are typically scalar
  // (e.g. a single-row aggregate). This ensures the CTE columns are accessible
  // in the SELECT without requiring the user to manually add a join clause.
  if (
    sql &&
    'ctes' in modelJson &&
    modelJson.ctes?.length &&
    'select' in modelJson &&
    modelJson.select
  ) {
    const cteNames = new Set(
      (modelJson.ctes as { name: string }[]).map((c) => c.name),
    );
    const fromCte =
      'from' in modelJson && 'cte' in modelJson.from
        ? (modelJson.from as { cte: string }).cte
        : null;
    const alreadyJoined = new Set<string | null>([fromCte]);
    if ('from' in modelJson && 'join' in modelJson.from) {
      for (const j of (
        modelJson.from as {
          join?: { model?: string; cte?: string }[];
        }
      ).join || []) {
        if (j.model) {
          alreadyJoined.add(j.model);
        }
        if (j.cte) {
          alreadyJoined.add(j.cte);
        }
      }
    }
    const referencedCtes = new Set<string>();
    for (const sel of modelJson.select) {
      if (typeof sel === 'object' && 'cte' in sel && sel.cte) {
        referencedCtes.add((sel as { cte: string }).cte);
      }
    }
    for (const cteName of referencedCtes) {
      if (cteNames.has(cteName) && !alreadyJoined.has(cteName)) {
        appendSql(`cross join ${cteName}`);
      }
    }
  }

  return { comments, sql };
}

/**
 * Build the SQL for applying an aggregation to a base expression.
 *
 * The `hll`, `tdigest`, and `count` aggregations are special-cased:
 * - `hll` over raw input uses `approx_set`; over an already-HLL input uses `merge(cast(... as hyperloglog))`.
 * - `tdigest` over raw input uses `tdigest_agg`; over an already-tdigest input uses `merge(cast(... as tdigest))`.
 * - `count` over an already-counted input switches to `sum` (partial counts must be summed, not re-counted).
 *
 * `inputSuffixAgg` indicates whether the provided `baseExpr` is already the
 * output of a prior aggregation of the given kind (derived from the column
 * name suffix upstream). Pass `null` when building a fresh aggregation from
 * a raw column or expression, such as inside a CTE's select list.
 */
export function frameworkBuildAggSql({
  agg,
  baseExpr,
  inputSuffixAgg,
}: {
  agg: string;
  baseExpr: string;
  inputSuffixAgg: string | null;
}): string {
  switch (agg) {
    case 'count': {
      if (inputSuffixAgg === 'count') {
        return `sum(${baseExpr})`;
      }
      return `count(${baseExpr})`;
    }
    case 'hll': {
      if (inputSuffixAgg === 'hll') {
        return `cast(merge(cast(${baseExpr} as hyperloglog)) as varbinary)`;
      }
      return `cast(approx_set(${baseExpr}) as varbinary)`;
    }
    case 'tdigest': {
      if (inputSuffixAgg === 'tdigest') {
        return `cast(merge(cast(${baseExpr} as tdigest)) as varbinary)`;
      }
      return `cast(tdigest_agg(${baseExpr}) as varbinary)`;
    }
    default: {
      return `${agg}(${baseExpr})`;
    }
  }
}

/**
 * Generate SQL SELECT clause
 *
 * @see utils.ts:3454-3603
 */
export function frameworkModelSelect({
  columns,
  datetimeInterval,
  dj,
  modelJson,
  project,
}: {
  columns: FrameworkColumn[];
  datetimeInterval: FrameworkInterval | null;
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
}): { comments: string[]; sql: string } {
  const partitionColumnNames = frameworkGetPartitionColumnNames({
    modelJson,
    project,
  });

  const comments: string[] = [];
  let hasPartitionColumnsComment: boolean = false;
  let sql: string = '';
  const appendSql = (line: string) =>
    sql ? (sql += `\n${line}`) : (sql = line);

  const sqlLines: string[] = [];
  if ('union' in modelJson.from && modelJson.from.union) {
    // HANDLE UNION
    const { union } = modelJson.from;
    const sqlSelectLines: string[] = [];
    for (const c of columns) {
      sqlSelectLines.push(frameworkColumnSelect(c));
    }
    if ('model' in modelJson.from && 'models' in union && union.models.length) {
      const baseModel = modelJson.from.model;
      const modelRefs: string[] = [baseModel];
      for (const unionModel of union.models ?? []) {
        modelRefs.push(unionModel);
      }
      for (const modelRef of modelRefs) {
        let sqlLine = `select ${sqlSelectLines.join(', ')} from {{ ref('${modelRef}') }}`;
        const filters = frameworkBuildFilters({
          datetimeInterval,
          dj,
          from: { model: modelRef },
          modelJson,
          project,
        });
        if (filters.length) {
          sqlLine += ` where ${filters.join(' and ')}`;
        }
        sqlLines.push(sqlLine);
      }
    } else if ('source' in modelJson.from && 'sources' in union) {
      const baseSource = modelJson.from.source;
      const sourceRefs: string[] = [baseSource];
      for (const unionSource of union.sources ?? []) {
        sourceRefs.push(unionSource);
      }
      for (const sourceRef of sourceRefs) {
        let sqlLine = `select ${sqlSelectLines.join(',')} from {{ source('${sourceRef.split('.').join("', '")}') }}`;
        const filters = frameworkBuildFilters({
          datetimeInterval,
          dj,
          from: { source: sourceRef },
          modelJson,
          project,
        });
        if (filters.length) {
          sqlLine += ` where ${filters.join(' and ')}`;
        }
        sqlLines.push(sqlLine);
      }
    } else if ('cte' in modelJson.from && 'ctes' in union) {
      // CTE-based union: CTEs are referenced by name directly (no ref() wrapper).
      // Per-branch filters are skipped because each CTE already applies its own WHERE.
      const baseCte = (modelJson.from as { cte: string }).cte;
      const cteRefs: string[] = [
        baseCte,
        ...((union as { ctes?: string[] }).ctes || []),
      ];
      for (const cteRef of cteRefs) {
        sqlLines.push(`select ${sqlSelectLines.join(', ')} from ${cteRef}`);
      }
    }
    appendSql(sqlLines.join(' union all '));
  } else {
    for (const c of columns) {
      const internalExpr = c.internal?.expr;
      const internalPrefix = c.internal?.prefix;
      const metaAgg = c.internal?.agg || null;
      const rollupAgg =
        'rollup' in modelJson.from && c.meta.type === 'fct' && !internalExpr
          ? frameworkSuffixAgg(c.name)
          : null;
      const newAgg = metaAgg || rollupAgg;
      const overrideSuffixAgg = !!c.internal?.override_suffix_agg;
      const resolved = newAgg
        ? frameworkResolveAgg({
            agg: newAgg,
            name: c.name,
            overrideSuffixAgg,
          })
        : { inputSuffixAgg: null, outputName: c.name };
      const shouldAlias = !!internalExpr || !!newAgg;
      const prefix =
        !internalExpr && internalPrefix ? `${internalPrefix}.` : '';

      let line = internalExpr || `${prefix}${c.name}`;
      if (newAgg) {
        line = frameworkBuildAggSql({
          agg: newAgg,
          baseExpr: line,
          inputSuffixAgg: resolved.inputSuffixAgg,
        });
      }
      if (shouldAlias) {
        line = `${line} as ${resolved.outputName}`;
      }

      sqlLines.push(line);
    }

    if (sqlLines.length) {
      // HANDLE SELECT
      appendSql('select');
      appendSql(
        '\n' +
          sqlLines
            .map((line) => {
              if (
                (partitionColumnNames.includes(line.split(' ').pop() ?? '') ||
                  partitionColumnNames.includes(line.split('.').pop() ?? '')) &&
                !hasPartitionColumnsComment
              ) {
                hasPartitionColumnsComment = true;
                return `-- partition columns\n${sqlCleanLine(line)} `;
              }
              return sqlCleanLine(line);
            })
            .join(',\n'),
      );
    } else {
      comments.push(
        'Warning: No columns found for this model. Using SELECT * as fallback. Consider defining columns in seeds.yml or _seeds.yml.',
      );
      appendSql('select\n*');
    }
  }

  return { comments, sql };
}

/**
 * Generate SQL WHERE clause
 *
 * @see utils.ts:3605-3711
 */
export function frameworkModelWhere({
  datetimeInterval,
  dj,
  modelJson,
  project,
}: {
  datetimeInterval: FrameworkInterval | null;
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
}): { comments: string[]; sql: string } {
  const comments: string[] = [];
  let sql: string = '';
  const appendSql = (line: string) =>
    sql ? (sql += `\n${line}`) : (sql = line);

  // We don't add a from block here for unions
  if ('union' in modelJson.from && modelJson.from.union) {
    return { comments, sql };
  }

  const sqlAndFramework: string[] = [];
  const sqlOrFramework: string[] = [];

  if (
    'from' in modelJson &&
    'model' in modelJson.from &&
    // Lookback models are filtered in the join
    !('lookback' in modelJson.from && modelJson.from.lookback)
  ) {
    sqlAndFramework.push(
      ...frameworkBuildFilters({
        datetimeInterval,
        dj,
        from: modelJson.from,
        modelJson,
        project,
        prefix:
          'join' in modelJson.from && modelJson.type !== 'int_join_column'
            ? modelJson.from.model
            : undefined,
      }),
    );
  } else if ('from' in modelJson && 'source' in modelJson.from) {
    sqlAndFramework.push(
      ...frameworkBuildFilters({
        datetimeInterval,
        dj,
        from: modelJson.from,
        modelJson,
        project,
      }),
    );
  } else if (
    'from' in modelJson &&
    'cte' in modelJson.from &&
    'ctes' in modelJson &&
    modelJson.ctes?.length
  ) {
    const rootFrom = resolveCteRootFrom(
      (modelJson.from as { cte: string }).cte,
      modelJson.ctes,
    );
    if (rootFrom) {
      sqlAndFramework.push(
        ...frameworkBuildFilters({
          datetimeInterval,
          dj,
          from: rootFrom,
          modelJson,
          project,
          prefix:
            'join' in modelJson.from
              ? (modelJson.from as { cte: string }).cte
              : undefined,
        }),
      );
    }
  }

  const userConditions =
    'where' in modelJson && modelJson.where
      ? buildConditionsSql(modelJson.where)
      : '';

  const sqlWhereFramework: string[] = [];
  if (sqlAndFramework.length) {
    sqlWhereFramework.push(sqlAndFramework.join(' and '));
  }
  if (sqlOrFramework.length) {
    sqlWhereFramework.push(sqlOrFramework.join(' or '));
  }

  const frameworkSql = sqlWhereFramework.join(' or ');
  if (frameworkSql && userConditions) {
    appendSql('where');
    appendSql('(');
    appendSql(frameworkSql);
    appendSql(') and (');
    appendSql(userConditions);
    appendSql(')');
  } else if (frameworkSql) {
    appendSql('where');
    appendSql(frameworkSql);
  } else if (userConditions) {
    appendSql('where');
    appendSql(userConditions);
  }

  return { comments, sql };
}

/**
 * Generate SQL GROUP BY clause
 *
 * @see utils.ts:2956-3058
 */
export function frameworkModelGroupBy({
  columns,
  modelJson,
}: {
  columns: FrameworkColumn[];
  modelJson: FrameworkModel;
}): { comments: string[]; sql: string } {
  const comments: string[] = [];
  let sql: string = '';
  const appendSql = (line: string) =>
    sql ? (sql += `\n${line}`) : (sql = line);

  // We don't add a group by block for unions
  if ('union' in modelJson.from && modelJson.from.union) {
    return { comments, sql };
  }

  const facts = columns.filter((c) => c.meta.type === 'fct');
  const dimensions = columns.filter((c) => c.meta.type === 'dim');

  const groupBy =
    'group_by' in modelJson ? normalizeGroupBy(modelJson.group_by) : undefined;

  const hasAggFact =
    facts.some((f) => !!f.internal?.agg || !!f.internal?.aggs) ||
    !!('lookback' in modelJson.from && modelJson.from.lookback);
  const shouldGroupBy =
    hasAggFact ||
    ('lookback' in modelJson.from && dimensions.length) ||
    ('rollup' in modelJson.from && dimensions.length) ||
    (groupBy && groupBy.length > 0);
  if (!shouldGroupBy) {
    return { comments, sql };
  }

  appendSql('group by');
  const sqlGroupBy: string[] = [];
  if ('rollup' in modelJson.from) {
    for (const d of dimensions) {
      if (d.internal?.expr) {
        sqlGroupBy.push(d.internal.expr);
      } else {
        sqlGroupBy.push(
          d.internal?.prefix ? `${d.internal.prefix}.${d.name}` : d.name,
        );
      }
    }
  } else if (hasAggFact) {
    for (const c of columns) {
      if (
        c.internal?.agg ||
        (c.meta.type === 'fct' && frameworkSuffixAgg(c.name)) ||
        c.meta.type === 'fct' ||
        c.internal?.exclude_from_group_by
      ) {
        continue;
      }
      if (c.internal?.expr) {
        sqlGroupBy.push(c.internal.expr);
      } else {
        sqlGroupBy.push(
          c.internal?.prefix ? `${c.internal.prefix}.${c.name}` : c.name,
        );
      }
    }
  }
  if (groupBy && groupBy.length > 0) {
    for (const g of groupBy) {
      if (typeof g === 'string') {
        if (sqlGroupBy.includes(g)) {
          continue;
        }
        sqlGroupBy.push(g);
      } else if ('expr' in g && g.expr) {
        if (sqlGroupBy.includes(g.expr)) {
          continue;
        }
        sqlGroupBy.push(g.expr);
      } else if ('type' in g && g.type === 'dims') {
        for (const d of dimensions) {
          if (d.internal?.exclude_from_group_by) {
            continue;
          }
          const line =
            d.internal?.expr ||
            (d.internal?.prefix ? `${d.internal.prefix}.${d.name}` : d.name);
          if (sqlGroupBy.includes(line)) {
            continue;
          }
          sqlGroupBy.push(line);
        }
      }
    }
  }

  // We always need to group by the lookback date in lookback models
  if ('lookback' in modelJson.from && modelJson.from.lookback) {
    const lookbackDateColumn = '_ext_event_date';
    if (!sqlGroupBy.includes(lookbackDateColumn)) {
      sqlGroupBy.push(lookbackDateColumn);
    }
  }

  appendSql(sqlGroupBy.join(',\n'));

  return { comments, sql };
}

/**
 * Generate SQL HAVING clause
 *
 * @see utils.ts:3060-3113
 */
export function frameworkModelHaving({
  modelJson,
}: {
  modelJson: FrameworkModel;
}): {
  comments: string[];
  sql: string;
} {
  const comments: string[] = [];
  let sql: string = '';
  const appendSql = (line: string) =>
    sql ? (sql += `\n${line}`) : (sql = line);

  // We don't support having in unions
  if (
    ('union' in modelJson.from && modelJson.from.union) ||
    !('having' in modelJson && modelJson.having)
  ) {
    return { comments, sql };
  }

  const havingConditions = buildConditionsSql(modelJson.having);
  if (!havingConditions) {
    return { comments, sql };
  }

  appendSql('having');
  appendSql(havingConditions);

  return { comments, sql };
}

/**
 * Build filter expressions
 *
 * @see utils.ts:675-859
 */
export function frameworkBuildFilters({
  datetimeInterval,
  dj,
  from,
  modelJson,
  prefix,
  project,
  excludeDailyFilterOverride,
  includeFullMonthOverride,
}: {
  datetimeInterval: 'hour' | 'day' | 'month' | 'year' | null;
  dj: DJ;
  from: { model: string } | { source: string };
  modelJson: FrameworkModel;
  prefix?: string;
  project: DbtProject;
  /**
   * Per-CTE override for `exclude_daily_filter`. When set, takes precedence
   * over the model-level value; otherwise the model-level flag is used.
   */
  excludeDailyFilterOverride?: boolean;
  /**
   * Per-CTE override for `include_full_month`. When set, takes precedence
   * over the model-level value; otherwise the model-level flag is used.
   */
  includeFullMonthOverride?: boolean;
}): string[] {
  const sqlLines: string[] = [];
  // If exclude_date_filter is set (or implied by `exclude_framework_artifacts:
  // "all"` at the model level), we return no framework date filters. CTE
  // call sites short-circuit before reaching this with their own resolver
  // call so per-CTE overrides participate too.
  if (frameworkResolveExcludeFlag('date_filter', null, modelJson)) {
    return sqlLines;
  }
  //
  const modelLayer = frameworkGetModelLayer(modelJson);

  // Effective flag values: CTE override > model-level > default false.
  const includeFullMonth =
    includeFullMonthOverride ??
    !!('include_full_month' in modelJson && modelJson.include_full_month);
  const excludeDailyFilter =
    excludeDailyFilterOverride ??
    !!('exclude_daily_filter' in modelJson && modelJson.exclude_daily_filter);

  if (
    'model' in from &&
    modelLayer !== 'mart' // We don't add date filters in mart models
  ) {
    const partitions = frameworkGetModelPartitions({
      datetimeInterval,
      dj,
      ...from,
      modelJson,
      project,
    });
    for (const p of partitions) {
      const expr = `${prefix ? `${prefix}.` : ''}${p.name}`;
      const args: string[] = [`"${expr}"`, `data_type="date"`];
      switch (p.name) {
        case PARTITION_MONTHLY: {
          args.push(`interval="month"`);
          sqlLines.push(`{{ _ext_event_date_filter(${args.join(', ')}) }}`);
          break;
        }
        case PARTITION_DAILY: {
          if (!excludeDailyFilter && !includeFullMonth) {
            sqlLines.push(`{{ _ext_event_date_filter(${args.join(', ')}) }}`);
          }
          break;
        }
      }
    }
  } else if ('source' in from) {
    const sourceMeta = frameworkGetSourceMeta({
      project,
      ...from,
    }) as FrameworkSourceMeta;
    const sourceId = frameworkGetSourceId({ project, ...from });

    const tableFunction = sourceMeta?.table_function;
    const dialect = tableFunction?.dialect;

    // Handle partition date filters
    const partitionDateCompileDates =
      sourceMeta?.partition_date?.compile_dates !== false;
    const partitionDateDataType = sourceMeta?.partition_date?.data_type;
    const partitionDateExpr = sourceMeta?.partition_date?.expr;
    const partitionDateInterval = sourceMeta?.partition_date?.interval;
    const partitionDateUseEventDates =
      sourceMeta?.partition_date?.use_event_dates ||
      ('use_event_dates_for_partition_dates' in modelJson &&
        modelJson.use_event_dates_for_partition_dates);
    const partitionDateUseRange = sourceMeta?.partition_date?.use_range;

    // Compile the dates any time we're using a table function

    if (partitionDateExpr) {
      const args: string[] = [`"${partitionDateExpr.replaceAll('"', "'")}"`];
      if (partitionDateCompileDates) {
        args.push('compile_dates=true');
      }
      if (partitionDateDataType) {
        args.push(`data_type="${partitionDateDataType}"`);
      }
      if (dialect) {
        args.push(`dialect="${dialect}"`);
      }
      if (includeFullMonth) {
        args.push('include="month"');
      }
      if (partitionDateInterval) {
        args.push(`interval="${partitionDateInterval}"`);
      }
      args.push(`source_id="${sourceId}"`);
      if (partitionDateUseEventDates) {
        args.push('use_event_dates=true');
      }
      if (partitionDateUseRange) {
        args.push('use_range=true');
      }
      sqlLines.push(`{{ _ext_partition_date_filter(${args.join(', ')}) }}`);
    }

    // Handle additional partition filters
    const partitions = sourceMeta?.partitions;
    for (const partition of partitions ?? []) {
      switch (partition.type) {
        case 'event_dates': {
          const args: string[] = [
            `"${partition.expr.replaceAll('"', "'")}"`,
            `data_type="${partition.data_type || 'date'}"`,
          ];
          if (includeFullMonth) {
            args.push('include="month"');
          }
          if (partition.interval) {
            args.push(`interval="${partition.interval}"`);
          }
          if (partition.use_range) {
            args.push(`use_range=true`);
          }
          sqlLines.push(`{{ _ext_event_date_filter(${args.join(', ')}) }}`);
          break;
        }
        case 'eq':
          sqlLines.push(`${partition.expr} = '${partition.value}'`);
          break;
        case 'gt':
          sqlLines.push(`${partition.expr} > '${partition.value}'`);
          break;
        case 'gte':
          sqlLines.push(`${partition.expr} >= '${partition.value}'`);
          break;
        case 'lt':
          sqlLines.push(`${partition.expr} < '${partition.value}'`);
          break;
        case 'lte':
          sqlLines.push(`${partition.expr} <= '${partition.value}'`);
          break;
        case 'neq':
          sqlLines.push(`${partition.expr} <> '${partition.value}'`);
          break;
        default:
          assertExhaustive(partition);
      }
    }

    // Handle event datetime filter
    // const eventDatetimeDataType = sourceMeta?.event_datetime?.data_type;
    const eventDatetimeExpr = sourceMeta?.event_datetime?.expr;
    const eventDatetimeInterval = sourceMeta?.event_datetime?.interval;
    const eventDatetimeUseRange = !!sourceMeta?.event_datetime?.use_range;
    if (eventDatetimeExpr) {
      const args: string[] = [
        `"${eventDatetimeExpr}"`,
        // `data_type="${eventDatetimeDataType || 'timestamp'}"`,
      ];
      if (dialect) {
        args.push(`dialect="${dialect}"`);
      }
      if (includeFullMonth) {
        args.push('include="month"');
      }
      if (eventDatetimeInterval) {
        args.push(`interval="${eventDatetimeInterval}"`);
      }
      if (eventDatetimeUseRange) {
        args.push(`use_range=true`);
      }
      sqlLines.push(`{{ _ext_event_datetime_filter(${args.join(', ')}) }}`);
    }
    const whereExpr = sourceMeta?.where?.expr;
    if (whereExpr) {
      sqlLines.push(whereExpr);
    }
  }
  return sqlLines;
}

/**
 * Expands a bulk CTE/model select directive into explicit column names.
 * Returns null when no exclude/include is specified, signaling that `*`
 * should be used for backward compatibility.
 */
export function expandBulkSelectColumns({
  sel,
  cteRegistry,
  project,
  hasJoins,
}: {
  sel: Record<string, unknown>;
  cteRegistry: CteColumnRegistry;
  project: DbtProject;
  hasJoins: boolean;
}): string[] | null {
  const selType = sel.type as string;
  const include =
    'include' in sel && Array.isArray(sel.include)
      ? (sel.include as string[])
      : undefined;
  const exclude =
    'exclude' in sel && Array.isArray(sel.exclude)
      ? (sel.exclude as string[])
      : undefined;

  if (!include?.length && !exclude?.length) {
    return null;
  }

  let sourceColumns: { name: string; meta?: { type?: string } }[] = [];
  let sourceAlias: string | null = null;

  if ('cte' in sel) {
    const cteName = sel.cte as string;
    sourceColumns = cteRegistry.get(cteName) || [];
    sourceAlias = cteName;
  } else if ('model' in sel) {
    const modelRef = sel.model as string;
    sourceColumns = frameworkGetNodeColumns({
      from: { model: modelRef },
      project,
    }).columns;
    sourceAlias = modelRef;
  }

  const filtered = filterBulkSelectColumns(sourceColumns, selType, {
    include,
    exclude,
  });

  const sorted = sortColumnsWithPartitionsLast(filtered);

  const prefix = hasJoins && sourceAlias ? `${sourceAlias}.` : '';
  return sorted.map((c) => `${prefix}${c.name}`);
}

/**
 * Rewrites the `selectParts` produced by `frameworkGenerateCteSql` when the
 * CTE declares `from.rollup`. Mirrors the model-level rollup pattern in
 * `frameworkModelSelect` (datetime → `date_trunc(...) as datetime`, fct
 * columns wrapped with their suffix-agg) but operates on the
 * `{ name, sql }[]` shape used by the CTE emitter.
 *
 * Rules:
 *
 * 1. The `datetime` part is ALWAYS rewritten to use the rollup grain --
 *    this overrides any bare `datetime` from auto-inject/bulk expansion
 *    AND any inconsistent `{ name: 'datetime', interval }` select item that
 *    declared a different grain than `from.rollup.interval`.
 * 2. Fct columns whose current SQL is a bare reference (`name` or
 *    `alias.name`) get wrapped with their suffix-agg via
 *    `frameworkBuildAggSql`. Parts that already contain `(` or ` as ` are
 *    treated as user-controlled (explicit `agg`, `aggs`, or `expr`) and
 *    are left untouched.
 * 3. Fct status is read from the CTE's own output registry so bulk-expanded
 *    columns inherit the type information from the upstream registry.
 */
function applyCteRollupSelectRewrites({
  cte,
  cteOutputColumns,
  cteRegistry,
  project,
  rollup,
  selectParts,
}: {
  cte: FrameworkCTE;
  cteOutputColumns: FrameworkColumn[];
  cteRegistry: CteColumnRegistry;
  project: DbtProject;
  rollup: { interval: FrameworkInterval };
  selectParts: { name: string; sql: string }[];
}): void {
  const sourceInterval = frameworkGetCteDatetimeSourceInterval({
    cteRegistry,
    from: cte.from,
    project,
  });
  const datetimeOutCol = cteOutputColumns.find((c) => c.name === 'datetime');
  // Refinement 3: forward Lightdash dimension overrides authored on the CTE
  // datetime (post-rollup-transform) into the emitted SQL via `userDimension`.
  // Without this, `frameworkBuildDatetimeColumn` would emit defaults even when
  // the user has customized the dimension's label, time_intervals, or hidden
  // status on the CTE itself.
  const built = frameworkBuildDatetimeColumn({
    interval: rollup.interval,
    sourceInterval,
    userDimension: datetimeOutCol?.meta?.dimension,
  });

  for (const part of selectParts) {
    if (part.name === 'datetime') {
      part.sql = built.expr ? `${built.expr} as datetime` : 'datetime';
      continue;
    }
    if (part.sql.includes('(') || part.sql.includes(' as ')) {
      continue;
    }
    const outCol = cteOutputColumns.find((c) => c.name === part.name);
    if (!outCol || outCol.meta?.type !== 'fct') {
      continue;
    }
    const agg = frameworkSuffixAgg(part.name);
    if (!agg) {
      continue;
    }
    const overrideSuffixAgg = !!outCol.internal?.override_suffix_agg;
    const resolved = frameworkResolveAgg({
      agg,
      name: part.name,
      overrideSuffixAgg,
    });
    part.sql = `${frameworkBuildAggSql({
      agg,
      baseExpr: part.sql,
      inputSuffixAgg: resolved.inputSuffixAgg,
    })} as ${resolved.outputName}`;
  }
}

/**
 * Generates the SQL body for an individual CTE definition.
 * Handles three FROM patterns: union (CTE-to-CTE or model-to-model),
 * CTE-to-CTE chaining, and standard model/source references.
 * Aggregation directives (agg/aggs) are applied here so the CTE's
 * output columns are already aggregated -- consumers should not re-aggregate.
 *
 * When the CTE declares `from.rollup`, the datetime select gets rewritten
 * to `date_trunc(...) as datetime`, fct columns are wrapped with their
 * suffix-agg, and the GROUP BY defaults to `'dims'` when not explicitly
 * authored. See `applyCteRollupSelectRewrites`.
 */
export function frameworkGenerateCteSql({
  cte,
  cteRegistry,
  datetimeInterval,
  dj,
  modelJson,
  partitionColumnNames,
  project,
}: {
  cte: FrameworkCTE;
  cteRegistry: CteColumnRegistry;
  datetimeInterval?: FrameworkInterval | null;
  dj?: DJ;
  modelJson?: FrameworkModel;
  partitionColumnNames?: string[];
  project: DbtProject;
}): string {
  const from = cte.from;

  const shouldExcludeDateFilter = frameworkResolveExcludeFlag(
    'date_filter',
    cte,
    modelJson ?? null,
  );

  // Per-CTE overrides for the daily-grain date filter and the include-full-month
  // shape. `undefined` falls through to the model-level value inside
  // `frameworkBuildFilters` via `??`, so omitting the flag on a CTE preserves
  // the existing model-level behavior.
  const cteExcludeDailyFilterOverride =
    'exclude_daily_filter' in cte ? cte.exclude_daily_filter : undefined;
  const cteIncludeFullMonthOverride =
    'include_full_month' in cte ? cte.include_full_month : undefined;

  // UNION CTE
  if ('union' in from && from.union) {
    const unionSpec = from.union;
    if ('cte' in from) {
      const allRefs: string[] = [from.cte];
      if ('ctes' in unionSpec) {
        allRefs.push(...unionSpec.ctes);
      }
      if (cte.select?.length) {
        const cols = cteRegistry.get(cte.name) || [];
        const colNames = cols.map((c) => c.name).join(', ');
        return allRefs
          .map((ref) => `select ${colNames} from ${ref}`)
          .join('\nunion all\n');
      }
      return allRefs.map((ref) => `select * from ${ref}`).join('\nunion all\n');
    } else if ('model' in from) {
      const baseModel = from.model;
      const modelRefs: string[] = [baseModel];
      if ('models' in unionSpec) {
        for (const m of unionSpec.models) {
          modelRefs.push(m);
        }
      }
      const selectCols = cte.select?.length
        ? (cteRegistry.get(cte.name) || []).map((c) => c.name).join(', ')
        : '*';

      const sqlLines: string[] = [];
      for (const modelRef of modelRefs) {
        let sqlLine = `select ${selectCols} from {{ ref('${modelRef}') }}`;
        if (!shouldExcludeDateFilter && dj && modelJson) {
          const filters = frameworkBuildFilters({
            datetimeInterval: datetimeInterval ?? null,
            dj,
            from: { model: modelRef },
            modelJson,
            project,
            excludeDailyFilterOverride: cteExcludeDailyFilterOverride,
            includeFullMonthOverride: cteIncludeFullMonthOverride,
          });
          if (filters.length) {
            sqlLine += ` where ${filters.join(' and ')}`;
          }
        }
        sqlLines.push(sqlLine);
      }
      return sqlLines.join('\nunion all\n');
    }

    return '';
  }

  // Standard CTE: build select, from, where, group_by, having
  const parts: string[] = [];

  // SELECT
  if (cte.select?.length) {
    const selectParts: { name: string; sql: string }[] = [];
    let hasStar = false;
    for (const item of cte.select) {
      if (typeof item === 'string') {
        selectParts.push({ name: item, sql: item });
        continue;
      }
      const sel = item as Record<string, unknown>;
      const selType = sel.type as string | undefined;
      const isBulkCte =
        'cte' in sel && !!selType && BULK_CTE_TYPES.has(selType);
      const isBulkModel =
        'model' in sel && !!selType && BULK_MODEL_TYPES.has(selType);
      if (isBulkCte || isBulkModel) {
        const hasJoins = 'join' in from && Array.isArray(from.join);
        const expanded = expandBulkSelectColumns({
          sel,
          cteRegistry,
          project,
          hasJoins,
        });
        if (expanded) {
          for (const exp of expanded) {
            // Bulk expansion may yield "alias.col" when joins are active;
            // strip the alias to recover the bare name for the sort key.
            const bare = exp.split('.').pop() ?? exp;
            selectParts.push({ name: bare, sql: exp });
          }
        } else {
          hasStar = true;
        }
        continue;
      }
      if ('name' in sel) {
        const name = sel.name as string;
        const agg = 'agg' in sel ? (sel.agg as FrameworkColumnAgg) : undefined;
        const aggs =
          'aggs' in sel ? (sel.aggs as FrameworkColumnAgg[]) : undefined;
        const interval =
          'interval' in sel ? (sel.interval as FrameworkInterval) : undefined;
        const baseExpr =
          'expr' in sel && sel.expr ? (sel.expr as string) : name;
        const overrideSuffixAgg = !!(
          'override_suffix_agg' in sel && sel.override_suffix_agg
        );

        // Datetime with interval: emit date_trunc('<interval>', datetime) as
        // datetime, or bare `datetime` when the upstream is already at the
        // requested granularity. Matches main-model behavior.
        if (name === 'datetime' && interval && !agg && !aggs) {
          const sourceInterval = frameworkGetCteDatetimeSourceInterval({
            cteRegistry,
            from: cte.from,
            project,
          });
          const built = frameworkBuildDatetimeColumn({
            interval,
            sourceInterval,
          });
          selectParts.push({
            name: 'datetime',
            sql: built.expr ? `${built.expr} as datetime` : 'datetime',
          });
          continue;
        }

        // Apply aggregation inside the CTE so consumers see pre-aggregated
        // columns. Output names follow the suffix-collision rule
        // (frameworkResolveAgg): a fresh agg on a raw column yields `name_agg`
        // with the fresh kernel; an agg matching the trailing suffix (e.g.
        // `count` on `portal_source_count`) keeps the bare name and uses the
        // merge-style kernel (`sum` for pre-counted columns, `merge(cast(...
        // as hyperloglog))` for pre-HLL, etc.).
        if (aggs) {
          for (const a of aggs) {
            const resolved = frameworkResolveAgg({
              agg: a,
              name,
              overrideSuffixAgg,
            });
            selectParts.push({
              name: resolved.outputName,
              sql: `${frameworkBuildAggSql({ agg: a, baseExpr, inputSuffixAgg: resolved.inputSuffixAgg })} as ${resolved.outputName}`,
            });
          }
          if (!agg) {
            continue;
          }
        }
        if (agg) {
          const resolved = frameworkResolveAgg({
            agg,
            name,
            overrideSuffixAgg,
          });
          selectParts.push({
            name: resolved.outputName,
            sql: `${frameworkBuildAggSql({ agg, baseExpr, inputSuffixAgg: resolved.inputSuffixAgg })} as ${resolved.outputName}`,
          });
        } else if ('expr' in sel && sel.expr) {
          selectParts.push({
            name,
            sql: `${String(sel.expr)} as ${name}`,
          });
        } else {
          selectParts.push({ name, sql: name });
        }
        continue;
      }
    }

    // Mirror the main-model datetime + partition auto-injection for CTEs
    // whose FROM is a plain model OR plain CTE ref. Registry
    // (frameworkInferCteColumns) and emitted SQL must stay in lock-step;
    // both call `frameworkShouldAutoInjectCteFrameworkDims`. Emitted as
    // bare passthrough refs -- the sorter below still pushes partitions
    // to the bottom.
    if (!hasStar) {
      const autoDims = frameworkShouldAutoInjectCteFrameworkDims({
        cte,
        alreadyPresentNames: selectParts.map((p) => p.name),
        cteRegistry,
        modelJson,
        project,
      });
      if (autoDims) {
        for (const name of autoDims.include) {
          selectParts.push({ name, sql: name });
        }
      }
    }

    // Mirror the main-model `portal_source_count` auto-injection for CTEs
    // whose FROM is a plain model OR plain CTE ref. Registry
    // (frameworkInferCteColumns) and emitted SQL must stay in lock-step;
    // both call `frameworkShouldAutoInjectCtePortalSourceCount`.
    if (!hasStar) {
      const autoPsc = frameworkShouldAutoInjectCtePortalSourceCount({
        cte,
        alreadyPresentNames: selectParts.map((p) => p.name),
        cteRegistry,
        modelJson,
        project,
      });
      if (autoPsc) {
        if (autoPsc.applyAgg) {
          const resolved = frameworkResolveAgg({
            agg: 'count',
            name: 'portal_source_count',
          });
          const sql = `${frameworkBuildAggSql({
            agg: 'count',
            baseExpr: 'portal_source_count',
            inputSuffixAgg: resolved.inputSuffixAgg,
          })} as ${resolved.outputName}`;
          selectParts.push({ name: resolved.outputName, sql });
        } else {
          selectParts.push({
            name: 'portal_source_count',
            sql: 'portal_source_count',
          });
        }
      }
    }

    // Rollup post-process. Two responsibilities:
    //
    // 1. Star-expansion: a bulk `all_from_*` / `dims_from_*` / `fcts_from_*`
    //    select with no `include` / `exclude` filters returns `null` from
    //    `expandBulkSelectColumns`, leaving us with `select *`. That's
    //    incompatible with rollup -- the emitted SQL would not contain the
    //    `date_trunc(...)` truncation or the suffix-agg wrapping needed at
    //    the new grain. Replace `*` with explicit column refs from the
    //    rolled-up registry so the rewrite pass below has something to work
    //    on.
    // 2. Rewrite datetime to `date_trunc(...) as datetime` and wrap any
    //    bare fct references with their suffix-agg. Runs after both
    //    auto-inject sites so `datetime`/`portal_source_count` injected
    //    there get normalized alongside user-authored selects and bulk
    //    expansions. See `applyCteRollupSelectRewrites`.
    if ('rollup' in from && from.rollup) {
      const cteOutputColumns = cteRegistry.get(cte.name) ?? [];
      if (hasStar) {
        hasStar = false;
        const presentNames = new Set(selectParts.map((p) => p.name));
        for (const col of cteOutputColumns) {
          if (presentNames.has(col.name)) {
            continue;
          }
          selectParts.push({ name: col.name, sql: col.name });
        }
      }
      applyCteRollupSelectRewrites({
        cte,
        cteOutputColumns,
        cteRegistry,
        project,
        rollup: from.rollup,
        selectParts,
      });
    }

    if (hasStar && selectParts.length === 0) {
      parts.push('select *');
    } else {
      // Sort alphabetically with partition columns pushed to the bottom,
      // matching the main-model convention. A `-- partition columns` comment
      // is emitted on its own line immediately before the first partition
      // column in the SELECT list.
      const sorted = sortColumnsWithPartitionsLast(
        selectParts,
        partitionColumnNames,
      );
      const partitionSet = new Set(
        partitionColumnNames ?? [...FRAMEWORK_PARTITIONS],
      );
      const renderedLines: string[] = [];
      let partitionCommentEmitted = false;
      for (const p of sorted) {
        if (partitionSet.has(p.name) && !partitionCommentEmitted) {
          partitionCommentEmitted = true;
          renderedLines.push(`-- partition columns\n${p.sql}`);
        } else {
          renderedLines.push(p.sql);
        }
      }
      const prefix = hasStar ? '*, ' : '';
      parts.push(`select ${prefix}${renderedLines.join(',\n')}`);
    }
  } else {
    parts.push('select *');
  }

  // FROM -- helper to generate join SQL for a base alias.
  // Join targets may be external models (ref()) or sibling CTEs (bare name).
  const appendJoinSql = (
    baseAlias: string,
    baseRef: { model?: string; cte?: string },
    joins: SchemaModelFromJoinModels,
  ) => {
    for (const j of joins) {
      const isCteJoin = 'cte' in j;
      const target = isCteJoin
        ? (j as { cte: string }).cte
        : (j as { model: string }).model;
      const alias = j.override_alias || target;
      const joinType = ('type' in j && j.type) || 'inner';
      const tableExpr = isCteJoin ? target : `{{ ref('${target}') }}`;
      parts.push(`${joinType} join ${tableExpr} ${alias}`);
      if ('on' in j && j.on) {
        const onParts = resolveJoinOnSql({
          on: j.on,
          baseAlias,
          joinAlias: alias,
          project,
          cteRegistry,
          baseRef,
          joinRef: isCteJoin ? { cte: target } : { model: target },
        });
        if (onParts.length) {
          parts.push(`on ${onParts.join(' and ')}`);
        }
      }
    }
  };

  if ('cte' in from && !('union' in from)) {
    parts.push(`from ${from.cte}`);
    if ('join' in from && from.join) {
      appendJoinSql(from.cte, { cte: from.cte }, from.join);
    }
  } else if ('model' in from && !('union' in from)) {
    const modelRef = from.model;
    parts.push(`from {{ ref('${modelRef}') }}`);
    if ('join' in from && from.join) {
      appendJoinSql(modelRef, { model: modelRef }, from.join);
    }
  }

  // WHERE -- merge user conditions with framework partition filters
  const userWhere = cte.where ? buildConditionsSql(cte.where) : '';
  const frameworkFilters: string[] = [];
  if (
    !shouldExcludeDateFilter &&
    dj &&
    modelJson &&
    'model' in from &&
    !('union' in from)
  ) {
    const modelLayer = frameworkGetModelLayer(modelJson);
    if (modelLayer !== 'mart') {
      frameworkFilters.push(
        ...frameworkBuildFilters({
          datetimeInterval: datetimeInterval ?? null,
          dj,
          from: { model: from.model },
          modelJson,
          project,
          prefix: 'join' in from && from.join ? from.model : undefined,
          excludeDailyFilterOverride: cteExcludeDailyFilterOverride,
          includeFullMonthOverride: cteIncludeFullMonthOverride,
        }),
      );
    }
  }
  const frameworkWhere = frameworkFilters.length
    ? frameworkFilters.join(' and ')
    : '';
  if (frameworkWhere && userWhere) {
    parts.push(`where (${frameworkWhere}) and (${userWhere})`);
  } else if (frameworkWhere) {
    parts.push(`where ${frameworkWhere}`);
  } else if (userWhere) {
    parts.push(`where ${userWhere}`);
  }

  // GROUP BY
  // Rollup implies aggregation across the new grain. When the user has not
  // authored an explicit `group_by` on the CTE, default to `'dims'` so the
  // SQL emitter produces `GROUP BY <all dim exprs>`. Mirrors the main-model
  // rollup pattern (`shouldGroupBy` in `frameworkModelGroupBy`).
  const cteGroupBy =
    'rollup' in from && from.rollup && cte.group_by === undefined
      ? 'dims'
      : cte.group_by;
  const normalizedCteGroupBy = normalizeGroupBy(cteGroupBy);
  if (normalizedCteGroupBy) {
    const selectExprMap = new Map<string, string>();
    if (cte.select) {
      for (const s of cte.select) {
        if (typeof s === 'object' && 'name' in s && 'expr' in s && s.expr) {
          selectExprMap.set(s.name, s.expr);
        }
      }
    }

    const gbParts: string[] = [];
    for (const gb of normalizedCteGroupBy) {
      if (typeof gb === 'string') {
        gbParts.push(gb);
      } else if ('expr' in gb) {
        gbParts.push(gb.expr);
      } else if ('type' in gb && gb.type === 'dims') {
        const cols = cteRegistry.get(cte.name) || [];
        const dimCols = cols
          .filter(
            (c) => c.meta?.type !== 'fct' && !c.internal?.exclude_from_group_by,
          )
          // Fall back to `c.internal.expr` (e.g. `date_trunc('hour', datetime)`
          // produced by frameworkBuildDatetimeColumn) before the bare name.
          // Trino's GROUP BY resolves identifiers against input columns, not
          // SELECT aliases (see trino#16533), so emitting the bare alias for
          // a derived expression would over-group to the raw input column's
          // granularity. Matches the main-model builder.
          .map((c) => selectExprMap.get(c.name) || c.internal?.expr || c.name);
        gbParts.push(...dimCols);
      }
    }
    if (gbParts.length) {
      parts.push(`group by ${gbParts.join(', ')}`);
    }
  }

  // HAVING
  if (cte.having) {
    const havingConditions = buildConditionsSql(cte.having);
    if (havingConditions) {
      parts.push(`having ${havingConditions}`);
    }
  }

  return parts.join('\n');
}

// ========================================================================
// Table Functions
// ========================================================================

/**
 * Get table function reference
 *
 * @see utils.ts:1887-1902
 */
export function frameworkModelTableFunction({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): FrameworkSourceMeta['table_function'] | null {
  if ('from' in modelJson && 'source' in modelJson.from) {
    const sourceMeta = frameworkGetSourceMeta({
      project,
      source: modelJson.from.source,
    }) as FrameworkSourceMeta;
    return sourceMeta?.table_function || null;
  }
  return null;
}

/**
 * Generate table function SQL
 *
 * @see utils.ts:3803-3849
 */
export function frameworkTableFunctionSql({
  datetimeInterval,
  dj,
  modelJson,
  project,
}: {
  datetimeInterval: FrameworkInterval | null;
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
}): string {
  const sourceRef = frameworkGetSourceRef(modelJson);
  if (!sourceRef) {
    return '';
  }

  const source = frameworkGetSource({ project, source: sourceRef });
  const sourceMeta = frameworkGetSourceMeta({
    project,
    source: sourceRef,
  }) as FrameworkSourceMeta;
  const tableFunction = sourceMeta?.table_function;
  const tableFunctionDatabase = tableFunction?.database;
  if (!source || !tableFunction || !tableFunctionDatabase) {
    return '';
  }

  // For table functions, we pass select all fields within the inner query, but ensure that filters are applied
  const dialect = tableFunction.dialect;
  // Path for the function to execute
  const tableFunctionPath = `${tableFunctionDatabase}.${tableFunction.schema}.${tableFunction.name}`;
  // The source table inside the context of the table function
  const tableFunctionSource = `${source.schema}.${source.name}`;
  const innerSql = sqlFormat(
    `
  select *
  from \`${tableFunctionSource}\`
  ${frameworkModelWhere({ datetimeInterval, dj, modelJson, project }).sql.replaceAll("'", '"')}
  `,
    dialect, // The inner query should be formatted in the dialect of the table function;
  );
  const sql = sqlFormat(
    `TABLE(${tableFunctionPath}(${tableFunction.arg} => '
${innerSql}
'
))`,
  );

  return sql;
}

// ========================================================================
// Complete SQL Generation
// ========================================================================

/**
 * Access a named field from the model's `materialization` object, handling
 * the union-type narrowing required by the FrameworkModel discriminated union.
 * Each model type schema may or may not include a `materialization` property,
 * so direct access like `modelJson.materialization.field` doesn't type-check.
 * Returns `null` when the model type has no materialization or the field is absent.
 */
function getMaterializationProp(
  modelJson: FrameworkModel,
  field: string,
): unknown {
  if ('materialization' in modelJson && modelJson.materialization) {
    if (typeof modelJson.materialization === 'string') {
      return field === 'type' ? modelJson.materialization : null;
    }
    if (field in modelJson.materialization) {
      return (modelJson.materialization as Record<string, unknown>)[field];
    }
  }
  return null;
}

/**
 * Pick the appropriate partition column(s) to use as the incremental `unique_key`.
 * The unique_key tells dbt which column(s) define "row identity" for the delete
 * step in delete+insert strategy -- rows matching these values are deleted before
 * new rows are inserted.
 *
 * Partition columns are the natural choice because incremental runs are scoped
 * by date range, so we delete+insert all rows for the processed date partition(s).
 *
 * Priority: portal_partition_daily (daily/hourly models) > portal_partition_monthly
 * (monthly models) > full partition list (custom partitions).
 *
 * Returns a plain string when there is a single key (e.g. unique_key="col")
 * and an array when there are multiple (e.g. unique_key=["col1","col2"]).
 */
function getDefaultUniqueKey(
  partitionColumnNames: string[],
): string | string[] {
  if (partitionColumnNames.includes(PARTITION_DAILY)) {
    return PARTITION_DAILY;
  }
  if (partitionColumnNames.includes(PARTITION_MONTHLY)) {
    return PARTITION_MONTHLY;
  }
  if (partitionColumnNames.length === 1) {
    return partitionColumnNames[0];
  }
  return [...partitionColumnNames];
}

/**
 * Generate complete model output (SQL + YAML)
 *
 * @see utils.ts:1559-1827
 */
export function frameworkGenerateModelOutput({
  dj,
  project,
  modelJson,
}: {
  dj: DJ;
  project: DbtProject;
  modelJson: FrameworkModel;
}): {
  config: DbtModelConfig;
  modelId: string;
  project: DbtProject;
  properties: DbtModelProperties;
  sql: string;
  yml: string;
} {
  const modelName = frameworkGetModelName(modelJson);
  const projectName = project.name;
  const modelId = getDbtModelId({ modelName, projectName });

  const partitionColumnNames = frameworkGetPartitionColumnNames({
    modelJson,
    project,
  });

  const cteColumnRegistry: CteColumnRegistry | undefined =
    'ctes' in modelJson && modelJson.ctes?.length
      ? frameworkBuildCteColumnRegistry({
          ctes: modelJson.ctes,
          modelId,
          modelJson,
          partitionColumnNames,
          project,
        })
      : undefined;

  const { columns, datetimeInterval } = frameworkBuildColumns({
    dj,
    modelJson,
    project,
    cteColumnRegistry,
  });

  const modelProperties = frameworkModelProperties({
    dj,
    modelJson,
    project,
    cteColumnRegistry,
  });

  const modelFrom = frameworkModelFrom({
    cteRegistry: cteColumnRegistry,
    datetimeInterval,
    dj,
    modelJson,
    project,
  });
  const modelGroupBy = frameworkModelGroupBy({
    columns,
    modelJson,
  });
  const modelHaving = frameworkModelHaving({
    modelJson,
  });
  const modelSelect = frameworkModelSelect({
    columns,
    datetimeInterval,
    dj,
    modelJson,
    project,
  });
  const modelWhere = frameworkModelWhere({
    datetimeInterval,
    dj,
    modelJson,
    project,
  });

  const modelTableFunction = frameworkModelTableFunction({
    modelJson,
    project,
  });

  let sql = '';

  // Append comments
  const modelComments = [
    ...modelFrom.comments,
    ...modelGroupBy.comments,
    ...modelHaving.comments,
    ...modelSelect.comments,
    ...modelWhere.comments,
  ];
  if (modelComments.length) {
    sql += `-- ${modelComments.join('\n-- ')}\n\n`;
  }
  //

  // Append dbt config() block
  const modelConfig: DbtModelConfig = {};
  const modelLayer = frameworkGetModelLayer(modelJson);
  let materialized: DbtModelConfig['materialized'];
  switch (modelLayer) {
    // Staging and intermediate models support user-configurable materialization
    // (incremental or ephemeral per JSON schema). Defaults to ephemeral if not specified.
    case 'int':
    case 'stg': {
      materialized =
        (getMaterializationProp(
          modelJson,
          'type',
        ) as DbtModelConfig['materialized']) ||
        ('materialized' in modelJson && modelJson.materialized) ||
        'ephemeral';
      break;
    }
    // Mart models are always views (analytics-ready, read-only layers)
    case 'mart': {
      materialized = 'view';
      break;
    }
  }
  if (materialized) {
    modelConfig.materialized = materialized;
    switch (materialized) {
      case 'incremental': {
        const database = getMaterializationProp(modelJson, 'database') as
          | string
          | null;
        if (database) {
          modelConfig.database = database;
        }

        // Resolve the storage type from the project's dbt_project.yml vars.
        // This drives storage-specific defaults for incremental strategy and partitioning.
        const storageType = project.variables?.storage_type;

        // Strategy resolution: check materialization.strategy (newer nested format),
        // then top-level incremental_strategy (older flat format), then fall back to
        // a storage-type-aware default.
        const strategy = (getMaterializationProp(modelJson, 'strategy') ||
          ('incremental_strategy' in modelJson &&
            modelJson.incremental_strategy) ||
          null) as {
          type?: string;
          unique_key?: string | string[];
          merge_update_columns?: string[];
          merge_exclude_columns?: string[];
        } | null;

        // Build the partition column list from columns that actually exist on
        // the model. Candidate partition columns can come from parent meta
        // (inherited) or from a hardcoded default list, neither of which is
        // guaranteed to match the current model's actual columns. Filtering
        // here ensures both `unique_key` defaulting and `partitioning` /
        // `partitioned_by` only reference columns the model really produces.
        const partitions: string[] = [];
        for (const p of partitionColumnNames) {
          if (columns.find((c) => c.name === p)) {
            partitions.push(p);
          }
        }

        switch (strategy?.type) {
          case 'append': {
            // Append: insert new rows with no de-duplication. No unique_key
            // is applicable. Upstream must guarantee no duplicates in the
            // new slice.
            modelConfig.incremental_strategy = 'append';
            break;
          }
          case 'delete+insert': {
            modelConfig.incremental_strategy = 'delete+insert';
            // Use user-provided unique_key if set, otherwise default to the
            // appropriate partition column based on the model's time grain.
            // If no partition column exists on the model, omit unique_key so
            // dbt surfaces its own clear "delete+insert requires unique_key"
            // error at compile time instead of us emitting a phantom column.
            if (strategy.unique_key) {
              modelConfig.unique_key = strategy.unique_key;
            } else if (partitions.length) {
              modelConfig.unique_key = getDefaultUniqueKey(partitions);
            }
            break;
          }
          case 'merge': {
            modelConfig.incremental_strategy = 'merge';
            modelConfig.unique_key = strategy.unique_key;
            // merge_update_columns and merge_exclude_columns are mutually exclusive
            if (strategy.merge_update_columns) {
              modelConfig.merge_update_columns = strategy.merge_update_columns;
            } else if (strategy.merge_exclude_columns) {
              modelConfig.merge_exclude_columns =
                strategy.merge_exclude_columns;
            }
            break;
          }
          case 'overwrite_existing_partitions': {
            // Requires a custom dbt macro in the consumer project (the DJ
            // extension does not ship it and dbt-trino does not provide it
            // natively). The macro derives the partition list from the new
            // slice itself, so unique_key is dead config for this strategy --
            // we intentionally never emit it (and the JSON schema rejects it).
            modelConfig.incremental_strategy = 'overwrite_existing_partitions';
            break;
          }
          case 'dj_iceberg_partition_overwrite': {
            // DJ-shipped strategy (macros/strategies.sql -> the dispatch macro
            // get_incremental_dj_iceberg_partition_overwrite_sql is auto-copied
            // to <project>/macros/_ext_/strategies.sql by writeMacroFiles).
            // Requires Iceberg format on the target table; the macro reads
            // properties.partitioning (Iceberg-only) to derive partitions
            // from the new slice itself, so unique_key is not applicable
            // (the JSON schema rejects it). Format is enforced at validation
            // time via validateDjIcebergPartitionOverwrite, not here.
            modelConfig.incremental_strategy = 'dj_iceberg_partition_overwrite';
            break;
          }
          default: {
            const defaultStrategy =
              dj.config.materializationDefaultIncrementalStrategy ??
              DEFAULT_INCREMENTAL_STRATEGY;
            modelConfig.incremental_strategy = defaultStrategy;
            // Only delete+insert auto-derives unique_key from partitions.
            // Append never needs one; merge requires a user-supplied key
            // (and is not a valid default); overwrite_existing_partitions and
            // dj_iceberg_partition_overwrite ignore unique_key entirely (the
            // macros derive partitions from the new slice itself).
            if (defaultStrategy === 'delete+insert' && partitions.length) {
              modelConfig.unique_key = getDefaultUniqueKey(partitions);
            }
          }
        }

        // Trino session settings for long-running incremental queries
        modelConfig.pre_hook =
          "set session iterative_optimizer_timeout='60m'; set session query_max_planning_time='60m'";

        if (partitions.length) {
          // Resolve storage format: model-level format override > project-level storage_type > delta_lake default.
          // Iceberg uses "partitioning" keyword; Delta Lake/Hive use "partitioned_by" in SQL properties.
          const format =
            getMaterializationProp(modelJson, 'format') ||
            (storageType === 'iceberg' ? 'iceberg' : null);
          switch (format) {
            case 'iceberg':
              modelConfig.properties = {
                partitioning: `ARRAY['${partitions.join("', '")}']`,
              };
              break;
            default:
              modelConfig.properties = {
                partitioned_by: `ARRAY['${partitions.join("', '")}']`,
              };
          }
        }
        break;
      }
      default:
      // No additional config needed for non-incremental materializations
    }
  }

  // Apply user-defined SQL hooks (pre/post statements from model JSON).
  // User hooks replace any auto-injected defaults (e.g., Trino session settings).
  if ('sql_hooks' in modelJson && modelJson.sql_hooks) {
    if (modelJson.sql_hooks.post) {
      modelConfig.post_hook = modelJson.sql_hooks.post;
    }
    if (modelJson.sql_hooks.pre) {
      modelConfig.pre_hook = modelJson.sql_hooks.pre;
    }
  }

  const modelConfigArgs: string[] = [];
  for (const [k, v] of Object.entries(modelConfig)) {
    try {
      switch (typeof v) {
        case 'object': {
          modelConfigArgs.push(`${k}=${JSON.stringify(v)}`);
          break;
        }
        default: {
          modelConfigArgs.push(`${k}="${v}"`);
          break;
        }
      }
    } catch {}
  }
  if (modelConfigArgs.length) {
    sql += `{{
  config(
    ${modelConfigArgs.join(',\n    ')}
  )
}}\n\n`;
  }
  //

  // Prepend user-defined CTEs to the model's WITH clause.
  // The trailing comma allows the main model CTE to follow seamlessly.
  let ctesSql = '';
  if ('ctes' in modelJson && modelJson.ctes?.length && cteColumnRegistry) {
    const cteParts: string[] = [];
    for (const cte of modelJson.ctes) {
      const cteSqlBody = frameworkGenerateCteSql({
        cte,
        cteRegistry: cteColumnRegistry,
        datetimeInterval,
        dj,
        modelJson,
        partitionColumnNames,
        project,
      });
      cteParts.push(`${cte.name} as (\n${cteSqlBody}\n)`);
    }
    ctesSql = cteParts.join(',\n') + ',\n';
  }

  // Append model SQL
  const modelSql = `
with ${ctesSql}${modelName} as (
${modelSelect.sql}
${modelFrom.sql}
${
  modelTableFunction
    ? '' // If the model has a table function, where filters are applied inside it
    : modelWhere.sql
}
${modelGroupBy.sql}
${modelHaving.sql}
)
select * from ${modelName}
`;
  sql += sqlFormat(modelSql);
  //

  return {
    config: modelConfig,
    modelId,
    project: {
      ...project,
      manifest: frameworkModelManifestMerge({
        dj,
        modelJson,
        project,
      }),
    },
    properties: modelProperties,
    sql: sql.trim(),
    yml: yamlStringify({
      version: '2',
      models: [modelProperties],
      // semantic_models: [],
    }),
  };
}

/**
 * Generate complete source output (YAML)
 *
 * @see utils.ts:1829-1856
 */
export function frameworkGenerateSourceOutput({
  project,
  sourceJson,
}: {
  project: DbtProject;
  sourceJson: FrameworkSource;
}): {
  project: DbtProject;
  yml: string;
} {
  const sourceProperties = frameworkSourceProperties(sourceJson);

  // Merge new properties into the source manifest

  return {
    project: {
      ...project,
      manifest: frameworkSourceManifestMerge({
        project,
        sourceJson,
      }),
    },
    yml: yamlStringify({
      version: '2',
      sources: [sourceProperties],
    }),
  };
}

/**
 * Generate model properties (YAML)
 *
 * @see utils.ts:3143-3452
 */
/**
 * Builds dbt model properties (used for YML output).
 * Accepts cteColumnRegistry so columns derived from CTEs are
 * included in the YML column list alongside manifest-sourced columns.
 */
export function frameworkModelProperties({
  dj,
  modelJson,
  project,
  cteColumnRegistry,
}: {
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
  cteColumnRegistry?: CteColumnRegistry;
}): DbtModelProperties {
  const { columns, modelMetrics } = frameworkBuildColumns({
    dj,
    modelJson,
    project,
    cteColumnRegistry,
  });

  const modelName = frameworkGetModelName(modelJson);
  const modelLayer = frameworkGetModelLayer(modelJson);
  const tags = frameworkBuildModelTags({ modelJson, project });

  const modelProperties: DbtModelProperties = {
    name: modelName,
    group: modelJson.group,
    description: modelJson.description || '',
    docs: { show: true },
    private: false,
    contract: { enforced: false },
    config: {},
    meta: {
      ...('meta' in modelJson && modelJson.meta ? modelJson.meta : {}),
      metrics: modelMetrics,
    },
    columns: [],
  };

  let portalPartitionColumns: string[] | null = null;
  if ('source' in modelJson.from) {
    const sourceMeta = frameworkGetSourceMeta({
      project,
      ...modelJson.from,
    }) as FrameworkSourceMeta;
    portalPartitionColumns = sourceMeta?.portal_partition_columns || null;
  } else if ('model' in modelJson.from) {
    const modelMeta = frameworkGetModelMeta({
      project,
      model: modelJson.from.model,
    }) as any;
    portalPartitionColumns = modelMeta?.portal_partition_columns || null;
  } else if (
    'cte' in modelJson.from &&
    'ctes' in modelJson &&
    modelJson.ctes?.length
  ) {
    const rootFrom = resolveCteRootFrom(
      (modelJson.from as { cte: string }).cte,
      modelJson.ctes,
    );
    if (rootFrom) {
      if ('source' in rootFrom) {
        const sourceMeta = frameworkGetSourceMeta({
          project,
          ...rootFrom,
        }) as FrameworkSourceMeta;
        portalPartitionColumns = sourceMeta?.portal_partition_columns || null;
      } else {
        const modelMeta = frameworkGetModelMeta({
          project,
          ...rootFrom,
        }) as any;
        portalPartitionColumns = modelMeta?.portal_partition_columns || null;
      }
    }
  }
  if (portalPartitionColumns) {
    // Propagate the inherited partition column list as-is so descendants can
    // see the full candidate set. Filtering against this model's columns here
    // would cascade through `frameworkGetParentMeta` (which reads cached YAML
    // meta) and incorrectly strip columns that downstream join models legitimately
    // re-introduce via joined sources. The `unique_key` defaulting in
    // `frameworkGenerateModelOutput` already intersects locally with this
    // model's actual columns, so correctness is preserved without filtering here.
    modelProperties.meta = {
      ...modelProperties.meta,
      portal_partition_columns: portalPartitionColumns,
    };
  }

  // Build AI Hint Tags
  let aiHintTags = [...tags.aiHints];
  if (dj.config.aiHintTag) {
    aiHintTags = _.union(aiHintTags, [dj.config.aiHintTag]);
  }
  // Apply tags to model
  if (tags.model.length) {
    modelProperties.config = { ...modelProperties.config, tags: tags.model };
  }
  // Specify tags which should stay local to this model
  if (tags.local.length) {
    modelProperties.meta = { ...modelProperties.meta, local_tags: tags.local };
  }
  // Add model level lightdash meta
  if ('lightdash' in modelJson) {
    // Precedence for `sql_filter` on the table block:
    //   1. explicit string  -> use as-is (per-model override)
    //   2. explicit null    -> drop the key (explicit disable)
    //   3. undefined        -> inject `dj.lightdash.defaultSqlFilter` only if
    //                          all `dj.lightdash.defaultSqlFilterRequiredColumns`
    //                          are present on this model.
    // Models without a `lightdash` block never receive the global default.
    const tableMeta: Record<string, unknown> = {
      ...(modelJson.lightdash?.table ?? {}),
    };
    const explicitSqlFilter = (
      modelJson.lightdash?.table as { sql_filter?: string | null } | undefined
    )?.sql_filter;

    if (explicitSqlFilter === null) {
      delete tableMeta.sql_filter;
    } else if (typeof explicitSqlFilter !== 'string') {
      const defaultFilter = dj.config.lightdashDefaultSqlFilter;
      const requiredCols =
        dj.config.lightdashDefaultSqlFilterRequiredColumns ?? [];
      if (defaultFilter) {
        const presentColNames = new Set(
          columns.map((c) => frameworkColumnName({ column: c, modelJson })),
        );
        const allPresent = requiredCols.every((name: string) =>
          presentColNames.has(name),
        );
        if (allPresent) {
          tableMeta.sql_filter = defaultFilter;
        }
      }
    }

    modelProperties.meta = {
      ...modelProperties.meta,
      ...tableMeta,
    };
    for (const { name: metricName, ...metric } of modelJson.lightdash
      ?.metrics ?? []) {
      // Adds 'ai' tag to model level metrics with an ai_hint
      if (aiHintTags.length && metric?.ai_hint) {
        metric.tags = _.union(metric.tags ?? [], aiHintTags);
      }
      metric.tags?.sort();
      modelProperties.meta.metrics = {
        ...modelProperties.meta.metrics,
        [metricName]: metric,
      };
    }
  }

  const modelCaseSensitive =
    'lightdash' in modelJson ? modelJson.lightdash?.case_sensitive : undefined;

  // Partition columns need case_sensitive: true to preserve predicate pushdown
  // (Lightdash wraps non-case-sensitive dimensions in UPPER() which prevents it)
  const partitionColumnNames = frameworkGetPartitionColumnNames({
    modelJson,
    project,
  });

  // Persist columns on the model properties.
  // Each column is built inside a try/catch so that an unexpected failure
  // (e.g. malformed meta inherited from an upstream manifest) is reported
  // with the offending column name. Without this context the parent log line
  // only shows the model name, which makes diagnosing schema-shape regressions
  // painful.
  const modelPropertiesColumns: DbtModelPropertiesColumn[] = [];
  for (const c of columns) {
    const columnContextName = frameworkColumnName({ column: c, modelJson });
    try {
      // Control ordering of column properties
      const column: DbtModelPropertiesColumn = {
        name: columnContextName,
        data_type: c.data_type || 'varchar',
        description: c.description || textToStartCase(c.name),
        tags: c.tags,
        // Switch to data_tests on the yml once dbt is updated to >=1.8
        // data_tests: c.data_tests,
        tests: c.data_tests,
        meta: c.meta,
      };

      const isIncrementalModel =
        ('materialized' in modelJson &&
          modelJson.materialized === 'incremental') ||
        ('materialization' in modelJson &&
          (modelJson.materialization === 'incremental' ||
            (typeof modelJson.materialization === 'object' &&
              modelJson.materialization?.type === 'incremental')));

      if (isIncrementalModel) {
        switch (column.name) {
          case PARTITION_MONTHLY:
          case PARTITION_DAILY:
          case PARTITION_HOURLY: {
            const dataTests = column.tests ?? [];
            if (!dataTests.includes('not_null')) {
              dataTests.push('not_null');
            }
            column.tests = dataTests;
            break;
          }
        }
      }

      // Setting lightdash dimension meta. `normalizeTimeIntervals` defends
      // against the YAML 1.1 boolean coercion of unquoted `OFF` -> `false`
      // and other unexpected shapes coming back from the dbt manifest.
      let dimension = { ...c.meta.dimension };
      dimension.time_intervals = normalizeTimeIntervals(
        dimension.time_intervals,
        { modelName, columnName: column.name },
      );
      // Set defaults for column level properties at the mart layer
      if (modelLayer === 'mart') {
        if (dimension.hidden === undefined) {
          dimension.hidden =
            column.meta?.type === 'fct' ||
            FRAMEWORK_PARTITIONS.includes(
              column.name as FrameworkPartitionName,
            );
        }
        if (!dimension.label) {
          dimension.label = textToStartCase(column.name);
        }
        if (!dimension.type) {
          dimension.type = lightdashConvertDimensionType(column.data_type);
        }

        if (column.name === 'datetime') {
          // Find a partitioned column to use for time intervals
          const partitionedColumn =
            columns.find((c) => c.name === PARTITION_HOURLY) ||
            columns.find((c) => c.name === PARTITION_DAILY) ||
            columns.find((c) => c.name === PARTITION_MONTHLY);
          if (partitionedColumn) {
            dimension.sql = partitionedColumn.name;
          }
        }
      }

      // If dimension has an ai_hint, automatically add an 'ai' tag
      if (aiHintTags.length && dimension.ai_hint) {
        dimension.tags = [..._.union(dimension.tags ?? [], aiHintTags)];
      }
      dimension.tags?.sort();

      // Control ordering of lightdash dimension properties
      dimension = orderKeys(dimension, [
        'ai_hint',
        'tags',
        'type',
        'label',
        'group_label',
        'groups',
        'case_sensitive',
      ]);

      // Order lightdash metric keys and remove empty properties
      const metrics = _.reduce(
        column.meta?.metrics ?? {},
        (m, metric, name) => {
          return {
            ...m,
            [name]: removeEmpty(
              orderKeys(metric, [
                'ai_hint',
                'tags',
                'type',
                'label',
                'group_label',
                'groups',
              ]),
            ),
          };
        },
        {},
      );

      // Column meta emit strategy (free-form meta support):
      //
      // After the `FrameworkColumn` split, all SQL-generation state lives
      // on `c.internal.*` and is never emitted. Values on `c.meta` fall
      // into three buckets:
      //   a. Populated-reserved keys (type / origin / dimension / metrics /
      //      case_sensitive) -- framework-written, will be re-layered below.
      //   b. SQL-internal reserved key names (agg / expr / prefix / ...) --
      //      the user placed them under `meta` by mistake. They have no
      //      effect on SQL (the framework reads SQL state from
      //      `c.internal.*`, which is populated from top-level select-item
      //      siblings). We strip them so they don't silently leak to the
      //      emitted YAML; the reserved-key lint (meta-lint.ts) separately
      //      surfaces the authoring mistake as a Warning diagnostic.
      //   c. Free-form user keys -- passed through verbatim.
      //
      // Strategy:
      //   1. Spread-destructure to drop (a) and (b) from the free-form bag.
      //   2. Layer the framework-populated reserved keys back on top so the
      //      framework silently wins on collision with any free-form key
      //      of the same name.
      //   3. Apply `case_sensitive` AFTER `removeEmpty` so a valid `false`
      //      value isn't stripped.
      const rawMeta = (c.meta ?? {}) as Record<string, unknown>;
      const metaFreeForm: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawMeta)) {
        // Skip populated-reserved keys -- they are re-layered below.
        if (
          key === 'type' ||
          key === 'origin' ||
          key === 'dimension' ||
          key === 'metrics' ||
          key === 'case_sensitive'
        ) {
          continue;
        }
        // Skip SQL-internal reserved key names -- never emitted.
        if (
          (
            COLUMN_META_SQL_INTERNAL_RESERVED_KEYS as readonly string[]
          ).includes(key)
        ) {
          continue;
        }
        metaFreeForm[key] = value;
      }

      // Preserve the explicit case_sensitive value before removeEmpty strips `false`.
      const explicitCaseSensitive = dimension.case_sensitive;
      const cleanedDimension = removeEmpty(dimension);

      // Re-inject case_sensitive after removeEmpty. Explicit values from
      // lightdash.dimension.case_sensitive take priority; otherwise auto-set
      // true on partition columns to prevent Lightdash from wrapping them in
      // UPPER(), which breaks Trino-Iceberg predicate pushdown.
      if (explicitCaseSensitive !== undefined) {
        cleanedDimension.case_sensitive = explicitCaseSensitive;
      } else if (
        dj.config.lightdashDefaultPartitionColumnCaseSensitive &&
        partitionColumnNames.includes(column.name)
      ) {
        cleanedDimension.case_sensitive = true;
      }

      column.meta = removeEmpty({
        ...metaFreeForm,
        type: c.meta?.type,
        origin: c.meta?.origin,
        dimension: cleanedDimension,
        metrics,
      });

      // Re-inject column-level case_sensitive AFTER removeEmpty so a valid
      // `false` value (intentionally opting OUT of case sensitivity) isn't
      // stripped along with other empty/falsy values.
      if (c.meta.case_sensitive !== undefined) {
        column.meta = {
          ...column.meta,
          case_sensitive: c.meta.case_sensitive,
        };
      }

      // Remove any remaining empty column properties
      modelPropertiesColumns.push(removeEmpty(column));
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to build column "${columnContextName}" for model "${modelName}": ${cause}`,
      );
    }
  }

  // Set data_tests at model level
  if ('data_tests' in modelJson && modelJson.data_tests) {
    for (const data_test of modelJson.data_tests) {
      // Cast to any to handle generic tests not yet in type definitions
      const test = data_test as any;

      // Both model and column level tests use consistent format:
      // { type: "test_name", param1: value1, param2: value2, ... }
      const testType = test.type;
      const testConfig: any = {};

      // Copy all properties except 'type' to test config
      for (const key in test) {
        if (key !== 'type') {
          testConfig[key] = test[key];
        }
      }

      // Add test to model properties in YML format
      // Format: { test_name: { param1: value1, param2: value2, ... } }
      modelProperties.tests = [
        ...(modelProperties.tests ?? []),
        { [testType]: testConfig } as any,
      ];
    }
  }

  modelProperties.columns = modelPropertiesColumns;

  // Look for specific metrics to keep (all others will be dropped)
  const metricsModelInclude =
    ('lightdash' in modelJson &&
      modelJson.lightdash &&
      'metrics_include' in modelJson.lightdash &&
      modelJson.lightdash.metrics_include) ||
    null;
  if (metricsModelInclude) {
    for (const metricName in modelProperties.meta?.metrics) {
      if (!metricsModelInclude.includes(metricName)) {
        delete modelProperties.meta.metrics[metricName];
      }
    }
  }

  // Look for excluded metrics to drop
  const metricsModelExclude =
    ('lightdash' in modelJson &&
      modelJson.lightdash &&
      'metrics_exclude' in modelJson.lightdash &&
      modelJson.lightdash.metrics_exclude) ||
    [];
  for (const metricName of metricsModelExclude) {
    if (modelProperties.meta?.metrics?.[metricName]) {
      delete modelProperties.meta.metrics[metricName];
    }
  }

  // Set node color for docs
  const nodeColor = frameworkModelNodeColor({ modelJson, project });
  if (nodeColor) {
    modelProperties.docs = orderKeys({
      ...modelProperties.docs,
      node_color: nodeColor,
    });
  }

  // Set addition defaults for model properties by layer
  switch (modelLayer) {
    case 'mart': {
      if (!modelProperties.meta?.required_filters) {
        if (
          _.find(modelProperties.columns, (c) => c.name === PARTITION_MONTHLY)
        ) {
          if (
            _.find(modelProperties.columns, (c) => c.name === PARTITION_DAILY)
          ) {
            modelProperties.meta = {
              ...modelProperties.meta,
              required_filters: [{ datetime: 'inThePast 14 days' }],
            };
          } else {
            modelProperties.meta = {
              ...modelProperties.meta,
              required_filters: [{ datetime: 'inThePast 2 months' }],
            };
          }
        }
      }
      break;
    }
  }

  if (_.isEmpty(modelProperties.meta?.metrics)) {
    delete modelProperties.meta?.metrics;
  }

  if ('lightdash' in modelJson && modelCaseSensitive !== undefined) {
    modelProperties.meta = {
      ...modelProperties.meta,
      case_sensitive: modelCaseSensitive,
    };
  }

  if (_.isEmpty(modelProperties.meta)) {
    delete modelProperties.meta;
  }

  return modelProperties;
}

/**
 * Merge model properties into manifest
 *
 * @see utils.ts:2793-2837
 */
export function frameworkModelManifestMerge({
  dj,
  modelJson,
  project,
}: {
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
}): DbtProjectManifest {
  let manifest = { ...project.manifest };
  const mergeModelName = frameworkGetModelName(modelJson);
  const mergeModelId = getDbtModelId({
    modelName: mergeModelName,
    projectName: project.name,
  });
  const cteRegistry: CteColumnRegistry | undefined =
    'ctes' in modelJson && modelJson.ctes?.length
      ? frameworkBuildCteColumnRegistry({
          ctes: modelJson.ctes,
          modelId: mergeModelId,
          modelJson,
          partitionColumnNames: frameworkGetPartitionColumnNames({
            modelJson,
            project,
          }),
          project,
        })
      : undefined;
  const modelProperties = frameworkModelProperties({
    dj,
    modelJson,
    project,
    cteColumnRegistry: cteRegistry,
  });
  const modelId = `model.${project.name}.${modelProperties.name}`;
  const existingModel = manifest.nodes[modelId];
  const columns: DbtProjectManifestNode['columns'] = {};
  for (const column of modelProperties.columns) {
    const existingModelColumn = existingModel?.columns?.[column.name];
    columns[column.name] = {
      ...existingModelColumn,
      ...column,
    };
  }
  manifest = {
    ...manifest,
    nodes: {
      ...manifest.nodes,
      [modelId]: {
        ...existingModel,
        // Only setting the properties that are needed for a temporary in-memory merge, re-parsing the project will add the remaining
        columns,
        config: modelProperties.config,
        resource_type: 'model',
        meta: modelProperties.meta,
        ...(modelProperties.config?.tags && {
          tags: modelProperties.config?.tags,
        }),
        unique_id: `model.${project.name}.${modelProperties.name}`,
      },
    },
  };
  return manifest;
}

/**
 * Generate source properties (YAML)
 *
 * @see utils.ts:3758-3795
 */
export function frameworkSourceProperties(
  sourceJson: FrameworkSource,
): DbtSourceProperties {
  const sourceName = frameworkMakeSourceName(sourceJson);
  const tables: DbtSourceTable[] = _.map(sourceJson.tables, (t) => {
    const columns = _.map(t.columns, ({ type, lightdash, ...c }) => {
      const columnMeta: DbtSourceTableColumn['meta'] = {};
      if (type) {
        columnMeta.type = type;
      }
      if (lightdash) {
        columnMeta.lightdash = lightdash;
      }
      const column: DbtSourceTableColumn = {
        ...c,
      };
      if (_.size(columnMeta) > 0) {
        column.meta = columnMeta;
      }
      return column;
    });
    const table: DbtSourceTable = removeEmpty({
      ...t,
      columns,
    });

    // Preserve explicit null — dbt uses `freshness: null` to disable checks per-table
    if (t.freshness === null) {
      table.freshness = null;
    }

    return table;
  });
  const sourceProperties: DbtSourceProperties = removeEmpty({
    name: sourceName,
    database: sourceJson.database,
    description: sourceJson.description,
    freshness: sourceJson.freshness,
    loaded_at_field: sourceJson.loaded_at_field,
    schema: sourceJson.schema,
    meta: sourceJson.meta,
    tables,
  });

  // Preserve explicit null — dbt uses `freshness: null` to disable checks for the source
  if (sourceJson.freshness === null) {
    sourceProperties.freshness = null;
  }

  return sourceProperties;
}

/**
 * Merge source properties into manifest
 *
 * @see utils.ts:3713-3756
 */
export function frameworkSourceManifestMerge({
  project,
  sourceJson,
}: {
  project: DbtProject;
  sourceJson: FrameworkSource;
}): DbtProjectManifest {
  let manifest = { ...project.manifest };
  const sourceProperties = frameworkSourceProperties(sourceJson);
  for (const sourceTable of sourceProperties.tables) {
    const sourceId = `source.${project.name}.${sourceProperties.name}.${sourceTable.name}`;
    const existingSource = manifest.sources[sourceId];
    const columns: DbtProjectManifestSourceColumns = {};
    for (const column of sourceTable.columns) {
      const existingSourceColumn = existingSource?.columns?.[column.name];
      columns[column.name] = {
        ...existingSourceColumn,
        ...column,
      } as DbtProjectManifestSourceColumn;
    }
    manifest = {
      ...manifest,
      sources: {
        ...manifest.sources,
        [sourceId]: {
          ...existingSource,
          // Only setting the properties that are needed for a temporary in-memory merge, re-parsing the project will add the remaining
          columns,
          database: sourceProperties.database,
          meta: sourceTable.meta,
          name: sourceTable.name,
          package_name: project.name,
          resource_type: 'source',
          schema: sourceProperties.schema,
          source_meta: sourceProperties.meta,
          source_name: sourceProperties.name,
          tags: sourceProperties.tags,
          unique_id: `source.${project.name}.${sourceProperties.name}`,
        },
      },
    };
  }
  return manifest;
}

/**
 * Get model node color for docs
 *
 * @see utils.ts:3115-3141
 */
export function frameworkModelNodeColor({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): string | null {
  const modelLayer = frameworkGetModelLayer(modelJson);
  switch (modelLayer) {
    case 'int': {
      const modelName = frameworkGetModelName(modelJson);
      const childMap = frameworkGetModelChildMap({ modelName, project });
      const hasMartChild = _.some(childMap, (id) =>
        _.startsWith(id, `model.${project.name}.mart__`),
      );
      if (hasMartChild) {
        return '#DAA520';
      }
      return null;
    }
    case 'mart': {
      return '#059669';
    }
    case 'stg': {
      return '#B6AB33';
    }
  }
}

/**
 * Make model template (orchestrates SQL generation)
 *
 * @see utils.ts:2091-2733
 */
export function frameworkMakeModelTemplate(
  {
    type,
    group,
    name,
    topic,
    materialized,
    from,
    select,
    group_by,
    where,
    lightdash,
    description,
    tags,
    incremental_strategy,
    sql_hooks,
    partitioned_by,
    exclude_daily_filter,
    exclude_date_filter,
    exclude_datetime,
    exclude_framework_artifacts,
    exclude_portal_partition_columns,
    exclude_portal_source_count,
    ctes,
  }: Api<'framework-model-create'>['request'],
  autoGenerateTestsConfig: AutoGenerateTestsConfig = {
    tests: { equalRowCount: { enabled: true, applyTo: ['left'] } },
  },
): FrameworkModel {
  /**
   * Build base model object with required and optional fields
   * These fields are common across all model types
   */
  const base = {
    // Required fields
    group,
    topic,
    name,

    // Optional basic fields
    ...(materialized && { materialized }),
    ...(description && { description }),
    ...(tags && tags.length > 0 && { tags }),

    // Incremental strategy configuration
    ...(incremental_strategy && {
      incremental_strategy: incremental_strategy as any,
    }),

    // SQL hooks configuration
    ...(sql_hooks &&
      (sql_hooks.pre || sql_hooks.post) && {
        sql_hooks: sql_hooks as any,
      }),

    // Partitioning configuration
    ...(partitioned_by &&
      partitioned_by.length > 0 && {
        partitioned_by: partitioned_by as any,
      }),

    // Exclude filter flags
    ...(exclude_daily_filter !== undefined && { exclude_daily_filter }),
    ...(exclude_date_filter !== undefined && { exclude_date_filter }),
    ...(exclude_datetime !== undefined && { exclude_datetime }),
    ...(exclude_framework_artifacts !== undefined && {
      exclude_framework_artifacts,
    }),
    ...(exclude_portal_partition_columns !== undefined && {
      exclude_portal_partition_columns,
    }),
    ...(exclude_portal_source_count !== undefined && {
      exclude_portal_source_count,
    }),

    // Inline CTE definitions are an opaque pass-through here -- the
    // sync-engine's per-CTE validators are the canonical authority. Without
    // this, the preview RPC silently strips `ctes` from the round-trip JSON
    // and the wizard's JSON tab shows an empty model. Cast to `any` because
    // schema types require a non-empty tuple shape while the API request
    // permits the broader `any[]` envelope.
    ...(ctes &&
      Array.isArray(ctes) &&
      ctes.length > 0 && { ctes: ctes as any }),
  };

  // Treat CTE-flavoured `from` shapes (`{ cte: ... }`, `{ union: { ctes: [...] } }`)
  // as opaque pass-throughs so the preview RPC doesn't rewrite them to
  // `{ model: '' }`. Per-type schemas allow these variants (e.g.
  // `int_select_model.from.cte`); the wizard already builds them correctly.
  const fromIsCteShape = !!(
    from &&
    typeof from === 'object' &&
    ('cte' in from || 'union' in from)
  );

  // Helper function to handle select with proper typing
  function getSelect<T>(modelSelect: T): T {
    if (select && select.length > 0) {
      // When select is provided, type cast it to match the expected model type
      return select as unknown as T;
    }
    return modelSelect;
  }

  // Helper function to build comprehensive lightdash configuration object
  function getLightdashConfig(): any {
    if (!lightdash) {
      return undefined;
    }

    const lightdashConfig: any = {};

    if (lightdash.table) {
      const tableConfig: any = {};
      const table = lightdash.table as any; // Type assertion to access all properties

      // Basic table configuration
      if (table.group_label) {
        tableConfig.group_label = table.group_label;
      }
      if (table.label) {
        tableConfig.label = table.label;
      }

      // Extended table configuration - supporting all SchemaModelLightdash values
      if (table.ai_hint) {
        tableConfig.ai_hint = table.ai_hint;
      }
      if (table.group_details) {
        tableConfig.group_details = table.group_details;
      }
      if (table.required_attributes) {
        tableConfig.required_attributes = table.required_attributes;
      }
      if (table.required_filters) {
        tableConfig.required_filters = table.required_filters;
      }
      // Preserve explicit `null` so users can disable the global default per model.
      if (table.sql_filter === null || typeof table.sql_filter === 'string') {
        tableConfig.sql_filter = table.sql_filter;
      }
      if (table.sql_where) {
        tableConfig.sql_where = table.sql_where;
      }

      lightdashConfig.table = tableConfig;
    }

    if (lightdash.metrics && lightdash.metrics.length > 0) {
      lightdashConfig.metrics = lightdash.metrics.map((metric: any) => ({
        name: metric.name,
        type: metric.type,
        ...(metric.label && { label: metric.label }),
        ...(metric.group_label && { group_label: metric.group_label }),
      })) as any;
    }

    if (lightdash.metrics_exclude && lightdash.metrics_exclude.length > 0) {
      lightdashConfig.metrics_exclude = lightdash.metrics_exclude as any;
    }

    if (lightdash.metrics_include && lightdash.metrics_include.length > 0) {
      lightdashConfig.metrics_include = lightdash.metrics_include as any;
    }

    return lightdashConfig;
  }

  // Helper function to parse group_by from API format to schema format
  function getGroupBy() {
    if (!group_by || !Array.isArray(group_by) || group_by.length === 0) {
      return undefined;
    }
    // group_by is already in the correct schema format from buildModelJson
    return group_by as any;
  }

  // Helper function to parse where from API format to schema format
  function getWhere() {
    if (!where) {
      return undefined;
    }
    // where is already in the correct schema format from buildModelJson
    return where as any;
  }

  // Preserve CTE-shaped `from` verbatim before the per-type reshape kicks
  // in. The per-type branches below all assume a `{ model: ... }`-flavoured
  // input and would clobber `{ cte: ... }` / `{ union: { ctes } }`. Letting
  // them pass through unchanged is safe for the preview RPC because the
  // sync engine validates `from` against the per-type schema downstream;
  // here we only need a structural pass-through.
  if (fromIsCteShape) {
    const passthrough = {
      ...base,
      type,
      from: from as any,
      ...(select && select.length > 0 && { select: select as any }),
      ...(group_by && group_by.length > 0 && { group_by: group_by as any }),
      ...(where !== undefined && { where: where as any }),
      ...(lightdash && { lightdash: lightdash as any }),
    };
    return passthrough as unknown as FrameworkModel;
  }

  switch (type) {
    case 'int_join_column': {
      const fromWithJoin = from as unknown as {
        model?: string;
        join?: {
          column?: string;
          fields?: any[];
        };
      };

      const baseModel: SchemaModelTypeIntJoinColumn = {
        ...base,
        type,
        from: {
          model: fromWithJoin?.model ?? '',
          join: {
            column: fromWithJoin?.join?.column ?? '',
            fields: [
              fromWithJoin?.join?.fields ?? '',
            ] as unknown as SchemaModelTypeIntJoinColumn['from']['join']['fields'],
            type: 'cross_join_unnest',
          },
        },
        select: getSelect(
          [] as unknown as SchemaModelTypeIntJoinColumn['select'],
        ),
      };

      // If we have fields data, populate it
      if (
        fromWithJoin?.join?.fields &&
        Array.isArray(fromWithJoin.join.fields)
      ) {
        baseModel.from.join.fields = fromWithJoin.join
          .fields as unknown as SchemaModelTypeIntJoinColumn['from']['join']['fields'];
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'int_join_models': {
      const baseModel: SchemaModelTypeIntJoinModels = {
        ...base,
        type,
        from: {
          model: from?.model ?? '',
          join: [] as unknown as SchemaModelFromJoinModels,
          ...(from?.rollup && { rollup: from.rollup }),
        } as SchemaModelTypeIntJoinModels['from'],
        select: getSelect(
          [] as unknown as SchemaModelTypeIntJoinModels['select'],
        ),
      };

      // If we have joins data, try to populate it (with proper type casting)
      if (from?.join && from.join.length > 0) {
        try {
          baseModel.from.join = from.join.map((joinItem) => ({
            ...joinItem,
            on: joinItem.on as any,
            type: joinItem.type as any,
          })) as any;
        } catch {
          // Fall back to empty array if type casting fails
          console.warn('Failed to map join data, using empty array');
        }
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      // Generate automatic tests based on configuration
      const autoTests = generateAutoTests(from, autoGenerateTestsConfig);
      if (autoTests.length > 0) {
        (baseModel as any).data_tests = autoTests;
      }

      return baseModel;
    }
    case 'int_lookback_model': {
      // Create a properly typed version of the from parameter
      const fromWithLookback = from as unknown as {
        model?: string;
        lookback?: {
          days?: number;
          exclude_event_date?: boolean;
        };
      };

      const baseModel: SchemaModelTypeIntLookbackModel = {
        ...base,
        type,
        from: {
          model: fromWithLookback?.model ?? '',
          lookback: { days: fromWithLookback?.lookback?.days ?? 0 },
        },
        select: getSelect(
          [] as unknown as SchemaModelTypeIntLookbackModel['select'],
        ),
      };

      // Add exclude_event_date if provided
      if (fromWithLookback?.lookback?.exclude_event_date !== undefined) {
        baseModel.from.lookback.exclude_event_date =
          fromWithLookback.lookback.exclude_event_date;
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'int_rollup_model': {
      const baseModel: SchemaModelTypeIntRollupModel = {
        ...base,
        type,
        from: {
          model: from?.model ?? '',
          rollup: {
            interval: from?.rollup?.interval ?? 'day',
          },
        },
      };

      // Note: int_rollup_model schema doesn't support select field

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'int_select_model': {
      const fromObj: SchemaModelTypeIntSelectModel['from'] = {
        model: from?.model ?? '',
        ...(from?.rollup && { rollup: from.rollup }),
      };
      const baseModel: SchemaModelTypeIntSelectModel = {
        ...base,
        type,
        from: fromObj,
        select: getSelect(
          [] as unknown as SchemaModelTypeIntSelectModel['select'],
        ),
      };

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'int_union_models': {
      const fromWithUnion = from as unknown as {
        model?: string;
        cte?: string;
        union?: {
          models?: string[];
          ctes?: string[];
        };
      };

      // Default to model-based union; CTE-based unions are created via JSON editing
      const baseModelFrom = fromWithUnion?.cte
        ? {
            cte: fromWithUnion.cte,
            union: { ctes: [] as unknown as [string, ...string[]] },
          }
        : {
            model: fromWithUnion?.model ?? '',
            union: { models: [] as string[] },
          };

      const baseModel: SchemaModelTypeIntUnionModels = {
        ...base,
        type,
        from: baseModelFrom as SchemaModelTypeIntUnionModels['from'],
      };

      // If we have union models/ctes data, populate it
      if (
        fromWithUnion?.union?.models &&
        Array.isArray(fromWithUnion.union.models) &&
        fromWithUnion.union.models.length > 0 &&
        'model' in baseModel.from
      ) {
        (
          baseModel.from as { model: string; union: { models: string[] } }
        ).union.models = fromWithUnion.union.models;
      } else if (
        fromWithUnion?.union?.ctes &&
        Array.isArray(fromWithUnion.union.ctes) &&
        fromWithUnion.union.ctes.length > 0 &&
        'cte' in baseModel.from
      ) {
        (
          baseModel.from as {
            cte: string;
            union: { ctes: [string, ...string[]] };
          }
        ).union.ctes = fromWithUnion.union.ctes as [string, ...string[]];
      }

      const selectLists = getSelect(
        [] as unknown as SchemaModelTypeIntUnionModels['select'],
      );

      if (selectLists) {
        baseModel.select = selectLists;
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'mart_join_models': {
      const baseModel: SchemaModelTypeMartJoinModels = {
        type,
        ...base,
        from: {
          model: from?.model ?? '',
          join: [] as unknown as SchemaModelFromJoinModels,
        } as SchemaModelTypeMartJoinModels['from'],
        select: [] as unknown as SchemaModelTypeMartJoinModels['select'],
      };

      // If we have joins data, try to populate it (with proper type casting)
      if (from?.join && from.join.length > 0) {
        try {
          baseModel.from.join = from.join.map((joinItem) => ({
            ...joinItem,
            on: joinItem.on as any,
            type: joinItem.type as any,
          })) as any;
        } catch {
          // Fall back to empty array if type casting fails
          console.warn(
            'Failed to map join data for mart join models, using empty array',
          );
        }
      }

      // Use select data directly if available
      if (select && select.length > 0) {
        baseModel.select =
          select as unknown as SchemaModelTypeMartJoinModels['select'];
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      // Generate automatic tests based on configuration
      const autoTests = generateAutoTests(from, autoGenerateTestsConfig);
      if (autoTests.length > 0) {
        (baseModel as any).data_tests = autoTests;
      }

      return baseModel;
    }
    case 'mart_select_model': {
      const baseModel: SchemaModelTypeMartSelectModel = {
        type,
        ...base,
        from: {
          model: from?.model ?? '',
        },
        select: [] as unknown as SchemaModelTypeMartSelectModel['select'],
      };

      // Use select data directly if available
      if (select && select.length > 0) {
        baseModel.select =
          select as unknown as SchemaModelTypeMartSelectModel['select'];
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      // Add lightdash configuration if provided
      if (lightdash) {
        baseModel.lightdash = getLightdashConfig();
      }

      return baseModel;
    }
    case 'stg_select_model': {
      const baseModel: SchemaModelTypeStgSelectModel = {
        ...base,
        type,
        from: {
          model: from?.model ?? '',
        },
        select: [] as unknown as SchemaModelTypeStgSelectModel['select'],
      };

      // Use select data directly if available
      if (select && select.length > 0) {
        baseModel.select =
          select as unknown as SchemaModelTypeStgSelectModel['select'];
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      return baseModel;
    }
    case 'stg_select_source': {
      const fromWithSource = from as unknown as {
        source?: string;
      };

      const baseModel: SchemaModelTypeStgSelectSource = {
        ...base,
        type,
        from: {
          source: fromWithSource?.source ?? '',
        },
        select: getSelect(
          [] as unknown as SchemaModelTypeStgSelectSource['select'],
        ),
      };

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      return baseModel;
    }
    case 'stg_union_sources': {
      const fromWithSourceUnion = from as unknown as {
        source?: string;
        union?: {
          sources?: any[];
        };
      };

      const baseModel: SchemaModelTypeStgUnionSources = {
        ...base,
        type,
        from: {
          source: fromWithSourceUnion?.source ?? '',
          union: {
            sources:
              [] as unknown as SchemaModelTypeStgUnionSources['from']['union']['sources'],
          },
        },
      };

      // If we have union sources data, populate it
      if (
        fromWithSourceUnion?.union?.sources &&
        Array.isArray(fromWithSourceUnion.union.sources)
      ) {
        baseModel.from.union.sources = fromWithSourceUnion.union
          .sources as unknown as SchemaModelTypeStgUnionSources['from']['union']['sources'];
      }

      const selectLists = getSelect(
        [] as unknown as SchemaModelTypeStgUnionSources['select'],
      );

      if (selectLists) {
        baseModel.select = selectLists;
      }

      // Add group_by configuration if provided
      const groupByConfig = getGroupBy();
      if (groupByConfig) {
        (baseModel as any).group_by = groupByConfig;
      }

      // Add where configuration if provided
      const whereConfig = getWhere();
      if (whereConfig) {
        (baseModel as any).where = whereConfig;
      }

      return baseModel;
    }
    default:
      return assertExhaustive<FrameworkModel>(type);
  }
}

/**
 * Configuration for auto-generating tests
 */
export interface AutoGenerateTestsConfig {
  enabled?: boolean;
  tests?: {
    equalRowCount?: {
      enabled?: boolean;
      applyTo?: string[];
      targetFolders?: string[];
    };
    equalOrLowerRowCount?: {
      enabled?: boolean;
      applyTo?: string[];
      targetFolders?: string[];
    };
  };
}

/**
 * Helper function to generate automatic tests based on model structure
 * Supports multiple test types based on configuration
 * @param from - The 'from' configuration object containing join information
 * @param config - Configuration object for which tests to auto-generate
 */
export function generateAutoTests(
  from: any,
  config: AutoGenerateTestsConfig,
): any[] {
  const autoTests: any[] = [];

  // Check if the feature is disabled
  if (config.enabled === false) {
    return autoTests;
  }

  // Only generate tests for models with joins
  if (
    !from?.join ||
    !Array.isArray(from.join) ||
    from.join.length === 0 ||
    !from.model
  ) {
    return autoTests;
  }

  // Generate equal_row_count tests
  if (config.tests?.equalRowCount?.enabled !== false) {
    const applyTo = config.tests?.equalRowCount?.applyTo ?? ['left'];
    const matchingJoin = from.join.find((joinItem: any) =>
      applyTo.includes(joinItem.type),
    );

    if (matchingJoin) {
      autoTests.push({
        type: 'equal_row_count',
        compare_model: `ref('${from.model}')`,
        join_type: matchingJoin.type,
      });
    }
  }

  // Generate equal_or_lower_row_count tests
  if (config.tests?.equalOrLowerRowCount?.enabled) {
    const applyTo = config.tests?.equalOrLowerRowCount?.applyTo ?? [];
    const matchingJoin = from.join.find((joinItem: any) =>
      applyTo.includes(joinItem.type),
    );

    if (matchingJoin) {
      autoTests.push({
        type: 'equal_or_lower_row_count',
        compare_model: `ref('${from.model}')`,
        join_type: matchingJoin.type,
      });
    }
  }

  return autoTests;
}
