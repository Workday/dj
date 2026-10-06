import { validateLightdashMetrics } from '@shared/lightdash/validateMetrics';

describe('validateLightdashMetrics', () => {
  it('flags invalid template refs and duplicate metric names', () => {
    const result = validateLightdashMetrics(
      {
        lightdash: {
          metrics: [
            {
              name: 'utilization_pct',
              sql: '100.0 * ${used_gb_sum} / NULLIF(${allocated_gb_sum}, 0)',
            },
            { name: 'utilization_pct', sql: '1' },
          ],
        },
      },
      ['allocated_gb_sum', 'used_gb_sum'],
    );
    expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown field'))).toBe(false);
  });

  it('reports unknown field references', () => {
    const result = validateLightdashMetrics(
      {
        lightdash: {
          metrics: [
            {
              name: 'bad',
              sql: '100.0 * ${missing_metric} / ${allocated_gb_sum}',
            },
          ],
        },
      },
      ['allocated_gb_sum'],
    );
    expect(result.errors.some((e) => e.includes('missing_metric'))).toBe(true);
  });
});
