/**
 * Merge CLI flag overrides into a JSON payload object for the DJ bridge.
 * Used by `dj-cli` and unit-tested without the socket transport.
 */

export type CliFlagOverrides = {
  modelName?: string;
  projectName?: string;
  select?: string;
  sql?: string;
  depth?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize `input` to a flat request object, then overlay CLI flags (flags win).
 */
export function mergeCliPayload(
  input: unknown,
  flags: CliFlagOverrides,
): Record<string, unknown> | null {
  let base: Record<string, unknown> = {};

  if (input === null || input === undefined) {
    base = {};
  } else if (isPlainObject(input)) {
    if ('request' in input && isPlainObject(input.request)) {
      base = { ...(input.request as Record<string, unknown>) };
    } else {
      base = { ...input };
    }
  } else {
    return null;
  }

  if (flags.modelName !== undefined && flags.modelName.trim() !== '') {
    base.modelName = flags.modelName.trim();
  }
  if (flags.projectName !== undefined && flags.projectName.trim() !== '') {
    base.projectName = flags.projectName.trim();
  }
  if (flags.select !== undefined && flags.select.trim() !== '') {
    base.select = flags.select.trim();
  }
  if (flags.sql !== undefined && flags.sql.trim() !== '') {
    base.sql = flags.sql.trim();
  }
  if (flags.depth !== undefined && !Number.isNaN(flags.depth)) {
    base.depth = flags.depth;
  }

  return base;
}
