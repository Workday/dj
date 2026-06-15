import type { CteState } from './useModelStore';

/**
 * Visitor signature for `visitCteRefs`. Called once per CTE reference site.
 *
 *   - Return `undefined` to leave the reference unchanged.
 *   - Return a string to rewrite the reference (rename).
 *   - Return `''` to request that the reference be stripped (delete).
 *
 * `path` is a JSON-pointer-ish location of the visited site (e.g.
 * `ctes/2/from/cte` or `modelingState/select/3/cte`). It is used by callers
 * for snackbars / logging, never for semantic decisions.
 */
export type CteRefVisitor = (
  kind: 'cte',
  name: string,
  path: string,
) => string | undefined;

type ModelingDraft = {
  ctes?: CteState[];
  modelingState?: Record<string, unknown>;
  // The walker also tolerates `from` / `select` / `where` / `having` / `join`
  // at the top level so it can be applied to a flattened `buildModelJson()`
  // draft as well.
  from?: unknown;
  select?: unknown;
  where?: unknown;
  having?: unknown;
  join?: unknown;
};

/**
 * Visit every CTE reference site in a model draft and apply the visitor.
 *
 * Reference sites covered (1:1 with the plan's "Reference Walker" list):
 *
 *   - `ctes[*].from.cte`
 *   - `ctes[*].from.union.ctes[]`
 *   - `ctes[*].from.join[].cte` (CTE-as-join-target)
 *   - `ctes[*].select[].cte` (named CTE selects + `*_from_cte` bulk)
 *   - `modelingState.from.cte`
 *   - `modelingState.from.union.ctes[]`
 *   - `modelingState.from.join[].cte`
 *   - `modelingState.select[].cte`
 *   - Subquery `from.cte` recursively inside any `where` / `having` (anywhere
 *     -- main model, CTEs, join `on`).
 *
 * Pure: never mutates the input. Callers receive a structurally-cloned draft
 * with rewrites applied. This is the lowest-risk way to implement rename and
 * delete-and-strip; callers wrap it in a two-line action.
 */
export function visitCteRefs<T extends ModelingDraft>(
  draft: T,
  fn: CteRefVisitor,
): T {
  // Structural clone so the caller's input is not mutated. We can safely
  // deep-clone via JSON because all visited values are plain JSON-safe data
  // (no Maps, no Dates, no functions live under these subtrees).
  const cloned: T = JSON.parse(JSON.stringify(draft));

  if (Array.isArray(cloned.ctes)) {
    for (let i = 0; i < cloned.ctes.length; i++) {
      const cte = cloned.ctes[i];
      visitCteFromAndSelect(cte, fn, `ctes/${i}`);
      visitWhereLike(cte.where, fn, `ctes/${i}/where`);
      visitWhereLike(cte.having, fn, `ctes/${i}/having`);
    }
  }

  if (cloned.modelingState && typeof cloned.modelingState === 'object') {
    visitModelingState(cloned.modelingState, fn, 'modelingState');
  }

  // Top-level support (callers may pass a flat `buildModelJson()` draft).
  visitFlatTopLevel(cloned, fn);

  return cloned;
}

function visitFlatTopLevel(draft: ModelingDraft, fn: CteRefVisitor): void {
  if (draft.from && typeof draft.from === 'object') {
    visitFromObject(draft.from as Record<string, unknown>, fn, 'from');
  }
  if (Array.isArray(draft.select)) {
    visitSelectArray(draft.select, fn, 'select');
  }
  if (Array.isArray(draft.join)) {
    visitJoinArray(draft.join, fn, 'join');
  }
  visitWhereLike(draft.where, fn, 'where');
  visitWhereLike(draft.having, fn, 'having');
}

function visitModelingState(
  state: Record<string, unknown>,
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  const fromVal = state.from;
  if (fromVal && typeof fromVal === 'object') {
    visitFromObject(
      fromVal as Record<string, unknown>,
      fn,
      `${pathPrefix}/from`,
    );
  }
  const selectVal = state.select;
  if (Array.isArray(selectVal)) {
    visitSelectArray(selectVal, fn, `${pathPrefix}/select`);
  }
  const joinVal = state.join;
  if (Array.isArray(joinVal)) {
    visitJoinArray(joinVal, fn, `${pathPrefix}/join`);
  }
  visitWhereLike(state.where, fn, `${pathPrefix}/where`);
  visitWhereLike(state.having, fn, `${pathPrefix}/having`);
}

