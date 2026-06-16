import {
  ClipboardDocumentIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
import { sqlFormat } from '@shared/sql/utils';
import { makeClassName } from '@web';
import { Button, CodeBlock, Text } from '@web/elements';
import { useThemeMode } from '@web/hooks';
import { useEffect, useMemo, useState } from 'react';

export type QuerySqlCardProps = {
  sql?: string;
  className?: string;
};

/**
 * Right-hand card on the Overview tab. Pretty-prints the submitted
 * SQL with the shared `sqlFormat` helper and renders it through the
 * design-system `CodeBlock` so SQL highlighting matches the Model
 * Preview view (same `react-syntax-highlighter` theme tokens).
 * Formatting failures fall back to the raw text so the card never
 * goes blank on unusual SQL shapes.
 *
 * The card seeds its theme from the webview's `data-theme` attribute
 * via the shared `useThemeMode` hook and exposes a Moon/Sun icon
 * toggle so the reader can override locally — useful for reviewing
 * dark SQL on a light-themed VS Code window or vice versa. The
 * override resets whenever VS Code itself toggles theme, matching
 * the behaviour of the Model Preview toggle.
 *
 * The "Query SQL" heading + theme toggle + Copy SQL action live in
 * a sticky header row so the actions stay reachable as the SQL body
 * scrolls. Both actions are icon-only (`p-1`) so the header collapses
 * to the same height as the sibling `MetadataCard` heading — the
 * Overview tab reads as a balanced two-column layout. The
 * single-thickness `border-neutral` matches `QueryInfoCard` for
 * dark-mode parity.
 */
export function QuerySqlCard({ sql, className }: QuerySqlCardProps) {
  // The card starts in the VS Code theme but the user can flip to
  // the opposite syntax-highlighter palette for readability (e.g.
  // when reviewing dark SQL in a light-themed VS Code window).
  // We seed local state from the system theme and reset it whenever
  // VS Code itself toggles, so the user's manual override stays in
  // effect until they next switch VS Code's theme. Mirrors the
  // toggle in Model Preview for consistency.
  const systemTheme = useThemeMode();
  const [theme, setTheme] = useState<'light' | 'dark'>(systemTheme);
  useEffect(() => {
    setTheme(systemTheme);
  }, [systemTheme]);

  const formattedSql = useMemo(() => {
    if (!sql) return '';
    try {
      return sqlFormat(sql);
    } catch {
      return sql;
    }
  }, [sql]);
  return (
    <div
      className={makeClassName(
        'rounded border border-neutral flex flex-col h-full min-h-0 overflow-hidden',
        className,
      )}
    >
      <div className="sticky top-0 z-10 bg-background px-3 pt-2 pb-2 border-b border-neutral flex items-center justify-between gap-2">
        <Text variant="label">Query SQL</Text>
        <div className="flex items-center gap-1">
          <Button
            variant="iconButton"
            className="p-1"
            title={`Switch SQL preview to ${theme === 'light' ? 'dark' : 'light'} theme`}
            icon={
              theme === 'light' ? (
                <MoonIcon className="h-4 w-4" />
              ) : (
                <SunIcon className="h-4 w-4" />
              )
            }
            onClick={() =>
              setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
            }
          />
          <Button
            variant="iconButton"
            className="p-1"
            title="Copy SQL"
            disabled={!sql}
            icon={<ClipboardDocumentIcon className="h-4 w-4" />}
            onClick={() => void navigator.clipboard.writeText(sql ?? '')}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {formattedSql ? (
          // `wrapLines` is intentionally left at the CodeBlock default
          // (false). Enabling it wraps each line in a per-line span,
          // which picks up the highlighter style's line-background
          // token and produces the alternating-stripe artifact in both
          // light and dark themes. Mirrors the Model Preview surface,
          // which renders SQL the same way.
          <CodeBlock
            code={formattedSql}
            language="sql"
            theme={theme}
            className="h-full"
          />
        ) : (
          <span className="px-3 py-2 text-xs opacity-70">—</span>
        )}
      </div>
    </div>
  );
}
