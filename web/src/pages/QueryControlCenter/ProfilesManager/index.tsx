import { XMarkIcon } from '@heroicons/react/20/solid';
import { Button, Chip } from '@web/elements';
import { useEffect, useState } from 'react';

import { useTrinoLive } from '../useTrinoLive';
import { ConnectionEditor } from './ConnectionEditor';

export type ProfilesManagerProps = {
  /** Called when the user clicks Cancel / close (X). Returns to QueryDetail. */
  onClose: () => void;
};

/**
 * Right-pane view that lists every Trino profile as a chip strip and
 * embeds the `ConnectionEditor` underneath. Selecting a chip remounts
 * the editor (`key={selectedName ?? 'new'}`) so its internal form state
 * resets to that profile's values without us having to lift state.
 *
 * Profile list + active profile are sourced from the shared
 * `TrinoLiveContext`, so this view stays in sync with the sidebar's
 * ConnectionPanel without each component running its own
 * `trino-list-profiles` round-trip.
 */
export function ProfilesManager({ onClose }: ProfilesManagerProps) {
  const {
    profiles,
    active,
    profilesLoaded,
    refreshProfiles,
    notifyProfileChanged,
  } = useTrinoLive();

  // `null` means the "+ New profile" form. A name means edit-existing.
  // Initial selection rule: active > first > new. We track this in
  // local state because the chip strip selection is a per-mount UI
  // concern, not something the rest of the app needs to know about.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pickedInitial, setPickedInitial] = useState(false);

  useEffect(() => {
    if (pickedInitial) return;
    if (!profilesLoaded) return;
    if (profiles.length === 0) {
      setSelectedName(null);
    } else {
      setSelectedName(active ?? profiles[0]?.name ?? null);
    }
    setPickedInitial(true);
  }, [profilesLoaded, profiles, active, pickedInitial]);

  const editing = profiles.find((p) => p.name === selectedName) ?? null;

  return (
    <div className="p-4 flex flex-col gap-3 h-full min-h-0 overflow-auto bg-background text-background-contrast">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold flex items-center gap-2">
            <span aria-hidden>⚙</span> Manage profiles
          </div>
          <div className="text-xs opacity-70 mt-1">
            Configure connection details for Trino. Profiles are saved in your
            VS Code settings; secrets live in OS keychain / env vars / files.
          </div>
        </div>
        <Button
          variant="iconButton"
          icon={<XMarkIcon className="w-4 h-4" />}
          onClick={onClose}
          title="Close"
          aria-label="Close manage profiles"
        />
      </div>

      {profilesLoaded && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {profiles.map((p) => {
            const isSelected = selectedName === p.name;
            const isActive = active === p.name;
            return (
              <Chip
                key={p.name}
                selected={isSelected}
                onClick={() => setSelectedName(p.name)}
              >
                {p.name}
                {isActive && <span className="ml-1 opacity-70">(active)</span>}
              </Chip>
            );
          })}
          <Chip
            dashed
            selected={selectedName === null}
            onClick={() => setSelectedName(null)}
          >
            + New profile
          </Chip>
        </div>
      )}

      <ConnectionEditor
        key={selectedName ?? '__new__'}
        initial={editing}
        onClose={(changed) => {
          if (changed) {
            // refreshProfiles broadcasts the new list to the
            // ConnectionPanel via context; notifyProfileChanged re-keys
            // QueryDetail so any cached single-query state is dropped
            // in case the currently-active profile's URL or auth was
            // edited.
            void refreshProfiles();
            notifyProfileChanged();
          } else {
            onClose();
          }
        }}
      />
    </div>
  );
}
