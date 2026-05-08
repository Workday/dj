/**
 * Column utility functions for Framework
 *
 * All column-related operations in one module:
 * - Simple column operations (inheritance, selection)
 * - Advanced column processing with circular dependencies
 * - Partition column management
 *
 * Circular dependencies resolved internally:
 * - frameworkGetRollupInputs ↔ frameworkProcessSelected
 */

import {
  FRAMEWORK_AGGS,
  FRAMEWORK_PARTITIONS,
  PARTITION_DAILY,
  PARTITION_HOURLY,
  PARTITION_MONTHLY,
} from '@services/framework/constants';
import { lightdashBuildMetrics } from '@services/lightdash/utils';
import type { DJ } from '@shared';
import { mergeDeep } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import {
  BULK_CTE_TYPES,
  BULK_MODEL_TYPES,
  BULK_SELECT_TYPES,
  DIMS_BULK_TYPES,
  FCTS_BULK_TYPES,
} from '@shared/framework/constants';
import type {
  FrameworkColumn,
  FrameworkColumnAgg,
  FrameworkColumnMeta,
  FrameworkCTE,
  FrameworkDims,
  FrameworkInterval,
  FrameworkModel,
  FrameworkPartitionName,
  FrameworkSelected,
} from '@shared/framework/types';
import type {
  LightdashDimension,
  LightdashMetrics,
} from '@shared/lightdash/types';
import type { SchemaModelCTE } from '@shared/schema/types/model.cte.schema';
import type { SchemaModelSelectCTE } from '@shared/schema/types/model.select.cte.schema';
import { sqlCleanLine } from '@shared/sql/utils';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';

// Import functions from other utils modules
import {
  frameworkGetModelId,
  frameworkGetModelLayer,
  frameworkGetNode,
  frameworkGetParentMeta,
} from './model-utils';
import { frameworkGetSourceMeta } from './source-utils';

// ========================================================================
// CTE Column Types
// ========================================================================

/** Maps CTE name → its inferred output columns. Used to resolve column references without manifest data. */
export type CteColumnRegistry = Map<string, FrameworkColumn[]>;

type CteSelectItem = NonNullable<SchemaModelCTE['select']>[number];

type BulkFilterableColumn = { name: string; meta?: { type?: string } };

/**
 * Central filtering for bulk select directives (all_from_*, dims_from_*, fcts_from_*).
 * Applies three-step filtering: type narrowing (dims/fcts), include whitelist, exclude blacklist.
 * All call sites that expand bulk directives should use this instead of reimplementing the logic.
 */
export function filterBulkSelectColumns<T extends BulkFilterableColumn>(
  columns: T[],
  selType: string,
  options?: { include?: string[]; exclude?: string[] },
): T[] {
  return columns.filter((c) => {
    if (DIMS_BULK_TYPES.has(selType) && c.meta?.type === 'fct') {
      return false;
    }
    if (FCTS_BULK_TYPES.has(selType) && c.meta?.type !== 'fct') {
      return false;
    }
    if (options?.include?.length && !options.include.includes(c.name)) {
      return false;
    }
    if (options?.exclude?.length && options.exclude.includes(c.name)) {
      return false;
    }
    return true;
  });
}

/**
 * Sorts columns alphabetically and moves partition columns to the end.
 * Partition columns are appended in the order given by partitionNames
 * (default: monthly, daily, hourly) to match the established convention
 * in frameworkBuildColumns.
 */
export function sortColumnsWithPartitionsLast<T extends { name: string }>(
  columns: T[],
  partitionNames?: string[],
): T[] {
  const partitionList = partitionNames ?? [...FRAMEWORK_PARTITIONS];
  const partitionSet = new Set(partitionList);
  const sorted = _.sortBy(columns, ['name']);
  const nonPartition = sorted.filter((c) => !partitionSet.has(c.name));
  const partitionCols: T[] = [];
  for (const name of partitionList) {
    const col = sorted.find((c) => c.name === name);
    if (col) {
      partitionCols.push(col);
    }
  }
  return [...nonPartition, ...partitionCols];
}

// ========================================================================
// Column Processing (From utils.ts)
// ========================================================================

/**
 * Process a selected column with all transformations
 *
 * @see utils.ts:66-272
 */
export function frameworkProcessSelected({
  existingColumns,
  dj,
  fromColumn,
  modelJson,
  modelMetrics,
  prefix,
  project,
  selected,
}: {
  existingColumns: FrameworkColumn[];
  dj: DJ;
  fromColumn: FrameworkColumn | null;
  modelJson: FrameworkModel;
  modelMetrics: LightdashMetrics;
  prefix: string | null;
  project: DbtProject;
  selected: FrameworkSelected;
}): {
  columns: FrameworkColumn[];
  modelMetrics: LightdashMetrics;
} {
  const modelId = frameworkGetModelId({ modelJson, project });
  const newColumns: FrameworkColumn[] = [];

  // Pre-compute column names for existing columns to avoid reprocessing each check
  const existingNames = new Set(
    existingColumns.map((c) => frameworkColumnName({ column: c, modelJson })),
  );

  // This function is how we prevent duplicate column names from being added
  function shouldAdd(n: FrameworkColumn) {
    const newName = frameworkColumnName({ column: n, modelJson });
    // Check against pre-computed existing names and accumulated new names
    if (existingNames.has(newName)) {
      return false;
    }
    // Check against already-added new columns
    return !newColumns.some(
      (c) => frameworkColumnName({ column: c, modelJson }) === newName,
    );
  }

  // These are already processed outside of this function
  if (typeof selected === 'string') {
    const newColumn: FrameworkColumn = {
      name: selected,
      meta: { type: 'dim' },
      internal: {},
    };
    if (shouldAdd(newColumn)) {
      newColumns.push(newColumn);
    }
  } else if (!('name' in selected)) {
    // If we don't have a name, we can't process this
  } else {
    // Building the new column properties that will override the inherited ones.
    // Seed meta with the user-authored free-form keys on the select item so that
    // downstream framework-derived keys (type, dimension, metrics, origin, etc.)
    // layer on top and win on collision with reserved names.
    const userSelectedMeta =
      'meta' in selected && selected.meta
        ? (selected.meta as Record<string, unknown>)
        : null;
    const selectedColumn: FrameworkColumn = {
      name: selected.name,
      meta: {
        ...(userSelectedMeta ?? {}),
        type: selected.type || 'dim',
      } as FrameworkColumnMeta,
      internal: {},
    };
    if ('data_type' in selected && selected.data_type) {
      selectedColumn.data_type = selected.data_type;
    }
    if ('description' in selected && selected.description) {
      selectedColumn.description = selected.description;
    }
    if ('exclude_from_group_by' in selected && selected.exclude_from_group_by) {
      selectedColumn.internal.exclude_from_group_by =
        selected.exclude_from_group_by;
    }
    if ('expr' in selected && selected.expr) {
      selectedColumn.internal.expr = selected.expr;
    }
    if ('interval' in selected && selected.interval) {
      selectedColumn.internal.interval = selected.interval;
    }
    // We'll handle the lightdash metrics separately
    if ('lightdash' in selected && selected.lightdash?.dimension) {
      selectedColumn.meta.dimension = selected.lightdash.dimension;
    }
    if ('override_suffix_agg' in selected && selected.override_suffix_agg) {
      selectedColumn.internal.override_suffix_agg =
        !!selected.override_suffix_agg;
    }
    if ('data_tests' in selected && selected.data_tests) {
      selectedColumn.data_tests = selected.data_tests;
    }
    if (
      'lightdash' in selected &&
      selected.lightdash?.case_sensitive !== undefined
    ) {
      selectedColumn.meta.case_sensitive = selected.lightdash.case_sensitive;
    }
    if (prefix) {
      selectedColumn.internal.prefix = prefix;
    }

    // In this scenario, we're creating a new column for each agg
    if ('aggs' in selected && selected.aggs) {
      let skipCustom = false;
      for (const agg of selected.aggs) {
        const aggColumn: FrameworkColumn = mergeDeep(selectedColumn, {
          data_type: 'number',
          internal: { agg }, // agg drives column name suffix + SQL agg wrap
        });
        const metrics = lightdashBuildMetrics({
          column: aggColumn,
          dj,
          modelJson,
          project,
          selected,
          skipCustom,
        });
        modelMetrics = { ...modelMetrics, ...metrics.model };
        const fromColumnWithAgg: FrameworkColumn = mergeDeep(
          fromColumn,
          aggColumn,
        );
        const newColumn: FrameworkColumn = mergeDeep(fromColumnWithAgg, {
          meta: { metrics: metrics.column },
        });
        if (_.isEmpty(newColumn.meta.metrics)) {
          delete newColumn.meta.metrics;
        }
        if (shouldAdd(newColumn)) {
          // Only adding if the column doesn't already exist
          newColumns.push(newColumn);
          skipCustom = true; // Only attach custom metrics to the first column created from these aggs
        }
      }
    } else {
      // Special handing for datetime columns with interval specified
      if (
        selected.name === 'datetime' &&
        'interval' in selected &&
        selected.interval
      ) {
        const sourceInterval = fromColumn?.internal?.interval ?? null;
        const built = frameworkBuildDatetimeColumn({
          interval: selected.interval,
          prefix,
          sourceInterval,
          userDimension: selected.lightdash?.dimension,
        });
        selectedColumn.internal.interval = built.interval;
        selectedColumn.meta.dimension = built.dimension;
        if (built.expr) {
          selectedColumn.internal.expr = built.expr;
        }
      } else {
        if ('agg' in selected && selected.agg) {
          selectedColumn.data_type = 'number';
          selectedColumn.internal.agg = selected.agg;
        }

        const metrics = lightdashBuildMetrics({
          column: selectedColumn,
          dj,
          modelJson,
          project,
          selected,
        });
        selectedColumn.meta.metrics = metrics.column;
        modelMetrics = { ...modelMetrics, ...metrics.model };
      }
      let newColumn: FrameworkColumn = mergeDeep(fromColumn, {
        ...selectedColumn,
      });
      if (modelId && !newColumn?.meta?.origin?.id) {
        // If selection isn't inheriting an existing column, we'll establish the current model id as the origin
        newColumn = mergeDeep(newColumn, {
          meta: { origin: { id: modelId } },
        });
      }
      if (_.isEmpty(newColumn.meta.metrics)) {
        delete newColumn.meta.metrics;
      }
      if (shouldAdd(newColumn)) {
        newColumns.push(newColumn);
      }
    }
  }

  return {
    columns: newColumns,
    modelMetrics,
  };
}

/**
 * Build all columns for a framework model
 *
 * @see utils.ts:274-673
 */
