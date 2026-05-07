import { describe, expect, test } from '@jest/globals';
import {
  collectModelMetaLintWarnings,
  COLUMN_META_POPULATED_RESERVED_KEYS,
  COLUMN_META_SQL_INTERNAL_RESERVED_KEYS,
  MODEL_META_POPULATED_RESERVED_KEYS,
} from '@services/framework/utils/meta-lint';
import type { FrameworkModel } from '@shared/framework/types';

/**
 * Unit tests for the reserved-key lint pass that surfaces user-authored
 * collisions in model-level and column-level `meta` as structured
 * warnings. The framework wins silently at YAML emit time; these warnings
 * flag the conflict in the Problems tab so the collision isn't invisible.
 */

describe('collectModelMetaLintWarnings — model-level meta', () => {
  test('no warnings when meta has only user-authored free-form keys', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'finops',
      topic: 'aws_cur',
      name: 'mart_aws_cur',
      meta: {
        owner: 'finops-team',
        owner_slack: '#finops-team',
        freshness_sla: 'daily by 06:00 UTC',
      },
      select: ['col_a'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    expect(collectModelMetaLintWarnings(modelJson)).toEqual([]);
  });

  test.each(MODEL_META_POPULATED_RESERVED_KEYS)(
    'warns when user authors populated-reserved model key `%s` under meta',
    (reservedKey) => {
      const modelJson = {
        type: 'mart_select_model',
        group: 'finops',
        topic: 'aws_cur',
        name: 'mart_aws_cur',
        meta: {
          [reservedKey]: 'user_value',
          owner: 'finops-team',
        },
        select: ['col_a'],
        from: { model: 'model_a' },
      } as unknown as FrameworkModel;

      const warnings = collectModelMetaLintWarnings(modelJson);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].instancePath).toBe(`/meta/${reservedKey}`);
      expect(warnings[0].message).toContain(`\`meta.${reservedKey}\``);
      expect(warnings[0].message).toContain('framework-populated');
    },
  );

  test('warns when a user key in meta collides with a lightdash.table key', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      meta: {
        label: 'user_label',
        owner: 'data-eng',
      },
      lightdash: {
        table: {
          label: 'lightdash_label',
        },
      },
      select: ['col_a'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const warnings = collectModelMetaLintWarnings(modelJson);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].instancePath).toBe('/meta/label');
    expect(warnings[0].message).toContain('lightdash.table.label');
  });

  test('does not warn on user meta keys that do not collide with any lightdash.table key', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      meta: {
        owner: 'data-eng',
      },
      lightdash: {
        table: {
          group_label: 'Customers',
        },
      },
      select: ['col_a'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    expect(collectModelMetaLintWarnings(modelJson)).toEqual([]);
  });

  test('handles missing meta / missing lightdash block gracefully', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: ['col_a'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    expect(collectModelMetaLintWarnings(modelJson)).toEqual([]);
  });
});

describe('collectModelMetaLintWarnings — column-level meta', () => {
  test('no warnings when select items have only free-form meta keys', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        {
          name: 'email',
          type: 'dim',
          meta: { pii: true, owner: 'privacy-team' },
        },
      ],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    expect(collectModelMetaLintWarnings(modelJson)).toEqual([]);
  });

  test.each(COLUMN_META_POPULATED_RESERVED_KEYS)(
    'warns when user authors populated-reserved column key `%s` under select meta',
    (reservedKey) => {
      const modelJson = {
        type: 'mart_select_model',
        group: 'marketing',
        topic: 'customers',
        name: 'mart_customers',
        select: [
          {
            name: 'email',
            type: 'dim',
            meta: { [reservedKey]: 'user_value' },
          },
        ],
        from: { model: 'model_a' },
      } as unknown as FrameworkModel;

      const warnings = collectModelMetaLintWarnings(modelJson);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].instancePath).toBe(`/select/0/meta/${reservedKey}`);
      expect(warnings[0].message).toContain(`\`meta.${reservedKey}\``);
      expect(warnings[0].message).toContain('framework-populated');
      expect(warnings[0].message).toContain('select `email`');
    },
  );

  test.each(COLUMN_META_SQL_INTERNAL_RESERVED_KEYS)(
    'warns when user authors SQL-internal reserved column key `%s` under select meta',
    (reservedKey) => {
      const modelJson = {
        type: 'mart_select_model',
        group: 'marketing',
        topic: 'customers',
        name: 'mart_customers',
        select: [
          {
            name: 'revenue',
            type: 'fct',
            meta: { [reservedKey]: 'user_value' },
          },
        ],
        from: { model: 'model_a' },
      } as unknown as FrameworkModel;

      const warnings = collectModelMetaLintWarnings(modelJson);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].instancePath).toBe(`/select/0/meta/${reservedKey}`);
      expect(warnings[0].message).toContain('SQL-internal');
      expect(warnings[0].message).toContain(`\`meta.${reservedKey}\``);
    },
  );

  test('points at the correct select index when multiple items collide', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        { name: 'id', type: 'dim' },
        {
          name: 'email',
          type: 'dim',
          meta: { dimension: 'user_value' },
        },
        { name: 'revenue', type: 'fct', meta: { expr: 'sum(r)' } },
      ],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const warnings = collectModelMetaLintWarnings(modelJson);
    expect(warnings).toHaveLength(2);
    const paths = warnings.map((w) => w.instancePath).sort();
    expect(paths).toEqual(['/select/1/meta/dimension', '/select/2/meta/expr']);
  });

  test('falls back to `select[i]` when the select item has no name', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: [
        {
          type: 'dim',
          meta: { type: 'dim' },
        },
      ],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const warnings = collectModelMetaLintWarnings(modelJson);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('select `select[0]`');
  });

  test('string shorthand select items (e.g. "col_a") produce no warnings', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      select: ['col_a', 'col_b'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    expect(collectModelMetaLintWarnings(modelJson)).toEqual([]);
  });
});

describe('collectModelMetaLintWarnings — edge cases', () => {
  test('escapes JSON pointer special chars in reserved key segments', () => {
    // None of the reserved keys contain `/` or `~` today, but the helper
    // applies RFC-6901 escaping so future additions stay well-formed.
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      meta: { metrics: {} },
      select: ['col_a'],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const warnings = collectModelMetaLintWarnings(modelJson);
    expect(warnings[0].instancePath).toBe('/meta/metrics');
  });

  test('returns warnings for both model-level and column-level collisions in one pass', () => {
    const modelJson = {
      type: 'mart_select_model',
      group: 'marketing',
      topic: 'customers',
      name: 'mart_customers',
      meta: { metrics: {}, owner: 'data-eng' },
      select: [
        { name: 'id', type: 'dim', meta: { type: 'dim' } },
        { name: 'revenue', type: 'fct', meta: { expr: 'sum(r)' } },
      ],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const warnings = collectModelMetaLintWarnings(modelJson);
    expect(warnings).toHaveLength(3);
    expect(warnings.map((w) => w.instancePath).sort()).toEqual([
      '/meta/metrics',
      '/select/0/meta/type',
      '/select/1/meta/expr',
    ]);
  });
});
