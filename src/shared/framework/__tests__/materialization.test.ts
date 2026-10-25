import { describe, expect, test } from '@jest/globals';
import {
  buildMaterializationForWizardOutput,
  getIncrementalStrategy,
  getMaterializationType,
  getPartitions,
  materializationInsertionIndex,
  normalizeMaterializationFromLegacyRequest,
  pickMaterializationExtras,
} from '@shared/framework/materialization';

describe('materialization helpers', () => {
  test('getMaterializationType resolves legacy and nested shapes', () => {
    expect(getMaterializationType({ materialized: 'ephemeral' })).toBe(
      'ephemeral',
    );
    expect(getMaterializationType({ materialization: 'incremental' })).toBe(
      'incremental',
    );
    expect(
      getMaterializationType({
        materialization: { type: 'incremental', strategy: { type: 'append' } },
      }),
    ).toBe('incremental');
  });

  test('getIncrementalStrategy prefers nested strategy', () => {
    expect(
      getIncrementalStrategy({
        materialization: {
          type: 'incremental',
          strategy: { type: 'merge', unique_key: 'id' },
        },
        incremental_strategy: { type: 'append' },
      }),
    ).toEqual({ type: 'merge', unique_key: 'id' });
    expect(
      getIncrementalStrategy({
        incremental_strategy: { type: 'delete+insert' },
      }),
    ).toEqual({ type: 'delete+insert' });
  });

  test('getPartitions prefers nested partitions', () => {
    expect(
      getPartitions({
        materialization: {
          type: 'incremental',
          partitions: ['portal_partition_daily'],
        },
        partitioned_by: ['other'],
      }),
    ).toEqual(['portal_partition_daily']);
  });

  test('pickMaterializationExtras copies wizard-non-owned keys', () => {
    expect(
      pickMaterializationExtras({
        type: 'incremental',
        format: 'iceberg',
        strategy: { type: 'append' },
        partitions: ['x'],
      }),
    ).toEqual({ format: 'iceberg' });
  });

  test('buildMaterializationForWizardOutput uses string shorthand when minimal', () => {
    expect(buildMaterializationForWizardOutput({ type: 'ephemeral' })).toBe(
      'ephemeral',
    );
    expect(buildMaterializationForWizardOutput({ type: 'incremental' })).toBe(
      'incremental',
    );
  });

  test('buildMaterializationForWizardOutput uses object when strategy or partitions set', () => {
    expect(
      buildMaterializationForWizardOutput({
        type: 'incremental',
        strategy: { type: 'delete+insert' },
        partitions: ['portal_partition_daily'],
      }),
    ).toEqual({
      type: 'incremental',
      strategy: { type: 'delete+insert' },
      partitions: ['portal_partition_daily'],
    });
  });

  test('normalizeMaterializationFromLegacyRequest folds flat fields', () => {
    expect(
      normalizeMaterializationFromLegacyRequest({
        materialized: 'incremental',
        incremental_strategy: { type: 'append' },
        partitioned_by: ['portal_partition_daily'],
      }),
    ).toEqual({
      type: 'incremental',
      strategy: { type: 'append' },
      partitions: ['portal_partition_daily'],
    });
  });

  test('materializationInsertionIndex uses the legacy materialized slot', () => {
    expect(
      materializationInsertionIndex(['type', 'name', 'materialized', 'from']),
    ).toBe(2);
    expect(materializationInsertionIndex(['type', 'name'])).toBe(2);
  });
});