export function frameworkBuildColumns({
  dj,
  modelJson,
  project,
  cteColumnRegistry,
}: {
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
  cteColumnRegistry?: CteColumnRegistry;
}): {
  columns: FrameworkColumn[];
  datetimeInterval: FrameworkInterval | null;
  dimensions: FrameworkColumn[];
  facts: FrameworkColumn[];
  modelMetrics: LightdashMetrics;
} {
  let columns: FrameworkColumn[] = [];

  const modelHasAgg = frameworkModelHasAgg({ modelJson });
  const modelLayer = frameworkGetModelLayer(modelJson);

  // Certain metrics can rise to the model level when declared on columns (e.g. avg)
  // We start with the inherited metrics as a baseline
  const inheritedMetrics = frameworkInheritModels({
    modelJson,
    project,
  }).metrics;
  const inheritedMetricNames = new Set(Object.keys(inheritedMetrics));
  let modelMetrics: LightdashMetrics = { ...inheritedMetrics };

  // Track which columns are inherited (vs explicitly selected) for column-level metric filtering
  const inheritedColumnNames = new Set<string>();

  let datetimeInterval: 'hour' | 'day' | 'month' | 'year' | null = null;

  // HANDLE ROLLUP SETUP (datetime column + partition exclusions)
  // This runs whenever from.rollup is present, regardless of whether select exists.
  if ('rollup' in modelJson.from && modelJson.from.rollup) {
    const { rollup } = modelJson.from;
    datetimeInterval = rollup.interval;
    const rollupArgs = { ...modelJson.from, rollup, dj, modelJson, project };
    columns.push(...frameworkGetRollupInputs(rollupArgs).columns);
  }

  // HANDLE SELECTED COLUMNS
  if (
    'rollup' in modelJson.from &&
    modelJson.from.rollup &&
    !('select' in modelJson && modelJson.select)
  ) {
    // ROLLUP WITHOUT SELECT (int_rollup_model) - auto-discover dims + suffix-agg facts
    const { rollup } = modelJson.from;
    const rollupArgs = { ...modelJson.from, rollup, dj, modelJson, project };
    const from = frameworkGetNodeColumns({
      exclude: [...columns, ...frameworkGetRollupInputs(rollupArgs).exclude],
      from: modelJson.from,
      project,
    });
    for (const col of from.dimensions) {
      inheritedColumnNames.add(col.name);
    }
    columns.push(...from.dimensions);
    for (const f of from.facts) {
      if (frameworkSuffixAgg(f.name)) {
        inheritedColumnNames.add(f.name);
        columns.push(f);
      }
    }
  } else if (
    'union' in modelJson.from &&
    modelJson.from.union &&
    !('select' in modelJson && modelJson.select)
  ) {
    // HANDLE UNION WITHOUT SELECT
    if ('cte' in modelJson.from && cteColumnRegistry) {
      // CTE-based union: resolve columns from the CTE registry
      const cteCols =
        cteColumnRegistry.get((modelJson.from as { cte: string }).cte) || [];
      columns.push(...cteCols);
    } else if ('model' in modelJson.from || 'source' in modelJson.from) {
      const fromRef =
        'model' in modelJson.from
          ? { model: (modelJson.from as { model: string }).model }
          : { source: (modelJson.from as { source: string }).source };
      const from = frameworkGetNodeColumns({
        exclude: columns,
        from: fromRef,
        project,
      });
      for (const col of from.columns) {
        inheritedColumnNames.add(col.name);
      }
      columns.push(...from.columns);
    }
  } else if ('select' in modelJson && modelJson.select) {
    // HANDLE SELECT
    for (const selected of modelJson.select ?? []) {
      // CTE items must not fall back to modelJson.from.model -- they resolve columns
      // from the CTE registry, not from the base model's manifest.
      const fromModel =
        typeof selected === 'object' && 'model' in selected && selected.model
          ? selected.model
          : typeof selected === 'object' && 'cte' in selected && selected.cte
            ? null
            : 'from' in modelJson &&
                'model' in modelJson.from &&
                modelJson.from.model
              ? modelJson.from.model
              : null;
      const fromSource =
        typeof selected === 'object' && 'source' in selected && selected.source
          ? selected.source
          : 'from' in modelJson &&
              'source' in modelJson.from &&
              modelJson.from.source
            ? modelJson.from.source
            : null;
      const exclude =
        typeof selected === 'object' &&
        'exclude' in selected &&
        selected.exclude
          ? selected.exclude
          : [];
      const include =
        typeof selected === 'object' &&
        'include' in selected &&
        selected.include
          ? selected.include
          : [];
      // When a select item explicitly references a model or source, don't fall back
      // to modelJson.from.cte -- otherwise dims_from_model would resolve against
      // the CTE registry instead of the model's manifest columns.
      const fromCte =
        typeof selected === 'object' && 'cte' in selected && selected.cte
          ? (selected as { cte: string }).cte
          : typeof selected === 'object' &&
              ('model' in selected || 'source' in selected)
            ? null
            : 'from' in modelJson &&
                'cte' in modelJson.from &&
                (modelJson.from as { cte: string }).cte
              ? (modelJson.from as { cte: string }).cte
              : null;
      // Strip CTE-materialized SQL metadata from CTE-sourced columns. `agg`,
      // `expr`, and `prefix` describe how the column was computed inside the
      // CTE's own SQL -- the CTE has already emitted that work as a named
      // output column. Carrying them into the main-model registry causes the
      // main-model SELECT and GROUP BY (which read `internal.expr` /
      // `internal.agg` / `internal.prefix`) to redundantly re-emit the same
      // expression. Concrete case: a CTE rolled up via `from.rollup` writes
      // `internal.expr = "date_trunc('month', datetime)"`; without this strip,
      // a downstream main model that selects `datetime` from that CTE would
      // emit `date_trunc('month', datetime) as datetime` (and the same in
      // GROUP BY) instead of a bare `datetime` reference. `interval` is kept
      // because it remains useful metadata at the main-model scope (drives
      // `_ext_event_date_filter` interval, partition selection, etc.).
      const from =
        fromCte && cteColumnRegistry
          ? (() => {
              const stripCteMaterialized = (
                c: FrameworkColumn,
              ): FrameworkColumn => {
                const {
                  agg: _agg,
                  expr: _expr,
                  prefix: _prefix,
                  ...restInternal
                } = c.internal || {};
                return { ...c, internal: restInternal };
              };
              const combinedExclude = [
                ...columns.map((c) => c.name),
                ...(exclude as (string | FrameworkColumn)[]).map((e) =>
                  typeof e === 'string' ? e : e.name,
                ),
              ];
              const includeNames = (
                include as (string | FrameworkColumn)[]
              ).map((i) => (typeof i === 'string' ? i : i.name));
              const cols = filterBulkSelectColumns(
                (cteColumnRegistry.get(fromCte) || []).map(
                  stripCteMaterialized,
                ),
                BULK_SELECT_TYPES.ALL_FROM_CTE,
                {
                  exclude: combinedExclude.length ? combinedExclude : undefined,
                  include: includeNames.length ? includeNames : undefined,
                },
              );
              return {
                columns: cols,
                dimensions: cols.filter((c) => c.meta?.type !== 'fct'),
                facts: cols.filter((c) => c.meta?.type === 'fct'),
              };
            })()
          : fromModel
            ? frameworkGetNodeColumns({
                exclude: [...columns, ...exclude],
                from: { model: fromModel },
                include,
                project,
              })
            : fromSource
              ? frameworkGetNodeColumns({
                  exclude: [...columns, ...exclude],
                  from: { source: fromSource },
                  include,
                  project,
                })
              : null;
      const fromColumnName = !(
        typeof selected === 'object' &&
        'expr' in selected &&
        selected.expr
      ) // If expr is provided, we aren't inheriting anything
        ? typeof selected === 'string'
          ? selected
          : 'name' in selected && selected.name
            ? selected.name
            : null
        : null;
      const fromColumn =
        (fromColumnName &&
          from?.columns.find((c) => c.name === fromColumnName)) ||
        null;
      const overridePrefix =
        typeof selected === 'object' &&
        'override_prefix' in selected &&
        selected.override_prefix;
      // In join models, columns must be table-qualified to avoid ambiguity.
      // CTE columns use the CTE name as qualifier (e.g. pre_agg.cost_sum).
      // When a join target has override_alias, use it as the qualifier so the
      // generated SQL matches the alias in the JOIN line.
      let resolvedQualifier = overridePrefix || fromModel || fromCte;
      const baseModel =
        'model' in modelJson.from ? modelJson.from.model : undefined;
      const isBaseModelSelect =
        fromModel && baseModel && fromModel === baseModel;
      if (
        !overridePrefix &&
        !isBaseModelSelect &&
        resolvedQualifier &&
        'join' in modelJson.from &&
        Array.isArray(modelJson.from.join) &&
        modelJson.from.join.length
      ) {
        const matchingJoin = (
          modelJson.from.join as Array<Record<string, unknown>>
        ).find(
          (j) =>
            (fromModel && j.model === fromModel) ||
            (fromCte && j.cte === fromCte),
        );
        if (matchingJoin?.override_alias) {
          resolvedQualifier = matchingJoin.override_alias as string;
        }
      }
      const prefix =
        ('join' in modelJson.from &&
          modelJson.type !== 'int_join_column' &&
          modelJson.from.join?.length &&
          resolvedQualifier) ||
        null;
      if (typeof selected === 'string') {
        columns.push(
          mergeDeep(fromColumn, {
            name: selected,
            meta: { type: 'dim' },
          }),
        );
      } else {
        const selectType = selected.type as string;
        switch (selectType) {
          case BULK_SELECT_TYPES.ALL_FROM_MODEL:
          case BULK_SELECT_TYPES.ALL_FROM_SOURCE:
          case BULK_SELECT_TYPES.ALL_FROM_CTE: {
            if (!from) {
              continue;
            }
            const allFromModelCols = frameworkInheritColumns(from.columns, {
              internal: { ...(prefix && { prefix }) },
            });
            for (const col of allFromModelCols) {
              inheritedColumnNames.add(col.name);
            }
            columns.push(...allFromModelCols);
            break;
          }
          case BULK_SELECT_TYPES.DIMS_FROM_MODEL:
          case BULK_SELECT_TYPES.DIMS_FROM_CTE: {
            if (!from) {
              continue;
            }
            const dimsFromModelCols = frameworkInheritColumns(from.dimensions, {
              internal: { ...(prefix && { prefix }) },
            });
            for (const col of dimsFromModelCols) {
              inheritedColumnNames.add(col.name);
            }
            columns.push(...dimsFromModelCols);
            break;
          }
          case BULK_SELECT_TYPES.FCTS_FROM_MODEL:
          case BULK_SELECT_TYPES.FCTS_FROM_CTE: {
            if (!from) {
              continue;
            }
            const fctsFromModelCols = frameworkInheritColumns(from.facts, {
              internal: { ...(prefix && { prefix }) },
            });
            for (const col of fctsFromModelCols) {
              inheritedColumnNames.add(col.name);
            }
            columns.push(...fctsFromModelCols);
            break;
          }
          // If single fact or dim, just add prefix
          case 'fct':
          case 'dim':
          default: {
            const processed = frameworkProcessSelected({
              dj,
              existingColumns: columns,
              fromColumn,
              modelJson,
              modelMetrics,
              prefix,
              project,
              selected: selected as FrameworkSelected,
            });
            columns.push(...processed.columns);
            modelMetrics = { ...modelMetrics, ...processed.modelMetrics };
            break;
          }
        }
      }
    }
  }

  let baseModel: string | null = null;
  let baseCte: string | null = null;
  let basePrefix: string | null = null;
  let baseSource: string | null = null;

  // HANDLE ADDITIONAL PARTITION COLUMNS
  if (modelLayer === 'stg') {
    if ('from' in modelJson && 'model' in modelJson.from) {
      baseModel = modelJson.from.model;
    }
    if ('from' in modelJson && 'source' in modelJson.from) {
      baseSource = modelJson.from.source;
    }
  } else if (
    'from' in modelJson &&
    'model' in modelJson.from &&
    modelJson.from.model
  ) {
    baseModel = modelJson.from.model;
    if ('join' in modelJson.from && modelJson.type !== 'int_join_column') {
      basePrefix = baseModel;
    }
  } else if (
    'from' in modelJson &&
    'cte' in modelJson.from &&
    (modelJson.from as { cte?: string }).cte
  ) {
    baseCte = (modelJson.from as { cte: string }).cte;
    if ('join' in modelJson.from && modelJson.type !== 'int_join_column') {
      basePrefix = baseCte;
    }
  }

  // Names the user listed explicitly in `select` (scalar `name` or bulk
  // `include`). Used by the three column-flag strip sites below so the
  // strip is origin-aware: it removes framework-supplied copies but leaves
  // user-typed copies alone. Bulk default-keep does not count -- otherwise
  // model-level excludes would be a no-op on any model using bulk passthrough.
  const userExplicitColumnNames =
    frameworkExtractUserExplicitColumnNames(modelJson);

  if (baseSource) {
    const sourceDateColumns = frameworkBuildSourceDateColumns({
      columns,
      project,
      source: baseSource,
    });
    columns.push(...sourceDateColumns);
  } else if (baseModel) {
    const exclude: FrameworkDims[] = [];
    if (!datetimeInterval) {
      // If we didn't select a datetime interval column, we'll inherit it from the base model
      const datetimeIntervalColumn = columns.find((c) =>
        c.name === 'datetime' ? c.internal?.interval || undefined : null,
      );
      datetimeInterval = datetimeIntervalColumn?.internal?.interval || null;
    }
    if (datetimeInterval) {
      exclude.push(
        ...frameworkGetRollupInputs({
          dj,
          model: baseModel,
          modelJson,
          project,
          rollup: { interval: datetimeInterval },
        }).exclude,
      );
    }
    switch (datetimeInterval) {
      case 'day': {
        exclude.push(PARTITION_HOURLY);
        break;
      }
      case 'month': {
        exclude.push(PARTITION_DAILY);
        exclude.push(PARTITION_HOURLY);
        break;
      }
      case 'year': {
        exclude.push(PARTITION_MONTHLY);
        exclude.push(PARTITION_HOURLY);
        exclude.push(PARTITION_DAILY);
        break;
      }
    }

    // By default, we include the datetime and partition columns when selecting from models, unless we're doing a lookback
    if (!('lookback' in modelJson.from && modelJson.from.lookback)) {
      const fromFrameworkDims = frameworkGetNodeColumns({
        exclude: [...columns, ...exclude], // Excluding if these were already added
        from: { model: baseModel },
        include: [
          'datetime',
          PARTITION_MONTHLY,
          PARTITION_DAILY,
          PARTITION_HOURLY,
        ],
        project,
        useCsvFallback: false,
      });
      const frameworkDims = frameworkInheritColumns(fromFrameworkDims.columns, {
        internal: { ...(basePrefix && { prefix: basePrefix }) },
      });
      columns.push(...frameworkDims);
    }

    // By default, we include portal_source_count column
    const fromFrameworkCounts = frameworkGetNodeColumns({
      exclude: [...columns, ...exclude], // Excluding if these were already added
      from: { model: baseModel },
      include: ['portal_source_count'],
      project,
      useCsvFallback: false,
    });
    const frameworkCounts = frameworkInheritColumns(
      fromFrameworkCounts.columns,
      {
        internal: {
          ...(basePrefix && { prefix: basePrefix }),
          ...(modelHasAgg && { agg: 'count' }),
        },
      },
    );
    columns.push(...frameworkCounts);
  } else if (baseCte && cteColumnRegistry) {
    // Parallel to the baseModel branch above for `from: { cte }` consumers:
    // auto-inject `datetime`, `portal_partition_*`, and `portal_source_count`
    // from the upstream CTE's registry. The model-level exclude-flag strip
    // further below applies uniformly, so opt-out semantics match.
    const cteCols = cteColumnRegistry.get(baseCte) ?? [];
    if (!datetimeInterval) {
      // Prefer interval declared on prior select-derived columns; fall back
      // to the upstream CTE registry's datetime column (mirrors the manifest
      // fallback in the baseModel branch).
      const datetimeIntervalColumn = columns.find((c) =>
        c.name === 'datetime' ? c.internal?.interval || undefined : null,
      );
      datetimeInterval =
        datetimeIntervalColumn?.internal?.interval ||
        cteCols.find((c) => c.name === 'datetime')?.internal?.interval ||
        null;
    }
    const excludedByInterval = new Set<string>();
    switch (datetimeInterval) {
      case 'day':
        excludedByInterval.add(PARTITION_HOURLY);
        break;
      case 'month':
        excludedByInterval.add(PARTITION_DAILY);
        excludedByInterval.add(PARTITION_HOURLY);
        break;
      case 'year':
        excludedByInterval.add(PARTITION_MONTHLY);
        excludedByInterval.add(PARTITION_HOURLY);
        excludedByInterval.add(PARTITION_DAILY);
        break;
    }

    const wantedFrameworkDims = new Set<string>([
      'datetime',
      PARTITION_MONTHLY,
      PARTITION_DAILY,
      PARTITION_HOURLY,
    ]);
    const alreadyPresent = new Set(columns.map((c) => c.name));
    const upstreamFrameworkCols = cteCols
      .filter(
        (c) =>
          wantedFrameworkDims.has(c.name) &&
          !alreadyPresent.has(c.name) &&
          !excludedByInterval.has(c.name),
      )
      // Clone before handing off -- `frameworkInheritColumn` mutates its
      // input, and these entries are shared with the persisted CTE registry.
      .map((c) => ({ ...c, internal: { ...c.internal } }));
    const frameworkDims = frameworkInheritColumns(upstreamFrameworkCols, {
      internal: { ...(basePrefix && { prefix: basePrefix }) },
    });
    columns.push(...frameworkDims);

    if (!alreadyPresent.has('portal_source_count')) {
      const upstreamPsc = cteCols.find((c) => c.name === 'portal_source_count');
      if (upstreamPsc) {
        const cloned = [
          { ...upstreamPsc, internal: { ...upstreamPsc.internal } },
        ];
        const frameworkCounts = frameworkInheritColumns(cloned, {
          internal: {
            ...(basePrefix && { prefix: basePrefix }),
            ...(modelHasAgg && { agg: 'count' }),
          },
        });
        columns.push(...frameworkCounts);
      }
    }
  }

  // Strip auto-injected `portal_source_count` when the model opts out
  // (individual flag, or `exclude_framework_artifacts` = "all" | "columns").
  // Columns the user listed explicitly survive (see `userExplicitColumnNames`).
  if (frameworkResolveExcludeFlag('portal_source_count', null, modelJson)) {
    columns = columns.filter(
      (c) =>
        c.name !== 'portal_source_count' || userExplicitColumnNames.has(c.name),
    );
  }

  // Sort alphabetically with partition columns at the end
  const partitionColumnNames = frameworkGetPartitionColumnNames({
    modelJson,
    project,
  });
  columns = sortColumnsWithPartitionsLast(columns, partitionColumnNames);

  // Strip auto-injected partition columns when the model opts out.
  // Origin-aware: same rules as `portal_source_count` above.
  if (
    frameworkResolveExcludeFlag('portal_partition_columns', null, modelJson)
  ) {
    columns = columns.filter(
      (c) =>
        !partitionColumnNames.includes(c.name) ||
        userExplicitColumnNames.has(c.name),
    );
  }

  // Strip the auto-injected `datetime` column when the model opts out.
  // Orthogonal to `exclude_portal_partition_columns`: partition columns
  // survive unless that flag is also set. Origin-aware: same rules as
  // `portal_source_count` above. `from.rollup` + `exclude_datetime` (and
  // combined-flag values that imply it) is rejected upstream by
  // ValidationService so the strip never sees that combination.
  if (frameworkResolveExcludeFlag('datetime', null, modelJson)) {
    columns = columns.filter(
      (c) => c.name !== 'datetime' || userExplicitColumnNames.has(c.name),
    );
  }

  if ('lookback' in modelJson.from && modelJson.from.lookback) {
    // Special handling for lookback models

    // Exclude the datetime and portal_source_count columns
    columns = columns.filter(
      (c) => !['datetime', 'portal_source_count'].includes(c.name),
    );
    // If portal_partition_daily exists, replace in current spot, otherwise add to end
    const portalPartitionDailyIndex = columns.findIndex(
      (c) => c.name === PARTITION_DAILY,
    );
    const portalPartitionDailyColumn: FrameworkColumn = {
      name: PARTITION_DAILY,
      data_type: 'date',
      meta: { type: 'dim' },
      internal: { expr: '_ext_event_date' },
    };
    if (portalPartitionDailyIndex >= 0) {
      columns = [
        ...columns.slice(0, portalPartitionDailyIndex),
        portalPartitionDailyColumn,
        ...columns.slice(portalPartitionDailyIndex + 1),
      ];
    } else {
      columns.push(portalPartitionDailyColumn);
    }
  }

  // Filter inherited metrics that reference columns not present in the downstream model
  const downstreamColumnNames = new Set(
    columns.map((c) => frameworkColumnName({ column: c, modelJson })),
  );
  const upstreamColumnNames = frameworkGetUpstreamColumnNames({
    modelJson,
    project,
  });

  const inheritedModelMetrics: LightdashMetrics = {};
  for (const [name, metric] of Object.entries(modelMetrics)) {
    if (
      inheritedMetricNames.has(name) &&
      modelMetrics[name] === inheritedMetrics[name]
    ) {
      inheritedModelMetrics[name] = metric;
    }
  }
  const filteredInheritedModelMetrics = frameworkFilterMetricsBySql({
    metrics: inheritedModelMetrics,
    downstreamColumnNames,
    upstreamColumnNames,
  });
  for (const name of Object.keys(inheritedModelMetrics)) {
    if (!(name in filteredInheritedModelMetrics)) {
      delete modelMetrics[name];
    }
  }

  for (const col of columns) {
    if (inheritedColumnNames.has(col.name) && col.meta.metrics) {
      col.meta.metrics = frameworkFilterMetricsBySql({
        metrics: col.meta.metrics,
        downstreamColumnNames,
        upstreamColumnNames,
      });
      if (_.isEmpty(col.meta.metrics)) {
        delete col.meta.metrics;
      }
    }
  }

  return {
    columns,
    datetimeInterval,
    dimensions: columns.filter((c) => c.meta.type === 'dim'),
    facts: columns.filter((c) => c.meta.type === 'fct'),
    modelMetrics,
  };
}

