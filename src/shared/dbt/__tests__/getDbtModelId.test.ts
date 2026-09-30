import { getDbtModelId } from '@shared/dbt/utils';

describe('getDbtModelId', () => {
  it('throws when modelName is not a string', () => {
    expect(() =>
      // @ts-expect-error intentional bad input
      getDbtModelId({ modelName: undefined, projectName: 'opus' }),
    ).toThrow(/modelName must be a string/);
  });

  it('builds model id for short name', () => {
    expect(
      getDbtModelId({ modelName: 'mart__a__b__c', projectName: 'opus' }),
    ).toBe('model.opus.mart__a__b__c');
  });

  it('preserves legacy empty name for incomplete model JSON during SQL gen', () => {
    expect(getDbtModelId({ modelName: '', projectName: 'opus' })).toBe(
      'model.opus.',
    );
  });
});
