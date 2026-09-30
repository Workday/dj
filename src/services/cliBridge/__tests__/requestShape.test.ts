import {
  assertModelExistsPayload,
  assertModelUpdatePayload,
  assertNonEmptyModelName,
  assertQueryExecutePayload,
  assertWrappedModelJsonPayload,
  normalizeDbtCompileRequest,
  normalizeWrappedModelRequest,
} from '@services/cliBridge/requestShape';

describe('requestShape', () => {
  it('assertWrappedModelJsonPayload accepts modelJson object', () => {
    expect(() =>
      assertWrappedModelJsonPayload('model.preview', {
        modelJson: { type: 'stg_select_source', name: 'x' },
      }),
    ).not.toThrow();
  });

  it('assertModelExistsPayload requires identity fields on modelJson', () => {
    expect(() =>
      assertModelExistsPayload({
        modelJson: { type: 'stg_select_source', group: 'g', topic: 't', name: 'n' },
      }),
    ).not.toThrow();
    expect(() =>
      assertModelExistsPayload({
        modelJson: { type: 'stg_select_source', group: 'g', topic: 't' },
      }),
    ).toThrow(/modelJson\.name/);
  });

  it('assertModelUpdatePayload requires path and modelJson', () => {
    expect(() =>
      assertModelUpdatePayload({
        originalModelPath: '/abs/path.model.json',
        modelJson: { type: 'int_select_model' },
      }),
    ).not.toThrow();
    expect(() =>
      assertModelUpdatePayload({
        modelName: 'int__a__b__c',
        modelJson: { type: 'int_select_model' },
      }),
    ).not.toThrow();
    expect(() =>
      assertModelUpdatePayload({
        modelName: 'int__a__b__c',
        type: 'int_select_model',
        group: 'g',
        topic: 't',
        name: 'n',
      }),
    ).toThrow(/modelJson/);
  });

  it('normalizeWrappedModelRequest wraps flat create bodies', () => {
    const wrapped = normalizeWrappedModelRequest({
      type: 'int_select_model',
      group: 'g',
      topic: 't',
      name: 'n',
      from: { model: 'stg__g__t__x' },
    });
    expect(wrapped.modelJson).toMatchObject({
      type: 'int_select_model',
      name: 'n',
    });
  });

  it('normalizeDbtCompileRequest rejects unknown keys and requires modelName or select', () => {
    expect(() =>
      normalizeDbtCompileRequest('dbt.compile', {
        modelName: 'mart__a',
        foo: 'bar',
      }),
    ).toThrow(/unknown key/);
    expect(() =>
      normalizeDbtCompileRequest('dbt.compile', { projectName: 'opus' }),
    ).toThrow(/modelName.*select/);
    const normalized = normalizeDbtCompileRequest('dbt.compile', {
      select: 'mart__a int__b',
      projectName: 'opus',
    });
    expect(normalized.select).toBe('mart__a int__b');
  });

  it('assertNonEmptyModelName rejects missing modelName', () => {
    expect(() => assertNonEmptyModelName('model.columns', {})).toThrow(
      /modelName/,
    );
    expect(() =>
      assertNonEmptyModelName('model.lineage', { modelName: '  ' }),
    ).toThrow(/modelName/);
    expect(() =>
      assertNonEmptyModelName('model.lineage', { modelName: 'mart__a' }),
    ).not.toThrow();
  });

  it('assertQueryExecutePayload requires sql', () => {
    expect(() => assertQueryExecutePayload(null)).toThrow(/sql/);
    expect(() => assertQueryExecutePayload({})).toThrow(/sql/);
    expect(() =>
      assertQueryExecutePayload({ sql: 'SELECT 1 LIMIT 1' }),
    ).not.toThrow();
  });

  it('normalizeDbtCompileRequest maps modelNames array and string', () => {
    expect(
      normalizeDbtCompileRequest('dbt.compile', {
        modelNames: ['mart__a'],
      }).modelName,
    ).toBe('mart__a');
    expect(() =>
      normalizeDbtCompileRequest('dbt.compile', {
        modelNames: ['mart__a', 'int__b'],
      }),
    ).toThrow(/select/);
    expect(
      normalizeDbtCompileRequest('dbt.compile', {
        modelNames: 'mart__a int__b',
      }).select,
    ).toBe('mart__a int__b');
  });
});