/**
 * Builds a column-name-to-type map from all sources in a CTE's FROM clause
 * (main source + joins). Used to inherit the correct dim/fct type when a CTE
 * lists columns as plain strings rather than typed objects.
 */
function buildCteSourceTypeMap(
  from: FrameworkCTE['from'],
  cteRegistry: CteColumnRegistry,
  project: DbtProject,
): Map<string, string> {
  const typeMap = new Map<string, string>();

  const addFromModel = (model: string) => {
    for (const col of frameworkGetNodeColumns({ from: { model }, project })
      .columns) {
      typeMap.set(col.name, col.meta?.type ?? 'dim');
    }
  };

  const addFromCte = (cteName: string) => {
    for (const col of cteRegistry.get(cteName) ?? []) {
      typeMap.set(col.name, col.meta?.type ?? 'dim');
    }
  };

  if ('model' in from && from.model) {
    addFromModel(from.model);
  } else if ('cte' in from && from.cte) {
    addFromCte(from.cte);
  }

  if ('join' in from && Array.isArray(from.join)) {
    for (const j of from.join) {
      if ('model' in j) {
        addFromModel((j as { model: string }).model);
      } else if ('cte' in j) {
        addFromCte((j as { cte: string }).cte);
      }
    }
  }

  return typeMap;
}

/**
 * Builds a column-name-to-FrameworkColumn map from all sources in a CTE's
 * FROM clause (main source + joins). Used to inherit full column metadata
 * (description, data_type, tags, etc.) when a CTE lists columns as plain
 * strings rather than typed objects.
 */
function buildCteSourceColumnMap(
  from: FrameworkCTE['from'],
  cteRegistry: CteColumnRegistry,
  project: DbtProject,
): Map<string, FrameworkColumn> {
  const colMap = new Map<string, FrameworkColumn>();

  const addFromModel = (model: string) => {
    for (const col of frameworkGetNodeColumns({ from: { model }, project })
      .columns) {
      colMap.set(col.name, col);
    }
  };

  const addFromCte = (cteName: string) => {
    for (const col of cteRegistry.get(cteName) ?? []) {
      colMap.set(col.name, col);
    }
  };

  if ('model' in from && from.model) {
    addFromModel(from.model);
  } else if ('cte' in from && from.cte) {
    addFromCte(from.cte);
  }

  if ('join' in from && Array.isArray(from.join)) {
    for (const j of from.join) {
      if ('model' in j) {
        addFromModel((j as { model: string }).model);
      } else if ('cte' in j) {
        addFromCte((j as { cte: string }).cte);
      }
    }
  }

  return colMap;
}

/**
 * Extracts the `interval` of the upstream `datetime` column for a given CTE
 * `from` clause. Returns `null` when the upstream doesn't carry a datetime
 * interval. Used by `frameworkBuildDatetimeColumn` to decide whether a
 * `date_trunc` is needed -- when the upstream is already at the requested
 * granularity, the truncation is skipped.
 */
export function frameworkGetCteDatetimeSourceInterval({
  cteRegistry,
  from,
  project,
}: {
  cteRegistry: CteColumnRegistry;
  from: FrameworkCTE['from'];
  project: DbtProject;
}): FrameworkInterval | null {
  const colMap = buildCteSourceColumnMap(from, cteRegistry, project);
  const dt = colMap.get('datetime');
  if (dt?.internal?.interval) {
    return dt.internal.interval;
  }
  return null;
}

/**
 * Returns true when `name` is a `portal_partition_*` column at a finer grain
 * than the rollup interval. Used by the CTE rollup transform to drop
 * upstream-inherited partitions that no longer make sense at the rollup
 * grain (e.g. `portal_partition_daily` is dropped under `rollup: month`).
 */
function frameworkIsCtePartitionFinerThanRollup(
  name: string,
  interval: FrameworkInterval,
): boolean {
  switch (interval) {
    case 'hour':
      return false;
    case 'day':
      return name === PARTITION_HOURLY;
    case 'month':
      return name === PARTITION_HOURLY || name === PARTITION_DAILY;
    case 'year':
      return (
        name === PARTITION_HOURLY ||
        name === PARTITION_DAILY ||
        name === PARTITION_MONTHLY
      );
  }
}

/**
 * Normalizes a CTE column list to the rollup grain. Mirrors the model-level
 * pattern (`frameworkBuildColumns` rollup setup + partition-exclusion block)
 * but operates on the already-built CTE column list as a final post-process:
 *
 * 1. Replaces any inherited `datetime` column with the rolled-up version
 *    (new `internal.interval`, `date_trunc(...)` `internal.expr`, refreshed
 *    `meta.dimension.time_intervals`). User-set meta is preserved via the
 *    `userDimension` channel, mirroring the named-datetime select branch.
 * 2. Drops partition columns finer than the rollup grain. The remaining
 *    coarser-or-equal partitions stay so downstream consumers (and the
 *    materialized table's `partitioned_by` clause) see a consistent shape.
 * 3. If no `datetime` column is present after the walk, prepends one. This
 *    handles the `from: { cte, rollup }` case where the auto-inject helper
 *    does not fire (it is gated on `from.model`); the rollup transform is
 *    the sole source of `datetime` in that branch.
 */
function frameworkApplyCteRollupTransform(
  columns: FrameworkColumn[],
  ctx: {
    cte: FrameworkCTE;
    cteRegistry: CteColumnRegistry;
    project: DbtProject;
    rollup: { interval: FrameworkInterval };
  },
): FrameworkColumn[] {
  const { cte, cteRegistry, project, rollup } = ctx;
  const sourceInterval = frameworkGetCteDatetimeSourceInterval({
    cteRegistry,
    from: cte.from,
    project,
  });

  const result: FrameworkColumn[] = [];
  let datetimePresent = false;
  for (const col of columns) {
    if (col.name === 'datetime') {
      const built = frameworkBuildDatetimeColumn({
        interval: rollup.interval,
        sourceInterval,
        userDimension: col.meta.dimension,
      });
      const internal: FrameworkColumn['internal'] = {
        ...col.internal,
        interval: built.interval,
      };
      if (built.expr) {
        internal.expr = built.expr;
      } else {
        delete internal.expr;
      }
      result.push({
        ...col,
        meta: {
          ...col.meta,
          type: 'dim',
          dimension: built.dimension,
        },
        internal,
      });
      datetimePresent = true;
      continue;
    }
    if (frameworkIsCtePartitionFinerThanRollup(col.name, rollup.interval)) {
      continue;
    }
    result.push(col);
  }

  if (!datetimePresent) {
    const sourceColMap = buildCteSourceColumnMap(
      cte.from,
      cteRegistry,
      project,
    );
    const sourceDt = sourceColMap.get('datetime');
    const built = frameworkBuildDatetimeColumn({
      interval: rollup.interval,
      sourceInterval,
      userDimension: sourceDt?.meta?.dimension,
    });
    const internal: FrameworkColumn['internal'] = {
      ...(sourceDt?.internal ?? {}),
      interval: built.interval,
    };
    if (built.expr) {
      internal.expr = built.expr;
    } else {
      delete internal.expr;
    }
    const datetimeCol: FrameworkColumn = sourceDt
      ? {
          ...sourceDt,
          name: 'datetime',
          meta: {
            ...sourceDt.meta,
            type: 'dim',
            dimension: built.dimension,
          },
          internal,
        }
      : {
          name: 'datetime',
          meta: {
            type: 'dim',
            dimension: built.dimension,
          },
          internal,
        };
    result.unshift(datetimeCol);
  }

  return result;
}

