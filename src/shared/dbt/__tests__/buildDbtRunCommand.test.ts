import { buildDbtRunCommand } from '@shared/dbt/utils';

describe('buildDbtRunCommand', () => {
  it('uses raw select override when config.select is set', () => {
    const cmd = buildDbtRunCommand({
      cleanAndDeps: false,
      seed: false,
      build: false,
      defer: false,
      favorState: false,
      fullRefresh: false,
      scope: 'single',
      modelName: 'int__a__b__c',
      lineage: 'model-only',
      select: '+int__a__b__c+',
    });
    expect(cmd).toContain('--select "+int__a__b__c+"');
  });

  it('maps lineage upstream to leading plus', () => {
    const cmd = buildDbtRunCommand({
      cleanAndDeps: false,
      seed: false,
      build: false,
      defer: false,
      favorState: false,
      fullRefresh: false,
      scope: 'single',
      modelName: 'int__a__b__c',
      lineage: 'upstream',
    });
    expect(cmd).toContain('--select "+int__a__b__c"');
  });
});
