import { Button, Checkbox, Chip, InputText, SelectSingle } from '@web/elements';

import {
  COMPACT_SELECT_CLASSNAME,
  STATE_CHIPS,
  type StateChip,
} from './queryFilters';

type SelectOption = { value: string; label: string };

export type QueryFilterBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  selectedStates: Set<StateChip>;
  onToggleState: (state: StateChip) => void;
  userFilter: string;
  userOptions: SelectOption[];
  onUserFilterChange: (value: string) => void;
  sourceFilter: string;
  sourceOptions: SelectOption[];
  onSourceFilterChange: (value: string) => void;
  activeFilterCount: number;
  onClearAll: () => void;
  /** Live-only: server-side `dbt-trino-*` source filter. */
  dbtOnly?: boolean;
  onDbtOnlyChange?: (next: boolean) => void;
  /** History-only: filter by the profile that wrote each diagnostic. */
  profileFilter?: string;
  profileOptions?: SelectOption[];
  onProfileFilterChange?: (value: string) => void;
};

/**
 * Filter strip shared by the Live and History tabs. The two tabs hand
 * in their own filter state — this component only owns the layout +
 * design-system bindings (InputText / SelectSingle / Checkbox / Chip
 * / Button), so we get a consistent look without forcing both tabs
 * to share a single reducer.
 */
export function QueryFilterBar({
  search,
  onSearchChange,
  selectedStates,
  onToggleState,
  userFilter,
  userOptions,
  onUserFilterChange,
  sourceFilter,
  sourceOptions,
  onSourceFilterChange,
  activeFilterCount,
  onClearAll,
  dbtOnly,
  onDbtOnlyChange,
  profileFilter,
  profileOptions,
  onProfileFilterChange,
}: QueryFilterBarProps) {
  const showDbtOnly = onDbtOnlyChange !== undefined;
  const showProfile = onProfileFilterChange !== undefined && profileOptions;

  return (
    <div className="pb-2 flex flex-col gap-2 border-b border-neutral">
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <InputText
            placeholder="Filter queries…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {showDbtOnly && (
          <Checkbox
            label="dbt runs only"
            title="Show only queries with source starting with 'dbt-trino-'. The coordinator may also see other tools' dbt runs (anyone running dbt against this coordinator), not just yours."
            checked={dbtOnly ?? false}
            onChange={(checked) =>
              onDbtOnlyChange?.(
                typeof checked === 'boolean' ? checked : checked.target.checked,
              )
            }
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center text-xs">
        <span className="opacity-70">State:</span>
        {STATE_CHIPS.map((s) => (
          <Chip
            key={s}
            selected={selectedStates.has(s)}
            onClick={() => onToggleState(s)}
            title={
              s === 'other'
                ? 'Any state outside RUNNING / FINISHED / FAILED / QUEUED (e.g. PLANNING, STARTING).'
                : `Toggle ${s} state`
            }
          >
            {s}
          </Chip>
        ))}
      </div>
      {/* Compact filter row so User/Source (and an optional Clear)
          fit the ~420 px sidebar without wrapping. When a Profile
          dropdown is present (History tab), Clear moves to the row
          below to keep this row balanced. */}
      <div className="flex flex-wrap gap-1.5 items-center text-xs">
        <span className="opacity-70">User:</span>
        <div className="flex-1 min-w-[6rem]">
          <SelectSingle
            options={userOptions}
            value={userOptions.find((o) => o.value === userFilter) ?? null}
            onChange={(o) => onUserFilterChange(o?.value ?? '')}
            onBlur={() => {}}
            showClearButton={false}
            className={COMPACT_SELECT_CLASSNAME}
          />
        </div>
        <span className="opacity-70">Source:</span>
        <div className="flex-1 min-w-[6rem]">
          <SelectSingle
            options={sourceOptions}
            value={sourceOptions.find((o) => o.value === sourceFilter) ?? null}
            onChange={(o) => onSourceFilterChange(o?.value ?? '')}
            onBlur={() => {}}
            showClearButton={false}
            className={COMPACT_SELECT_CLASSNAME}
          />
        </div>
        {!showProfile && activeFilterCount > 0 && (
          <Button
            variant="secondary"
            label={`Clear (${activeFilterCount})`}
            onClick={onClearAll}
            title="Clear all filters and search"
          />
        )}
      </div>
      {showProfile && (
        <div className="flex flex-wrap gap-1.5 items-center text-xs">
          <span className="opacity-70">Profile:</span>
          <div className="flex-1 min-w-[6rem]">
            <SelectSingle
              options={profileOptions}
              value={
                profileOptions.find((o) => o.value === (profileFilter ?? '')) ??
                null
              }
              onChange={(o) => onProfileFilterChange?.(o?.value ?? '')}
              onBlur={() => {}}
              showClearButton={false}
              className={COMPACT_SELECT_CLASSNAME}
            />
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="secondary"
              label={`Clear (${activeFilterCount})`}
              onClick={onClearAll}
              title="Clear all filters and search"
            />
          )}
        </div>
      )}
    </div>
  );
}
