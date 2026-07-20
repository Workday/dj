import { describe, expect, it } from '@jest/globals';
import {
  applyGitignoreEntry,
  GITIGNORE_MARKER_BEGIN,
  GITIGNORE_MARKER_END,
  parseChartDoc,
  parseDashboardDoc,
  resolveModelFromFieldId,
} from '@services/lightdash/contentParser';

describe('parseChartDoc', () => {
  it('returns null when input is missing or non-object', () => {
    expect(parseChartDoc(null, 'a.yml')).toBeNull();
    expect(parseChartDoc(undefined, 'a.yml')).toBeNull();
    expect(parseChartDoc('not-an-object', 'a.yml')).toBeNull();
    expect(parseChartDoc(42, 'a.yml')).toBeNull();
  });

  it('returns null when slug is missing (malformed YAML safety)', () => {
    const doc = { name: 'Some Chart', metricQuery: { exploreName: 'foo' } };
    expect(parseChartDoc(doc, 'charts/foo.yml')).toBeNull();
  });

  it('parses a minimal chart with exploreName as the model link', () => {
    const doc = {
      slug: 'orders-by-region',
      name: 'Orders by Region',
      metricQuery: {
        exploreName: 'mart_orders',
        dimensions: ['mart_orders_region'],
        metrics: ['mart_orders_total_revenue'],
      },
    };
    const out = parseChartDoc(doc, 'lightdash/charts/orders-by-region.yml');
    expect(out).not.toBeNull();
    expect(out?.slug).toBe('orders-by-region');
    expect(out?.name).toBe('Orders by Region');
    expect(out?.modelName).toBe('mart_orders');
    expect(out?.dimensions).toEqual(['mart_orders_region']);
    expect(out?.metrics).toEqual(['mart_orders_total_revenue']);
    expect(out?.filePath).toBe('lightdash/charts/orders-by-region.yml');
  });

  it('leaves modelName null when exploreName is missing (resolved later in rebuild)', () => {
    // The pure parser intentionally does NOT guess the model from a field
    // id: DJ model names contain `__` separators, so the longest-prefix
    // match needs the set of known dbt model names, which only
    // `LightdashContent.rebuild()` has. See `resolveModelFromFieldId`.
    const doc = {
      slug: 'top-customers',
      metricQuery: {
        dimensions: ['mart__core__customers__top_customers_id'],
        metrics: ['mart__core__customers__top_customers_total_orders'],
      },
    };
    const out = parseChartDoc(doc, 'lightdash/charts/top-customers.yml');
    expect(out?.modelName).toBeNull();
  });

  it('extracts column-level fields for future column lineage work', () => {
    const doc = {
      slug: 'rev-trend',
      name: 'Revenue Trend',
      metricQuery: {
        exploreName: 'mart_revenue',
        dimensions: ['mart_revenue_month'],
        metrics: ['mart_revenue_amount'],
        filters: {
          dimensions: [
            { target: { fieldId: 'mart_revenue_country' } },
            'broken-not-an-object',
          ],
          metrics: [{ target: { fieldId: 'mart_revenue_amount' } }],
        },
        tableCalculations: [
          { name: 'pct_change', sql: '${amount} / lag(${amount}) - 1' },
          { name: 'no_sql' }, // skipped
        ],
        additionalMetrics: [
          {
            name: 'count_distinct_customers',
            baseDimensionName: 'customer_id',
            sql: 'count(distinct ${customer_id})',
          },
          { skipped: true }, // skipped (no name)
        ],
      },
    };
    const out = parseChartDoc(doc, 'lightdash/charts/rev-trend.yml');
    expect(out?.filterFieldIds).toEqual([
      'mart_revenue_country',
      'mart_revenue_amount',
    ]);
    expect(out?.tableCalculations).toEqual([
      { name: 'pct_change', sql: '${amount} / lag(${amount}) - 1' },
    ]);
    expect(out?.additionalMetrics).toEqual([
      {
        name: 'count_distinct_customers',
        baseDimensionName: 'customer_id',
        sql: 'count(distinct ${customer_id})',
      },
    ]);
  });

  it('uses slug as a fallback for missing name', () => {
    const out = parseChartDoc(
      { slug: 'no-name', metricQuery: { exploreName: 'mart_x' } },
      'a.yml',
    );
    expect(out?.name).toBe('no-name');
  });

  it('falls back to chartConfig.config.label, then slug, for a blank name', () => {
    // Lightdash "copy of" exports carry `name: ' '` (whitespace only).
    const labelled = parseChartDoc(
      {
        slug: 'copy-of-foo-123',
        name: ' ',
        chartConfig: { config: { label: 'GCP CP2 Dev Clusters' } },
        metricQuery: { exploreName: 'mart_foo' },
      },
      'charts/copy.yml',
    );
    expect(labelled?.name).toBe('GCP CP2 Dev Clusters');

    // No usable label -> slug.
    const slugFallback = parseChartDoc(
      { slug: 'copy-of-bar-456', name: '   ', metricQuery: {} },
      'charts/copy2.yml',
    );
    expect(slugFallback?.name).toBe('copy-of-bar-456');
  });

  it('captures dashboardSlug when the chart is saved within a dashboard', () => {
    // Lightdash exports charts saved inside a dashboard's space (drilled
    // views, detached tiles) with `dashboardSlug` set to the parent. The
    // parent dashboard YAML may not list the chart in tiles[], so this
    // field is the only signal of the relationship - the rebuild step
    // relies on it to avoid bucketing the chart as a standalone orphan.
    const doc = {
      slug: 'embedded-chart',
      name: 'Embedded Chart',
      dashboardSlug: 'parent-dashboard',
      metricQuery: { exploreName: 'mart_x', dimensions: ['mart_x_id'] },
    };
    const out = parseChartDoc(doc, 'lightdash/charts/embedded-chart.yml');
    expect(out?.dashboardSlug).toBe('parent-dashboard');
  });

  it('leaves dashboardSlug undefined for plain saved charts', () => {
    const doc = {
      slug: 'standalone',
      metricQuery: { exploreName: 'mart_x' },
    };
    const out = parseChartDoc(doc, 'a.yml');
    expect(out?.dashboardSlug).toBeUndefined();
  });
});