/**
 * Infers output columns for a CTE by analyzing its select items.
 * Unlike external models, CTEs have no manifest entry, so their schema
 * must be derived from the select definition at generation time.
 * Aggregated columns are stored with their suffixed name (e.g. cost_sum)
 * and agg metadata so downstream SQL generation can reference them correctly.
 *
 * When the CTE declares `from.rollup`, a final transform normalizes the
 * column list to the rollup grain (see `frameworkApplyCteRollupTransform`).
 */
export function frameworkInferCteColumns({
  cte,
  cteRegistry,
  modelId,
  modelJson,
  project,
}: {
  cte: FrameworkCTE;
  cteRegistry: CteColumnRegistry;
  modelId?: string | null;
  /**
   * Parent model JSON. When provided, CTE-level `exclude_portal_partition_columns`
   * and `exclude_portal_source_count` inherit from the model when omitted on
   * the CTE itself (CTE override > model > false). Optional so test fixtures
   * and lineage previews can build a registry without a full model.
   */
  modelJson?: FrameworkModel;
  project: DbtProject;
}): FrameworkColumn[] {
  const columns: FrameworkColumn[] = [];

  // When a CTE has no explicit select (e.g. a UNION passthrough), inherit
  // columns from its source so downstream consumers can resolve them.
  // If the CTE also has joins, include columns from all joined targets.
  if (!cte.select) {
    const from = cte.from;
    if ('cte' in from && from.cte) {
      const srcCols = cteRegistry.get(from.cte);
      if (srcCols) {
        columns.push(...srcCols.map((c) => ({ ...c })));
      }
    } else if ('model' in from && from.model) {
      columns.push(
        ...frameworkGetNodeColumns({
          from: { model: from.model },
          project,
        }).columns,
      );
    }
    if ('join' in from && Array.isArray(from.join)) {
      for (const j of from.join) {
        if ('cte' in j) {
          const joinCols = cteRegistry.get((j as { cte: string }).cte);
          if (joinCols) {
            columns.push(...joinCols.map((c) => ({ ...c })));
          }
        } else if ('model' in j) {
          columns.push(
            ...frameworkGetNodeColumns({
              from: { model: (j as { model: string }).model },
              project,
            }).columns,
          );
        }
      }
    }
    return columns;
  }

  const sourceTypeMap = buildCteSourceTypeMap(cte.from, cteRegistry, project);
  const sourceColumnMap = buildCteSourceColumnMap(
    cte.from,
    cteRegistry,
    project,
  );

  for (const item of cte.select) {
    if (typeof item === 'string') {
      const inherited = sourceColumnMap.get(item);
      if (inherited) {
        columns.push({ ...inherited, internal: { ...inherited.internal } });
      } else {
        const inheritedType = (sourceTypeMap.get(item) ?? 'dim') as
          | 'dim'
          | 'fct';
        columns.push({
          name: item,
          meta: { type: inheritedType },
          internal: {},
        });
      }
      continue;
    }

    const sel = item as CteSelectItem & Record<string, unknown>;
    const selType = sel.type as string | undefined;

    if ('cte' in sel && selType && BULK_CTE_TYPES.has(selType)) {
      const cteSelectItem = sel as SchemaModelSelectCTE;
      const srcCols = cteRegistry.get(cteSelectItem.cte) || [];
      const include = 'include' in sel ? (sel.include as string[]) : undefined;
      const exclude = 'exclude' in sel ? (sel.exclude as string[]) : undefined;
      const filtered = filterBulkSelectColumns(srcCols, selType, {
        include,
        exclude,
      });
      const ordered =
        include || exclude ? sortColumnsWithPartitionsLast(filtered) : filtered;
      columns.push(
        ...ordered.map((c) => ({ ...c, internal: { ...c.internal } })),
      );
      continue;
    }

    if ('model' in sel && selType && BULK_MODEL_TYPES.has(selType)) {
      const modelRef = sel.model as string;
      const include = 'include' in sel ? (sel.include as string[]) : undefined;
      const exclude = 'exclude' in sel ? (sel.exclude as string[]) : undefined;
      const nodeColumns = frameworkGetNodeColumns({
        from: { model: modelRef },
        project,
        include,
        exclude,
      });
      const filtered = filterBulkSelectColumns(nodeColumns.columns, selType);
      const ordered =
        include || exclude ? sortColumnsWithPartitionsLast(filtered) : filtered;
      columns.push(...ordered);
      continue;
    }

    if ('name' in sel) {
      const name = sel.name as string;
      const sourceCol = sourceColumnMap.get(name);
      const agg = 'agg' in sel ? (sel.agg as FrameworkColumnAgg) : undefined;
      const aggs =
        'aggs' in sel ? (sel.aggs as FrameworkColumnAgg[]) : undefined;
      const interval =
        'interval' in sel ? (sel.interval as FrameworkInterval) : undefined;

      // Datetime with interval: produce a dim column with time_intervals and
      // optionally an expr for date_trunc (matches main-model behavior).
      if (name === 'datetime' && interval && !agg && !aggs) {
        const sourceInterval = sourceCol?.internal?.interval ?? null;
        const built = frameworkBuildDatetimeColumn({
          interval,
          sourceInterval,
          userDimension: (
            sel.lightdash as { dimension?: Partial<LightdashDimension> }
          )?.dimension,
        });
        const selectedColumn: FrameworkColumn = {
          name,
          meta: {
            type: 'dim',
            dimension: built.dimension,
          },
          internal: {
            interval: built.interval,
          },
        };
        if (built.expr) {
          selectedColumn.internal.expr = built.expr;
        }
        // Forward description, data_tests, override_suffix_agg,
        // and exclude_from_group_by from `sel`. The interval schema has no
        // `expr`, so the expr-from-sel branch in the helper is a no-op here.
        frameworkApplyCteSelectMeta(sel, selectedColumn, { hasAgg: false });
        // frameworkApplyCteSelectMeta may overwrite selectedColumn.meta.dimension
        // with the raw sel.lightdash.dimension (full replace, not a merge);
        // restore the merged version from frameworkBuildDatetimeColumn which
        // already folded user overrides on top of the built defaults.
        selectedColumn.meta.dimension = built.dimension;
        // Deep-merge upstream beneath the selected overlay so upstream
        // data_type (e.g. `timestamp(6)`), description, and nested
        // meta.dimension fields (e.g. `dimension.type: timestamp`) survive
        // while the selected column's interval, time_intervals, label, and
        // expr win. Mirrors the main-model `mergeDeep(fromColumn, selectedColumn)`
        // pattern in frameworkProcessSelected.
        const col: FrameworkColumn = sourceCol
          ? mergeDeep({ ...sourceCol }, selectedColumn)
          : selectedColumn;
        if (modelId && !col.meta.origin?.id) {
          col.meta.origin = { id: modelId };
        }
        columns.push(col);
        continue;
      }

      const selectedColumn: FrameworkColumn = {
        name,
        meta: { type: selType === 'fct' ? 'fct' : 'dim' },
        internal: {},
      };
      frameworkApplyCteSelectMeta(sel, selectedColumn, {
        hasAgg: !!(agg || aggs),
      });

      // Deep-merge upstream beneath the selected overlay so upstream
      // data_type, description, and meta.dimension.* fields are preserved
      // while selected fields (type, anything forwarded from sel via
      // frameworkApplyCteSelectMeta) win. Matches the main-model
      // `mergeDeep(fromColumn, selectedColumn)` pattern.
      const col: FrameworkColumn = sourceCol
        ? mergeDeep({ ...sourceCol }, selectedColumn)
        : selectedColumn;

      // For aggregated columns, the kernel (sum/count/hll/tdigest) determines
      // the output type, not the upstream input -- strip any inherited
      // `data_type`. `meta.dimension` is NOT stripped so that framework
      // auto-synthesized dimensions (e.g. the `portal_source_count` audit
      // column's `dimension: { label, hidden: true }`) and user-authored
      // dim-style dimensions on upstream fct columns flow through, exactly
      // as they do in the main-model `mergeDeep(fromColumn, selectedColumn)`
      // path. Description, origin, and tags remain inherited via mergeDeep.
      if ((agg || aggs) && col.data_type !== undefined) {
        delete col.data_type;
      }

      // Each `aggs` entry becomes its own fct column, carrying forward the
      // scalar meta (override_suffix_agg, etc.) collected
      // onto `col` above, matching the main-model `mergeDeep` path.
      if (aggs) {
        for (const a of aggs) {
          const resolved = frameworkResolveAgg({
            agg: a,
            name,
            overrideSuffixAgg: !!col.internal?.override_suffix_agg,
          });
          const aggCol: FrameworkColumn = {
            ...col,
            name: resolved.outputName,
            meta: { ...col.meta, type: 'fct' },
            internal: { ...col.internal, agg: a },
          };
          columns.push(aggCol);
        }
        if (!agg) {
          continue;
        }
      }
      if (agg) {
        const resolved = frameworkResolveAgg({
          agg,
          name,
          overrideSuffixAgg: !!col.internal?.override_suffix_agg,
        });
        col.name = resolved.outputName;
        col.internal = { ...col.internal, agg };
      }
      if (modelId && !col.meta.origin?.id) {
        col.meta.origin = { id: modelId };
      }
      columns.push(col);
      continue;
    }
  }

  // Mirror the main-model datetime + partition auto-injection for CTEs
  // whose FROM is a plain model OR plain CTE reference. Without this, a
  // `dims_from_model` bulk select with a small `include` list -- or a
  // pre-aggregation CTE that only enumerates non-partition dims -- silently
  // drops `portal_partition_*` (and `datetime`), and downstream materialization
  // fails because `partitioned_by` can't find the columns. The helper docstring
  // covers the from-type dispatch and exclude-flag precedence.
  const autoDims = frameworkShouldAutoInjectCteFrameworkDims({
    cte,
    alreadyPresentNames: columns.map((c) => c.name),
    cteRegistry,
    modelJson,
    project,
  });
  if (autoDims) {
    const upstreamColumns: FrameworkColumn[] =
      autoDims.source === 'model'
        ? frameworkGetNodeColumns({
            from: { model: autoDims.baseModel },
            include: autoDims.include,
            project,
            useCsvFallback: false,
          }).columns
        : (() => {
            const registryCols = cteRegistry.get(autoDims.baseCte) ?? [];
            const includeSet = new Set<string>(autoDims.include);
            // Clone before handing off -- `frameworkInheritColumn` mutates
            // its input, and these entries are shared with downstream CTEs.
            return registryCols
              .filter((c) => includeSet.has(c.name))
              .map((c) => ({ ...c, internal: { ...c.internal } }));
          })();
    // Framework-managed passthroughs: preserve whatever origin the upstream
    // had (typically none for `datetime` / `portal_partition_*`). Do NOT
    // stamp `modelId` here — that would cascade a spurious `meta.origin.id`
    // into every downstream YAML and diverge from the `baseModel` auto-inject
    // branch in `frameworkBuildColumns`, which also leaves origin alone.
    const injected = frameworkInheritColumns(upstreamColumns, {});
    columns.push(...injected);
  }

  // Mirror the main-model `portal_source_count` auto-injection for CTEs
  // whose FROM is a plain model OR plain CTE reference. Without this, a CTE
  // that pre-aggregates a model (or chains off such a CTE) silently drops
  // the audit column and downstream `all_from_cte` / `dims_from_cte`
  // passthroughs can't put it back.
  const autoPsc = frameworkShouldAutoInjectCtePortalSourceCount({
    cte,
    alreadyPresentNames: columns.map((c) => c.name),
    cteRegistry,
    modelJson,
    project,
  });
  if (autoPsc) {
    const upstreamColumns: FrameworkColumn[] =
      autoPsc.source === 'model'
        ? frameworkGetNodeColumns({
            from: { model: autoPsc.baseModel },
            include: ['portal_source_count'],
            project,
            useCsvFallback: false,
          }).columns
        : (cteRegistry.get(autoPsc.baseCte) ?? [])
            .filter((c) => c.name === 'portal_source_count')
            .map((c) => ({ ...c, internal: { ...c.internal } }));
    const injected = frameworkInheritColumns(upstreamColumns, {
      internal: {
        ...(autoPsc.applyAgg && { agg: 'count' }),
      },
    });
    for (const col of injected) {
      if (autoPsc.applyAgg) {
        const resolved = frameworkResolveAgg({
          agg: 'count',
          name: col.name,
          overrideSuffixAgg: !!col.internal?.override_suffix_agg,
        });
        col.name = resolved.outputName;
      }
      if (modelId && !col.meta.origin?.id) {
        col.meta.origin = { id: modelId };
      }
    }
    columns.push(...injected);
  }

  // Rollup post-process: when the CTE declares `from.rollup`, normalize the
  // column list to the new grain. Done after the auto-inject step so that
  // upstream-grain `datetime` (and any finer-grain `portal_partition_*`
  // columns) pulled by select inheritance / auto-inject get rewritten or
  // dropped consistently.
  const rollup =
    'rollup' in cte.from && cte.from.rollup ? cte.from.rollup : null;
  if (rollup) {
    return frameworkApplyCteRollupTransform(columns, {
      cte,
      cteRegistry,
      project,
      rollup,
    });
  }

  return columns;
}

