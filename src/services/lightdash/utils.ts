import { FRAMEWORK_AGGS } from '@services/framework/constants';
import {
  frameworkBuildModelTags,
  frameworkColumnName,
} from '@services/framework/utils';
import type { DJ } from '@shared';
import { assertExhaustive, mergeDeep, textToStartCase } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type {
  FrameworkColumn,
  FrameworkColumnAgg,
  FrameworkDataType,
  FrameworkModel,
  FrameworkSelected,
} from '@shared/framework/types';
import type {
  LightdashDimension,
  LightdashMetric,
  LightdashMetrics,
} from '@shared/lightdash/types';
import * as _ from 'lodash';

export function lightdashBuildMetrics({
  column,
  dj,
  modelJson,
  project,
  selected,
  skipCustom,
}: {
  column: FrameworkColumn;
  dj: DJ;
  modelJson: FrameworkModel;
  project: DbtProject;
  selected: FrameworkSelected;
  skipCustom?: boolean; // Use this is we're creating multiple agg columns with the metrics and only want to attach custom ones to the first
}): { column: LightdashMetrics; model: LightdashMetrics } {
  const metrics: {
    column: LightdashMetrics;
    model: LightdashMetrics;
  } = {
    column: {},
    model: {},
  };

  // Build AI Hint Tags
  const tags = frameworkBuildModelTags({ modelJson, project });
  let aiHintTags = [...tags.aiHints];
  if (dj.config.aiHintTag) {
    aiHintTags = _.union(aiHintTags, [dj.config.aiHintTag]);
  }

  if (
    typeof selected === 'object' &&
    'lightdash' in selected &&
    selected.lightdash &&
    'metrics' in selected.lightdash
  ) {
    const metricsMerge = (selected.lightdash.metrics_merge ||
      {}) as LightdashMetric;
    for (const _metric of selected.lightdash.metrics || []) {
      if (typeof _metric === 'string') {
        const columnAgg = column.internal?.agg;
        const nameAgg: FrameworkColumnAgg | null =
          (new RegExp(`_(${FRAMEWORK_AGGS.join('|')})$`).exec(
            column.name,
          )?.[1] as FrameworkColumnAgg) || null;
        const agg = columnAgg || nameAgg;
        const groupLabel =
          metricsMerge.group_label || column.meta.dimension?.group_label;
        const groups = metricsMerge.groups || column.meta.dimension?.groups;
        const metricAgg = _metric;
        switch (metricAgg) {
          case 'avg': {
            // Avg needs both sum and count, so we're creating this metric at the model level
            const nameBase = column.name;
            const metricName = `metric_${nameBase}_${metricAgg}`;
            const label = `${textToStartCase(nameBase)} Avg`;
            const readableName = textToStartCase(nameBase);
            metrics.model[metricName] = {
              ...metricsMerge,
              type: 'number',
              label,
              sql: `case when sum(${nameBase}_count) = 0 then 0 else sum(${nameBase}_sum) / sum(${nameBase}_count) end`,
              ...(groupLabel ? { group_label: groupLabel } : {}),
              ...(groups ? { groups } : {}),
              ...(!metricsMerge.description
                ? { description: `Average of ${readableName}` }
                : {}),
            };
            break;
          }
          case 'count': {
            if (agg === metricAgg) {
              const nameBase = column.name.replace(new RegExp(`_${agg}$`), '');
              const metricName = `metric_${nameBase}_${metricAgg}`;
              const label = `${textToStartCase(frameworkColumnName({ column, modelJson }))}`;
              const readableName = textToStartCase(nameBase);
              const metricBase = {
                ...metricsMerge,
                ...(groupLabel ? { group_label: groupLabel } : {}),
                ...(groups ? { groups } : {}),
                label,
                ...(!metricsMerge.description
                  ? { description: `Total count of ${readableName}` }
                  : {}),
              };
              if (nameAgg === 'count') {
                // If the input column already has a count agg, then going forward we'll sum it
                metrics.column[metricName] = { ...metricBase, type: 'sum' };
              } else {
                metrics.column[metricName] = { ...metricBase, type: 'count' };
              }
            }
            break;
          }
          case 'max':
          case 'min':
          case 'sum': {
            if (agg === metricAgg) {
              const nameBase = column.name.replace(new RegExp(`_${agg}$`), '');
              const metricName = `metric_${nameBase}_${metricAgg}`;
              const label = `${textToStartCase(frameworkColumnName({ column, modelJson }))}`;
              const readableName = textToStartCase(nameBase);
              const descriptionPrefixes: Record<string, string> = {
                max: 'Maximum of',
                min: 'Minimum of',
                sum: 'Sum of',
              };
              metrics.column[metricName] = {
                ...metricsMerge,
                ...(groupLabel ? { group_label: groupLabel } : {}),
                ...(groups ? { groups } : {}),
                label,
                type: metricAgg,
                ...(!metricsMerge.description
                  ? {
                      description: `${descriptionPrefixes[metricAgg]} ${readableName}`,
                    }
                  : {}),
              };
            }
            break;
          }
          case 'distinctcount': {
            if (agg === 'hll') {
              const nameBase = column.name.replace(new RegExp(`_${agg}$`), '');
              const metricName = `metric_${nameBase}_${metricAgg}`;
              const label = `${textToStartCase(nameBase)} Count Distinct`;
              const readableName = textToStartCase(nameBase);
              metrics.column[metricName] = {
                ...metricsMerge,
                ...(groupLabel ? { group_label: groupLabel } : {}),
                ...(groups ? { groups } : {}),
                type: 'number',
                label,
                sql: `cardinality(merge(cast(${frameworkColumnName({ column, modelJson })} as hyperloglog)))`,
                ...(!metricsMerge.description
                  ? { description: `Count of distinct ${readableName} values` }
                  : {}),
              };
            }
            break;
          }
          case 'p50':
          case 'p90':
          case 'p95':
          case 'p98': {
            // Log.info({ metric, name: column.name, nameAgg });
            if (agg === 'tdigest') {
              const nameBase = column.name.replace(new RegExp(`_${agg}$`), '');
              const metricName = `metric_${nameBase}_${metricAgg}`;
              const percentile = metricAgg.replace('p', '');
              const readableName = textToStartCase(nameBase);
              const percentilePrefixes: Record<string, string> = {
                p50: '50th percentile of',
                p90: '90th percentile of',
                p95: '95th percentile of',
                p98: '98th percentile of',
              };
              metrics.column[metricName] = {
                ...metricsMerge,
                type: 'number',
                label: `${textToStartCase(nameBase)} P${percentile}`,
                sql: `value_at_quantile(merge(cast(${frameworkColumnName({ column, modelJson })} as tdigest)), 0.${percentile})`,
                ...(groupLabel ? { group_label: groupLabel } : {}),
                ...(groups ? { groups } : {}),
                ...(!metricsMerge.description
                  ? {
                      description: `${percentilePrefixes[metricAgg]} ${readableName}`,
                    }
                  : {}),
              };
            }
            break;
          }
        }
      } else {
        if (skipCustom) {
          continue;
        }
        const { name: metricName, ...metric } = _metric;
        metrics.column[metricName] = mergeDeep(metricsMerge, metric);
      }
    }
  }

  // If model or column level metric has an ai_hint, automatically add an 'ai' tag
  metrics.column = _.reduce(
    metrics.column,
    (m, metric, name) => {
      if (aiHintTags && metric?.ai_hint) {
        metric.tags = _.union(metric.tags || [], aiHintTags);
      }
      metric.tags?.sort();
      return { ...m, [name]: metric };
    },
    {},
  );
  return metrics;
}

export function lightdashConvertDimensionType(
  frameworkType?: FrameworkDataType,
): LightdashDimension['type'] {
  if (!frameworkType) {
    return 'string';
  }
  switch (frameworkType) {
    case 'bigint':
    case 'double':
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
    case 'timestamp':
    case 'timestamp(0)':
    case 'timestamp(3)':
    case 'timestamp(6)':
      return 'timestamp';
    case 'string':
    case 'varchar':
      return 'string';
    // These shouldn't reach the lightdash layer
    case 'row(date)':
    case 'row(varchar)':
      return 'string';
    default:
      return assertExhaustive(frameworkType, 'string');
  }
}
