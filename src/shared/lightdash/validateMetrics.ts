/**
 * Validates Lightdash metric SQL references in model JSON before preview/create.
 */

export type LightdashValidationResult = {
  errors: string[];
  warnings: string[];
  fieldIds: string[];
  metricNames: string[];
};

type MetricLike = {
  name?: string;
  sql?: string;
  type?: string;
};

function collectMetrics(modelJson: Record<string, unknown>): MetricLike[] {
  const metrics: MetricLike[] = [];
  const lightdash = modelJson.lightdash;
  if (!lightdash || typeof lightdash !== 'object') {
    return metrics;
  }
  const rootMetrics = (lightdash as { metrics?: unknown }).metrics;
  if (Array.isArray(rootMetrics)) {
    for (const m of rootMetrics) {
      if (m && typeof m === 'object') {
        metrics.push(m as MetricLike);
      }
    }
  }
  const select = modelJson.select;
  if (Array.isArray(select)) {
    for (const item of select) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const sel = item as Record<string, unknown>;
      const colLd = sel.lightdash;
      if (colLd && typeof colLd === 'object') {
        const colMetrics = (colLd as { metrics?: unknown }).metrics;
        if (Array.isArray(colMetrics)) {
          for (const m of colMetrics) {
            if (m && typeof m === 'object') {
              metrics.push(m as MetricLike);
            }
          }
        }
      }
    }
  }
  return metrics;
}

function extractTemplateRefs(sql: string): string[] {
  const refs: string[] = [];
  const re = /\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    refs.push(match[1].trim());
  }
  return refs;
}

export function validateLightdashMetrics(
  modelJson: Record<string, unknown>,
  columnNames: string[],
): LightdashValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fieldIds: string[] = columnNames.map((n) => n);
  const metricNames: string[] = [];
  const nameSet = new Set<string>();
  const columnSet = new Set(columnNames);

  const metrics = collectMetrics(modelJson);
  for (const metric of metrics) {
    const name = typeof metric.name === 'string' ? metric.name.trim() : '';
    if (!name) {
      warnings.push('Lightdash metric missing name');
      continue;
    }
    if (nameSet.has(name)) {
      errors.push(`Duplicate Lightdash metric name: ${name}`);
    }
    nameSet.add(name);
    metricNames.push(name);

    const sql = typeof metric.sql === 'string' ? metric.sql : '';
    if (!sql) {
      continue;
    }
    for (const ref of extractTemplateRefs(sql)) {
      const baseField = ref.replace(/_(sum|avg|min|max|count)$/i, '');
      if (!columnSet.has(ref) && !columnSet.has(baseField)) {
        errors.push(
          `Metric "${name}" references unknown field \${${ref}} (not in model columns)`,
        );
      }
    }
  }

  return { errors, warnings, fieldIds, metricNames };
}
