import { describe, expect, test } from '@jest/globals';
import { frameworkGenerateModelOutput } from '@services/framework/utils';
import { preserveColumnMetaOnUpdate } from '@services/framework/utils/update-helpers';
import { yamlParse } from '@shared';
import type { FrameworkModel } from '@shared/framework/types';
import Ajv from 'ajv';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Pre-populate an Ajv instance with every schema in `schemas/` so `$ref`s
 * between model schemas resolve. Mirrors the runtime Framework service setup
 * and the pattern used by source-meta.test.ts.
 */
function buildAjv() {
  const schemasDir = path.join(__dirname, '../../../../schemas');
  const ajv = new Ajv({
    allErrors: true,
    strictSchema: 'log',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });
  const schemaFiles = glob.sync('*.schema.json', { cwd: schemasDir });
  for (const file of schemaFiles) {
    const content = fs.readFileSync(path.join(schemasDir, file), 'utf8');
    ajv.addSchema(JSON.parse(content), file);
  }
  return ajv;
}

function getTypeValidator(ajv: Ajv, modelType: string) {
  const schemaId = `model.type.${modelType}.schema.json`;
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new Error(`${schemaId} failed to register`);
  }
  return validator;
}

function extractModelMeta(yml: string): Record<string, unknown> {
  const parsed = yamlParse(yml) as {
    models: Array<{ meta?: Record<string, unknown> }>;
  };
  return parsed.models[0].meta ?? {};
}

function extractColumns(yml: string) {
  const parsed = yamlParse(yml) as {
    models: Array<{
      columns: Array<{ name: string; meta?: Record<string, unknown> }>;
    }>;
  };
  const byName = new Map<string, Record<string, unknown>>();
  for (const column of parsed.models[0].columns) {
    byName.set(column.name, column.meta ?? {});
  }
  return byName;
}

describe('model meta — schema validation', () => {
  test.each([
    ['stg_select_source'],
    ['stg_select_model'],
    ['stg_union_sources'],
    ['int_select_model'],
    ['int_join_column'],
    ['int_join_models'],
    ['int_lookback_model'],
    ['int_rollup_model'],
    ['int_union_models'],
    ['mart_select_model'],
    ['mart_join_models'],
  ])(
    '%s accepts free-form model-level `meta` keys at the root',
    (modelType) => {
      const ajv = buildAjv();
      const validator = getTypeValidator(ajv, modelType);

      // Minimal valid skeleton per type is awkward to construct generically;
      // the schema's `meta.additionalProperties: true` is the invariant we
      // want to pin, so we only validate the meta slice in isolation via
      // the shared model.meta.schema.json.
      const metaValidator = ajv.getSchema('model.meta.schema.json');
      expect(metaValidator).toBeDefined();
      expect(
        metaValidator!({
          owner: 'finops-team',
          owner_slack: '#finops-team',
          freshness_sla: 'daily by 06:00 UTC',
          upstream_process: 'load_cur_billing',
        }),
      ).toBe(true);

      // Also confirm the per-type schema resolves `$ref: model.meta.schema.json`
      // for the `meta` property (the $ref is what enables additional keys).
      const schema = validator.schema as { properties?: { meta?: unknown } };
      expect(schema.properties?.meta).toEqual({
        $ref: 'model.meta.schema.json',
      });
    },
  );

  test('column-level `meta` accepts free-form keys on a select item', () => {
    const ajv = buildAjv();
    const metaValidator = ajv.getSchema('column.meta.schema.json');
    expect(metaValidator).toBeDefined();
    expect(
      metaValidator!({
        owner: 'data-eng',
        pii: true,
        compliance: ['gdpr', 'hipaa'],
        notes: 'exposed to downstream analytics',
      }),
    ).toBe(true);
  });

  test('model.select.col.schema.json references column.meta.schema.json', () => {
    const ajv = buildAjv();
    const selectColSchema = ajv.getSchema('model.select.col.schema.json')
      ?.schema as { anyOf: Array<{ properties?: { meta?: unknown } }> };
    expect(selectColSchema).toBeDefined();
    // Both the dim and fct branches expose `meta: { $ref: 'column.meta.schema.json' }`
    for (const branch of selectColSchema.anyOf) {
      expect(branch.properties?.meta).toEqual({
        $ref: 'column.meta.schema.json',
      });
    }
  });
});