/**
 * Resolves the effective value of a single framework-injection opt-out flag
 * across the four-tier precedence chain:
 *
 *   CTE individual > CTE combined > model individual > model combined > false
 *
 * Each scope (CTE, model) carries two channels: an explicit individual flag
 * (`exclude_datetime`, `exclude_portal_partition_columns`,
 * `exclude_portal_source_count`, `exclude_date_filter`) and the combined
 * `exclude_framework_artifacts` enum. The combined enum implies a fixed set
 * of individual flags:
 *
 *   - `"all"`     → datetime, portal_partition_columns, portal_source_count, date_filter
 *   - `"columns"` → datetime, portal_partition_columns, portal_source_count
 *
 * The individual flag at any scope wins over the combined flag at that scope:
 * `exclude_framework_artifacts: "all"` paired with `exclude_portal_source_count: false`
 * keeps the count column. CTE scope wins over model scope, so a CTE that sets
 * `exclude_datetime: false` keeps datetime even when the model set
 * `exclude_framework_artifacts: "all"`.
 *
 * Used by every site that decides whether to drop a framework-injected column
 * or filter -- the model-level strip in `frameworkBuildColumns`, the CTE gates
 * (`frameworkShouldAutoInjectCteFrameworkDims`,
 * `frameworkShouldAutoInjectCtePortalSourceCount`), the WHERE-clause builder
 * `frameworkBuildFilters`, and the `from.rollup` validator -- so all paths
 * agree on the same effective value.
 */
type ExcludeFlagName =
  | 'datetime'
  | 'portal_partition_columns'
  | 'portal_source_count'
  | 'date_filter';

const COMBINED_FLAG_IMPLIES: Record<'all' | 'columns', Set<ExcludeFlagName>> = {
  all: new Set<ExcludeFlagName>([
    'datetime',
    'portal_partition_columns',
    'portal_source_count',
    'date_filter',
  ]),
  columns: new Set<ExcludeFlagName>([
    'datetime',
    'portal_partition_columns',
    'portal_source_count',
  ]),
};

type ExcludeFlagSource =
  | (Partial<Record<`exclude_${ExcludeFlagName}`, boolean | undefined>> & {
      exclude_framework_artifacts?: 'all' | 'columns';
    })
  | null
  | undefined;

export function frameworkResolveExcludeFlag(
  flag: ExcludeFlagName,
  cte: ExcludeFlagSource,
  modelJson: ExcludeFlagSource,
): boolean {
  const individual = (s: ExcludeFlagSource): boolean | undefined =>
    s?.[`exclude_${flag}`];
  const combined = (s: ExcludeFlagSource): boolean | undefined => {
    const v = s?.exclude_framework_artifacts;
    if (v !== 'all' && v !== 'columns') {
      return undefined;
    }
    return COMBINED_FLAG_IMPLIES[v].has(flag);
  };

  const cteIndividual = individual(cte);
  if (cteIndividual !== undefined) {
    return Boolean(cteIndividual);
  }
  const cteCombined = combined(cte);
  if (cteCombined !== undefined) {
    return cteCombined;
  }
  const modelIndividual = individual(modelJson);
  if (modelIndividual !== undefined) {
    return Boolean(modelIndividual);
  }
  const modelCombined = combined(modelJson);
  if (modelCombined !== undefined) {
    return modelCombined;
  }
  return false;
}

const BULK_SELECT_TYPE_NAMES = new Set<string>([
  'all_from_model',
  'dims_from_model',
  'fcts_from_model',
  'all_from_source',
  'all_from_cte',
  'dims_from_cte',
  'fcts_from_cte',
]);

/**
 * Names the user listed explicitly in `select`. Two cases qualify:
 *   1. Scalar select items addressed by `name`
 *      (e.g. `{ "name": "datetime", "expr": "max(datetime)" }`).
 *   2. Bulk-select `include` arrays (e.g. `{ "type": "all_from_model",
 *      "include": ["portal_partition_daily"] }`). `include` is opt-in.
 *
 * Bulk default-keep (a column the bulk picks up because it isn't in
 * `exclude`) does NOT qualify -- the user did not name that column.
 *
 * Powers origin-aware stripping for `exclude_datetime`,
 * `exclude_portal_partition_columns`, and `exclude_portal_source_count`
 * (and the combined-flag values that imply them): framework-supplied
 * copies are removed, user-typed copies are kept.
 */
export function frameworkExtractUserExplicitColumnNames(
  modelJson: unknown,
): Set<string> {
  const names = new Set<string>();
  const select = (modelJson as { select?: unknown })?.select;
  if (!Array.isArray(select)) {
    return names;
  }
  for (const item of select) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as {
      type?: unknown;
      name?: unknown;
      include?: unknown;
    };
    const isBulk =
      typeof record.type === 'string' &&
      BULK_SELECT_TYPE_NAMES.has(record.type);
    if (isBulk) {
      if (Array.isArray(record.include)) {
        for (const candidate of record.include) {
          if (typeof candidate === 'string') {
            names.add(candidate);
          }
        }
      }
      continue;
    }
    if (typeof record.name === 'string') {
      names.add(record.name);
    }
  }
  return names;
}

/**
 * Shared gate for the CTE `portal_source_count` auto-injection, used by both
 * the CTE column registry (`frameworkInferCteColumns`) and the CTE SQL
 * emitter (`frameworkGenerateCteSql`) so the two stay consistent.
 *
 * Auto-injection fires when:
 * - The CTE's FROM is a plain `{ model }` or `{ cte }` ref (no union).
 * - The upstream actually has `portal_source_count` (manifest schema for
 *   `{ model }`, registry entry for `{ cte }`).
 * - The CTE's own select / bulk expansions haven't already pulled it in.
 * - The CTE has not opted out via `exclude_portal_source_count: true` or via
 *   `exclude_framework_artifacts` ("all" or "columns" both imply opt-out).
 *   The flag mirrors the main-model flag with the same name; resolution
 *   follows the standard CTE > model > false chain through
 *   `frameworkResolveExcludeFlag`, with the individual flag beating the
 *   combined flag at each scope.
 *
 * `applyAgg` is true when the CTE aggregates (non-empty `group_by`), mirroring
 * the main-model `frameworkModelHasAgg` rule. The caller is responsible for
 * feeding `applyAgg` into `frameworkResolveAgg` / `frameworkBuildAggSql` so
 * the suffix-collision + merge-kernel semantics match the named-select path.
 */
export function frameworkShouldAutoInjectCtePortalSourceCount({
  cte,
  alreadyPresentNames,
  cteRegistry,
  modelJson,
  project,
}: {
  cte: FrameworkCTE;
  alreadyPresentNames: string[];
  /**
   * Required for `from: { cte }` sources -- looked up to confirm the
   * upstream CTE actually exposes `portal_source_count`. Optional for
   * `from: { model }` sources (the manifest is consulted directly).
   */
  cteRegistry?: CteColumnRegistry;
  /**
   * When provided, the model's own `exclude_portal_source_count` is used as
   * a fallback when the CTE does not declare the flag. CTE-only call sites
   * (tests, lineage previews) may omit this; behavior reduces to "no model
   * inheritance" in that case.
   */
  modelJson?: FrameworkModel;
  project: DbtProject;
}):
  | { source: 'model'; baseModel: string; applyAgg: boolean }
  | { source: 'cte'; baseCte: string; applyAgg: boolean }
  | null {
  if (
    frameworkResolveExcludeFlag('portal_source_count', cte, modelJson ?? null)
  ) {
    return null;
  }
  if ('union' in cte.from) {
    return null;
  }
  const baseModel =
    'model' in cte.from && cte.from.model ? cte.from.model : null;
  const baseCte = 'cte' in cte.from && cte.from.cte ? cte.from.cte : null;
  if (!baseModel && !baseCte) {
    return null;
  }
  if (alreadyPresentNames.includes('portal_source_count')) {
    return null;
  }

  const upstreamHasPsc = baseModel
    ? frameworkGetNodeColumns({
        from: { model: baseModel },
        include: ['portal_source_count'],
        project,
        useCsvFallback: false,
      }).columns.length > 0
    : (cteRegistry?.get(baseCte!) ?? []).some(
        (c) => c.name === 'portal_source_count',
      );
  if (!upstreamHasPsc) {
    return null;
  }

  // Rollup implies aggregation across the new grain even when `group_by`
  // is not explicitly declared (the SQL emitter synthesizes the GROUP BY
  // from dimensions). Treat it the same as an explicit non-empty group_by
  // so `portal_source_count` is wrapped with `count(...)` instead of being
  // selected raw, matching the suffix-agg behavior of the named-select path.
  const hasRollup = 'rollup' in cte.from && !!cte.from.rollup;
  const hasGroupBy =
    typeof cte.group_by === 'string'
      ? cte.group_by.length > 0
      : Array.isArray(cte.group_by) && cte.group_by.length > 0;
  const applyAgg = hasRollup || hasGroupBy;

  return baseModel
    ? { source: 'model', baseModel, applyAgg }
    : { source: 'cte', baseCte: baseCte!, applyAgg };
}

/**
 * Shared gate for the CTE `datetime` + `portal_partition_*` auto-injection,
 * used by both the CTE column registry (`frameworkInferCteColumns`) and the
 * CTE SQL emitter (`frameworkGenerateCteSql`) so the two stay consistent.
 *
 * Mirrors the `baseModel` auto-inject branch in `frameworkBuildColumns`:
 * when a CTE sources from a plain `{ model }` or `{ cte }` ref, datetime
 * and the partition columns are considered framework-managed and are
 * appended automatically even if the user's select (or
 * `dims_from_model` / `dims_from_cte` include list) did not mention them.
 * Without this, a CTE that pre-aggregates upstream columns silently drops
 * the partitions, and the downstream model fails at materialization because
 * `partitioned_by` can't find them.
 *
 * Auto-injection fires when:
 * - The CTE's FROM is a plain `{ model }` or `{ cte }` ref (no union).
 * - The upstream actually has the candidate column (manifest schema for
 *   `{ model }`, registry entry for `{ cte }`).
 * - The CTE's own select hasn't already pulled the column in.
 * - The candidate is not excluded by the effective datetime interval
 *   (day → hourly dropped; month → daily+hourly dropped; year → all three).
 * - The CTE has not opted out via `exclude_portal_partition_columns: true`
 *   (suppresses all `portal_partition_*`) or `exclude_datetime: true`
 *   (suppresses just `datetime`). Both flags match the main-model flags with
 *   the same names. CTE flag overrides the model-level value; when omitted on
 *   the CTE the model-level value is inherited (CTE override > model > false).
 *   The two flags are orthogonal -- set both for pure-dimension/lookup models.
 *   `exclude_datetime` is mutually exclusive with `from.rollup` at any scope
 *   (model OR CTE), validated by `validateExcludeDatetimeRollupConflict`.
 *
 * The effective datetime interval is determined in priority order:
 *
 *   1. The CTE's own `from.rollup.interval` -- rollup declares a new grain
 *      and wins over both the user select and the upstream interval.
 *   2. An explicit `{ name: 'datetime', interval: X }` entry in the CTE
 *      select (only relevant when no rollup is declared).
 *   3. The upstream column's own `internal.interval` -- read from the
 *      manifest for `{ model }` sources, from `cteRegistry` for `{ cte }`
 *      sources.
 */
