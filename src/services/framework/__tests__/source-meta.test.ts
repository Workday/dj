import { describe, expect, test } from '@jest/globals';
import { frameworkGenerateSourceOutput } from '@services/framework/utils';
import { yamlParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type { FrameworkSource } from '@shared/framework/types';
import Ajv from 'ajv';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';

import { createTestProject } from './helpers';

/**
 * Build an Ajv instance pre-populated with every schema file in `schemas/`.
 * Mirrors how the runtime Framework service registers schemas (see
 * src/services/framework/index.ts) so the source validator can resolve $refs.
 */
function buildSourceValidator() {
  const schemasDir = path.join(__dirname, '../../../../schemas');
  // `strictSchema: 'log'` matches the runtime Framework service config and
  // lets us tolerate non-standard keywords like `allowTrailingCommas`. A
  // no-op logger keeps the strict-mode warnings out of test output.
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
  const validator = ajv.getSchema('source.schema.json');
  if (!validator) {
    throw new Error('source.schema.json failed to register');
  }
  return validator;
}

const project: DbtProject = createTestProject({ name: 'project' });

/**
 * Mirrors the `raw_orders` entry from the jaffle shop fixture at
 * docs/examples/jaffle_shop_lightdash/.../development__jaffle_shop_lightdash_dev_seeds.source.json
 * which already exercises the typed `event_datetime` and `partition_date`
 * meta keys. Free-form keys are layered on top in the tests below.
 */
const baseSourceJson: FrameworkSource = {
  database: 'development',
  schema: 'jaffle_shop_lightdash_dev_seeds',
  tables: [
    {
      name: 'raw_orders',
      meta: {
        event_datetime: { expr: 'ordered_at' },
        partition_date: {
          expr: 'ordered_at',
          data_type: 'timestamp',
          use_event_dates: true,
          use_range: true,
        },
      },
      columns: [
        { name: 'id', data_type: 'varchar', description: '' },
        { name: 'customer', data_type: 'varchar', description: '' },
        { name: 'ordered_at', data_type: 'timestamp(3)', description: '' },
        { name: 'store_id', data_type: 'varchar', description: '' },
        { name: 'subtotal', data_type: 'integer', description: '' },
        { name: 'tax_paid', data_type: 'integer', description: '' },
        { name: 'order_total', data_type: 'integer', description: '' },
      ],
    },
  ],
};

describe('source meta — free-form custom keys', () => {
  test('accepts arbitrary string keys at the source and table level via JSON Schema', () => {
    const validate = buildSourceValidator();

    const sourceJson: FrameworkSource = {
      ...baseSourceJson,
      meta: {
        owner: 'jaffle-shop-team',
        owner_slack: '#jaffle-shop',
      },
      tables: [
        {
          ...baseSourceJson.tables[0],
          meta: {
            owner: 'jaffle-shop-team',
            owner_slack: '#jaffle-shop',
            upstream_process: 'jaffle_shop_seed_loader',
            upstream_process_type: 'dbt seed',
            freshness_sla: 'daily by 06:00 UTC',
          },
        },
      ],
    };

    const valid = validate(sourceJson);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  test('typed and free-form meta keys can coexist on the same table', () => {
    const validate = buildSourceValidator();

    const sourceJson: FrameworkSource = {
      ...baseSourceJson,
      tables: [
        {
          ...baseSourceJson.tables[0],
          meta: {
            // Existing typed keys preserved from the jaffle shop fixture
            ...baseSourceJson.tables[0].meta,
            // Free-form additions
            owner: 'jaffle-shop-team',
            freshness_sla: 'daily by 06:00 UTC',
          },
        },
      ],
    };

    const valid = validate(sourceJson);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  test('round-trips arbitrary meta keys verbatim into the generated YAML', () => {
    const sourceJson: FrameworkSource = {
      ...baseSourceJson,
      meta: {
        owner: 'jaffle-shop-team',
        owner_slack: '#jaffle-shop',
      },
      tables: [
        {
          ...baseSourceJson.tables[0],
          meta: {
            ...baseSourceJson.tables[0].meta,
            owner: 'jaffle-shop-team',
            owner_slack: '#jaffle-shop',
            upstream_process: 'jaffle_shop_seed_loader',
            upstream_process_type: 'dbt seed',
            freshness_sla: 'daily by 06:00 UTC',
          },
        },
      ],
    };

    const { yml } = frameworkGenerateSourceOutput({ project, sourceJson });
    const parsed = yamlParse(yml) as {
      sources: Array<{
        meta?: Record<string, unknown>;
        tables: Array<{ name: string; meta?: Record<string, unknown> }>;
      }>;
    };

    const [source] = parsed.sources;
    expect(source.meta).toEqual({
      owner: 'jaffle-shop-team',
      owner_slack: '#jaffle-shop',
    });

    const table = source.tables.find((t) => t.name === 'raw_orders');
    expect(table?.meta).toEqual({
      event_datetime: { expr: 'ordered_at' },
      partition_date: {
        expr: 'ordered_at',
        data_type: 'timestamp',
        use_event_dates: true,
        use_range: true,
      },
      owner: 'jaffle-shop-team',
      owner_slack: '#jaffle-shop',
      upstream_process: 'jaffle_shop_seed_loader',
      upstream_process_type: 'dbt seed',
      freshness_sla: 'daily by 06:00 UTC',
    });
  });
});
