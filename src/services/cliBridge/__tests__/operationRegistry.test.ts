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
    // A loaded project is a stand-in object keyed by name; dbt.parse forwards it.
    getProject: (name: string) =>
      projectNames.includes(name) ? { pathRelative: name } : undefined,
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

describe('operationRegistry — authoring tier', () => {
  it('registers authoring mutate ops with sideEffect mutate', () => {
    const reg = createOperationRegistry();
    for (const name of ['model.create', 'source.create', 'model.update']) {
      expect(reg[name].sideEffect).toBe('mutate');
    }
  });

  it('registers authoring read ops with sideEffect read', () => {
    const reg = createOperationRegistry();
    for (const name of ['model.preview', 'model.exists', 'model.cte-analysis']) {
      expect(reg[name].sideEffect).toBe('read');
    }
  });

  it('source.create infers projectName and forwards the flat payload', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(
      reg,
      'source.create',
      { trinoCatalog: 'c', trinoSchema: 's', trinoTable: 't' },
      ctx,
    );
    expect(calls).toEqual([
      {
        type: 'framework-source-create',
        request: {
          trinoCatalog: 'c',
          trinoSchema: 's',
          trinoTable: 't',
          projectName: 'analytics',
        },
      },
    ]);
  });

  it('model.preview forwards to framework-model-preview', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'model.preview', { name: 'x', projectName: 'analytics' }, ctx);
    expect(calls[0].type).toBe('framework-model-preview');
  });
});

describe('operationRegistry — mutate tier', () => {
  it('registers dbt mutate ops as mutate', () => {
    const reg = createOperationRegistry();
    for (const name of ['dbt.compile', 'dbt.compile-logs', 'dbt.parse', 'dbt.run']) {
      expect(reg[name].sideEffect).toBe('mutate');
    }
  });

  it('dbt.compile forwards { modelName, projectName }', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(reg, 'dbt.compile', { modelName: 'm' }, ctx);
    expect(calls).toEqual([
      {
        type: 'dbt-model-compile',
        request: { modelName: 'm', projectName: 'analytics' },
      },
    ]);
  });

  it('dbt.parse resolves name to the project object and forwards { project }', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(reg, 'dbt.parse', null, ctx);
    expect(calls).toEqual([
      {
        type: 'dbt-parse-project',
        request: { project: { pathRelative: 'analytics' } },
      },
    ]);
  });

  it('dbt.parse rejects an unknown / unloaded project', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx(['analytics']);
    await expect(
      dispatch(reg, 'dbt.parse', { projectName: 'ghost' }, ctx),
    ).rejects.toThrow(/project 'ghost' is not loaded/);
  });

  it('dbt.run lifts projectName into config and forwards { config }', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(reg, 'dbt.run', { modelName: 'm' }, ctx);
    expect(calls).toEqual([
      {
        type: 'dbt-run-model',
        request: { config: { modelName: 'm', projectName: 'analytics' } },
      },
    ]);
  });

  it('dbt.run accepts an explicit { config } object', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx(['analytics']);
    await dispatch(reg, 'dbt.run', { config: { modelName: 'm' } }, ctx);
    expect(calls).toEqual([
      {
        type: 'dbt-run-model',
        request: { config: { modelName: 'm', projectName: 'analytics' } },
      },
    ]);
  });
});

describe('operationRegistry — query & data read tier', () => {
  it('registers query/data ops as read', () => {
    const reg = createOperationRegistry();
    for (const name of [
      'model.compiled-sql',
      'model.query',
      'model.lineage',
      'model.reverse-lineage',
      'query.execute',
    ]) {
      expect(reg[name].sideEffect).toBe('read');
    }
  });

  it('model.reverse-lineage forwards the flat { kind, slug } payload', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'model.reverse-lineage', { kind: 'chart', slug: 's' }, ctx);
    expect(calls).toEqual([
      {
        type: 'data-explorer-get-reverse-lineage',
        request: { kind: 'chart', slug: 's' },
      },
    ]);
  });

  it('query.execute forwards a SELECT with its limit', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'query.execute', { sql: 'select 1', limit: 10 }, ctx);
    expect(calls).toEqual([
      {
        type: 'query-draft-execute',
        request: { sql: 'select 1', limit: 10 },
      },
    ]);
  });

  it('query.execute allows WITH / SHOW / a leading comment', async () => {
    const reg = createOperationRegistry();
    const { ctx, calls } = makeCtx();
    await dispatch(reg, 'query.execute', { sql: 'with t as (select 1) select * from t' }, ctx);
    await dispatch(reg, 'query.execute', { sql: 'SHOW TABLES' }, ctx);
    await dispatch(reg, 'query.execute', { sql: '-- note\nselect 1' }, ctx);
    expect(calls).toHaveLength(3);
  });

  it('query.execute rejects a non-SELECT statement', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(
      dispatch(reg, 'query.execute', { sql: 'delete from t' }, ctx),
    ).rejects.toThrow(/read-only SELECT/);
  });

  it('query.execute rejects multiple statements', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(
      dispatch(reg, 'query.execute', { sql: 'select 1; drop table t' }, ctx),
    ).rejects.toThrow(/single read-only statement/);
  });

  it('query.execute rejects empty sql', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(
      dispatch(reg, 'query.execute', { sql: '   ' }, ctx),
    ).rejects.toThrow(/non-empty 'sql'/);
  });

  it('query.execute rejects a statement hidden behind a block comment', async () => {
    const reg = createOperationRegistry();
    const { ctx } = makeCtx();
    await expect(
      dispatch(reg, 'query.execute', { sql: '/* select */ delete from t' }, ctx),
    ).rejects.toThrow(/read-only SELECT/);
  });
});
