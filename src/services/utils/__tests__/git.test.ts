import { describe, expect, it } from '@jest/globals';
import { gitLastLog } from '@services/utils/git';

const sample = (action: string, message = 'something happened') =>
  `0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 Test User <test@example.com> 1234567890 +0000\t${action}: ${message}`;

describe('gitLastLog', () => {
  it('parses a checkout entry as the "checkout" action', () => {
    const { action, line } = gitLastLog(
      sample('checkout', 'moving from main to feature/foo'),
    );
    expect(action).toBe('checkout');
    expect(line).toContain('checkout: moving from main to feature/foo');
  });

  it('parses a pull entry as the "pull" action', () => {
    const { action } = gitLastLog(sample('pull', 'Fast-forward'));
    expect(action).toBe('pull');
  });

  it('parses a commit entry as the "commit" action', () => {
    const { action } = gitLastLog(sample('commit', 'Initial commit'));
    expect(action).toBe('commit');
  });

  it('uses only the last log line when multiple are present', () => {
    const logs = [
      sample('commit', 'first'),
      sample('checkout', 'moving from main to feature/x'),
    ].join('\n');
    const { action, line } = gitLastLog(logs);
    expect(action).toBe('checkout');
    expect(line).toContain('moving from main to feature/x');
  });

  it('ignores trailing blank lines when picking the last entry', () => {
    const logs = sample('checkout', 'moving from main to feature/y') + '\n\n';
    const { action } = gitLastLog(logs);
    expect(action).toBe('checkout');
  });

  it('returns an undefined action for malformed lines without a tab/action', () => {
    const { action, line } = gitLastLog('not-a-real-git-log-line');
    expect(action).toBeUndefined();
    expect(line).toBe('not-a-real-git-log-line');
  });

  it('returns line="" and undefined action for empty input', () => {
    const { action, line } = gitLastLog('');
    expect(line).toBe('');
    expect(action).toBeUndefined();
  });
});
