import { describe, expect, test } from '@jest/globals';
import { frameworkMakeModelTemplate } from '@services/framework/utils/sql-utils';

describe('frameworkMakeModelTemplate materialization', () => {
  test('emits materialization shorthand instead of deprecated materialized', () => {
    const model = frameworkMakeModelTemplate({
      projectName: 'p',
      type: 'int_select_model',
      group: 'g',
      topic: 't',
      name: 'n',
      materialized: 'ephemeral',
      from: { model: 'stg__x' },
      select: [],
    });

    expect(model).toMatchObject({ materialization: 'ephemeral' });
    expect(model).not.toHaveProperty('materialized');
  });

  test('folds legacy incremental_strategy and partitioned_by into materialization', () => {
    const model = frameworkMakeModelTemplate({
      projectName: 'p',
      type: 'int_select_model',
      group: 'g',
      topic: 't',
      name: 'n',
      materialized: 'incremental',
      incremental_strategy: { type: 'append' },
      partitioned_by: ['portal_partition_daily'],
      from: { model: 'stg__x' },
      select: [],
    });

    expect((model as { materialization?: unknown }).materialization).toEqual({
      type: 'incremental',
      strategy: { type: 'append' },
      partitions: ['portal_partition_daily'],
    });
    expect(model).not.toHaveProperty('incremental_strategy');
    expect(model).not.toHaveProperty('partitioned_by');
  });
});
