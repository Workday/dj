/**
 * Detects destructive SQL statements (DROP / DELETE / TRUNCATE) inside Python
 * model files. DJ blocks these in user-authored python models to protect data;
 * the safe DML helpers in python_models/_trino_io.py should be used instead.
 */

export interface DangerousSqlMatch {
  /** 0-based line index */
  line: number;
  /** 0-based start column */
  startCol: number;
  /** 0-based end column (exclusive) */
  endCol: number;
  /** The offending statement keyword, e.g. "DROP" */
  statement: string;
}

const DANGEROUS_SQL_PATTERNS: { regex: RegExp; label: string }[] = [
  {
    regex: /\bDROP\s+(TABLE|SCHEMA|VIEW|DATABASE|MATERIALIZED\s+VIEW)\b/gi,
    label: 'DROP',
  },
  { regex: /\bTRUNCATE\b/gi, label: 'TRUNCATE' },
  { regex: /\bDELETE\s+FROM\b/gi, label: 'DELETE' },
];

/**
 * Scan text for destructive SQL statements and return positional matches.
 * Matching is line-based so callers can build precise diagnostic ranges.
 */
export function findDangerousSqlStatements(text: string): DangerousSqlMatch[] {
  const matches: DangerousSqlMatch[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIndex) => {
    for (const { regex, label } of DANGEROUS_SQL_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(line)) !== null) {
        matches.push({
          line: lineIndex,
          startCol: match.index,
          endCol: match.index + match[0].length,
          statement: label,
        });
        // Guard against zero-width matches causing an infinite loop
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }
  });

  return matches;
}
