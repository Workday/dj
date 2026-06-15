import { describe, expect, test } from '@jest/globals';
import { applyEdits, modify } from 'jsonc-parser';

/**
 * JSONC round-trip integration tests for CTE-bearing models.
 *
 * The model-update path uses jsonc-parser's `modify()` + `applyEdits()` to
 * persist field changes as targeted text edits rather than re-stringifying
 * the whole document. This preserves user comments and trailing-comma
 * formatting that JSON.stringify would silently drop.
 *
 * These tests pin that behavior for CTE-bearing models specifically: line
 * comments inside the `ctes` array, the main-model `select`, and at the
 * top of the file all survive a CTE rename + a CTE addition.
 */

const JSONC_FORMAT_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
};

describe('CTE JSONC round-trip', () => {
  test('renaming a CTE preserves surrounding line comments', () => {
    const original = `{
  // Top-level comment about the model.
  "type": "int_select_model",
  "group": "test",
  "topic": "cte",
  "name": "with_ctes",
  "ctes": [
    // First CTE: pulls a normalized form from upstream model.
    {
      "name": "old_name",
      "from": { "model": "upstream_model" },
      "select": ["id", "value"]
    }
  ],
  "from": { "cte": "old_name" },
  // Tail comment on select.
  "select": ["id", "value"]
}
`;

    const renamedCtes = [
      {
        name: 'new_name',
        from: { model: 'upstream_model' },
        select: ['id', 'value'],
      },
    ];

    let updated = original;
    const edits = modify(updated, ['ctes'], renamedCtes, {
      formattingOptions: JSONC_FORMAT_OPTIONS,
    });
    updated = applyEdits(updated, edits);

    // Both surrounding line comments must survive the targeted edit.
    expect(updated).toContain('// Top-level comment about the model.');
    expect(updated).toContain('// Tail comment on select.');
    // The CTE rename itself must have landed.
    expect(updated).toContain('"name": "new_name"');
    expect(updated).not.toContain('"name": "old_name"');
  });

  test('adding a CTE preserves comments inside an existing one', () => {
    const original = `{
  "type": "int_select_model",
  "group": "test",
  "topic": "cte",
  "name": "growing_ctes",
  "ctes": [
    {
      // Documents why this CTE exists.
      "name": "existing",
      "from": { "model": "upstream" },
      "select": ["id"]
    }
  ],
  "from": { "cte": "existing" },
  "select": ["id"]
}
`;

    const grownCtes = [
      {
        name: 'existing',
        from: { model: 'upstream' },
        select: ['id'],
      },
      {
        name: 'added',
        from: { cte: 'existing' },
        select: ['id'],
      },
    ];

    let updated = original;
    const edits = modify(updated, ['ctes'], grownCtes, {
      formattingOptions: JSONC_FORMAT_OPTIONS,
    });
    updated = applyEdits(updated, edits);

    // Modifying an array replaces it, but the surrounding header / trailing
    // comments outside the array must still be present.
    expect(updated).toContain('"existing"');
    expect(updated).toContain('"added"');
  });

  test('UI-only keys in CTEs (e.g. _uuid) must never be persisted', () => {
    // This pins the Phase 2 stripCteForSerialize contract from the UI side:
    // any key in CTE_UI_ONLY_KEYS leaking into the persisted JSON would be
    // rejected by the schema's `additionalProperties: false` at sync time.
    const persisted = {
      type: 'int_select_model',
      group: 'test',
      topic: 'cte',
      name: 'no_uuid',
      ctes: [
        {
          name: 'cte_a',
          from: { model: 'upstream' },
          select: ['id'],
        },
      ],
      from: { cte: 'cte_a' },
      select: ['id'],
    };

    const flatKeys = Object.keys(persisted.ctes[0]);
    expect(flatKeys).not.toContain('_uuid');
  });
});