describe('resolveModelFromFieldId', () => {
  const knownModels = new Set([
    'mart__core__customers__top_customers',
    'mart__core__orders__orders',
    'mart__core__orders__orders_status',
  ]);

  it('returns null for an empty/undefined field id', () => {
    expect(resolveModelFromFieldId(undefined, knownModels)).toBeNull();
    expect(resolveModelFromFieldId('', knownModels)).toBeNull();
  });

  it('returns null when no known model prefixes the field id', () => {
    expect(
      resolveModelFromFieldId('stg__core__orders__line_items_id', knownModels),
    ).toBeNull();
    // A `mart` prefix alone must NOT resolve (the old buggy behaviour).
    expect(
      resolveModelFromFieldId('mart_something_else', knownModels),
    ).toBeNull();
  });

  it('matches a field id whose prefix is a known __-delimited model', () => {
    expect(
      resolveModelFromFieldId(
        'mart__core__customers__top_customers_region',
        knownModels,
      ),
    ).toBe('mart__core__customers__top_customers');
  });

  it('matches when the field id equals the model name exactly', () => {
    expect(
      resolveModelFromFieldId('mart__core__orders__orders', knownModels),
    ).toBe('mart__core__orders__orders');
  });

  it('prefers the longest matching model name (disambiguates shared prefixes)', () => {
    // `..._status_code` is prefixed by BOTH `..._orders` and
    // `..._orders_status`; the longer model must win.
    expect(
      resolveModelFromFieldId(
        'mart__core__orders__orders_status_code',
        knownModels,
      ),
    ).toBe('mart__core__orders__orders_status');
  });

  it('returns null when the known-model set is empty', () => {
    expect(
      resolveModelFromFieldId('mart__core__orders__orders_x', new Set()),
    ).toBeNull();
  });
});

describe('parseDashboardDoc', () => {
  it('returns null when slug is missing', () => {
    expect(parseDashboardDoc({ name: 'No Slug' }, 'a.yml')).toBeNull();
  });

  it('falls back to slug for a blank name', () => {
    const out = parseDashboardDoc(
      { slug: 'd-1', name: ' ', tiles: [] },
      'dashboards/d.yml',
    );
    expect(out?.name).toBe('d-1');
  });

  it('extracts saved-chart tile slugs and skips non-chart tiles', () => {
    const doc = {
      slug: 'executive-overview',
      name: 'Executive Overview',
      tiles: [
        {
          type: 'saved_chart',
          properties: { chartSlug: 'orders-by-region' },
        },
        {
          type: 'saved_chart',
          properties: { chartSlug: 'top-customers' },
        },
        // Non-chart tiles (markdown, loom, etc.) are ignored.
        { type: 'markdown', properties: { content: 'hi' } },
        // Malformed tiles are silently skipped (defensive parsing).
        'not-a-tile',
        null,
        { type: 'saved_chart' /* no properties */ },
      ],
    };
    const out = parseDashboardDoc(
      doc,
      'lightdash/dashboards/executive-overview.yml',
    );
    expect(out?.slug).toBe('executive-overview');
    expect(out?.chartSlugs).toEqual(['orders-by-region', 'top-customers']);
  });

  it('returns an empty chartSlugs list when there are no tiles', () => {
    const out = parseDashboardDoc({ slug: 'empty' }, 'a.yml');
    expect(out?.chartSlugs).toEqual([]);
  });
});

