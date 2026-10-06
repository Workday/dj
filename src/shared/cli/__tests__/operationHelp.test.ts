import {
  CLI_OPERATION_NAMES,
  formatGlobalHelp,
  formatOperationHelpSummary,
  getOperationHelp,
  listOperationHelp,
} from '@shared/cli/operationHelp';
import { createOperationRegistry } from '@services/cliBridge/operationRegistry';

describe('operationHelp', () => {
  it('lists help for every bridge op except system.help', () => {
    const registry = createOperationRegistry();
    const registryNames = Object.keys(registry).filter((n) => n !== 'system.help');
    expect(registryNames.sort()).toEqual([...CLI_OPERATION_NAMES].sort());
    for (const name of registryNames) {
      expect(getOperationHelp(name)).toBeDefined();
    }
  });

  it('listOperationHelp matches CLI_OPERATION_NAMES length', () => {
    expect(listOperationHelp()).toHaveLength(CLI_OPERATION_NAMES.length);
  });

  it('formatOperationHelpSummary returns error for unknown op', () => {
    const result = formatOperationHelpSummary('not.real');
    expect(result).toMatchObject({ error: expect.stringContaining('Unknown') });
  });

  it('formatGlobalHelp includes usage and op names', () => {
    const g = formatGlobalHelp();
    expect(g.usage).toContain('--help');
    expect(g.operations).toContain('model.lineage');
  });

  it('model.create uses fileFlatBody preferred invoke', () => {
    const h = getOperationHelp('model.create');
    expect(h?.preferredInvoke).toBe('fileFlatBody');
    expect(h?.exampleFile).toBe('examples/model-create.request.json');
  });
});