function visitCteFromAndSelect(
  cte: CteState,
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  if (cte.from && typeof cte.from === 'object') {
    visitFromObject(cte.from, fn, `${pathPrefix}/from`);
  }
  if (Array.isArray(cte.select)) {
    visitSelectArray(cte.select, fn, `${pathPrefix}/select`);
  }
}

function visitFromObject(
  from: Record<string, unknown>,
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  // from.cte
  if (typeof from.cte === 'string' && from.cte) {
    const next = fn('cte', from.cte, `${pathPrefix}/cte`);
    if (next === '') {
      delete from.cte;
    } else if (typeof next === 'string') {
      from.cte = next;
    }
  }

  // from.union.ctes[]
  const union = from.union;
  if (union && typeof union === 'object') {
    const u = union as Record<string, unknown>;
    if (Array.isArray(u.ctes)) {
      const newList: string[] = [];
      for (let i = 0; i < u.ctes.length; i++) {
        const ref = u.ctes[i];
        if (typeof ref !== 'string') {
          continue;
        }
        const next = fn('cte', ref, `${pathPrefix}/union/ctes/${i}`);
        if (next === '') {
          continue;
        }
        newList.push(typeof next === 'string' ? next : ref);
      }
      // Preserve schema's `[string, ...string[]]` (minItems: 1) by stripping
      // the `union` wrapper entirely if the resulting list is empty.
      if (newList.length === 0) {
        delete from.union;
      } else {
        u.ctes = newList;
      }
    }
  }

  // from.join[].cte
  if (Array.isArray(from.join)) {
    visitJoinArray(from.join, fn, `${pathPrefix}/join`);
  }
}

function visitJoinArray(
  joins: unknown[],
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  for (let i = 0; i < joins.length; i++) {
    const j = joins[i];
    if (!j || typeof j !== 'object') {
      continue;
    }
    const obj = j as Record<string, unknown>;
    if (typeof obj.cte === 'string' && obj.cte) {
      const next = fn('cte', obj.cte, `${pathPrefix}/${i}/cte`);
      if (next === '') {
        delete obj.cte;
      } else if (typeof next === 'string') {
        obj.cte = next;
      }
    }
    // Subqueries inside join `on.and[*].subquery` and `on.or[*].subquery`.
    const on = obj.on;
    if (on && typeof on === 'object') {
      visitWhereLike(on, fn, `${pathPrefix}/${i}/on`);
    }
  }
}

function visitSelectArray(
  items: unknown[],
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') {
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.cte === 'string' && obj.cte) {
      const next = fn('cte', obj.cte, `${pathPrefix}/${i}/cte`);
      if (next === '') {
        delete obj.cte;
      } else if (typeof next === 'string') {
        obj.cte = next;
      }
    }
  }
}

/**
 * Walk a where/having-shaped tree (the schema permits string, AND/OR groups,
 * nested groups, and subqueries) and visit any subquery `from.cte`.
 */
function visitWhereLike(
  node: unknown,
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === 'and' || key === 'or') {
      const arr = obj[key];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i];
          if (!entry || typeof entry !== 'object') {
            continue;
          }
          const e = entry as Record<string, unknown>;
          // Nested group: {group: <where>}
          if (e.group) {
            visitWhereLike(e.group, fn, `${pathPrefix}/${key}/${i}/group`);
          }
          // Inline subquery: {subquery: {...}}
          if (e.subquery && typeof e.subquery === 'object') {
            visitSubquery(
              e.subquery as Record<string, unknown>,
              fn,
              `${pathPrefix}/${key}/${i}/subquery`,
            );
          }
        }
      }
    } else if (key === 'subquery') {
      // Some shapes nest subquery directly on the node (e.g. join `on.and[*]`)
      const sq = obj[key];
      if (sq && typeof sq === 'object') {
        visitSubquery(
          sq as Record<string, unknown>,
          fn,
          `${pathPrefix}/${key}`,
        );
      }
    }
  }
}

function visitSubquery(
  sq: Record<string, unknown>,
  fn: CteRefVisitor,
  pathPrefix: string,
): void {
  const from = sq.from;
  if (from && typeof from === 'object') {
    const f = from as Record<string, unknown>;
    if (typeof f.cte === 'string' && f.cte) {
      const next = fn('cte', f.cte, `${pathPrefix}/from/cte`);
      if (next === '') {
        delete f.cte;
      } else if (typeof next === 'string') {
        f.cte = next;
      }
    }
  }
  if (sq.where) {
    visitWhereLike(sq.where, fn, `${pathPrefix}/where`);
  }
}
