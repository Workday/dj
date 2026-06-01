/**
 * Pure-function helpers for parsing Lightdash Dashboards-as-Code YAML and
 * managing the `.gitignore` entry for the content directory.
 *
 * Lives in its own module (no `vscode` / `fs` imports) so it can be unit
 * tested without a vscode extension host or filesystem mocks. The runtime
 * `LightdashContent` class in `content.ts` wraps these helpers with the
 * IO + watcher layer.
 */

export interface LightdashChartContent {
  slug: string;
  name: string;
  /** dbt model name this chart references (the Lightdash explore). */
  modelName: string | null;
  /**
   * `model_field` IDs from `metricQuery.dimensions`. Kept verbatim so
   * future column-lineage work can split the model prefix from the field.
   */
  dimensions: string[];
  metrics: string[];
  filterFieldIds: string[];
  tableCalculations: { name: string; sql: string }[];
  additionalMetrics: {
    name: string;
    baseDimensionName?: string;
    sql?: string;
  }[];
  /**
   * Slug of a parent dashboard, when the chart was saved inside a
   * dashboard's space rather than as a standalone artifact (drilled
   * views, detached tiles, etc.). Lightdash exports such charts with
   * `dashboardSlug` set even when they are NOT referenced by any
   * `tiles[].properties.chartSlug` in the dashboard YAML, so this is
   * the only signal that the chart belongs to that dashboard.
   */
  dashboardSlug?: string;
  /** Source file (workspace-relative, POSIX). */
  filePath: string;
}

export interface LightdashDashboardContent {
  slug: string;
  name: string;
  /** Slugs of saved-chart tiles embedded in the dashboard. */
  chartSlugs: string[];
  /** Source file (workspace-relative, POSIX). */
  filePath: string;
}

/* -------------------------------------------------------------------------- */
/* YAML coercion helpers                                                      */
/* -------------------------------------------------------------------------- */

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Pure-function parser for a chart YAML document. Returns null when the
 * input is not a Lightdash chart (no `slug`).
 */
export function parseChartDoc(
  doc: unknown,
  filePath: string,
): LightdashChartContent | null {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const obj = doc as Record<string, unknown>;
  const slug = stringOrUndefined(obj['slug']);
  if (!slug) {
    return null;
  }
  const name = stringOrUndefined(obj['name']) ?? slug;

  const metricQuery = (obj['metricQuery'] ?? {}) as Record<string, unknown>;
  const dimensions = stringArray(metricQuery['dimensions']);
  const metrics = stringArray(metricQuery['metrics']);

  const filters = (metricQuery['filters'] ?? {}) as Record<string, unknown>;
  const filterFieldIds: string[] = [];
  for (const group of ['dimensions', 'metrics', 'tableCalculations']) {
    const arr = filters[group];
    if (!Array.isArray(arr)) {
      continue;
    }
    for (const filter of arr) {
      if (filter && typeof filter === 'object') {
        const target = (filter as Record<string, unknown>)['target'];
        if (target && typeof target === 'object') {
          const fieldId = stringOrUndefined(
            (target as Record<string, unknown>)['fieldId'],
          );
          if (fieldId) {
            filterFieldIds.push(fieldId);
          }
        }
      }
    }
  }

  const tableCalculations: { name: string; sql: string }[] = [];
  if (Array.isArray(metricQuery['tableCalculations'])) {
    for (const tc of metricQuery['tableCalculations']) {
      if (tc && typeof tc === 'object') {
        const tcObj = tc as Record<string, unknown>;
        const tcName = stringOrUndefined(tcObj['name']);
        const sql = stringOrUndefined(tcObj['sql']);
        if (tcName && sql !== undefined) {
          tableCalculations.push({ name: tcName, sql });
        }
      }
    }
  }

  const additionalMetrics: LightdashChartContent['additionalMetrics'] = [];
  if (Array.isArray(metricQuery['additionalMetrics'])) {
    for (const am of metricQuery['additionalMetrics']) {
      if (am && typeof am === 'object') {
        const amObj = am as Record<string, unknown>;
        const amName = stringOrUndefined(amObj['name']);
        if (!amName) {
          continue;
        }
        additionalMetrics.push({
          name: amName,
          baseDimensionName: stringOrUndefined(amObj['baseDimensionName']),
          sql: stringOrUndefined(amObj['sql']),
        });
      }
    }
  }

  // Resolve the dbt model that this chart targets. Lightdash's
  // `metricQuery.exploreName` is the canonical join key; when it's
  // missing (older exports / partial files) fall back to the model
  // prefix encoded in the first dimension/metric ID.
  let modelName = stringOrUndefined(metricQuery['exploreName']);
  if (!modelName) {
    const firstField = dimensions[0] ?? metrics[0];
    if (firstField) {
      const underscoreIdx = firstField.indexOf('_');
      if (underscoreIdx > 0) {
        modelName = firstField.slice(0, underscoreIdx);
      }
    }
  }

  const dashboardSlug = stringOrUndefined(obj['dashboardSlug']);

  return {
    slug,
    name,
    modelName: modelName ?? null,
    dimensions,
    metrics,
    filterFieldIds,
    tableCalculations,
    additionalMetrics,
    dashboardSlug,
    filePath,
  };
}

