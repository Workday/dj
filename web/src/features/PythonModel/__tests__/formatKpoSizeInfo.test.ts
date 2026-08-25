import { describe, expect, test } from '@jest/globals';
import { formatKpoSizeInfo } from '@web/features/PythonModel/formatKpoSizeInfo';

describe('formatKpoSizeInfo', () => {
  test('formats single vCPU without pluralization', () => {
    expect(
      formatKpoSizeInfo({
        cpu: '1',
        memory: '2Gi',
        guidance: 'Light jobs.',
      }),
    ).toBe('1 vCPU, 2Gi memory — Light jobs.');
  });

  test('pluralizes vCPU when cpu is not 1', () => {
    expect(
      formatKpoSizeInfo({
        cpu: '2',
        memory: '4Gi',
        guidance: 'Typical ETL.',
      }),
    ).toBe('2 vCPUs, 4Gi memory — Typical ETL.');
  });

  test('omits guidance dash when guidance is empty', () => {
    expect(
      formatKpoSizeInfo({
        cpu: '2',
        memory: '8Gi',
        guidance: '',
      }),
    ).toBe('2 vCPUs, 8Gi memory');
  });
});
