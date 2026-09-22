import { describe, expect, test } from '@jest/globals';
import { frameworkGenerateModelOutput } from '@services/framework/utils';
import { extractFrameworkDependencies } from '@services/sync/dependencyGraph';
import type { FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

const project = createTestProject({
  nodes: {
    ['model.project.model_a']: {
      columns: {
        col_a: {
          name: 'col_a',
          data_type: 'varchar',
          meta: { type: 'dim' },
        },
      },
    },
    ['model.project.processed_orders']: {
      columns: {
        order_id: {
          name: 'order_id',
          data_type: 'varchar',
          meta: { type: 'dim' },
        },
      },
    },
    ['model.project.another_model']: {
      columns: {
        id: {
          name: 'id',
          data_type: 'varchar',
          meta: { type: 'dim' },
        },
      },
    },
  },
});

describe('depends_on SQL emission', () => {
  test('emits one --depends_on comment per value before config', () => {
    const modelJson = {
      type: 'int_select_model',
      group: 'ml',
      topic: 'test',
      name: 'with_forced_deps',
      select: ['col_a'],
      from: { model: 'model_a' },
      depends_on: ['processed_orders', 'another_model'],
    } as FrameworkModel;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(sql).toContain(
      `--depends_on: {{ ref('processed_orders') }}\n--depends_on: {{ ref('another_model') }}\n\n{{`,
    );
    expect(
      sql.indexOf("--depends_on: {{ ref('processed_orders') }}"),
    ).toBeLessThan(sql.indexOf('config('));
  });

  test('omits --depends_on lines when the field is absent', () => {
    const modelJson = {
      type: 'int_select_model',
      group: 'ml',
      topic: 'test',
      name: 'without_forced_deps',
      select: ['col_a'],
      from: { model: 'model_a' },
    } as FrameworkModel;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(sql).not.toContain('--depends_on:');
  });
});

describe('extractFrameworkDependencies with depends_on', () => {
  test('includes authored depends_on names alongside from.model', () => {
    const modelJson = {
      type: 'int_select_model',
      group: 'ml',
      topic: 'test',
      name: 'with_forced_deps',
      select: ['col_a'],
      from: { model: 'model_a' },
      depends_on: ['processed_orders', 'another_model'],
    } as FrameworkModel;

    const deps = extractFrameworkDependencies(modelJson);
    expect(deps).toEqual(
      expect.arrayContaining(['model_a', 'processed_orders', 'another_model']),
    );
    expect(deps).toHaveLength(3);
  });
});
