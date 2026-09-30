import {
  validateRollupInterval,
  validateRollupOutputColumns,
} from '@services/modelValidation';
import type { FrameworkColumn } from '@shared/framework/types';

describe('rollup validation', () => {
  it('rejects week rollup interval with guidance', () => {
    const errors = validateRollupInterval({
      from: { model: 'x', rollup: { interval: 'week' } },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/week/);
    expect(errors[0].message).toMatch(/day, hour, month, year/);
  });

  it('flags non-suffix fct columns on rollup models', () => {
    const columns: FrameworkColumn[] = [
      {
        name: 'utilization_pct',
        meta: { type: 'fct' },
        internal: { expr: 'allocated_gb / total_gb' },
      },
    ];
    const errors = validateRollupOutputColumns(
      { from: { model: 'x', rollup: { interval: 'month' } } },
      columns,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/utilization_pct/);
  });
});
