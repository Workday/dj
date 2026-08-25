import { describe, expect, test } from '@jest/globals';

import { readKpoSizesTemplate } from '@services/framework/utils/kpo-sizes';

describe('readKpoSizesTemplate', () => {
  test('loads cpu, memory, and guidance for all preset sizes', async () => {
    const sizes = await readKpoSizesTemplate();

    expect(sizes.small).toEqual({
      cpu: '1',
      memory: '2Gi',
      guidance: expect.stringContaining('Light jobs'),
    });
    expect(sizes.medium).toEqual({
      cpu: '2',
      memory: '4Gi',
      guidance: expect.stringContaining('Typical ETL'),
    });
    expect(sizes.large?.cpu).toBe('2');
    expect(sizes.large?.memory).toBe('8Gi');
    expect(sizes.xlarge?.memory).toBe('16Gi');
  });
});