export function frameworkShouldAutoInjectCteFrameworkDims({
  cte,
  alreadyPresentNames,
  cteRegistry,
  modelJson,
  project,
}: {
  cte: FrameworkCTE;
  alreadyPresentNames: string[];
  /**
   * Required for `from: { cte }` sources -- looked up to find what the
   * upstream CTE actually exposes (`datetime` / `portal_partition_*`).
   * Optional for `from: { model }` sources (the manifest is consulted
   * directly). Test fixtures without a registry get the safe default of
   * "no auto-inject" for `from: { cte }` cases.
   */
  cteRegistry?: CteColumnRegistry;
  /**
   * When provided, the model's own `exclude_portal_partition_columns` and
   * `exclude_datetime` are used as fallbacks when the CTE does not declare
   * the flags. CTE-only call sites (tests, lineage previews) may omit this;
   * behavior reduces to "no model inheritance" in that case.
   */
  modelJson?: FrameworkModel;
  project: DbtProject;
}):
  | {
      source: 'model';
      baseModel: string;
      include: ('datetime' | FrameworkPartitionName)[];
    }
  | {
      source: 'cte';
      baseCte: string;
      include: ('datetime' | FrameworkPartitionName)[];
    }
  | null {
  if ('union' in cte.from) {
    return null;
  }

  const baseModel =
    'model' in cte.from && cte.from.model ? cte.from.model : null;
  const baseCte = 'cte' in cte.from && cte.from.cte ? cte.from.cte : null;
  if (!baseModel && !baseCte) {
    return null;
  }

  let datetimeInterval: FrameworkInterval | null = null;
  // CTE-level `from.rollup` declares the new output grain; it wins over both
  // an explicit `{ name: 'datetime', interval }` select item and the upstream
  // source's own interval. The rollup grain controls partition exclusion here
  // (drop hourly under day, drop daily+hourly under month, drop all three
  // under year), and the rollup transform in `frameworkInferCteColumns`
  // rewrites the inherited `datetime` column to match.
  if ('rollup' in cte.from && cte.from.rollup) {
    datetimeInterval = cte.from.rollup.interval;
  }
  if (!datetimeInterval && Array.isArray(cte.select)) {
    for (const item of cte.select) {
      if (
        typeof item === 'object' &&
        item &&
        'name' in item &&
        item.name === 'datetime' &&
        'interval' in item &&
        (item as { interval?: FrameworkInterval }).interval
      ) {
        datetimeInterval =
          (item as { interval: FrameworkInterval }).interval ?? null;
        break;
      }
    }
  }
  // Resolve the upstream column list once and use it for both the interval
  // fallback and the final intersection check. For `{ model }` sources this
  // pulls from the manifest; for `{ cte }` sources it pulls from the
  // in-progress registry (the upstream CTE was processed earlier in the
  // declaration order).
  const upstreamColumns: FrameworkColumn[] = baseModel
    ? frameworkGetNodeColumns({
        from: { model: baseModel },
        project,
        useCsvFallback: false,
      }).columns
    : cteRegistry?.get(baseCte!) ?? [];
  if (!datetimeInterval) {
    const upstreamDt = upstreamColumns.find((c) => c.name === 'datetime');
    if (upstreamDt?.internal?.interval) {
      datetimeInterval = upstreamDt.internal.interval;
    }
  }

  const excluded = new Set<string>();
  switch (datetimeInterval) {
    case 'day':
      excluded.add(PARTITION_HOURLY);
      break;
    case 'month':
      excluded.add(PARTITION_DAILY);
      excluded.add(PARTITION_HOURLY);
      break;
    case 'year':
      excluded.add(PARTITION_MONTHLY);
      excluded.add(PARTITION_DAILY);
      excluded.add(PARTITION_HOURLY);
      break;
  }

  // Per-CTE opt-outs: `exclude_portal_partition_columns` suppresses the
  // partition columns and `exclude_datetime` suppresses the `datetime`
  // column. Both mirror main-model flags with the same names and resolve
  // through `frameworkResolveExcludeFlag`, which honors the combined
  // `exclude_framework_artifacts` enum and the four-tier precedence chain
  // (CTE individual > CTE combined > model individual > model combined).
  // The flags are orthogonal -- set both to drop both, matching the main-
  // model behavior.
  const effectiveExcludePartitions = frameworkResolveExcludeFlag(
    'portal_partition_columns',
    cte,
    modelJson ?? null,
  );
  const effectiveExcludeDatetime = frameworkResolveExcludeFlag(
    'datetime',
    cte,
    modelJson ?? null,
  );
  const candidates: ('datetime' | FrameworkPartitionName)[] = [];
  if (!effectiveExcludeDatetime) {
    candidates.push('datetime');
  }
  if (!effectiveExcludePartitions) {
    candidates.push(PARTITION_MONTHLY, PARTITION_DAILY, PARTITION_HOURLY);
  }
  const alreadyPresent = new Set(alreadyPresentNames);
  const missing = candidates.filter(
    (c) => !alreadyPresent.has(c) && !excluded.has(c),
  );
  if (missing.length === 0) {
    return null;
  }

  const upstreamNames = new Set(upstreamColumns.map((c) => c.name));
  const include = missing.filter((c) => upstreamNames.has(c));
  if (include.length === 0) {
    return null;
  }

  return baseModel
    ? { source: 'model', baseModel, include }
    : { source: 'cte', baseCte: baseCte!, include };
}

/**
 * Builds the column registry by processing CTEs in declaration order.
 * Sequential processing allows later CTEs to reference earlier ones
 * (forward references are rejected by validateCtes).
 */
export function frameworkBuildCteColumnRegistry({
  ctes,
  modelId,
  modelJson,
  partitionColumnNames,
  project,
}: {
  ctes: FrameworkCTE[];
  modelId?: string | null;
  /**
   * Parent model JSON. Forwarded to `frameworkInferCteColumns` so that CTE
   * exclude flags inherit from the model when omitted on the CTE.
   */
  modelJson?: FrameworkModel;
  partitionColumnNames?: string[];
  project: DbtProject;
}): CteColumnRegistry {
  const registry: CteColumnRegistry = new Map();
  for (const cte of ctes) {
    const columns = frameworkInferCteColumns({
      cte,
      cteRegistry: registry,
      modelId,
      modelJson,
      project,
    });
    // Sort alphabetically with partition columns at the end, matching the
    // main-model convention. Downstream dims_from_cte / fcts_from_cte bulk
    // expansions and the CTE's own group_by: "dims" builder both read from
    // the registry and thus inherit the same canonical order.
    registry.set(
      cte.name,
      sortColumnsWithPartitionsLast(columns, partitionColumnNames),
    );
  }
  return registry;
}

/**
 * Build source date columns
 *
 * @see utils.ts:961-1048
 */
export function frameworkBuildSourceDateColumns({
  columns,
  project,
  source,
}: {
  columns: FrameworkColumn[];
  project: DbtProject;
  source: string;
}): FrameworkColumn[] {
  const sourceDateColumns: FrameworkColumn[] = [];
  const sourceMeta = frameworkGetSourceMeta({
    project,
    source,
  });

  const eventDatetimeExpr = sourceMeta?.event_datetime?.expr;
  if (eventDatetimeExpr) {
    if (!columns.find((c) => c.name === 'datetime')) {
      sourceDateColumns.push({
        name: 'datetime',
        data_type: 'timestamp(6)',
        description: 'Event Datetime Column',
        meta: {
          type: 'dim',
          dimension: { label: 'Datetime', type: 'timestamp' },
        },
        internal: { expr: `cast(${eventDatetimeExpr} as timestamp(6))` },
      });
    }
    if (!columns.find((c) => c.name === PARTITION_DAILY)) {
      sourceDateColumns.push({
        name: PARTITION_DAILY,
        data_type: 'date',
        description: 'Daily Partition Column',
        meta: {
          type: 'dim',
          dimension: { label: 'Portal Partition Daily' },
        },
        internal: {
          expr: `date_trunc('day', cast(${eventDatetimeExpr} as date))`,
        },
      });
    }
    if (!columns.find((c) => c.name === PARTITION_HOURLY)) {
      sourceDateColumns.push({
        name: PARTITION_HOURLY,
        data_type: 'timestamp(6)',
        description: 'Hourly Partition Column',
        meta: {
          type: 'dim',
          dimension: { label: 'Portal Partition Hourly' },
        },
        internal: {
          expr: `date_trunc('hour', cast(${eventDatetimeExpr} as timestamp(6)))`,
        },
      });
    }
    if (!columns.find((c) => c.name === PARTITION_MONTHLY)) {
      sourceDateColumns.push({
        name: PARTITION_MONTHLY,
        data_type: 'date',
        description: 'Monthly Partition Column',
        meta: {
          type: 'dim',
          dimension: { label: 'Portal Partition Monthly' },
        },
        internal: {
          expr: `date_trunc('month', cast(${eventDatetimeExpr} as date))`,
        },
      });
    }
  }

  const portalSourceCount = sourceMeta?.portal_source_count;
  if (!portalSourceCount?.exclude) {
    sourceDateColumns.push({
      name: 'portal_source_count',
      data_type: 'bigint',
      meta: {
        type: 'fct',
        dimension: { label: 'Portal Source Count', hidden: true },
        metrics: {
          metric_portal_source_count: {
            type: 'sum',
            label: portalSourceCount?.metric_label || 'Portal Source Count',
          },
        },
      },
      internal: { expr: '1' },
    });
  }

  return sourceDateColumns;
}

// ========================================================================
// Shared primitives (consumed by main-model + CTE paths)
// ========================================================================

/**
 * Resolves the suffix-collision rule for a column being aggregated.
 *
 * When a column name already ends in `_{agg}` (e.g. `portal_source_count`
 * for `agg: "count"`), we treat the input as already-aggregated: the output
 * column keeps the original name (no double-suffix) and `frameworkBuildAggSql`
 * receives `inputSuffixAgg` so it picks the merge-style kernel (`sum` for
 * pre-counted columns, `merge(cast(... as hyperloglog))` for pre-HLL, etc.).
 *
 * Passing `overrideSuffixAgg: true` disables the collision branch: the output
 * is re-suffixed (`portal_source_count_count`) and a fresh aggregation kernel
 * is applied.
 *
 * Consumed by: main-model `frameworkColumnName`, main-model SELECT emission
 * in `sql-utils.ts`, CTE SQL generator, CTE registry.
 */
export function frameworkResolveAgg({
  agg,
  name,
  overrideSuffixAgg,
}: {
  agg: FrameworkColumnAgg;
  name: string;
  overrideSuffixAgg?: boolean;
}): { outputName: string; inputSuffixAgg: FrameworkColumnAgg | null } {
  const suffixAgg = frameworkSuffixAgg(name);
  const collides = suffixAgg === agg && !overrideSuffixAgg;
  return {
    outputName: collides ? name : `${name}_${agg}`,
    inputSuffixAgg: collides ? suffixAgg : null,
  };
}

/**
 * Builds the metadata + SQL expression for a `{name:"datetime", interval:"..."}`
 * select item. Skips the `date_trunc` when the upstream source is already at
 * the requested granularity.
 *
 * Returns:
 * - `expr`: `date_trunc('<interval>', [prefix.]datetime)` when truncation is
 *   required, or `null` when `sourceInterval === interval`. Callers emit
 *   bare `datetime` in the `null` case.
 * - `interval`: the chosen interval, to be stored on `col.internal.interval`.
 * - `dimension`: the Lightdash dimension payload with `time_intervals`
 *   synthesized from the chosen interval and merged with any user overrides.
 *
 * Consumed by: main-model `frameworkProcessSelected`, CTE SQL generator,
 * CTE registry.
 */
export function frameworkBuildDatetimeColumn({
  interval,
  prefix,
  sourceInterval,
  userDimension,
}: {
  interval: FrameworkInterval;
  prefix?: string | null;
  sourceInterval?: FrameworkInterval | null;
  userDimension?: Partial<LightdashDimension>;
}): {
  dimension: LightdashDimension;
  expr: string | null;
  interval: FrameworkInterval;
} {
  const timeIntervals: LightdashDimension['time_intervals'] = ['YEAR'];
  switch (interval) {
    case 'hour': {
      timeIntervals.push('DAY');
      timeIntervals.push('DAY_OF_WEEK_NAME');
      timeIntervals.push('HOUR');
      timeIntervals.push('MONTH');
      timeIntervals.push('WEEK');
      break;
    }
    case 'day': {
      timeIntervals.push('DAY');
      timeIntervals.push('DAY_OF_WEEK_NAME');
      timeIntervals.push('MONTH');
      timeIntervals.push('WEEK');
      break;
    }
    case 'month': {
      timeIntervals.push('MONTH');
      break;
    }
    // 'year' falls through: only YEAR.
  }
  timeIntervals.sort();

  const dimension: LightdashDimension = {
    label: 'Datetime',
    time_intervals: timeIntervals,
    ...userDimension,
  };

  const shouldTrunc = sourceInterval !== interval;
  const prefixedName = prefix ? `${prefix}.datetime` : 'datetime';
  const expr = shouldTrunc
    ? `date_trunc('${interval}', ${prefixedName})`
    : null;

  return { dimension, expr, interval };
}

/**
 * Copies the scalar-meta fields that flow from a CTE `sel` item onto a
 * `FrameworkColumn`. Single source of truth for CTE field forwarding --
 * adding a new meta field here propagates it to downstream `dims_from_cte` /
 * `all_from_cte` consumers in exactly one place.
 *
 * The `hasAgg` option suppresses `expr` and `exclude_from_group_by`, which
 * describe the pre-aggregation input and are meaningless on the aggregated
 * output column.
 */
