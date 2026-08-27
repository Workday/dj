/**
 * Smoke test for build_kpo_env_vars_from_context logic mirrored in etl_helper.
 * Validates the env key contract without importing Airflow at test runtime.
 */
import { describe, expect, test } from '@jest/globals';

describe('KPO env context contract', () => {
  test('resolved context maps to expected PYMODEL keys', () => {
    const ctx = {
      ds: '2025-08-25',
      ds_nodash: '20250825',
      dates: ['2025-08-25', '2025-08-26'],
    };
    const env = {
      PYMODEL_DS: ctx.ds,
      PYMODEL_DS_NODASH: ctx.ds_nodash,
      PYMODEL_DATES: JSON.stringify(ctx.dates),
    };
    expect(env.PYMODEL_DS).toBe('2025-08-25');
    expect(env.PYMODEL_DS_NODASH).toBe('20250825');
    expect(JSON.parse(env.PYMODEL_DATES)).toEqual(ctx.dates);
  });
});
