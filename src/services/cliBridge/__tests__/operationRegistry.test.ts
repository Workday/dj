import { describe, expect, it } from '@jest/globals';
import {
  createOperationRegistry,
  dispatch,
} from '@services/cliBridge/operationRegistry';
import type { OperationContext } from '@shared/cli/types';

/**
 * Build a context whose `handleApi` records the last payload it received, so
 * tests can assert exactly what a handler forwarded to the extension API.
 */
function makeCtx(projectNames: string[] = ['analytics']): {
  ctx: OperationContext;
  calls: Array<{ type: string; request: unknown }>;
} {
  const calls: Array<{ type: string; request: unknown }> = [];
  const ctx: OperationContext = {
    api: {
      handleApi: (payload: unknown) => {
        calls.push(payload as { type: string; request: unknown });
        return Promise.resolve({ echoed: payload });
      },
    },
    projectNames: () => projectNames,
    version: '9.9.9',
  };
  return { ctx, calls };
}

describe('operationRegistry — read tier', () => {
  it('registers the expected read ops as side-effect read', () => {
    const reg = createOperationRegistry();
    const readOps = [
      'dbt.projects',
      'dbt.models',
      'dbt.sources',
      'dbt.modified-models',
      'dbt.compiled-status',
      'dbt.model-outdated',
      'trino.catalogs',
      'trino.schemas',
      'trino.tables',
      'trino.columns',
    ];
    for (const name of readOps) {
      expect(reg[name]).toBeDefined();
      expect(reg[name].sideEffect).toBe('read');
    }
  });

  it('nullable op forwards request: null (dbt.projects)', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'dbt.projects', null, ctx);
    expect(calls).toEqual([{ type: 'dbt-fetch-projects', request: null }]);
  });

  it('plain-fields op forwards the flat payload verbatim (trino.columns)', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    const input = { catalog: 'c', schema: 's', table: 't' };
    await dispatch(reg, 'trino.columns', input, ctx);
    expect(calls).toEqual([
      { type: 'trino-fetch-columns', request: input },
    ]);
  });

  it('accepts an explicit { request } envelope as an escape hatch', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'trino.schemas', { request: { catalog: 'c' } }, ctx);
    expect(calls).toEqual([
      { type: 'trino-fetch-schemas', request: { catalog: 'c' } },
    ]);
  });

  it('infers projectName for a single-project workspace (dbt.models)', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(reg, 'dbt.models', null, ctx);
    expect(calls).toEqual([
      { type: 'dbt-fetch-available-models', request: { projectName: 'analytics' } },
    ]);
  });

  it('honors an explicit projectName when provided', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['a', 'b']);
    await dispatch(reg, 'dbt.compiled-status', { modelName: 'm', projectName: 'b' }, ctx);
    expect(calls).toEqual([
      {
        type: 'dbt-check-compiled-status',
        request: { modelName: 'm', projectName: 'b' },
      },
    ]);
  });

  it('errors listing projects when projectName is ambiguous', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx(['a', 'b']);
    await expect(dispatch(reg, 'dbt.models', null, ctx)).rejects.toThrow(
      /Multiple dbt projects found.*a, b/,
    );
  });

  it('errors when no dbt project exists', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx([]);
    await expect(dispatch(reg, 'dbt.models', null, ctx)).rejects.toThrow(
      /No dbt projects found/,
    );
  });

  it('rejects a non-object payload for a plain-fields op', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(dispatch(reg, 'trino.schemas', 'oops', ctx)).rejects.toThrow(
      /must be a JSON object/,
    );
  });
});

describe('operationRegistry — dispatch + capabilities', () => {
  it('throws on an unknown operation', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(dispatch(reg, 'bogus.op', null, ctx)).rejects.toThrow(
      /Unknown operation: bogus\.op/,
    );
  });

  it('system.capabilities enumerates every registered op', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    const result = (await dispatch(reg, 'system.capabilities', null, ctx)) as {
      operations: Array<{ name: string; sideEffect: string }>;
    };
    const names = result.operations.map((o) => o.name);
    expect(names).toEqual(expect.arrayContaining(['dbt.models', 'trino.columns', 'model.create']));
    expect(result.operations.length).toBe(Object.keys(reg).length);
  });

  it('model.create resolves projectName then forwards framework-model-create', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    const res = (await dispatch(
      reg,
      'model.create',
      { type: 'stg_select_source', topic: 'sales', name: 'customers' },
      ctx,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(calls[0].type).toBe('framework-model-create');
    expect((calls[0].request as { projectName: string }).projectName).toBe('analytics');
  });
});