describe('model meta — YAML emission', () => {
  test('model-level free-form meta round-trips verbatim into YAML', () => {
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'finops',
      topic: 'aws_cur',
      name: 'mart_aws_cur',
      meta: {
        owner: 'finops-team',
        owner_slack: '#finops-team',
        freshness_sla: 'daily by 06:00 UTC',
        upstream_process: 'load_cur_billing',
      },
      select: ['col_a'],
      from: { model: 'model_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const meta = extractModelMeta(yml);
    expect(meta).toMatchObject({
      owner: 'finops-team',
      owner_slack: '#finops-team',
      freshness_sla: 'daily by 06:00 UTC',
      upstream_process: 'load_cur_billing',
    });
  });

  test('framework-computed model keys (metrics / local_tags) silently win over same-named free-form keys', () => {
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'finops',
      topic: 'aws_cur',
      name: 'mart_aws_cur',
      meta: {
        owner: 'finops-team',
        // The framework populates `metrics` from lightdash.metrics; any
        // user-authored `metrics` key at the meta root must be overwritten.
        metrics: { user_authored: { type: 'count' } },
        // Same for local_tags (populated from tags of shape { type: 'local', tag }).
        local_tags: ['user_authored_tag'],
      },
      // { type: 'local', tag: 'internal' } classifies as a local tag and
      // drives the framework-computed `local_tags: ['internal']`.
      tags: [{ type: 'local', tag: 'internal' }],
      select: ['col_a'],
      from: { model: 'model_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const meta = extractModelMeta(yml);
    expect(meta.owner).toBe('finops-team');
    // { type: 'local', tag: 'internal' } → local_tags: ['internal'],
    // overwriting the user's ['user_authored_tag'].
    expect(meta.local_tags).toEqual(['internal']);
    // No user-authored metric was declared via lightdash.metrics, so the
    // framework-computed `metrics` is absent from YAML (removeEmpty drops
    // empty objects) -- importantly the user-authored `metrics` key is
    // NOT passed through.
    expect(meta).not.toHaveProperty('metrics.user_authored');
  });

  test('column-level free-form meta round-trips verbatim into YAML', () => {
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        {
          name: 'col_a',
          type: 'dim',
          meta: {
            owner: 'data-eng',
            pii: true,
            compliance: ['gdpr', 'hipaa'],
          },
        },
      ],
      from: { model: 'model_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    expect(columns.get('col_a')).toMatchObject({
      owner: 'data-eng',
      pii: true,
      compliance: ['gdpr', 'hipaa'],
      type: 'dim',
    });
  });

  test('framework-computed column keys (type / dimension) silently win over same-named free-form keys', () => {
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        {
          name: 'col_a',
          type: 'dim',
          lightdash: { dimension: { label: 'Col A' } },
          meta: {
            // Collides with the reserved framework-populated `type` -- the
            // structured `type: dim` on the select item must win.
            type: 'fct',
            // Collides with the reserved `dimension` populated from the
            // lightdash block -- the framework value must win.
            dimension: { label: 'User Wrote This' },
            // Free-form key must pass through.
            owner: 'data-eng',
          },
        },
      ],
      from: { model: 'model_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    const meta = columns.get('col_a');
    expect(meta).toMatchObject({
      type: 'dim',
      owner: 'data-eng',
    });
    expect((meta?.dimension as Record<string, unknown>)?.label).toBe('Col A');
  });

  test('SQL-internal column meta keys (expr / prefix / exclude_from_group_by / override_suffix_agg / metrics_merge / metrics) do not leak into YAML', () => {
    // NOTE: `agg` / `aggs` / `interval` deliberately drive column renaming
    // (col_a + agg:sum → col_a_sum, interval:day → datetime grain logic) and
    // are exercised via the existing framework tests. Here we only prove that
    // a user placing SQL-internal keys in `meta` does NOT leak them verbatim
    // into the emitted YAML meta block, while the free-form key `owner` does.
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        {
          name: 'col_a',
          type: 'dim',
          meta: {
            expr: 'UPPER(col_a)',
            prefix: 'total',
            exclude_from_group_by: true,
            override_suffix_agg: true,
            metrics_merge: { type: 'sum' },
            // Free-form key, should survive the deny-list spread.
            owner: 'data-eng',
          },
        },
      ],
      from: { model: 'model_a' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    const meta = columns.get('col_a') ?? {};
    for (const denied of [
      'expr',
      'prefix',
      'exclude_from_group_by',
      'override_suffix_agg',
      'metrics_merge',
    ]) {
      expect(meta).not.toHaveProperty(denied);
    }
    expect(meta.owner).toBe('data-eng');
  });

  test('SQL-internal column state (agg / aggs / expr / prefix / exclude_from_group_by / interval / override_suffix_agg / metrics_merge) NEVER appears in columns[].meta when authored at the canonical top-level location', () => {
    // Correct authoring path: user writes SQL-internal fields as top-level
    // siblings on the select item (`select[i].agg`, `.expr`, `.prefix`, ...).
    // The framework moves these into `column.internal.*` during processing;
    // they drive SQL generation and are NEVER emitted to `columns[].meta`.
    // This guards the `FrameworkColumn.meta`/`internal` split invariant.
    const project = createTestProject();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'int_customers',
      from: { model: 'model_a' },
      select: [
        {
          name: 'col_a',
          type: 'dim',
          expr: 'UPPER(col_a)',
          prefix: 'customer',
          exclude_from_group_by: true,
          override_suffix_agg: true,
        } as any,
        {
          name: 'col_b',
          type: 'fct',
          agg: 'sum',
        } as any,
        {
          name: 'col_c',
          type: 'fct',
          aggs: ['sum', 'max'],
          lightdash: { metrics_merge: { group_label: 'Revenue' } },
        } as any,
        {
          name: 'datetime',
          type: 'dim',
          interval: 'day',
        } as any,
      ],
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);

    const forbidden = [
      'agg',
      'aggs',
      'expr',
      'prefix',
      'exclude_from_group_by',
      'interval',
      'override_suffix_agg',
      'metrics_merge',
    ];

    for (const [name, meta] of columns.entries()) {
      for (const denied of forbidden) {
        expect({ column: name, meta }).not.toHaveProperty(['meta', denied]);
      }
    }
  });
});