/**
 * Pure-function parser for a dashboard YAML document. Returns null when
 * the input is not a Lightdash dashboard (no `slug`).
 */
export function parseDashboardDoc(
  doc: unknown,
  filePath: string,
): LightdashDashboardContent | null {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const obj = doc as Record<string, unknown>;
  const slug = stringOrUndefined(obj['slug']);
  if (!slug) {
    return null;
  }
  const name = stringOrUndefined(obj['name']) ?? slug;

  const chartSlugs: string[] = [];
  const tiles = obj['tiles'];
  if (Array.isArray(tiles)) {
    for (const tile of tiles) {
      if (!tile || typeof tile !== 'object') {
        continue;
      }
      const tileObj = tile as Record<string, unknown>;
      if (tileObj['type'] !== 'saved_chart') {
        continue;
      }
      const properties = tileObj['properties'];
      if (!properties || typeof properties !== 'object') {
        continue;
      }
      const chartSlug = stringOrUndefined(
        (properties as Record<string, unknown>)['chartSlug'],
      );
      if (chartSlug) {
        chartSlugs.push(chartSlug);
      }
    }
  }

  return {
    slug,
    name,
    chartSlugs,
    filePath,
  };
}

/* -------------------------------------------------------------------------- */
/* .gitignore helper                                                          */
/* -------------------------------------------------------------------------- */

export const GITIGNORE_MARKER_BEGIN = '# dj';
export const GITIGNORE_MARKER_END = '# /dj';

/**
 * Pure helper. Returns the new `.gitignore` body required to ensure
 * `rawPath` is ignored. Idempotent:
 *
 * - `alreadyPresent` is true when any non-comment line in `body` matches
 *   the entry (with or without trailing slash). When true the caller
 *   should NOT write the file back.
 * - When inserting, the entry lands inside a managed marker block
 *   (existing or new) so future runs can rewrite cleanly.
 */
export function applyGitignoreEntry(
  body: string,
  rawPath: string,
): { updatedBody: string; entry: string; alreadyPresent: boolean } {
  const entry = normalizeGitignoreEntry(rawPath);

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed === entry || trimmed === entry.replace(/\/$/, '')) {
      return { updatedBody: body, entry, alreadyPresent: true };
    }
  }

  return {
    updatedBody: appendInsideManagedBlock(body, entry),
    entry,
    alreadyPresent: false,
  };
}

function normalizeGitignoreEntry(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^\.\//, '');
  if (!trimmed) {
    return 'lightdash/';
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function appendInsideManagedBlock(body: string, entry: string): string {
  const beginIdx = body.indexOf(GITIGNORE_MARKER_BEGIN);
  const endIdx =
    beginIdx >= 0
      ? body.indexOf(
          GITIGNORE_MARKER_END,
          beginIdx + GITIGNORE_MARKER_BEGIN.length,
        )
      : -1;

  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = body.slice(0, endIdx);
    const after = body.slice(endIdx);
    const trimmedBefore = before.replace(/\s+$/, '');
    return `${trimmedBefore}\n${entry}\n${after}`;
  }

  const sep = body.length === 0 || body.endsWith('\n') ? '' : '\n';
  const newBlock = [
    GITIGNORE_MARKER_BEGIN,
    entry,
    GITIGNORE_MARKER_END,
    '',
  ].join('\n');
  return `${body}${sep}${body.length === 0 ? '' : '\n'}${newBlock}`;
}
