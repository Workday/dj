import type {
  SchemaLightdashDimension,
  SchemaLightdashMetric,
} from '@shared/schema/types/model.schema';
import React from 'react';

interface ColumnDetailsProps {
  selectItem: Record<string, unknown>;
}

export const ColumnDetails: React.FC<ColumnDetailsProps> = ({ selectItem }) => {
  // Extract expression
  const expression: string =
    ('expr' in selectItem ? String(selectItem.expr) : '') || '';

  // Extract aggregations
  const agg = 'agg' in selectItem ? selectItem.agg : undefined;
  const aggregations: string[] = [];
  if (agg) {
    if (typeof agg === 'string') {
      aggregations.push(agg);
    } else if (Array.isArray(agg)) {
      aggregations.push(...agg.map(String));
    }
  }

  // Extract Lightdash metadata
  const meta = (
    'lightdash' in selectItem ? selectItem.lightdash : undefined
  ) as Record<string, unknown> | undefined;
  const dimension = meta?.dimension as SchemaLightdashDimension | undefined;
  const metrics = meta?.metrics;

  // Separate string metrics from object metrics
  let stringMetrics: string[] = [];
  let objectMetrics: SchemaLightdashMetric[] = [];

  if (Array.isArray(metrics)) {
    stringMetrics = metrics.filter((m) => typeof m === 'string');
    objectMetrics = metrics.filter(
      (m) => typeof m === 'object' && m !== null,
    ) as SchemaLightdashMetric[];
  }

  return (
    <div className="bg-surface border-t border-border p-2 relative z-10">
      <div className="flex gap-4 flex-wrap">
        {/* Expression Section */}
        <div className="flex-1 min-w-0 bg-background rounded-lg p-4">
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Expression:
            </h4>
            <p className="text-sm text-foreground font-mono bg-background px-3 py-2 rounded border border-border">
              {expression || 'N/A'}
            </p>
          </div>

          {/* Aggregations Section */}
          {aggregations.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-2">
                Aggs:
              </h4>
              <p className="text-sm text-foreground">
                {aggregations.join(', ')}
              </p>
            </div>
          )}
        </div>

        {/* Lightdash Section */}
        {(dimension ||
          stringMetrics.length > 0 ||
          objectMetrics.length > 0) && (
          <div className="flex-1 min-w-0 bg-background rounded-lg p-4">
            <h4 className="text-sm font-semibold text-foreground mb-3 border-b border-border pb-2">
              Lightdash
            </h4>
            <div className="flex gap-6 justify-between">
              {dimension && (
                <div className="mb-4">
                  <h5 className="text-sm font-medium text-foreground mb-2">
                    Dimension
                  </h5>
                  {dimension.label !== undefined &&
                    dimension.label !== null && (
                      <div className="mb-1">
                        <span className="text-xs text-muted-foreground">
                          Label:{' '}
                        </span>
                        <span className="text-sm text-foreground">
                          {dimension.label}
                        </span>
                      </div>
                    )}
                  {dimension.group_label !== undefined &&
                    dimension.group_label !== null && (
                      <div>
                        <span className="text-xs text-muted-foreground">
                          Group Label:{' '}
                        </span>
                        <span className="text-sm text-foreground">
                          {dimension.group_label}
                        </span>
                      </div>
                    )}
                </div>
              )}

              {(stringMetrics.length > 0 || objectMetrics.length > 0) && (
                <div>
                  <h5 className="text-sm font-medium text-foreground mb-2">
                    Metrics:
                  </h5>

                  {/* Display string metrics joined together */}
                  {stringMetrics.length > 0 && (
                    <div className="mb-3">
                      <span className="text-sm text-foreground">
                        {stringMetrics.join(', ')}
                      </span>
                    </div>
                  )}

                  {/* Display object metrics in detailed structure */}
                  {objectMetrics.map((metric, idx) => (
                    <div
                      key={idx}
                      className="mb-3 border-l-2 border-primary pl-3"
                    >
                      {metric.name !== undefined && metric.name !== null && (
                        <div className="mb-1">
                          <span className="text-xs text-muted-foreground">
                            name:{' '}
                          </span>
                          <span className="text-sm text-foreground">
                            {metric.name}
                          </span>
                        </div>
                      )}
                      {metric.type !== undefined && metric.type !== null && (
                        <div className="mb-1">
                          <span className="text-xs text-muted-foreground">
                            type:{' '}
                          </span>
                          <span className="text-sm text-foreground">
                            {metric.type}
                          </span>
                        </div>
                      )}
                      {metric.label !== undefined && metric.label !== null && (
                        <div className="mb-1">
                          <span className="text-xs text-muted-foreground">
                            label:{' '}
                          </span>
                          <span className="text-sm text-foreground">
                            {metric.label}
                          </span>
                        </div>
                      )}
                      {metric.hidden !== undefined &&
                        metric.hidden !== null && (
                          <div className="mb-1">
                            <span className="text-xs text-muted-foreground">
                              hidden:{' '}
                            </span>
                            <span className="text-sm text-foreground">
                              {String(metric.hidden)}
                            </span>
                          </div>
                        )}
                      {metric.groups !== undefined &&
                        metric.groups !== null && (
                          <div>
                            <span className="text-xs text-muted-foreground">
                              groups:{' '}
                            </span>
                            <span className="text-sm text-foreground">
                              {metric.groups.length > 0
                                ? metric.groups.join(', ')
                                : '[]'}
                            </span>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
