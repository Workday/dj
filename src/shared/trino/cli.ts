/**
 * Helpers for building Trino CLI invocations.
 */

/**
 * Build the argument vector for a Trino CLI invocation.
 *
 * Returning an argv array (rather than a single command string) is what keeps
 * SQL text and file paths inside a single argument. Because callers spawn the
 * CLI with `shell: false`, nothing returned here is re-parsed by a shell, so
 * quotes, semicolons, and other metacharacters in `execute` cannot break out of
 * the `--execute` argument or inject additional commands.
 */
export function buildTrinoCliArgs(
  params: { raw?: boolean } & ({ execute: string } | { file: string }),
): string[] {
  const args: string[] =
    'file' in params ? ['--file', params.file] : ['--execute', params.execute];

  if (!params.raw) {
    // CSV_HEADER handles complex Trino types (arrays, maps, structs) that the
    // CLI's JSON format cannot serialize.
    args.push('--output-format=CSV_HEADER');
  }

  return args;
}