describe('applyGitignoreEntry', () => {
  const PATH = 'lightdash';

  it('creates a managed marker block when .gitignore is empty', () => {
    const { updatedBody, alreadyPresent } = applyGitignoreEntry('', PATH);
    expect(alreadyPresent).toBe(false);
    expect(updatedBody).toContain(GITIGNORE_MARKER_BEGIN);
    expect(updatedBody).toContain(GITIGNORE_MARKER_END);
    // The block is delimited by `# dj` / `# /dj` - a single shared marker
    // pair so future DJ-managed entries can land inside the same block.
    expect(updatedBody).toMatch(/^# dj$/m);
    expect(updatedBody).toMatch(/^# \/dj$/m);
    // The entry is root-anchored with a leading slash so a directory of
    // the same name nested elsewhere isn't accidentally ignored.
    expect(updatedBody).toMatch(/^\/lightdash\/$/m);
    expect(updatedBody).not.toMatch(/^lightdash\/$/m);
    expect(updatedBody.endsWith('\n')).toBe(true);
  });

  it('appends the managed block to existing content without truncating it', () => {
    const existing = 'node_modules/\ndist/\n';
    const { updatedBody, alreadyPresent } = applyGitignoreEntry(existing, PATH);
    expect(alreadyPresent).toBe(false);
    expect(updatedBody.startsWith(existing)).toBe(true);
    expect(updatedBody).toContain(GITIGNORE_MARKER_BEGIN);
    expect(updatedBody).toMatch(/^\/lightdash\/$/m);
  });

  it('treats a legacy unanchored entry outside the marker block as already-present (idempotent)', () => {
    const existing = '# user-managed\nlightdash/\n';
    const { updatedBody, alreadyPresent } = applyGitignoreEntry(existing, PATH);
    expect(alreadyPresent).toBe(true);
    expect(updatedBody).toBe(existing);
    expect(updatedBody).not.toContain(GITIGNORE_MARKER_BEGIN);
  });

  it('matches a legacy entry missing the trailing slash', () => {
    const existing = 'lightdash\n';
    const { alreadyPresent } = applyGitignoreEntry(existing, PATH);
    expect(alreadyPresent).toBe(true);
  });

  it('matches an existing root-anchored entry (round-trip idempotent)', () => {
    const existing = '/lightdash/\n';
    const { updatedBody, alreadyPresent } = applyGitignoreEntry(existing, PATH);
    expect(alreadyPresent).toBe(true);
    expect(updatedBody).toBe(existing);
  });

  it('inserts inside an existing managed block instead of duplicating it', () => {
    const existing = [
      'node_modules/',
      GITIGNORE_MARKER_BEGIN,
      'old-path/',
      GITIGNORE_MARKER_END,
      '',
    ].join('\n');
    const { updatedBody, alreadyPresent } = applyGitignoreEntry(existing, PATH);
    expect(alreadyPresent).toBe(false);
    expect(
      (updatedBody.match(new RegExp(GITIGNORE_MARKER_BEGIN, 'g')) || []).length,
    ).toBe(1);
    expect(
      (updatedBody.match(new RegExp(GITIGNORE_MARKER_END, 'g')) || []).length,
    ).toBe(1);
    expect(updatedBody).toContain('old-path/');
    expect(updatedBody).toMatch(/^\/lightdash\/$/m);
    // New entry should land before the closing marker.
    const newEntryIdx = updatedBody.indexOf('/lightdash/');
    const endIdx = updatedBody.indexOf(GITIGNORE_MARKER_END);
    expect(newEntryIdx).toBeLessThan(endIdx);
  });

  it('normalizes paths: strips ./ prefix and root-anchors with a trailing slash', () => {
    const { updatedBody } = applyGitignoreEntry('', './my-lightdash');
    expect(updatedBody).toMatch(/^\/my-lightdash\/$/m);
    expect(updatedBody).not.toContain('./my-lightdash');
  });

  it('falls back to /lightdash/ when given an empty path', () => {
    const { updatedBody } = applyGitignoreEntry('', '   ');
    expect(updatedBody).toMatch(/^\/lightdash\/$/m);
  });
});
