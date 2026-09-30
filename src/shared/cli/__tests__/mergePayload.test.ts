import { mergeCliPayload } from '@shared/cli/mergePayload';

describe('mergeCliPayload', () => {
  it('overlays flags onto file payload', () => {
    const merged = mergeCliPayload(
      { modelName: 'old' },
      { modelName: 'mart__a__b__c', projectName: 'opus' },
    );
    expect(merged).toEqual({
      modelName: 'mart__a__b__c',
      projectName: 'opus',
    });
  });

  it('unwraps request envelope', () => {
    const merged = mergeCliPayload(
      { request: { sql: 'select 1' } },
      { sql: 'select 2' },
    );
    expect(merged?.sql).toBe('select 2');
  });

  it('returns null for non-object input', () => {
    expect(mergeCliPayload('bad', {})).toBeNull();
  });
});
