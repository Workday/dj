import type { TrinoCoordinatorPing, TrinoProfile } from '@shared/trino/types';
import { Spinner } from '@web/elements';

export type StatusLineProps = {
  ping: TrinoCoordinatorPing | null;
  profile: TrinoProfile | null;
  switching: boolean;
};

/**
 * Status line under the profile selector. Four modes:
 * - Switching → small spinner + "Switching to <name>…" + new URL.
 * - Pinging → small spinner + coordinator URL.
 * - OK → green dot + URL + (v<version>).
 * - Failed → red dot + URL + "— <error>".
 *
 * The URL is truncated with a native tooltip so long Starburst Galaxy
 * URLs don't blow out the 420px sidebar.
 */
export function StatusLine({ ping, profile, switching }: StatusLineProps) {
  const url = profile?.coordinatorUrl;
  if (switching) {
    return (
      <div className="flex items-center gap-2 text-xs opacity-80">
        <Spinner size={10} />
        <span className="flex-shrink-0">
          Switching to <strong>{profile?.name ?? '…'}</strong>
        </span>
        {url && (
          <span className="truncate font-mono opacity-70" title={url}>
            {url}
          </span>
        )}
      </div>
    );
  }
  if (ping === null) {
    return (
      <div className="flex items-center gap-2 text-xs opacity-70">
        <Spinner size={10} />
        <span className="truncate" title={url}>
          {url ?? 'Pinging…'}
        </span>
      </div>
    );
  }
  if (ping.ok) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span className="truncate font-mono" title={url}>
          {url ?? '—'}
        </span>
        {ping.version && (
          <span className="opacity-70 flex-shrink-0">(v{ping.version})</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="inline-block w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
      <span className="truncate font-mono" title={url}>
        {url ?? 'Disconnected'}
      </span>
      {ping.error && (
        <span className="opacity-70 truncate" title={ping.error}>
          — {ping.error}
        </span>
      )}
    </div>
  );
}