describe('model meta — column-level inheritance', () => {
  test('passthrough select inherits free-form column meta from the upstream model', () => {
    // Upstream model exposes `meta.pii = true`; a downstream passthrough
    // column must surface the same key verbatim. This uses the standard
    // column-meta merge pipeline (frameworkProcessSelected + mergeDeep) with
    // free-form keys flowing through unchanged.
    const project = createTestProject({
      nodes: {
        ['model.project.stg_customers']: {
          columns: {
            email: {
              name: 'email',
              data_type: 'varchar',
              meta: {
                type: 'dim',
                pii: true,
                compliance: ['gdpr'],
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
      select: ['email'],
      from: { model: 'stg_customers' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    expect(columns.get('email')).toMatchObject({
      type: 'dim',
      pii: true,
      compliance: ['gdpr'],
    });
  });

  test('downstream free-form meta merges per-key with upstream (downstream wins on collision)', () => {
    const project = createTestProject({
      nodes: {
        ['model.project.stg_customers']: {
          columns: {
            email: {
              name: 'email',
              data_type: 'varchar',
              meta: {
                type: 'dim',
                pii: true,
                compliance: ['gdpr'],
                owner: 'upstream-team',
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
      select: [
        {
          name: 'email',
          type: 'dim',
          meta: { owner: 'downstream-team', notes: 'reviewed' },
        },
      ],
      from: { model: 'stg_customers' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    expect(columns.get('email')).toMatchObject({
      type: 'dim',
      pii: true,
      compliance: ['gdpr'],
      owner: 'downstream-team',
      notes: 'reviewed',
    });
  });

  test('expr-based rename does NOT inherit free-form meta from the upstream column', () => {
    const project = createTestProject({
      nodes: {
        ['model.project.stg_customers']: {
          columns: {
            customer_id: {
              name: 'customer_id',
              data_type: 'varchar',
              meta: {
                type: 'dim',
                pii: true,
                owner: 'upstream-team',
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
      select: [{ name: 'id', expr: 'customer_id', type: 'dim' }],
      from: { model: 'stg_customers' },
    };

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const columns = extractColumns(yml);
    const meta = columns.get('id');
    expect(meta).toBeDefined();
    expect(meta).not.toHaveProperty('pii');
    expect(meta).not.toHaveProperty('owner');
  });
});

describe('preserveColumnMetaOnUpdate — UI round-trip', () => {
  test('no-op when neither side has a select array', () => {
    const existing = { meta: { owner: 'foo' } };
    const incoming = { meta: { owner: 'foo' } };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming).toEqual({ meta: { owner: 'foo' } });
  });

  test('no-op when select items are strings (no meta possible)', () => {
    const existing = { select: ['col_a'] };
    const incoming = { select: ['col_a'] };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming).toEqual({ select: ['col_a'] });
  });

  test('preserves free-form column meta the UI did not send', () => {
    const existing = {
      select: [
        {
          name: 'col_a',
          type: 'dim',
          meta: { owner: 'data-eng', pii: true },
        },
      ],
    };
    const incoming = {
      // UI re-sent only the typed fields; `meta` is absent.
      select: [{ name: 'col_a', type: 'dim' }],
    };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming.select[0]).toEqual({
      name: 'col_a',
      type: 'dim',
      meta: { owner: 'data-eng', pii: true },
    });
  });

  test('incoming meta keys win on collision with existing meta', () => {
    const existing = {
      select: [
        {
          name: 'col_a',
          meta: { owner: 'old-team', pii: true },
        },
      ],
    };
    const incoming = {
      select: [
        {
          name: 'col_a',
          meta: { owner: 'new-team' },
        },
      ],
    };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming.select[0]).toEqual({
      name: 'col_a',
      meta: { owner: 'new-team', pii: true },
    });
  });

  test('does not restore meta when the column was renamed (name mismatch)', () => {
    const existing = {
      select: [{ name: 'col_a', meta: { owner: 'data-eng', pii: true } }],
    };
    const incoming = {
      select: [{ name: 'col_b', type: 'dim' }],
    };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming.select[0]).toEqual({ name: 'col_b', type: 'dim' });
  });

  test('preserves meta on some items while leaving untracked items untouched', () => {
    const existing = {
      select: [
        { name: 'col_a', meta: { pii: true } },
        { name: 'col_b', meta: { owner: 'data-eng' } },
      ],
    };
    const incoming = {
      select: [
        { name: 'col_a', type: 'dim' }, // UI didn't resend meta
        { name: 'col_b', type: 'dim', meta: { owner: 'new-team' } },
        'col_c', // string-form (added, no existing meta)
      ],
    };
    preserveColumnMetaOnUpdate(existing, incoming);
    expect(incoming.select).toEqual([
      { name: 'col_a', type: 'dim', meta: { pii: true } },
      { name: 'col_b', type: 'dim', meta: { owner: 'new-team' } },
      'col_c',
    ]);
  });
});
