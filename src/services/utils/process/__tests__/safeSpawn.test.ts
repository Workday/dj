/**
 * Unit tests for the Windows escaping helpers behind `safeSpawn`. They guard the
 * Windows batch path against command injection: when a `.cmd` / `.bat` shim is
 * run through `cmd.exe`, every metacharacter in the command and its arguments
 * must be caret-escaped so a value derived from an untrusted `dbt_project.yml`
 * (or any repository-controlled string) stays inert data and can never start a
 * second command.
 *
 * The POSIX path and the Windows executable resolution touch the real
 * filesystem / platform, so they are exercised at the integration level rather
 * than here; these tests pin the pure, platform-independent escaping logic.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildBatchCmdArgs,
  escapeArgument,
  escapeCommand,
  isBatchFile,
} from '@services/utils/process/safeSpawn';

/** Return the single `cmd.exe` command-line token produced by the builder. */
function commandLineFor(command: string, args: readonly string[]): string {
  const built = buildBatchCmdArgs(command, args);
  return built[built.length - 1];
}

describe('isBatchFile', () => {
  it('matches .bat / .cmd regardless of case', () => {
    for (const file of [
      'dbt.cmd',
      'dbt.CMD',
      'lightdash.bat',
      'C:\\tools\\trino.BaT',
    ]) {
      expect(isBatchFile(file)).toBe(true);
    }
  });

  it('does not match executables or extension-less names', () => {
    for (const file of ['trino.exe', 'dbt.com', 'lightdash', 'a.cmd.exe']) {
      expect(isBatchFile(file)).toBe(false);
    }
  });
});

describe('escapeCommand', () => {
  it('leaves a metacharacter-free path untouched', () => {
    expect(escapeCommand('C:\\tools\\trino.cmd')).toBe('C:\\tools\\trino.cmd');
  });

  it('caret-escapes cmd.exe metacharacters in the path', () => {
    expect(escapeCommand('a&b')).toBe('a^&b');
    expect(escapeCommand('a b')).toBe('a^ b');
  });
});

describe('escapeArgument', () => {
  it('quotes and double-escapes a plain argument (batch double-parse)', () => {
    // cmd.exe parses a batch invocation twice, so metacharacters are escaped
    // twice; the surrounding quotes are themselves metacharacters.
    expect(escapeArgument('foo')).toBe('^^^"foo^^^"');
  });

  it('backslash-escapes an embedded double quote so it cannot close the arg', () => {
    expect(escapeArgument('a"b')).toContain('\\');
  });
});

describe('buildBatchCmdArgs', () => {
  it('emits the /d /s /c prefix and wraps the whole line in quotes', () => {
    const built = buildBatchCmdArgs('C:\\tools\\lightdash.cmd', ['upload']);
    expect(built.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const line = built[3];
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
  });
});

describe('safeSpawn batch builder neutralizes command injection', () => {
  it('escapes a command-injection proof-of-concept payload', () => {
    // A proof-of-concept payload that closes a quoted context and chains a
    // command with redirection.
    const line = commandLineFor('C:\\tools\\dbt.cmd', [
      "x'; id > /tmp/dj_poc.txt; echo '",
    ]);
    // The raw redirection sequence never survives; the metacharacter is escaped
    // and the path text remains inert data.
    expect(line).not.toContain('> /tmp');
    expect(line).toMatch(/\^+>/);
  });

  it.each<[string, string, string, RegExp]>([
    ['ampersand command chaining', 'a & calc', '& calc', /\^+&/],
    ['pipe', 'a | whoami', '| whoami', /\^+\|/],
    ['output redirection', 'a > out.txt', '> out.txt', /\^+>/],
    ['env-var expansion', '%USERPROFILE%', '%USERPROFILE%', /\^+%/],
  ])('neutralizes %s', (_label, payload, rawInjection, escapedPattern) => {
    const line = commandLineFor('C:\\tools\\dbt.cmd', [payload]);
    // The raw injection substring must not appear verbatim, and its
    // metacharacter must be caret-escaped.
    expect(line).not.toContain(rawInjection);
    expect(line).toMatch(escapedPattern);
  });

  it('preserves the literal (non-meta) portion of a chained payload as data', () => {
    const line = commandLineFor('C:\\tools\\dbt.cmd', ['a & calc']);
    expect(line).toContain('calc');
    expect(line).not.toContain('& calc');
  });

  it('escapes a quote-breakout that tries to close the arg and chain', () => {
    const line = commandLineFor('C:\\tools\\dbt.cmd', ['a" & calc & "b']);
    expect(line).not.toContain('" & calc');
    expect(line).toMatch(/\^+&/);
  });
});