export function frameworkApplyCteSelectMeta(
  sel: Record<string, unknown>,
  col: FrameworkColumn,
  opts: { hasAgg: boolean },
): void {
  if ('description' in sel && sel.description) {
    col.description = sel.description as string;
  }
  if ('data_type' in sel && sel.data_type) {
    col.data_type = sel.data_type as FrameworkColumn['data_type'];
  }
  if ('data_tests' in sel && sel.data_tests) {
    col.data_tests = sel.data_tests as FrameworkColumn['data_tests'];
  }

  const ld = (
    'lightdash' in sel && sel.lightdash
      ? (sel.lightdash as { dimension?: unknown })
      : null
  ) as { dimension?: unknown } | null;
  if (ld?.dimension) {
    col.meta.dimension = ld.dimension as FrameworkColumn['meta']['dimension'];
  }

  // Ensure col.internal exists for SQL-internal field assignments below.
  if (!col.internal) {
    col.internal = {};
  }

  if ('override_suffix_agg' in sel && sel.override_suffix_agg) {
    col.internal.override_suffix_agg = !!sel.override_suffix_agg;
  }

  if (!opts.hasAgg) {
    if ('expr' in sel && sel.expr) {
      col.internal.expr = sel.expr as string;
    }
    if ('exclude_from_group_by' in sel && sel.exclude_from_group_by) {
      col.internal.exclude_from_group_by = true;
    }
  }
}

// ========================================================================

/**
 * Get column select expression
 *
 * @see utils.ts:1050-1058
 */
export function frameworkColumnSelect(column: FrameworkColumn): string {
  if (column.internal?.expr) {
    return `${column.internal.expr} as ${column.name}`;
  }
  if (column.internal?.prefix) {
    return `${column.internal.prefix}.${column.name} as ${column.name}`;
  }
  return sqlCleanLine(column.name);
}

/**
 * Get column name with aggregation suffix
 *
 * @see utils.ts:1060-1079
 */
export function frameworkColumnName({
  column,
  modelJson,
}: {
  column: FrameworkColumn;
  modelJson: FrameworkModel;
}): string {
  const metaAgg = column.internal?.agg || null;
  const rollupAgg =
    ('rollup' in modelJson.from &&
      column.meta.type === 'fct' &&
      !column.internal?.expr &&
      frameworkSuffixAgg(column.name)) ||
    null;
  const newAgg = metaAgg || rollupAgg;
  if (!newAgg) {
    return column.name;
  }
  return frameworkResolveAgg({
    agg: newAgg,
    name: column.name,
    overrideSuffixAgg: !!column.internal?.override_suffix_agg,
  }).outputName;
}

/**
 * Reads the header row from a CSV seed file and returns column names.
 */
export function frameworkGetSeedColumnsFromCSV(csvPath: string): string[] {
  try {
    if (!fs.existsSync(csvPath)) {
      return [];
    }
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const firstLine = fileContent.split('\n')[0];
    if (!firstLine) {
      return [];
    }
    const columns: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        columns.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else if (char !== '\r') {
        current += char;
      }
    }
    if (current) {
      columns.push(current.trim().replace(/^"|"$/g, ''));
    }
    return columns.filter((col) => col.length > 0);
  } catch {
    return [];
  }
}

/**
 * Normalize a source column's manifest meta into the shape used by model
 * columns internally (and emitted in model YAML).
 *
 * Source YAML stores Lightdash config nested under `meta.lightdash.*`, while
 * model YAML stores it flat as `meta.dimension` / `meta.case_sensitive`
 * (see `frameworkSourceProperties` vs `frameworkModelProperties` in
 * `sql-utils.ts`). When a downstream model inherits a source column, we
 * promote the nested keys up so the rest of the pipeline (inheritance,
 * `mergeDeep`, YAML emit) can treat source- and model-origin columns
 * uniformly. Existing flat keys on the meta always win over promoted ones.
 */
function normalizeSourceColumnMeta(
  meta: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  const lightdash = (meta?.lightdash ?? null) as {
    dimension?: unknown;
    case_sensitive?: unknown;
  } | null;
  if (lightdash?.dimension && next.dimension === undefined) {
    next.dimension = lightdash.dimension;
  }
  if (
    lightdash?.case_sensitive !== undefined &&
    next.case_sensitive === undefined
  ) {
    next.case_sensitive = lightdash.case_sensitive;
  }
  delete next.lightdash;
  return next;
}

/**
 * Get node columns with expressions
 *
 * @see utils.ts:1361-1410
 */
export function frameworkGetNodeColumns({
  exclude,
  from,
  include,
  project,
  useCsvFallback = true,
}: {
  exclude?: (string | FrameworkColumn)[];
  from: { model: string; alias?: string } | { source: string };
  include?: (string | FrameworkColumn)[];
  project: DbtProject;
  useCsvFallback?: boolean;
}): {
  columns: FrameworkColumn[];
  dimensions: FrameworkColumn[];
  facts: FrameworkColumn[];
} {
  exclude = exclude?.map((e) => (typeof e === 'string' ? e : e.name)) ?? [];
  include = include?.map((e) => (typeof e === 'string' ? e : e.name)) ?? [];

  const node = frameworkGetNode({ project, ...from });

  const columns: FrameworkColumn[] = [];

  const hasNoManifestColumns =
    !node?.columns || Object.keys(node.columns).length === 0;
  const isSeed = node?.resource_type === 'seed';

  if (hasNoManifestColumns && isSeed && 'model' in from && useCsvFallback) {
    const seedId = `seed.${project.name}.${from.model}`;
    const seedNode = project.manifest.nodes?.[seedId];

    if (seedNode?.original_file_path) {
      const csvPath = path.join(
        project.pathSystem,
        seedNode.original_file_path,
      );
      const csvColumns = frameworkGetSeedColumnsFromCSV(csvPath);

      for (const colName of csvColumns) {
        if (exclude?.length && exclude?.includes(colName)) {
          continue;
        }
        if (include?.length && !include?.includes(colName)) {
          continue;
        }

        columns.push({
          name: colName,
          description: '',
          tags: [],
          meta: { type: 'dim' },
          internal: {},
        });
      }
    }
  } else {
    const isSource = 'source' in from;
    for (const [name, c] of Object.entries(node?.columns ?? {})) {
      if (exclude.length && exclude.includes(name)) {
        continue;
      }
      if (include.length && !include.includes(name)) {
        continue;
      }
      if (!c?.meta?.type) {
        c.meta = { ...c.meta, type: 'dim' };
      }
      const rawMeta = isSource
        ? (normalizeSourceColumnMeta(
            c.meta as unknown as Record<string, unknown>,
          ) as typeof c.meta)
        : c.meta;
      // Defensively strip SQL-internal keys (`agg`, `aggs`, `prefix`,
      // `expr`, `interval`, `exclude_from_group_by`, `override_suffix_agg`)
      // from upstream YAML in case any legacy `.yml` files still carry
      // them under `meta`. New framework writes these to `.internal`
      // during processing only; the upstream's SQL-generation state
      // should never flow into a downstream model's inherited meta.
      // `interval` is the one exception that must round-trip via the
      // upstream catalog so downstream models can detect when a CTE/
      // model is already at the requested datetime granularity (drives
      // the `date_trunc` skip in `frameworkBuildDatetimeColumn`).
      const {
        agg: _agg,
        aggs: _aggs,
        prefix: _prefix,
        expr: _expr,
        interval,
        exclude_from_group_by: _excludeFromGroupBy,
        override_suffix_agg: _overrideSuffixAgg,
        ...meta
      } = rawMeta as Record<string, unknown>;
      const internal: FrameworkColumn['internal'] = {};
      if (
        interval === 'day' ||
        interval === 'hour' ||
        interval === 'month' ||
        interval === 'year'
      ) {
        internal.interval = interval;
      }
      columns.push({
        name,
        data_type: c.data_type,
        description: c.description,
        tags: c.tags || [],
        meta: meta as FrameworkColumn['meta'],
        internal,
      });
    }
  }

  return {
    columns,
    dimensions: columns.filter((c) => c.meta.type === 'dim'),
    facts: columns.filter((c) => c.meta.type === 'fct'),
  };
}

/**
 * Get rollup inputs for datetime-based model aggregation
 *
 * @see utils.ts:1412-1484
 * @circular Calls frameworkProcessSelected
 */
export function frameworkGetRollupInputs({
  dj,
  model,
  modelJson,
  project,
  rollup,
}: {
  dj: DJ;
  model: string;
  modelJson: FrameworkModel;
  project: DbtProject;
  rollup: { interval: 'hour' | 'day' | 'month' | 'year' };
}): {
  columns: FrameworkColumn[];
  exclude: FrameworkDims[];
  include: FrameworkPartitionName[];
} {
  const fromDatetime = frameworkGetNodeColumns({
    from: { model },
    include: ['datetime'],
    project,
  }).columns[0];
  const columns: FrameworkColumn[] = [];
  const exclude: ('datetime' | FrameworkPartitionName)[] = ['datetime'];
  const partitions: FrameworkPartitionName[] = [
    PARTITION_MONTHLY,
    PARTITION_DAILY,
    PARTITION_HOURLY,
  ];

  let newDatetimeExpr = '';

  switch (rollup.interval) {
    case 'hour':
      newDatetimeExpr = "date_trunc('hour', datetime)";
      break;
    case 'day':
      exclude.push(PARTITION_HOURLY);
      newDatetimeExpr = "date_trunc('day', datetime)";
      break;
    case 'month':
      exclude.push(PARTITION_DAILY);
      exclude.push(PARTITION_HOURLY);
      newDatetimeExpr = "date_trunc('month', datetime)";
      break;
    case 'year':
      exclude.push(PARTITION_DAILY);
      exclude.push(PARTITION_HOURLY);
      exclude.push(PARTITION_MONTHLY);
      newDatetimeExpr = "date_trunc('year', datetime)";
      break;
  }
  if (newDatetimeExpr) {
    columns.push(
      ...frameworkProcessSelected({
        existingColumns: columns,
        dj,
        fromColumn: fromDatetime,
        modelJson,
        modelMetrics: {},
        prefix: null,
        project,
        selected: { name: 'datetime', interval: rollup.interval },
      }).columns,
    );
  }
  return {
    columns,
    exclude,
    include: partitions.filter((p) => !exclude.includes(p)),
  };
}

/**
 * Get partition columns for a model
 *
 * @see utils.ts:1251-1287
 */
export function frameworkGetModelPartitions({
  datetimeInterval,
  dj,
  project,
  model,
  modelJson,
}: {
  datetimeInterval: 'hour' | 'day' | 'month' | 'year' | null;
  dj: DJ;
  project: DbtProject;
  model: string;
  modelJson: FrameworkModel;
}): FrameworkColumn[] {
  const exclude: FrameworkDims[] = [];
  if (datetimeInterval) {
    exclude.push(
      ...frameworkGetRollupInputs({
        dj,
        model,
        modelJson,
        project,
        rollup: { interval: datetimeInterval },
      }).exclude,
    );
  }
  const from = frameworkGetNodeColumns({
    exclude,
    from: { model },
    include: [PARTITION_MONTHLY, PARTITION_DAILY, PARTITION_HOURLY],
    project,
  });
  return from.columns;
}

/**
 * Inherit column properties
 *
 * When a downstream model inherits a column from an upstream model (via
 * `all_from_model`, `dims_from_model`, `fcts_from_model`, CTE bulk
 * selects, auto-inherited partition/count columns, etc.), we clear the
 * entire `internal` bag on the upstream column before layering the
 * downstream's new `internal` state (e.g. a join prefix, or `agg:count`
 * for portal_source_count). This is critical: the upstream's SQL
 * generation state (`agg`, `expr`, `prefix`, `override_suffix_agg`,
 * `exclude_from_group_by`, `aggs`) describes how the UPSTREAM produced
 * the column -- downstream should only see the resulting column name and
 * re-wrap it with its own internal state.
 *
 * `meta` (user-facing: dimension, metrics, case_sensitive, origin, plus
 * any free-form user keys) IS inherited through `mergeDeep` semantics so
 * Lightdash dimension config and custom metrics flow downstream.
 *
 * @see utils.ts:1904-1937
 */
export function frameworkInheritColumn(
  col: FrameworkColumn,
  merge?: Partial<Omit<FrameworkColumn, 'meta' | 'internal'>> & {
    meta?: Partial<FrameworkColumn['meta']>;
    internal?: Partial<FrameworkColumn['internal']>;
    tags?: string[];
  },
): FrameworkColumn {
  col.name = merge?.name || col.name;
  col.data_type = merge?.data_type || col.data_type;
  col.description = merge?.description || col.description;
  col.tags = _.union(col.tags, merge?.tags);
  // Don't propagate this legacy key (description was never a meta field,
  // but defensive strip kept for safety against older YAML).
  if ('description' in col.meta) {
    delete (col.meta as Record<string, unknown>).description;
  }
  col.meta = { ...col.meta, ...merge?.meta };
  // `internal` is framework-private per-model SQL-gen state and is never
  // inherited from upstream. Replace wholesale with merged-in values
  // (typically a new prefix for a join, or `agg: 'count'` for
  // portal_source_count in aggregating downstream models).
  col.internal = { ...(merge?.internal ?? {}) };
  return col;
}

/**
 * Inherit columns properties
 *
 * @see utils.ts:1939-1946
 */
