/** Suffix that identifies a query draft file. */
export const DRAFT_SQL_SUFFIX = '.draft.sql';

/** Shown when no draft can be resolved; names the next step for the user. */
export const NO_DRAFT_FOUND_MESSAGE =
  'No query draft found. Click into a .draft.sql file in the editor, then run the command again.';

/** True when the path names a `.draft.sql` file. */
export function isDraftSqlPath(filePath: string | null | undefined): boolean {
  return !!filePath && filePath.endsWith(DRAFT_SQL_SUFFIX);
}

/** True for `.draft.sql` files and anything stored under `.dj/drafts/`. */
export function isDjDraftPath(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }
  if (isDraftSqlPath(filePath)) {
    return true;
  }
  return /[\\/]\.dj[\\/]drafts[\\/]/.test(filePath);
}

interface TabLike {
  isActive?: boolean;
  input?: unknown;
}

interface TabGroupLike {
  readonly tabs: readonly TabLike[];
}

function tabFsPath(tab: TabLike): string | undefined {
  const input = tab.input as { uri?: { fsPath?: string } } | undefined;
  return input?.uri?.fsPath;
}

/**
 * Pick a draft file from the editor tab groups. Active tabs win over
 * inactive ones, so the draft the user last focused is preferred.
 */
export function findDraftPathInTabs(
  groups: readonly TabGroupLike[],
): string | undefined {
  const draftTabs = groups
    .flatMap((group) => group.tabs)
    .filter((tab) => isDraftSqlPath(tabFsPath(tab)));

  const chosen = draftTabs.find((tab) => tab.isActive) ?? draftTabs[0];
  return chosen ? tabFsPath(chosen) : undefined;
}

/** Cursor deep link that prefills the composer with a prompt. */
export const CURSOR_PROMPT_DEEPLINK =
  'cursor://anysphere.cursor-deeplink/prompt';

// Limits and rules copied from Cursor's bundled cursor-deeplink extension.
// Links that break them are rejected there, so we check first and fall back.
const CURSOR_PROMPT_MAX_LINK_LENGTH = 10000;
const CURSOR_PROMPT_LINK_OVERHEAD = 21;
const CURSOR_PROMPT_CHARSET =
  /^(?!.*(?:\p{Cf}|\u007F))[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Z}\r\n\t !-~]+$/u;
const CURSOR_PROMPT_BLOCKED = [
  /\.env(\b|\W)/,
  /read.*\.env.*print/i,
  /cat.*\.ssh\/id_rsa/i,
  /upload.*passwords\.txt/i,
  /dump.*token/i,
  /dump.*password/i,
  /exfiltrate.*credential/i,
  /leak.*secret/i,
  /how.*extract.*credential/i,
];

function decodeRepeatedly(text: string): string {
  let current = text;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

/**
 * Build a Cursor prompt deep link, or return null when Cursor would reject it
 * (empty text, unsupported characters, too long, or a blocked pattern).
 */
export function buildCursorPromptDeeplink(text: string): string | null {
  if (!text.trim() || !CURSOR_PROMPT_CHARSET.test(text)) {
    return null;
  }

  const encoded = encodeURIComponent(text);
  if (
    CURSOR_PROMPT_LINK_OVERHEAD + encoded.length >
    CURSOR_PROMPT_MAX_LINK_LENGTH
  ) {
    return null;
  }

  const variants = [text, decodeRepeatedly(text)].map((v) => v.toLowerCase());
  for (const variant of variants) {
    if (CURSOR_PROMPT_BLOCKED.some((pattern) => pattern.test(variant))) {
      return null;
    }
  }

  return `${CURSOR_PROMPT_DEEPLINK}?text=${encoded}`;
}

/** Return the path with the newest modification time, or undefined when empty. */
export function pickNewestDraft(
  entries: { path: string; mtimeMs: number }[],
): string | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    if (!newest || entry.mtimeMs > newest.mtimeMs) {
      newest = entry;
    }
  }
  return newest?.path;
}
