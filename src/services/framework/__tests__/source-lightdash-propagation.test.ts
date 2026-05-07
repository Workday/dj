import { describe, expect, test } from '@jest/globals';
import { frameworkGenerateModelOutput } from '@services/framework/utils';
import { yamlParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type { FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Builds a project whose manifest contains a single source (`source_a.table_a`)
 * with one Lightdash-annotated column and a few plain columns. This mirrors
 * the shape that dbt parses into `manifest.sources[...].columns[...]` after
 * generating source YAML via `frameworkSourceProperties` (Lightdash nested
 * under `meta.lightdash`).
 */
function buildProjectWithSource(): DbtProject {
  return createTestProject({
    sources: {
      ['source.project.source_a.table_a']: {
        name: 'table_a',
        source_name: 'source_a',
        resource_type: 'source',
        columns: {
          customer_id: {
            name: 'customer_id',
            data_type: 'varchar',
            description: 'Customer identifier',
            meta: {
              type: 'dim',
              lightdash: {
                dimension: {
                  label: 'Customer ID',
                  group_label: 'Customers',
                  urls: [
                    {
                      label: 'View customer',
                      url: 'https://example.com/c/${value.raw}',
                    },
                  ],
                },
                case_sensitive: true,
              },
            },
          },
          order_total: {
            name: 'order_total',
            data_type: 'integer',
            description: 'Order total',
            meta: {
              type: 'fct',
              lightdash: {
                dimension: {
                  label: 'Order Total',
                  format: 'usd',
                },
              },
            },
          },
          plain_col: {
            name: 'plain_col',
            data_type: 'varchar',
            description: 'No Lightdash meta',
            meta: { type: 'dim' },
          },
        },
      },
    },
  });
}

function extractColumns(yml: string) {
  const parsed = yamlParse(yml) as {
    models: Array<{
      name: string;
      columns: Array<{ name: string; meta?: Record<string, unknown> }>;
    }>;
  };
  const [model] = parsed.models;
  const byName = new Map<string, Record<string, unknown>>();
  for (const column of model.columns) {
    byName.set(column.name, column.meta ?? {});
  }
  return byName;
}

describe('source column Lightdash propagation', () => {
  test('propagates source lightdash.dimension into a downstream stg_select_source passthrough column', () => {
    const project = buildProjectWithSource();
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: ['customer_id'],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    expect(columns.get('customer_id')).toEqual({
      type: 'dim',
      case_sensitive: true,
      dimension: {
        label: 'Customer ID',
        group_label: 'Customers',
        urls: [
          {
            label: 'View customer',
            url: 'https://example.com/c/${value.raw}',
          },
        ],
      },
    });
  });

  test('model-declared lightdash.dimension fields override source-propagated dimension per-key (inherited fields preserved)', () => {
    const project = buildProjectWithSource();
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: [
        {
          name: 'customer_id',
          type: 'dim',
          lightdash: {
            dimension: {
              label: 'Customer identifier',
              hidden: true,
            },
          },
        },
      ],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    const meta = columns.get('customer_id');
    // Per-key deep merge: user's `label` and `hidden` override source's,
    // while source's `group_label` and `urls` pass through unchanged. This
    // matches pre-existing model-to-model inheritance semantics.
    expect(meta).toMatchObject({
      type: 'dim',
      case_sensitive: true,
      dimension: {
        label: 'Customer identifier',
        hidden: true,
        group_label: 'Customers',
        urls: [
          {
            label: 'View customer',
            url: 'https://example.com/c/${value.raw}',
          },
        ],
      },
    });
  });

  test('model-declared `case_sensitive` overrides source while inherited dimension passes through', () => {
    const project = buildProjectWithSource();
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: [
        {
          name: 'customer_id',
          type: 'dim',
          lightdash: {
            case_sensitive: false,
          },
        },
      ],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    const meta = columns.get('customer_id');
    // User's `case_sensitive: false` wins over the source's `true`, but
    // the source `dimension` still flows through because the user did not
    // declare any dimension fields.
    expect(meta).toMatchObject({
      type: 'dim',
      case_sensitive: false,
      dimension: {
        label: 'Customer ID',
        group_label: 'Customers',
        urls: [
          {
            label: 'View customer',
            url: 'https://example.com/c/${value.raw}',
          },
        ],
      },
    });
  });

  test('propagates source lightdash.case_sensitive when the model column does not override', () => {
    const project = createTestProject({
      sources: {
        ['source.project.source_a.table_a']: {
          name: 'table_a',
          source_name: 'source_a',
          resource_type: 'source',
          columns: {
            email: {
              name: 'email',
              data_type: 'varchar',
              description: 'Email',
              meta: {
                type: 'dim',
                lightdash: { case_sensitive: true },
              },
            },
          },
        },
      },
    });
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: ['email'],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    expect(columns.get('email')).toEqual({
      type: 'dim',
      case_sensitive: true,
    });
  });

  test('does not propagate source lightdash when the column is renamed via `expr`', () => {
    const project = buildProjectWithSource();
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: [{ name: 'id', expr: 'customer_id', type: 'dim' }],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    const meta = columns.get('id');
    expect(meta).toBeDefined();
    expect(meta).not.toHaveProperty('dimension');
    expect(meta).not.toHaveProperty('case_sensitive');
  });

  test('inherited dimension flows through to an aggregated column', () => {
    // Aggregation behaves like any other model-to-model inheritance:
    // upstream `dimension` fields are preserved via mergeDeep. This matches
    // pre-existing behavior for framework-generated columns like
    // `portal_source_count` (`dimension: { label, hidden }`) and common-dim
    // aggregations (`dimension: { group_label }`), which previously
    // regressed when selected with an `agg`.
    const project = createTestProject({
      nodes: {
        ['model.project.stg_orders']: {
          columns: {
            store_id: {
              name: 'store_id',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            order_total: {
              name: 'order_total',
              data_type: 'integer',
              meta: {
                type: 'fct',
                dimension: {
                  label: 'Order Total',
                  format: 'usd',
                },
              },
            },
          },
        },
      },
    });

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson: {
        type: 'int_select_model',
        group: 'marketing',
        topic: 'orders',
        name: 'int_order_totals',
        select: ['store_id', { name: 'order_total', type: 'fct', agg: 'sum' }],
        from: { model: 'stg_orders' },
      },
      project,
    });
    const columns = extractColumns(yml);
    expect(columns.get('order_total_sum')).toMatchObject({
      type: 'fct',
      dimension: { label: 'Order Total', format: 'usd' },
    });
  });

  test('user-declared lightdash.dimension.group_label merges with inherited type/label from upstream model', () => {
    // Regression guard for the primary real-world pattern: an upstream
    // model exposes `dimension: { type, label }`, and a downstream model
    // adds only `group_label` via its lightdash block. Previously the
    // entire upstream dimension was replaced with just `group_label`;
    // under per-key mergeDeep all three fields are preserved.
    const project = createTestProject({
      nodes: {
        ['model.project.stg_accounts']: {
          columns: {
            account_name: {
              name: 'account_name',
              data_type: 'varchar',
              description: 'Account Name',
              meta: {
                type: 'dim',
                dimension: { type: 'string', label: 'Account Name' },
              },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'marketing',
      topic: 'tenants',
      name: 'int_tenants',
      select: [
        {
          name: 'account_name',
          type: 'dim',
          lightdash: {
            dimension: { group_label: 'Tenant Details' },
          },
        },
      ],
      from: { model: 'stg_accounts' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);
    expect(columns.get('account_name')).toMatchObject({
      type: 'dim',
      dimension: {
        type: 'string',
        label: 'Account Name',
        group_label: 'Tenant Details',
      },
    });
  });

  test('datetime-interval column preserves upstream dimension fields (e.g. `type: timestamp`) while framework-set label/time_intervals win', () => {
    // Regression guard: a staging datetime column typically exposes
    // `meta.dimension: { type: 'timestamp', label: 'Datetime' }`. When an
    // intermediate model selects `{ name: 'datetime', interval: 'day' }`,
    // the framework constructs a fresh `{ label, time_intervals }` dimension
    // and relies on mergeDeep to preserve upstream fields like `type`.
    const project = createTestProject({
      nodes: {
        ['model.project.stg_events']: {
          columns: {
            datetime: {
              name: 'datetime',
              data_type: 'timestamp(6)',
              description: 'Event Datetime Column',
              meta: {
                type: 'dim',
                dimension: { type: 'timestamp', label: 'Datetime' },
              },
            },
          },
        },
      },
    });
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'marketing',
      topic: 'events',
      name: 'int_events_daily',
      select: [{ name: 'datetime', interval: 'day' }],
      from: { model: 'stg_events' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);
    const datetimeMeta = columns.get('datetime');
    expect(datetimeMeta).toMatchObject({
      type: 'dim',
      dimension: {
        type: 'timestamp',
        label: 'Datetime',
        time_intervals: expect.arrayContaining(['DAY']),
      },
    });
  });

  test('bulk select `dims_from_source` is not yet a supported bulk directive (only `all_from_source` is); all_from_source carries source dimensions through', () => {
    // NOTE: the project's `BULK_SELECT_TYPES` does not currently define a
    // `dims_from_source` entry (only `all_from_source`). We test the
    // supported path here to pin the behavior.
    const project = buildProjectWithSource();
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'marketing',
      topic: 'customers',
      name: 'stg_customers',
      select: [{ type: 'all_from_source', source: 'source_a.table_a' }],
      from: { source: 'source_a.table_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    expect(columns.get('customer_id')).toMatchObject({
      type: 'dim',
      case_sensitive: true,
      dimension: {
        label: 'Customer ID',
      },
    });
    expect(columns.get('order_total')).toMatchObject({
      type: 'fct',
      dimension: {
        label: 'Order Total',
        format: 'usd',
      },
    });
    expect(columns.get('plain_col')).toEqual({ type: 'dim' });
  });

  test('propagation is transitive: source → stg → int via the model manifest carries dimension through all layers', () => {
    // Simulate the post-sync state: after the staging model's YAML is
    // generated, dbt re-parses it and exposes `meta.dimension` on the
    // staging model node. A downstream int model should inherit it
    // unchanged — exercising the non-source (model) branch of
    // frameworkGetNodeColumns (no normalization, direct passthrough).
    const project = createTestProject({
      sources: {
        ['source.project.source_a.table_a']: {
          name: 'table_a',
          source_name: 'source_a',
          resource_type: 'source',
          columns: {
            customer_id: {
              name: 'customer_id',
              data_type: 'varchar',
              description: 'Customer ID',
              meta: {
                type: 'dim',
                lightdash: {
                  dimension: { label: 'Customer ID', group_label: 'Customers' },
                },
              },
            },
          },
        },
      },
      nodes: {
        ['model.project.stg_customers']: {
          columns: {
            customer_id: {
              name: 'customer_id',
              data_type: 'varchar',
              description: 'Customer ID',
              meta: {
                type: 'dim',
                // Mirrors the YAML that stg_customers would generate after
                // propagating the source's Lightdash dimension.
                dimension: { label: 'Customer ID', group_label: 'Customers' },
              },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'int_customers',
      select: ['customer_id'],
      from: { model: 'stg_customers' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const columns = extractColumns(yml);

    expect(columns.get('customer_id')).toMatchObject({
      type: 'dim',
      dimension: { label: 'Customer ID', group_label: 'Customers' },
    });
  });
});
