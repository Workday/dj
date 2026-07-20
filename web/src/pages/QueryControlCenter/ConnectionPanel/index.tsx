import { Box, Button, SelectSingle } from '@web/elements';
import { useMemo } from 'react';

import { useTrinoLive } from '../useTrinoLive';
import { StatusLine } from './StatusLine';

export type ConnectionPanelProps = {
  /** Open the right-pane Manage Profiles view. */
  onManage: () => void;
};

/**
 * Compact connection panel at the top of the master sidebar (above
 * the Live/History tabs). Owns the active-profile select and the
 * "Manage profiles" affordance.
 *
 * Polling, ping state, and profile state all flow through
 * `TrinoLiveContext` so the pill and the Live tab share a single
 * `/v1/query` heartbeat.
 */
export function ConnectionPanel({ onManage }: ConnectionPanelProps) {
  const {
    profiles,
    active,
    activeProfile,
    setActiveProfile,
    switchingProfile,
    ping,
  } = useTrinoLive();

  const profileOptions = useMemo(
    () => profiles.map((p) => ({ value: p.name, label: p.name })),
    [profiles],
  );
  const selectedOption = profileOptions.find((o) => o.value === active) ?? null;

  return (
    <div className="border-b border-neutral bg-background text-background-contrast p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Trino coordinator</div>
        <Button
          variant="secondary"
          label="Manage profiles"
          onClick={onManage}
        />
      </div>

      {profiles.length === 0 ? (
        <Box variant="bordered">
          <div className="text-xs">
            <strong>⚠ No Trino profile configured.</strong>
            <div className="mt-1 opacity-80 leading-relaxed">
              Using the local Trino CLI — limited functionality (no live REST
              listings, no per-query JSON, no Analyze with AI). Click{' '}
              <strong>Manage profiles</strong> to add one.
            </div>
          </div>
        </Box>
      ) : (
        <>
          <SelectSingle
            options={profileOptions}
            value={selectedOption}
            onChange={(o) => {
              if (o) void setActiveProfile(o.value);
            }}
            onBlur={() => {}}
            showClearButton={false}
            placeholder="Pick a profile"
            // Lock the dropdown while a switch is in flight so rapid
            // re-clicks don't race the in-flight RPC.
            disabled={switchingProfile}
          />
          <StatusLine
            ping={ping}
            profile={activeProfile}
            switching={switchingProfile}
          />
        </>
      )}
    </div>
  );
}
