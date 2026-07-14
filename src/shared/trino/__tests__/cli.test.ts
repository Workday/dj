import { describe, expect, it } from '@jest/globals';
import { buildTrinoCliArgs } from '@shared/trino/cli';

describe('buildTrinoCliArgs', () => {
  it('keeps a metacharacter-laden SQL string as a single --execute argument', () => {
    // A payload that would break out of a shell-quoted command string. As an
    // argv element it must remain intact so shell: false spawning is safe.
    const sql =
      "select 1 from project.x'; id > /tmp/dj_poc.txt; echo '.dbt_sources";
    const args = buildTrinoCliArgs({ execute: sql });

    expect(args[0]).toBe('--execute');
    expect(args[1]).toBe(sql);
    // The SQL is exactly one argument -- never split on quotes or semicolons.
    expect(args.filter((a) => a === sql)).toHaveLength(1);
    expect(args).toContain('--output-format=CSV_HEADER');
  });

  it('omits the output format when raw is requested', () => {
    const args = buildTrinoCliArgs({ execute: 'select 1', raw: true });
    expect(args).toEqual(['--execute', 'select 1']);
  });

  it('uses --file for file-based execution as a single argument', () => {
    const filepath = "/tmp/dj sql/'; touch pwned; '.sql";
    const args = buildTrinoCliArgs({ file: filepath });

    expect(args[0]).toBe('--file');
    expect(args[1]).toBe(filepath);
    expect(args).toContain('--output-format=CSV_HEADER');
  });
});
