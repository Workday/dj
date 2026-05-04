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
    };
    if (shouldAdd(newColumn)) {
      newColumns.push(newColumn);
    }
  } else if (!('name' in selected)) {
    // If we don't have a name, we can't process this
  } else {
    // Building the new column properties that will override the inherited ones
    const selectedColumn: FrameworkColumn = {
      name: selected.name,
      meta: { type: selected.type || 'dim' },
    };
    if ('data_type' in selected && selected.data_type) {
      selectedColumn.data_type = selected.data_type;
    }
    if ('description' in selected && selected.description) {
      selectedColumn.description = selected.description;
    }
    if ('exclude_from_group_by' in selected && selected.exclude_from_group_by) {
      selectedColumn.meta.exclude_from_group_by =
        selected.exclude_from_group_by;
    }
    if ('expr' in selected && selected.expr) {
      selectedColumn.meta.expr = selected.expr;
    }
    if ('interval' in selected && selected.interval) {
      selectedColumn.meta.interval = selected.interval;
    }
    // We'll handle the lightdash metrics separately
    if ('lightdash' in selected && selected.lightdash?.dimension) {
      selectedColumn.meta.dimension = selected.lightdash.dimension;
    }
    if ('override_suffix_agg' in selected && selected.override_suffix_agg) {
      selectedColumn.meta.override_suffix_agg = !!selected.override_suffix_agg;
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
      selectedColumn.meta.prefix = prefix;
    }

    // In this scenario, we're creating a new column for each agg
    if ('aggs' in selected && selected.aggs) {
      let skipCustom = false;
      for (const agg of selected.aggs) {
        const aggColumn: FrameworkColumn = mergeDeep(selectedColumn, {
          data_type: 'number',
          meta: { agg }, // This agg key will append to the column name
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
        const sourceInterval =
          fromColumn?.meta && 'interval' in fromColumn.meta
            ? fromColumn.meta.interval ?? null
            : null;
        const built = frameworkBuildDatetimeColumn({
          interval: selected.interval,
          prefix,
          sourceInterval,
          userDimension: selected.lightdash?.dimension,
        });
        selectedColumn.meta.interval = built.interval;
        selectedColumn.meta.dimension = built.dimension;
        if (built.expr) {
          selectedColumn.meta.expr = built.expr;
        }
      } else {
        if ('agg' in selected && selected.agg) {
          selectedColumn.data_type = 'number';
          selectedColumn.meta.agg = selected.agg;
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
      // Strip agg metadata from CTE-sourced columns: aggregation was already
      // applied inside the CTE's SQL. Without stripping, mergeDeep would carry
      // the agg into the main model and wrap the column in a duplicate sum/count/etc.
      const from =
        fromCte && cteColumnRegistry
          ? (() => {
              const stripCteAgg = (c: FrameworkColumn): FrameworkColumn => {
                const { agg: _agg, ...restMeta } = (c.meta || {}) as Record<
                  string,
                  unknown
                >;
                return { ...c, meta: restMeta as FrameworkColumn['meta'] };
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
                (cteColumnRegistry.get(fromCte) || []).map(stripCteAgg),
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
              meta: { ...(prefix && { prefix }) },
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
              meta: { ...(prefix && { prefix }) },
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
              meta: { ...(prefix && { prefix }) },
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
  }

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
        'interval' in c.meta && c.name === 'datetime'
          ? c.meta.interval || undefined
          : null,
      );
      datetimeInterval =
        (datetimeIntervalColumn &&
          'interval' in datetimeIntervalColumn.meta &&
          datetimeIntervalColumn.meta.interval) ||
        null;
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
        meta: { ...(basePrefix && { prefix: basePrefix }) },
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
        meta: {
          ...(basePrefix && { prefix: basePrefix }),
          ...(modelHasAgg && { agg: 'count' }),
        },
      },
    );
    columns.push(...frameworkCounts);
  }

  // Remove portal_source_count if it's excluded
  if (modelJson.exclude_portal_source_count) {
    columns = columns.filter((c) => c.name !== 'portal_source_count');
  }

  // Sort alphabetically with partition columns at the end
  const partitionColumnNames = frameworkGetPartitionColumnNames({
    modelJson,
    project,
  });
  columns = sortColumnsWithPartitionsLast(columns, partitionColumnNames);

  // Strip partition columns entirely when the model opts out
  if (modelJson.exclude_portal_partition_columns) {
    columns = columns.filter((c) => !partitionColumnNames.includes(c.name));
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
      meta: { expr: '_ext_event_date', type: 'dim' },
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
  if (dt?.meta && 'interval' in dt.meta && dt.meta.interval) {
    return dt.meta.interval;
  }
  return null;
}

/**
 * Infers output columns for a CTE by analyzing its select items.
 * Unlike external models, CTEs have no manifest entry, so their schema
 * must be derived from the select definition at generation time.
 * Aggregated columns are stored with their suffixed name (e.g. cost_sum)
 * and agg metadata so downstream SQL generation can reference them correctly.
 */
export function frameworkInferCteColumns({
  cte,
  cteRegistry,
  modelId,
  project,
}: {
  cte: FrameworkCTE;
  cteRegistry: CteColumnRegistry;
  modelId?: string | null;
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
        columns.push({ ...inherited });
      } else {
        const inheritedType = (sourceTypeMap.get(item) ?? 'dim') as
          | 'dim'
          | 'fct';
        columns.push({ name: item, meta: { type: inheritedType } });
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
      columns.push(...ordered.map((c) => ({ ...c })));
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
        const sourceInterval =
          sourceCol?.meta && 'interval' in sourceCol.meta
            ? sourceCol.meta.interval ?? null
            : null;
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
            interval: built.interval,
          },
        };
        if (built.expr) {
          selectedColumn.meta.expr = built.expr;
        }
        // Forward description, data_tests, case_sensitive, override_suffix_agg,
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
      // scalar meta (case_sensitive, override_suffix_agg, etc.) collected
      // onto `col` above, matching the main-model `mergeDeep` path.
      if (aggs) {
        for (const a of aggs) {
          const resolved = frameworkResolveAgg({
            agg: a,
            name,
            overrideSuffixAgg: col.meta.override_suffix_agg,
          });
          const aggCol: FrameworkColumn = {
            ...col,
            name: resolved.outputName,
            meta: { ...col.meta, agg: a, type: 'fct' },
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
          overrideSuffixAgg: col.meta.override_suffix_agg,
        });
        col.name = resolved.outputName;
        col.meta.agg = agg;
      }
      if (modelId && !col.meta.origin?.id) {
        col.meta.origin = { id: modelId };
      }
      columns.push(col);
      continue;
    }
  }

  // Mirror the main-model datetime + partition auto-injection (see L727-744
  // in this file) for CTEs whose FROM is a plain model reference. Without
  // this, a `dims_from_model` bulk select with a small `include` list, or a
  // pre-aggregation CTE that only enumerates non-partition dims, silently
  // drops `portal_partition_*` (and `datetime`), and downstream materialization
  // fails because `partitioned_by` can't find the columns.
  const autoDims = frameworkShouldAutoInjectCteFrameworkDims({
    cte,
    alreadyPresentNames: columns.map((c) => c.name),
    project,
  });
  if (autoDims) {
    const upstream = frameworkGetNodeColumns({
      from: { model: autoDims.baseModel },
      include: autoDims.include,
      project,
      useCsvFallback: false,
    });
    // Framework-managed passthroughs: preserve whatever origin the upstream
    // had (typically none for `datetime` / `portal_partition_*`). Do NOT
    // stamp `modelId` here — that would cascade a spurious `meta.origin.id`
    // into every downstream YAML and diverge from the main-model auto-inject
    // behavior (see L727-744 in this file), which also leaves origin alone.
    const injected = frameworkInheritColumns(upstream.columns, {});
    columns.push(...injected);
  }

  // Mirror the main-model `portal_source_count` auto-injection (see L746-763
  // in this file) for CTEs whose FROM is a plain model reference. Without
  // this, a CTE that pre-aggregates a model silently drops the audit column
  // and downstream `all_from_cte` / `dims_from_cte` passthroughs can't put
  // it back. The SQL emitter (`frameworkGenerateCteSql`) uses the same
  // helper so the registry and the emitted SQL stay in lock-step.
  const autoPsc = frameworkShouldAutoInjectCtePortalSourceCount({
    cte,
    alreadyPresentNames: columns.map((c) => c.name),
    project,
  });
  if (autoPsc) {
    const upstream = frameworkGetNodeColumns({
      from: { model: autoPsc.baseModel },
      include: ['portal_source_count'],
      project,
      useCsvFallback: false,
    });
    const injected = frameworkInheritColumns(upstream.columns, {
      meta: {
        ...(autoPsc.applyAgg && { agg: 'count' }),
      },
    });
    for (const col of injected) {
      if (autoPsc.applyAgg) {
        const resolved = frameworkResolveAgg({
          agg: 'count',
          name: col.name,
          overrideSuffixAgg: col.meta.override_suffix_agg,
        });
        col.name = resolved.outputName;
      }
      if (modelId && !col.meta.origin?.id) {
        col.meta.origin = { id: modelId };
      }
    }
    columns.push(...injected);
  }

  return columns;
}

/**
 * Shared gate for the CTE `portal_source_count` auto-injection, used by both
 * the CTE column registry (`frameworkInferCteColumns`) and the CTE SQL
 * emitter (`frameworkGenerateCteSql`) so the two stay consistent.
 *
 * Auto-injection fires when:
 * - The CTE's FROM is a plain `{ model }` ref (no union, no cte chaining).
 * - The upstream model actually has `portal_source_count` in its catalog.
 * - The CTE's own select / bulk expansions haven't already pulled it in.
 *
 * `applyAgg` is true when the CTE aggregates (non-empty `group_by`), mirroring
 * the main-model `frameworkModelHasAgg` rule. The caller is responsible for
 * feeding `applyAgg` into `frameworkResolveAgg` / `frameworkBuildAggSql` so
 * the suffix-collision + merge-kernel semantics match the named-select path.
 */
export function frameworkShouldAutoInjectCtePortalSourceCount({
  cte,
  alreadyPresentNames,
  project,
}: {
  cte: FrameworkCTE;
  alreadyPresentNames: string[];
  project: DbtProject;
}): { baseModel: string; applyAgg: boolean } | null {
  if (!('model' in cte.from) || !cte.from.model) {
    return null;
  }
  if ('union' in cte.from) {
    return null;
  }
  if (alreadyPresentNames.includes('portal_source_count')) {
    return null;
  }

  const upstream = frameworkGetNodeColumns({
    from: { model: cte.from.model },
    include: ['portal_source_count'],
    project,
    useCsvFallback: false,
  });
  if (upstream.columns.length === 0) {
    return null;
  }

  const applyAgg = !!(typeof cte.group_by === 'string'
    ? cte.group_by.length > 0
    : Array.isArray(cte.group_by) && cte.group_by.length > 0);

  return { baseModel: cte.from.model, applyAgg };
}

/**
 * Shared gate for the CTE `datetime` + `portal_partition_*` auto-injection,
 * used by both the CTE column registry (`frameworkInferCteColumns`) and the
 * CTE SQL emitter (`frameworkGenerateCteSql`) so the two stay consistent.
 *
 * Mirrors the main-model behavior in `frameworkModelColumns` (see L727-744 in
 * this file): when a CTE sources from a plain `{ model }` ref, datetime and
 * the partition columns are considered framework-managed and are appended
 * automatically even if the user's select (or `dims_from_model` include list)
 * did not mention them. Without this, a CTE that pre-aggregates upstream
 * columns silently drops the partitions, and the downstream model fails at
 * materialization because `partitioned_by` can't find them.
 *
 * Auto-injection fires when:
 * - The CTE's FROM is a plain `{ model }` ref (no union, no cte chaining).
 * - The upstream model actually has the candidate column in its catalog.
 * - The CTE's own select hasn't already pulled the column in.
 * - The candidate is not excluded by the effective datetime interval
 *   (day → hourly dropped; month → daily+hourly dropped; year → all three).
 *
 * The effective datetime interval is determined from either an explicit
 * `{ name: 'datetime', interval: X }` entry in the CTE select, or by
 * falling back to the upstream column's own `meta.interval`.
 */
export function frameworkShouldAutoInjectCteFrameworkDims({
  cte,
  alreadyPresentNames,
  project,
}: {
  cte: FrameworkCTE;
  alreadyPresentNames: string[];
  project: DbtProject;
}): {
  baseModel: string;
  include: ('datetime' | FrameworkPartitionName)[];
} | null {
  if (!('model' in cte.from) || !cte.from.model) {
    return null;
  }
  if ('union' in cte.from) {
    return null;
  }

  const baseModel = cte.from.model;

  let datetimeInterval: FrameworkInterval | null = null;
  if (Array.isArray(cte.select)) {
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
  if (!datetimeInterval) {
    const upstreamDt = frameworkGetNodeColumns({
      from: { model: baseModel },
      include: ['datetime'],
      project,
      useCsvFallback: false,
    }).columns[0];
    if (
      upstreamDt?.meta &&
      'interval' in upstreamDt.meta &&
      upstreamDt.meta.interval
    ) {
      datetimeInterval = upstreamDt.meta.interval;
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

  const candidates: ('datetime' | FrameworkPartitionName)[] = [
    'datetime',
    PARTITION_MONTHLY,
    PARTITION_DAILY,
    PARTITION_HOURLY,
  ];
  const alreadyPresent = new Set(alreadyPresentNames);
  const missing = candidates.filter(
    (c) => !alreadyPresent.has(c) && !excluded.has(c),
  );
  if (missing.length === 0) {
    return null;
  }

  const upstream = frameworkGetNodeColumns({
    from: { model: baseModel },
    include: missing,
    project,
    useCsvFallback: false,
  });
  const upstreamNames = new Set(upstream.columns.map((c) => c.name));
  const include = missing.filter((c) => upstreamNames.has(c));
  if (include.length === 0) {
    return null;
  }

  return { baseModel, include };
}

/**
 * Builds the column registry by processing CTEs in declaration order.
 * Sequential processing allows later CTEs to reference earlier ones
 * (forward references are rejected by validateCtes).
 */
export function frameworkBuildCteColumnRegistry({
  ctes,
  modelId,
  partitionColumnNames,
  project,
}: {
  ctes: FrameworkCTE[];
  modelId?: string | null;
  partitionColumnNames?: string[];
  project: DbtProject;
}): CteColumnRegistry {
  const registry: CteColumnRegistry = new Map();
  for (const cte of ctes) {
    const columns = frameworkInferCteColumns({
      cte,
      cteRegistry: registry,
      modelId,
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
          expr: `cast(${eventDatetimeExpr} as timestamp(6))`,
          dimension: { label: 'Datetime', type: 'timestamp' },
        },
      });
    }
    if (!columns.find((c) => c.name === PARTITION_DAILY)) {
      sourceDateColumns.push({
        name: PARTITION_DAILY,
        data_type: 'date',
        description: 'Daily Partition Column',
        meta: {
          type: 'dim',
          expr: `date_trunc('day', cast(${eventDatetimeExpr} as date))`,
          dimension: { label: 'Portal Partition Daily' },
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
          expr: `date_trunc('hour', cast(${eventDatetimeExpr} as timestamp(6)))`,
          dimension: { label: 'Portal Partition Hourly' },
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
          expr: `date_trunc('month', cast(${eventDatetimeExpr} as date))`,
          dimension: { label: 'Portal Partition Monthly' },
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
        expr: '1',
        dimension: { label: 'Portal Source Count', hidden: true },
        metrics: {
          metric_portal_source_count: {
            type: 'sum',
            label: portalSourceCount?.metric_label || 'Portal Source Count',
          },
        },
      },
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
 * - `interval`: the chosen interval, to be stored on `col.meta.interval`.
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
      ? (sel.lightdash as { case_sensitive?: boolean; dimension?: unknown })
      : null
  ) as { case_sensitive?: boolean; dimension?: unknown } | null;
  if (ld?.dimension) {
    col.meta.dimension = ld.dimension as FrameworkColumn['meta']['dimension'];
  }
  if (ld?.case_sensitive !== undefined) {
    col.meta.case_sensitive = ld.case_sensitive;
  }

  if ('override_suffix_agg' in sel && sel.override_suffix_agg) {
    col.meta.override_suffix_agg = !!sel.override_suffix_agg;
  }

  if (!opts.hasAgg) {
    if ('expr' in sel && sel.expr) {
      col.meta.expr = sel.expr as string;
    }
    if ('exclude_from_group_by' in sel && sel.exclude_from_group_by) {
      col.meta.exclude_from_group_by = true;
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
  if (column.meta.expr) {
    return `${column.meta.expr} as ${column.name}`;
  }
  if (column.meta.prefix) {
    return `${column.meta.prefix}.${column.name} as ${column.name}`;
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
  const metaAgg = ('agg' in column.meta && column.meta.agg) || null;
  const rollupAgg =
    ('rollup' in modelJson.from &&
      column.meta.type === 'fct' &&
      !column.meta.expr &&
      frameworkSuffixAgg(column.name)) ||
    null;
  const newAgg = metaAgg || rollupAgg;
  if (!newAgg) {
    return column.name;
  }
  return frameworkResolveAgg({
    agg: newAgg,
    name: column.name,
    overrideSuffixAgg:
      'override_suffix_agg' in column.meta && column.meta.override_suffix_agg,
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
        });
      }
    }
  } else {
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
      const { agg: _agg, aggs: _aggs, prefix: _prefix, ...meta } = c.meta;
      columns.push({
        name,
        data_type: c.data_type,
        description: c.description,
        tags: c.tags || [],
        meta,
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
 * @see utils.ts:1904-1937
 */
export function frameworkInheritColumn(
  col: FrameworkColumn,
  merge?: Partial<Omit<FrameworkColumn, 'meta'>> & {
    meta?: Partial<FrameworkColumn['meta']>;
    tags?: string[];
  },
): FrameworkColumn {
  col.name = merge?.name || col.name;
  col.data_type = merge?.data_type || col.data_type;
  col.description = merge?.description || col.description;
  col.tags = _.union(col.tags, merge?.tags);
  // We never inherit these properties
  if ('agg' in col.meta) {
    delete col.meta.agg;
  }
  if ('aggs' in col.meta) {
    delete col.meta.aggs;
  }
  if ('description' in col.meta) {
    delete col.meta.description;
  } // Don't need to inherit on the meta
  if ('exclude_from_group_by' in col.meta) {
    delete col.meta.exclude_from_group_by;
  }
  if ('expr' in col.meta) {
    delete col.meta.expr;
  }
  if ('prefix' in col.meta) {
    delete col.meta.prefix;
  }
  //
  col.meta = { ...col.meta, ...merge?.meta };
  return col;
}

/**
 * Inherit columns properties
 *
 * @see utils.ts:1939-1946
 */
export function frameworkInheritColumns(
  cols: FrameworkColumn[],
  merge?: Partial<Omit<FrameworkColumn, 'meta'>> & {
    meta?: Partial<FrameworkColumn['meta']>;
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
