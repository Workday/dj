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

/**
 * Trim-aware string coercion: returns the trimmed value only when it has
 * non-whitespace content, else undefined. Used for display names, where
 * Lightdash occasionally exports a blank `name: ' '` (e.g. "copy of"
 * charts) that should fall through to a better label rather than render as
 * an empty / kind-only picker row.
 */
function nonBlank(v: unknown): string | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  // Blank `name: ' '` exports (common on Lightdash "copy of" charts) fall
  // back to the chart's display label, then the slug, so the picker never
  // shows an empty / kind-only row.
  const chartConfig = (obj['chartConfig'] ?? {}) as Record<string, unknown>;
  const chartConfigConfig = (chartConfig['config'] ?? {}) as Record<
    string,
    unknown
  >;
  const name =
    nonBlank(obj['name']) ?? nonBlank(chartConfigConfig['label']) ?? slug;

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
  // `metricQuery.exploreName` is the canonical join key. When it's
  // missing (older exports / partial files), `modelName` is left null
  // here: the field-id fallback needs the set of known dbt model names
  // (to resolve `__`-delimited DJ names correctly), which this pure
  // parser intentionally doesn't have. `LightdashContent.rebuild()`
  // finalizes it via `resolveModelFromFieldId`.
  const modelName = stringOrUndefined(metricQuery['exploreName']) ?? null;

  const dashboardSlug = stringOrUndefined(obj['dashboardSlug']);

  return {
    slug,
    name,
    modelName,
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
 * Resolve a dbt model name from a Lightdash field id by longest-prefix
 * match against the set of known dbt model names.
 *
 * Lightdash field ids are `<exploreName>_<fieldName>`. DJ model names
 * themselves contain `__` separators (`mart__group__topic__name`), so a
 * naive split on the first `_` mis-resolves `mart__orders_status` to
 * `mart`. Instead we return the longest known model name `m` such that
 * `fieldId === m` or `fieldId` starts with `m + '_'`, or `null` when
 * nothing matches (so no bogus model is attached).
 *
 * Pure (no IO) so it can be unit tested; called from
 * `LightdashContent.rebuild()` for the rare charts that lack an explicit
 * `exploreName`.
 */
export function resolveModelFromFieldId(
  fieldId: string | undefined,
  knownModelNames: ReadonlySet<string>,
): string | null {
  if (!fieldId) {
    return null;
  }
  let best: string | null = null;
  for (const name of knownModelNames) {
    if (fieldId === name || fieldId.startsWith(`${name}_`)) {
      if (best === null || name.length > best.length) {
        best = name;
      }
    }
  }
  return best;
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
  const name = nonBlank(obj['name']) ?? slug;

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

  // A line counts as already-present if it matches the anchored entry or
  // any looser/legacy variant (with or without a leading or trailing
  // slash). This keeps us from appending a duplicate next to a
  // pre-existing unanchored `lightdash/` written by an older version.
  const core = entry.replace(/^\/+/, '').replace(/\/+$/, '');
  const equivalents = new Set([entry, `/${core}`, `${core}/`, core]);

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (equivalents.has(trimmed)) {
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
  const cleaned = rawPath
    .trim()
    .replace(/^\.\//, '') // drop a leading ./
    .replace(/^\/+/, '') // drop leading slashes; we re-anchor below
    .replace(/\/+$/, ''); // drop trailing slashes; we re-add exactly one
  const core = cleaned || 'lightdash';
  // Root-anchor with a leading slash so a directory of the same name
  // nested elsewhere in the tree (e.g. `src/services/lightdash/`) is NOT
  // accidentally ignored - only the top-level content dir is matched.
  return `/${core}/`;
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
