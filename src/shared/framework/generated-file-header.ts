/**
 * Version header stamped on the first line of every DJ-generated runtime
 * file (`_trino_io.py`, `_config.py`, `_model_tasks.py`, the etl helper bundle).
 * The header lets DJ tell an outdated file from a newer one written by a
 * teammate's DJ, so regeneration never downgrades content pulled from git.
 */
export const GENERATED_FILE_HEADER_PREFIX = '# dj-generated:';

const HEADER_REGEX = /^# dj-generated: version=(\S+)(?:[ \t].*)?$/;

export interface GeneratedFileHeader {
  version: string;
}

export interface ParsedGeneratedFile {
  header?: GeneratedFileHeader;
  /** File content after the header line, with LF line endings. */
  body: string;
}

export type GeneratedFileDecision =
  | {
      action: 'write';
      reason:
        | 'missing'
        | 'unversioned'
        | 'outdated'
        | 'changed'
        | 'legacy-header';
    }
  | {
      action: 'keep';
      reason: 'up-to-date' | 'newer' | 'conflict' | 'git-operation';
      fileVersion?: string;
    };

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Prefix `body` with a `# dj-generated:` header for `version`. */
export function withGeneratedHeader(body: string, version: string): string {
  const normalized = normalizeLineEndings(body);
  return `${GENERATED_FILE_HEADER_PREFIX} version=${version}\n${normalized}`;
}

export function parseGeneratedFile(content: string): ParsedGeneratedFile {
  const normalized = normalizeLineEndings(content);
  const newlineIndex = normalized.indexOf('\n');
  const firstLine =
    newlineIndex === -1 ? normalized : normalized.slice(0, newlineIndex);
  const match = HEADER_REGEX.exec(firstLine);
  if (!match) {
    return { body: normalized };
  }
  return {
    header: { version: match[1] },
    body: newlineIndex === -1 ? '' : normalized.slice(newlineIndex + 1),
  };
}

/**
 * Compare two `major.minor.patch[-prerelease]` versions. Returns a negative
 * number when `a < b`, positive when `a > b`, and 0 when equal. A prerelease
 * sorts below the release with the same core version.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  const length = Math.max(coreA.length, coreB.length);
  for (let i = 0; i < length; i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  if (preA === preB) {
    return 0;
  }
  if (!preA) {
    return 1;
  }
  if (!preB) {
    return -1;
  }
  return preA < preB ? -1 : 1;
}

function splitVersion(version: string): [number[], string] {
  const [core, ...pre] = version.trim().replace(/^v/, '').split('-');
  const parts = core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return [parts, pre.join('-')];
}

/** True when git left unresolved conflict markers in the file. */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(?: |$)/m.test(text) && /^>{7}(?: |$)/m.test(text);
}

/**
 * Decide whether DJ should (re)write a generated file.
 *
 * - Missing, unversioned, or outdated files are rewritten when body differs.
 * - Files whose body already matches are kept even when the header names an
 *   older version, so a DJ upgrade with unchanged output produces no diff.
 * - Files whose body matches but whose header carries extra fields (the
 *   earlier `sha256=` form) are rewritten once to the version-only header.
 * - Files stamped by a newer DJ, or containing conflict markers, are kept.
 */
export function decideGeneratedFileAction({
  existing,
  desiredBody,
  version,
}: {
  existing: string | undefined;
  desiredBody: string;
  version: string;
}): GeneratedFileDecision {
  if (existing === undefined) {
    return { action: 'write', reason: 'missing' };
  }
  if (hasConflictMarkers(normalizeLineEndings(existing))) {
    return { action: 'keep', reason: 'conflict' };
  }

  const { header, body } = parseGeneratedFile(existing);
  if (!header) {
    return { action: 'write', reason: 'unversioned' };
  }

  const versionOrder = compareVersions(header.version, version);
  if (versionOrder > 0) {
    return { action: 'keep', reason: 'newer', fileVersion: header.version };
  }

  if (body === normalizeLineEndings(desiredBody)) {
    const firstLine = normalizeLineEndings(existing).split('\n', 1)[0];
    if (
      firstLine !== `${GENERATED_FILE_HEADER_PREFIX} version=${header.version}`
    ) {
      return { action: 'write', reason: 'legacy-header' };
    }
    return { action: 'keep', reason: 'up-to-date' };
  }
  return { action: 'write', reason: versionOrder < 0 ? 'outdated' : 'changed' };
}