export function frameworkInheritColumns(
  cols: FrameworkColumn[],
  merge?: Partial<Omit<FrameworkColumn, 'meta' | 'internal'>> & {
    meta?: Partial<FrameworkColumn['meta']>;
    internal?: Partial<FrameworkColumn['internal']>;
  },
): FrameworkColumn[] {
  return cols.map((col) => frameworkInheritColumn(col, merge));
}

/**
 * Inherit model metrics
 *
 * @see utils.ts:1948-1960
 */
export function frameworkInheritModel({
  model,
  project,
}: {
  model: string;
  project: DbtProject;
}): { metrics: LightdashMetrics } {
  const node = frameworkGetNode({ project, model });
  if (node?.resource_type !== 'model') {
    return { metrics: {} };
  }
  return { metrics: node.meta?.metrics || {} };
}

/**
 * Inherit models metrics
 *
 * @see utils.ts:1962-1998
 */
export function frameworkInheritModels({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): {
  metrics: LightdashMetrics;
} {
  let metrics: LightdashMetrics = {};

  if ('from' in modelJson && 'model' in modelJson.from) {
    const baseModel = modelJson.from.model;
    metrics = {
      ...metrics,
      ...frameworkInheritModel({ model: baseModel, project }).metrics,
    };
    if ('join' in modelJson.from && modelJson.type !== 'int_join_column') {
      for (const join of modelJson.from.join ?? []) {
        if (!('model' in join)) {
          continue;
        }
        metrics = {
          ...metrics,
          ...frameworkInheritModel({ model: join.model, project }).metrics,
        };
      }
    }
    if ('union' in modelJson.from && 'models' in modelJson.from.union) {
      for (const model of modelJson.from.union.models ?? []) {
        metrics = {
          ...metrics,
          ...frameworkInheritModel({ model, project }).metrics,
        };
      }
    }
  }

  return { metrics };
}

/**
 * Collects all column names from upstream models (base, join, union)
 * by reading their manifest nodes. Used to identify columns that exist
 * upstream but may not be present in the downstream model.
 */
export function frameworkGetUpstreamColumnNames({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): Set<string> {
  const columnNames = new Set<string>();

  if ('from' in modelJson && 'model' in modelJson.from) {
    const baseNode = frameworkGetNode({
      project,
      model: modelJson.from.model,
    });
    if (baseNode?.columns) {
      for (const name of Object.keys(baseNode.columns)) {
        columnNames.add(name);
      }
    }
    if ('join' in modelJson.from && modelJson.type !== 'int_join_column') {
      for (const join of modelJson.from.join || []) {
        if (!('model' in join)) {
          continue;
        }
        const joinNode = frameworkGetNode({ project, model: join.model });
        if (joinNode?.columns) {
          for (const name of Object.keys(joinNode.columns)) {
            columnNames.add(name);
          }
        }
      }
    }
    if ('union' in modelJson.from && 'models' in modelJson.from.union) {
      for (const model of modelJson.from.union.models || []) {
        const unionNode = frameworkGetNode({ project, model });
        if (unionNode?.columns) {
          for (const name of Object.keys(unionNode.columns)) {
            columnNames.add(name);
          }
        }
      }
    }
  }

  return columnNames;
}

/**
 * Filters out metrics whose SQL references columns that are not present
 * in the downstream model. Metric references (${...}) are stripped before
 * checking, since those reference other metrics, not columns. Metrics
 * without a sql field are always kept.
 */
export function frameworkFilterMetricsBySql({
  metrics,
  downstreamColumnNames,
  upstreamColumnNames,
}: {
  metrics: LightdashMetrics;
  downstreamColumnNames: Set<string>;
  upstreamColumnNames: Set<string>;
}): LightdashMetrics {
  const missingColumns = [...upstreamColumnNames].filter(
    (col) => !downstreamColumnNames.has(col),
  );
  if (missingColumns.length === 0) {
    return metrics;
  }

  const filtered: LightdashMetrics = {};
  for (const [name, metric] of Object.entries(metrics)) {
    if (!metric.sql) {
      filtered[name] = metric;
      continue;
    }
    const sqlWithoutMetricRefs = metric.sql.replace(/\$\{[^}]+\}/g, '');
    const referencesMissingColumn = missingColumns.some((col) =>
      new RegExp(`\\b${_.escapeRegExp(col)}\\b`).test(sqlWithoutMetricRefs),
    );
    if (!referencesMissingColumn) {
      filtered[name] = metric;
    }
  }
  return filtered;
}

/**
 * Get aggregation suffix from column name
 *
 * @see utils.ts:3797-3801
 */
export function frameworkSuffixAgg(name: string): FrameworkColumnAgg | null {
  const nameParts = name.split('_');
  const suffix = nameParts[nameParts.length - 1] as FrameworkColumnAgg;
  return FRAMEWORK_AGGS.includes(suffix) ? suffix : null;
}

/**
 * Get partition column names for a model
 *
 * @see utils.ts:1189-1213
 */
export function frameworkGetPartitionColumnNames({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): string[] {
  const parentMeta = frameworkGetParentMeta({ modelJson, project }) as {
    portal_partition_columns?: string[];
  } | null;
  const partitionColumnsParent = parentMeta?.portal_partition_columns;
  const partitionColumnsModel =
    ('materialization' in modelJson &&
      typeof modelJson.materialization === 'object' &&
      modelJson.materialization &&
      'partitions' in modelJson.materialization &&
      modelJson.materialization?.partitions) ||
    ('partitioned_by' in modelJson && modelJson.partitioned_by);
  const partitionColumnsDefault: FrameworkPartitionName[] = [
    PARTITION_MONTHLY,
    PARTITION_DAILY,
    PARTITION_HOURLY,
  ];
  // Set in order of priority
  const partitionColumnNames =
    partitionColumnsModel || partitionColumnsParent || partitionColumnsDefault;
  return partitionColumnNames;
}

/**
 * Superset of `FRAMEWORK_AGGS` used purely for expression-level recognition.
 * `FRAMEWORK_AGGS` remains the list of user-facing `agg` values (the suffixes
 * `frameworkResolveAgg` knows about); this list adds the raw Trino aggregate
 * function names that show up inside `expr` strings -- including the HLL /
 * T-Digest merge kernels the framework itself emits for re-aggregation.
 *
 * Without `merge`, `approx_set`, and `tdigest_agg`, hand-written `expr`
 * values like `cast(merge(cast(col as hyperloglog)) as varbinary)` get
 * flagged as un-aggregated by `validateMainModelAggregation`, even though
 * they reduce rows the same way `agg: "hll"` does.
 *
 * The `AGGREGATE_EXPR_SUFFIX_REGEX` below complements this list by matching
 * Trino's `*_agg` naming convention (array_agg, map_agg, set_agg,
 * reduce_agg, bitwise_and_agg, multimap_agg, etc.) and user-defined UDAFs
 * that follow the same convention.
 */
const AGGREGATE_EXPR_FUNCTIONS = [
  ...FRAMEWORK_AGGS,
  // Average isn't in FRAMEWORK_AGGS (no `avg` suffix convention) but shows up
  // often inside hand-written expressions.
  'avg',
  // Raw-input sketch kernels the framework emits for `agg: "hll"` /
  // `agg: "tdigest"`. Users occasionally copy these into `expr` manually.
  'approx_set',
  'tdigest_agg',
  // Sketch-merge kernel. This is the common one: pre-aggregated HLL /
  // T-Digest columns are re-combined with `merge(cast(... as hyperloglog))`.
  'merge',
  // `any_value` / `arbitrary` both reduce rows to a single arbitrary value
  // per group and are a legitimate alternative to wrapping a dimension-ish
  // column with `agg`. Trino accepts both names.
  'any_value',
  'arbitrary',
  // Row-pick aggregates: return the value of one column at the row where
  // another column is min/max. Common for "winning row" patterns.
  'max_by',
  'min_by',
  // Boolean aggregates.
  'bool_and',
  'bool_or',
  'every',
  // Conditional counting / summing.
  'count_if',
  'sum_if',
  // Approximate aggregates beyond the sketch kernels above.
  'approx_distinct',
  'approx_percentile',
  'approx_most_frequent',
  // Dispersion statistics.
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'variance',
  'var_pop',
  'var_samp',
  'geometric_mean',
  // Bivariate statistics.
  'corr',
  'covar_pop',
  'covar_samp',
  // String concatenation aggregate.
  'listagg',
  // Row-hash aggregate.
  'checksum',
  // Histograms.
  'histogram',
  'numeric_histogram',
];

/**
 * Matches any function call whose name ends in `_agg` (Trino's aggregate
 * naming convention). Covers `array_agg`, `map_agg`, `multimap_agg`,
 * `set_agg`, `reduce_agg`, `bitwise_and_agg`, `bitwise_or_agg`,
 * `bitwise_xor_agg`, `tdigest_agg`, and user-defined UDAFs following the
 * same convention. The negative lookahead on `over (` guards against window
 * functions that happen to end in `_agg`.
 */
const AGGREGATE_EXPR_SUFFIX_REGEX = /\b\w*_agg\s*\([^)]+\)(?!\s*over\s*\()/i;

/**
 * Check if an expression contains an aggregate function
 *
 * @see utils.ts:1858-1863
 */
export function isAggregateExpr(expr?: string): boolean {
  if (!expr) {
    return false;
  }
  const haystack = expr.toLowerCase().trim();
  if (AGGREGATE_EXPR_SUFFIX_REGEX.test(haystack)) {
    return true;
  }
  return AGGREGATE_EXPR_FUNCTIONS.some((agg) => {
    // The `[^)]+` inside is intentionally narrow: we just need evidence the
    // aggregate is actually called (open paren with at least one non-`)`
    // character). `(?!\\s*over\\s*\\()` guards against window-function usage,
    // which is a row-wise transform, not a row reduction.
    const aggRegex = new RegExp(
      `\\b${agg}\\s*\\([^)]+\\)(?!\\s*over\\s*\\()`,
      'i',
    );
    return aggRegex.test(haystack);
  });
}

// Numeric literal: `0`, `-1.5`, `42`.
const CONSTANT_NUMERIC_REGEX = /^-?\d+(\.\d+)?$/;
// SQL string literal: `'foo'` or `"foo"` (no embedded quotes).
const CONSTANT_STRING_REGEX = /^('[^']*'|"[^"]*")$/;
// `CAST(<literal> AS <type>)` where `<literal>` is null, numeric, or string,
// and `<type>` is an identifier optionally followed by `(...)` for length/
// precision (e.g. `varchar(50)`, `decimal(10, 2)`).
const CONSTANT_CAST_REGEX =
  /^cast\s*\(\s*(null|-?\d+(\.\d+)?|'[^']*'|"[^"]*")\s+as\s+\w+(\s*\([^)]*\))?\s*\)$/i;

/**
 * Returns true when `expr` is a SQL constant with no column dependencies:
 * numeric literal, `null`/`NULL`, quoted string, or `CAST(<literal> AS <type>)`.
 * Such expressions cannot conflict with `GROUP BY`, so they are safe to skip
 * in main-model aggregation validation.
 */
export function isConstantExpr(expr?: string): boolean {
  if (!expr) {
    return false;
  }
  const haystack = expr.trim();
  if (!haystack) {
    return false;
  }
  if (haystack.toLowerCase() === 'null') {
    return true;
  }
  if (CONSTANT_NUMERIC_REGEX.test(haystack)) {
    return true;
  }
  if (CONSTANT_STRING_REGEX.test(haystack)) {
    return true;
  }
  return CONSTANT_CAST_REGEX.test(haystack);
}

/**
 * Returns true when `expr` contains Jinja templating (`{{ ... }}` or
 * `{% ... %}`). The framework cannot inspect macro expansions, so any Jinja
 * `expr` is treated as opaque-aggregated to avoid false-positive
 * "un-aggregated" diagnostics.
 */
export function isJinjaExpr(expr?: string): boolean {
  if (!expr) {
    return false;
  }
  return /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/.test(expr);
}

/**
 * Returns true when `expr` looks like a window function: a bare function call
 * followed by `OVER (`. Used by validators to switch the diagnostic wording
 * (window functions are row-wise, so `agg`/`aggs` aren't applicable).
 */
export function isWindowFunctionExpr(expr?: string): boolean {
  if (!expr) {
    return false;
  }
  return /\b\w+\s*\([\s\S]*?\)\s*over\s*\(/i.test(expr);
}

/**
 * Check if a model has aggregation
 *
 * @see utils.ts:1865-1885
 */
export function frameworkModelHasAgg({
  modelJson,
}: {
  modelJson: FrameworkModel;
}): boolean {
  return !!(
    ('group_by' in modelJson &&
      (typeof modelJson.group_by === 'string' || modelJson.group_by?.length)) ||
    ('rollup' in modelJson.from && modelJson.from.rollup) ||
    ('lookback' in modelJson.from && modelJson.from.lookback) ||
    ('select' in modelJson &&
      modelJson.select?.some(
        (c) =>
          typeof c === 'object' &&
          !!(
            ('agg' in c && c.agg) ||
            ('aggs' in c && c.aggs) ||
            ('expr' in c && c.expr && isAggregateExpr(c.expr))
          ),
      ))
  );
}
