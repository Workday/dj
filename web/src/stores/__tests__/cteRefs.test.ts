import { describe, expect, test } from '@jest/globals';

import { visitCteRefs } from '../cteRefs';

/**
 * Unit tests for the standalone CTE reference walker. The walker is the
 * core primitive behind `applyCteRename` and `removeCte`; covering every
 * reference site here keeps those store actions testable without spinning
 * up the full Zustand store.
 *
 * "rename" = visitor returns a non-empty string (rewrite to that string).
 * "delete" = visitor returns the empty string ('' is the strip sentinel).
 */
describe('visitCteRefs', () => {
  test('renames cte reference at ctes[].from.cte', () => {
    const draft = {
      ctes: [
        {
          name: 'a',
          from: { model: 'upstream' },
          select: ['id'],
        },
        {
          name: 'b',
          from: { cte: 'a' },
          select: ['id'],
        },
      ],
      modelingState: { from: {} },
    };
    const out = visitCteRefs(draft, (_, name) =>
      name === 'a' ? 'a_renamed' : undefined,
    );
    expect(out.ctes[1].from).toEqual({ cte: 'a_renamed' });
  });

  test('deletes cte reference at ctes[].from.union.ctes', () => {
    const draft = {
      ctes: [
        { name: 'a', from: { model: 'm' }, select: ['id'] },
        { name: 'b', from: { model: 'm' }, select: ['id'] },
        {
          name: 'c',
          from: {
            cte: 'a',
            union: { ctes: ['b'] },
          },
          select: ['id'],
        },
      ],
      modelingState: { from: {} },
    };
    const out = visitCteRefs(draft, (_, name) =>
      name === 'b' ? '' : undefined,
    );
    const finalFrom = out.ctes[2].from as Record<string, unknown>;
    // Stripping the only entry from `union.ctes` collapses the union
    // wrapper away entirely -- otherwise the result would be a partial
    // structure that fails schema validation (`union.ctes` requires
    // minItems: 1).
    expect(finalFrom.union).toBeUndefined();
    expect(finalFrom.cte).toBe('a');
  });

  test('renames cte reference at modelingState.from.cte', () => {
    const draft = {
      ctes: [],
      modelingState: { from: { cte: 'orig' } },
    };
    const out = visitCteRefs(draft, (_, name) =>
      name === 'orig' ? 'final' : undefined,
    );
    const fromObj = (out.modelingState as Record<string, unknown>).from as {
      cte?: string;
    };
    expect(fromObj.cte).toBe('final');
  });

  test('renames cte reference at modelingState.select[].cte', () => {
    const draft = {
      ctes: [],
      modelingState: {
        from: {},
        select: [
          { type: 'all_from_cte', cte: 'a' },
          { cte: 'a', name: 'col1', type: 'dim' },
        ],
      },
    };
    const out = visitCteRefs(draft, (_, name) =>
      name === 'a' ? 'a_v2' : undefined,
    );
    const select = (out.modelingState as { select: { cte?: string }[] }).select;
    expect(select[0].cte).toBe('a_v2');
    expect(select[1].cte).toBe('a_v2');
  });

  test('renames cte reference inside subquery in where', () => {
    const draft = {
      ctes: [],
      modelingState: {
        from: {},
        where: {
          and: [
            {
              subquery: {
                operator: 'in',
                column: 'id',
                select: ['id'],
                from: { cte: 'inner_cte' },
              },
            },
          ],
        },
      },
    };
    const out = visitCteRefs(draft, (_, name) =>
      name === 'inner_cte' ? 'renamed_inner' : undefined,
    );
    const where = (out.modelingState as { where: { and: any[] } }).where;
    expect(where.and[0].subquery.from.cte).toBe('renamed_inner');
  });

  test('does not touch unrelated string keys', () => {
    const draft = {
      ctes: [
        {
          name: 'a',
          from: { model: 'just_a_model_name' },
          select: ['some_column_name'],
        },
      ],
      modelingState: { from: {} },
    };
    const before = JSON.stringify(draft);
    const out = visitCteRefs(draft, () => 'WRECKED');
    // Visitor only fires for known CTE reference sites, so this must be
    // a structural no-op despite the visitor unconditionally rewriting.
    expect(JSON.stringify(out)).toBe(before);
  });

  test('walker is pure: input draft is not mutated', () => {
    const draft = {
      ctes: [
        { name: 'a', from: { model: 'm' }, select: ['id'] },
        { name: 'b', from: { cte: 'a' }, select: ['id'] },
      ],
      modelingState: { from: { cte: 'a' } },
    };
    const snapshot = JSON.stringify(draft);
    visitCteRefs(draft, (_, name) => (name === 'a' ? 'mutated' : undefined));
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});
