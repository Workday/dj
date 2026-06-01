import {
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  Button,
  ButtonGroup,
  Checkbox,
  InputText,
  SelectSingle,
  TagInput,
  Tooltip,
} from '@web/elements';
import {
  type AdditionalFieldsSchema,
  type CteState,
  useModelStore,
} from '@web/stores/useModelStore';
import React, { useCallback, useMemo } from 'react';

import {
  FIELD_LABEL,
  MUTED_CHIP,
  SECONDARY_HINT,
  SECTION_GAP,
  SECTION_HEADER_ROW,
  SECTION_HEADING,
  TAB_BODY,
} from './panelStyles';
import { useProjectModels } from './useProjectModels';

type FromVariant = 'model' | 'cte' | 'model_union' | 'cte_union';

interface CteGeneralTabProps {
  cte: CteState;
  onPatch: (patch: Partial<CteState>) => void;
}

function inferFromVariant(from: CteState['from']): FromVariant {
  const f = from ?? {};
  if (f.union && typeof f.union === 'object') {
    const u = f.union as Record<string, unknown>;
    if (Array.isArray(u.ctes)) {
      return 'cte_union';
    }
    if (Array.isArray(u.models)) {
      return 'model_union';
    }
  }
  if (typeof f.cte === 'string') {
    return 'cte';
  }
  return 'model';
}

const ROLLUP_INTERVALS = [
  { label: 'Day', value: 'day' },
  { label: 'Hour', value: 'hour' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
];

// Bundle button labels (segmented control). Map to schema values via
// `LABEL_TO_BUNDLE` -- the `Unset` segment clears the field so the CTE
// inherits from the main model.
const BUNDLE_OPTIONS = ['Unset', 'All', 'Columns'] as const;
const LABEL_TO_BUNDLE: Record<
  (typeof BUNDLE_OPTIONS)[number],
  'all' | 'columns' | undefined
> = {
  Unset: undefined,
  All: 'all',
  Columns: 'columns',
};
const BUNDLE_TO_LABEL = (value: 'all' | 'columns' | undefined): string => {
  if (value === 'all') {
    return 'All';
  }
  if (value === 'columns') {
    return 'Columns';
  }
  return 'Unset';
};

// Individual exclude/include flag rows shown beneath the bundle. Order is
// stable and mirrors the schema ordering. `include_full_month` is in the
// schema but not in the wizard's `AdditionalFieldsSchema`, so its inherited
// value is always treated as undefined here -- documented as a separate
// gap, not in scope for this redesign.
const FLAG_ROWS: ReadonlyArray<{
  key: keyof CteState;
  /**
   * Plain-English label rendered next to the checkbox. Wording mirrors the
   * model-level Additional Fields page so the inheritance reads naturally
   * (the JSON key is reserved for the diagnostics tab and YAML emit).
   */
  label: string;
  inheritKey:
    | 'exclude_date_filter'
    | 'exclude_daily_filter'
    | 'exclude_datetime'
    | 'exclude_portal_partition_columns'
    | 'exclude_portal_source_count'
    | null;
}> = [
  {
    key: 'exclude_date_filter',
    label: 'Exclude Date Filter',
    inheritKey: 'exclude_date_filter',
  },
  {
    key: 'exclude_daily_filter',
    label: 'Exclude Daily Filter',
    inheritKey: 'exclude_daily_filter',
  },
  {
    key: 'exclude_datetime',
    label: 'Exclude Datetime',
    inheritKey: 'exclude_datetime',
  },
  {
    key: 'exclude_portal_partition_columns',
    label: 'Exclude Portal Partition Columns',
    inheritKey: 'exclude_portal_partition_columns',
  },
  {
    key: 'exclude_portal_source_count',
    label: 'Exclude Portal Source Count',
    inheritKey: 'exclude_portal_source_count',
  },
  {
    key: 'include_full_month',
    label: 'Include Full Month',
    inheritKey: null,
  },
];

/**
 * General tab for the CTE side-panel. Covers:
 *   - Name (rename routes through `applyCteRename` via store.patchCte).
 *   - The four `from` variants: model, cte, model union, cte union.
 *   - Optional rollup (interval + datetime expression).
 *   - The framework exclude/include flag cluster.
 *
 * Joins live on `from.join` for both model and cte variants; a basic editor
 * is exposed when `from.model` or `from.cte` is selected. Union variants do
 * not support joins (the schema rejects the combination at sync time).
 */
export const CteGeneralTab: React.FC<CteGeneralTabProps> = ({
  cte,
  onPatch,
}) => {
  const { models, sources: _sources, loading } = useProjectModels();
  const ctes = useModelStore((s) => s.ctes);
  const editingCteIndex = useModelStore((s) => s.editingCteIndex);
  // Inherited (model-level) Framework Artifacts. CTE-level flags fall back
  // to these when omitted -- surfacing the resolved value here lets users
  // see what the CTE will actually pick up before they finish wizarding to
  // the Additional Fields step.
  const inherited = useModelStore((s) => s.additionalFields);

  const variant = inferFromVariant(cte.from);
  const fromObj = cte.from ?? {};

  // Earlier CTEs are the only ones eligible as `from.cte` / `from.union.ctes`
  // targets -- forward references are rejected at sync time. Filter on the
  // current CTE's index to mirror that constraint in the UI.
  const earlierCteOptions = useMemo(() => {
    const ix = editingCteIndex ?? ctes.length;
    return ctes.slice(0, ix).map((c) => ({ label: c.name, value: c.name }));
  }, [ctes, editingCteIndex]);

  const modelOptions = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );

  const handleVariantChange = useCallback(
    (next: FromVariant) => {
      // Switching variant rebuilds `from` from scratch so we don't carry over
      // stale keys (e.g. `model` lingering after switching to `cte`). `select`
      // is cleared because any existing bulk or passthrough entries point at
      // the old upstream and would resolve to columns that no longer exist.
      //
      // `where` / `group_by` / `having` are cleared when switching INTO a
      // union variant: the sync engine rejects per-CTE filters on a union
      // (filters belong on the upstream branches), and the Filters tab
      // disables its editors in union mode -- which would leave a stale,
      // un-removable filter on the saved JSON. Switching back to a
      // non-union variant doesn't touch them (nothing to clear).
      let newFrom: Record<string, unknown> = {};
      const patch: Partial<CteState> = { select: undefined };
      switch (next) {
        case 'model':
          newFrom = { model: '' };
          break;
        case 'cte':
          newFrom = { cte: '' };
          break;
        case 'model_union':
          newFrom = { model: '', union: { models: [] } };
          patch.where = undefined;
          patch.group_by = undefined;
          patch.having = undefined;
          break;
        case 'cte_union':
          newFrom = { cte: '', union: { ctes: [] } };
          patch.where = undefined;
          patch.group_by = undefined;
          patch.having = undefined;
          break;
      }
      onPatch({ ...patch, from: newFrom });
    },
    [onPatch],
  );

  const handleFromKeyChange = useCallback(
    (key: 'model' | 'cte', value: string) => {
      // Reset `select` whenever the head upstream identity changes -- column
      // names from the previous upstream would otherwise stay selected.
      onPatch({ from: { ...fromObj, [key]: value }, select: undefined });
    },
    [fromObj, onPatch],
  );

  // Atomic head + tail patch for the union editor. A pair of head-then-tail
  // patches would clobber the first write because `patchCte` replaces the
  // `from` key per call rather than deep-merging it.
  const handleUnionFlatChange = useCallback(
    (kind: 'model' | 'cte', flat: string[]) => {
      const [head = '', ...tail] = flat;
      const union = (fromObj.union as Record<string, unknown>) ?? {};
      onPatch({
        from: {
          ...fromObj,
          [kind]: head,
          union: { ...union, [kind === 'model' ? 'models' : 'ctes']: tail },
        },
        select: undefined,
      });
    },
    [fromObj, onPatch],
  );

  const rollup =
    (fromObj.rollup as
      | { interval?: string; datetime_expr?: string }
      | undefined) ?? null;

  const handleRollupToggle = useCallback(
    (enable: boolean) => {
      const next = { ...fromObj };
      if (enable) {
        next.rollup = { interval: 'day' };
      } else {
        delete next.rollup;
      }
      onPatch({ from: next });
    },
    [fromObj, onPatch],
  );

  const handleRollupInterval = useCallback(
    (interval: string) => {
      const r = { ...(rollup ?? {}), interval } as Record<string, unknown>;
      onPatch({ from: { ...fromObj, rollup: r } });
    },
    [fromObj, onPatch, rollup],
  );

  const handleRollupExpr = useCallback(
    (datetime_expr: string) => {
      const r = { ...(rollup ?? {}), datetime_expr } as Record<string, unknown>;
      if (!datetime_expr) {
        delete r.datetime_expr;
      }
      onPatch({ from: { ...fromObj, rollup: r } });
    },
    [fromObj, onPatch, rollup],
  );

  return (
    <div className={`${TAB_BODY} flex flex-col ${SECTION_GAP}`}>
      {/* Name */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <label className={FIELD_LABEL.replace('block ', '') + ' font-medium'}>
            Name
          </label>
          <Tooltip content="Updates every reference automatically.">
            <span
              aria-label="Rename behaviour"
              className="text-muted-foreground cursor-help"
            >
              <InformationCircleIcon className="w-4 h-4" />
            </span>
          </Tooltip>
        </div>
        <InputText
          value={cte.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="cte_name"
          className="font-mono"
        />
      </section>

      {/* Select from. Four peer variants. Model and CTE unions are
          surfaced as separate top-level buttons (instead of a Union
          parent with a sub-toggle) because the schema rules out mixing
          model and CTE branches in a single union -- a single Union
          button would still require a follow-up choice to disambiguate
          and hides the constraint behind an extra click. */}
      <section>
        <label className={FIELD_LABEL}>Select from</label>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              { v: 'model', l: 'Model' },
              { v: 'cte', l: 'CTE' },
              { v: 'model_union', l: 'Union of models' },
              { v: 'cte_union', l: 'Union of CTEs' },
            ] as { v: FromVariant; l: string }[]
          ).map(({ v, l }) => {
            const active = variant === v;
            return (
              <Button
                key={v}
                variant="link"
                label={l}
                onClick={() => handleVariantChange(v)}
                className={`px-3 py-1 rounded border text-sm ${
                  active
                    ? 'bg-primary text-white border-primary'
                    : 'bg-background border-neutral text-foreground hover:bg-surface'
                }`}
              />
            );
          })}
        </div>
      </section>

      {/* Source pickers per variant */}
      {variant === 'model' && (
        <section>
          <SelectSingle
            options={modelOptions}
            value={
              typeof fromObj.model === 'string' && fromObj.model
                ? { label: fromObj.model, value: fromObj.model }
                : null
            }
            onChange={(opt) => handleFromKeyChange('model', opt?.value || '')}
            onBlur={() => {}}
            placeholder={loading ? 'Loading models...' : 'Pick a model'}
          />
        </section>
      )}
      {variant === 'cte' && (
        <section>
          <SelectSingle
            options={earlierCteOptions}
            value={
              typeof fromObj.cte === 'string' && fromObj.cte
                ? { label: fromObj.cte, value: fromObj.cte }
                : null
            }
            onChange={(opt) => handleFromKeyChange('cte', opt?.value || '')}
            onBlur={() => {}}
            placeholder="Pick an earlier CTE"
          />
          {earlierCteOptions.length === 0 && (
            <p className={`${SECONDARY_HINT} mt-1`}>
              No earlier CTEs defined. Move this CTE down or add one above.
            </p>
          )}
        </section>
      )}
      {/* Union list. First entry is `from.model` / `from.cte`; the rest live
          on `from.union.models` / `from.union.ctes`. A single dynamic list
          presents both as one flat sequence so users don't think of "head"
          vs "tail" -- internally we keep the head in `from.model` / `from.cte`
          on serialize so the framework keeps treating index 0 as the
          starting point of the union (matches its existing parse logic). */}
      {(variant === 'model_union' || variant === 'cte_union') && (
        <UnionEditor
          kind={variant === 'model_union' ? 'model' : 'cte'}
          fromObj={fromObj}
          modelOptions={modelOptions}
          cteOptions={earlierCteOptions}
          onFlatChange={(flat) =>
            handleUnionFlatChange(
              variant === 'model_union' ? 'model' : 'cte',
              flat,
            )
          }
        />
      )}

      {/* Joins. Schema allows `from.join` on both `from.model` and `from.cte`
          variants (see model.from.join.models.schema.json). The inline
          editor surfaces a basic subset: target (model or earlier CTE),
          join type, and either the `dims` shorthand or an array of column
          names. More complex `on.and` shapes (subqueries / expressions)
          remain JSON-only -- documented in the hint below. */}
      {(variant === 'model' || variant === 'cte') && (
        <CteJoinEditor
          cteFrom={fromObj}
          modelOptions={modelOptions}
          cteOptions={earlierCteOptions}
          onPatch={onPatch}
        />
      )}

      {/* Rollup. Only meaningful when the source is `model` or `cte`. */}
      {(variant === 'model' || variant === 'cte') && (
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Checkbox
              checked={!!rollup}
              onChange={(checked) =>
                handleRollupToggle(
                  typeof checked === 'boolean'
                    ? checked
                    : checked.target.checked,
                )
              }
            />
            <label className="text-sm font-medium text-foreground">
              Rollup
            </label>
          </div>
          {rollup && (
            <div className="space-y-2 pl-6">
              <SelectSingle
                label="Interval"
                options={ROLLUP_INTERVALS}
                value={
                  rollup.interval
                    ? {
                        label: rollup.interval,
                        value: rollup.interval,
                      }
                    : null
                }
                onChange={(opt) => handleRollupInterval(opt?.value || 'day')}
                onBlur={() => {}}
                placeholder="day"
              />
              <div>
                <label className={FIELD_LABEL}>
                  Datetime expression (optional)
                </label>
                <InputText
                  value={rollup.datetime_expr || ''}
                  onChange={(e) => handleRollupExpr(e.target.value)}
                  placeholder="cast(event_date as timestamp)"
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Framework Artifacts. Moved to the bottom so the tab reads top-
          down as "identity -> source -> joins -> rollup -> framework
          overrides", which matches the order most users author CTEs in. */}
      <FrameworkArtifactsSection
        cte={cte}
        inherited={inherited}
        onPatch={onPatch}
      />
    </div>
  );
};

interface UnionEditorProps {
  kind: 'model' | 'cte';
  fromObj: Record<string, unknown>;
  modelOptions: { label: string; value: string }[];
  cteOptions: { label: string; value: string }[];
  onFlatChange: (flat: string[]) => void;
}

/**
 * Unified list editor for union branches. Schema-wise the first branch
 * lives on `from.model` / `from.cte` and the rest live in
 * `from.union.{models,ctes}`; the UI flattens this so the user sees one
 * dynamic list with an "Add branch" affordance instead of a fixed
 * "first" + "additional" split. The parent's `onFlatChange` callback
 * routes the entire list through one atomic store patch so head and
 * tail updates can't clobber each other.
 *
 * Empty rows are kept in-memory so users can pick a value into them;
 * `stripCteForSerialize` drops empty entries from `union.models[]` /
 * `union.ctes[]` before save.
 *
 * Note on bounds: the schema doesn't enforce a maximum number of
 * branches, but very long unions are typically refactored into
 * intermediate models.
 */
const UnionEditor: React.FC<UnionEditorProps> = ({
  kind,
  fromObj,
  modelOptions,
  cteOptions,
  onFlatChange,
}) => {
  const head =
    kind === 'model'
      ? typeof fromObj.model === 'string'
        ? fromObj.model
        : ''
      : typeof fromObj.cte === 'string'
        ? fromObj.cte
        : '';
  const tail = Array.isArray(
    (fromObj.union as Record<string, unknown> | undefined)?.[
      kind === 'model' ? 'models' : 'ctes'
    ],
  )
    ? ((fromObj.union as Record<string, unknown>)[
        kind === 'model' ? 'models' : 'ctes'
      ] as string[])
    : [];
  const options = kind === 'model' ? modelOptions : cteOptions;
  const placeholder = kind === 'model' ? 'Pick a model' : 'Pick an earlier CTE';

  const flat = [head, ...tail];

  return (
    <section className="space-y-2">
      {flat.map((value, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <SelectSingle
            options={options}
            value={value ? { label: value, value } : null}
            onChange={(opt) => {
              const copy = flat.slice();
              copy[idx] = opt?.value || '';
              onFlatChange(copy);
            }}
            onBlur={() => {}}
            placeholder={placeholder}
          />
          {/* Allow removing tail entries; the head is never removed
              (the framework requires at least one branch and we'd lose
              the union shape if `from.model`/`from.cte` were empty). */}
          {idx > 0 && (
            <Button
              variant="iconButton"
              aria-label="Remove branch"
              className="p-1 text-muted-foreground hover:text-error"
              icon={<TrashIcon className="w-4 h-4" />}
              onClick={() => onFlatChange(flat.filter((_, i) => i !== idx))}
            />
          )}
        </div>
      ))}
      <Button
        variant="link"
        label={kind === 'model' ? 'Add model' : 'Add CTE'}
        icon={<PlusIcon className="w-4 h-4" />}
        onClick={() => onFlatChange([...flat, ''])}
      />
    </section>
  );
};

interface FrameworkArtifactsSectionProps {
  cte: CteState;
  inherited: AdditionalFieldsSchema;
  onPatch: (patch: Partial<CteState>) => void;
}

/**
 * Framework Artifacts section for the CTE General tab. Two parts:
 *
 *   1. **Bundle row** -- segmented `exclude_framework_artifacts` picker
 *      with three states: Unset (inherits from the model), All (override
 *      to 'all'), Columns (override to 'columns'). When Unset and the
 *      main model has the bundle set, an "inherited: <value>" hint
 *      appears next to the segmented control.
 *
 *   2. **Per-flag rows** -- one tri-state row per individual exclude/
 *      include flag. Three states per row:
 *
 *      - Overridden: solid checkbox + small `x` to clear back to inherit.
 *      - Inherited: muted checkbox showing the inherited value with an
 *        "inherited" badge. Clicking it overrides to the *opposite* of
 *        the inherited value so the first click meaningfully diverges.
 *      - Default (both undefined): plain unchecked checkbox; click sets
 *        true.
 *
 * `include_full_month` is rendered for parity with the schema, but the
 * wizard's `AdditionalFieldsSchema` doesn't expose it -- so its inherited
 * value is always undefined. That's a separate gap, not in scope here.
 */
const FrameworkArtifactsSection: React.FC<FrameworkArtifactsSectionProps> = ({
  cte,
  inherited,
  onPatch,
}) => {
  const setFlag = useCallback(
    (key: keyof CteState, value: boolean | 'all' | 'columns' | undefined) => {
      // Send a minimal patch -- `{ [key]: undefined }` is intentional and
      // tells `useModelStore.patchCte` to delete the key from the CTE
      // (which makes `stripCteForSerialize` drop it from the JSON so the
      // CTE re-inherits the main-model value). Sending the entire CTE
      // back with the key omitted would NOT trigger a delete in the
      // store's shallow merge.
      const patch = { [key]: value } as unknown as Partial<CteState>;
      onPatch(patch);
    },
    [onPatch],
  );

  const bundleValue = cte.exclude_framework_artifacts;
  const inheritedBundle = inherited.exclude_framework_artifacts;
  const bundleLabel = BUNDLE_TO_LABEL(bundleValue);
  const showInheritedBundleHint =
    bundleValue === undefined && inheritedBundle !== undefined;

  return (
    <section>
      <div className={SECTION_HEADER_ROW}>
        <h3 className={SECTION_HEADING}>Framework artifacts</h3>
        <Tooltip content="CTE-level flags override the main model. Leave Unset (or use the X to clear an override) to inherit the main model's value.">
          <span
            aria-label="Framework artifacts inheritance"
            className="text-muted-foreground cursor-help"
          >
            <InformationCircleIcon className="w-4 h-4" />
          </span>
        </Tooltip>
      </div>

      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <label className="text-sm text-foreground">
          Exclude Framework Artifacts
        </label>
        <ButtonGroup
          options={[...BUNDLE_OPTIONS]}
          initialValue={bundleLabel}
          onSelect={(label) => {
            setFlag(
              'exclude_framework_artifacts',
              LABEL_TO_BUNDLE[label as (typeof BUNDLE_OPTIONS)[number]],
            );
          }}
        />
        {showInheritedBundleHint && (
          <span className="text-xs text-muted-foreground">
            inherited: <span className="font-mono">{inheritedBundle}</span>
          </span>
        )}
      </div>

      {/* Individual flag rows. */}
      <div className="space-y-1.5">
        {FLAG_ROWS.map(({ key, label, inheritKey }) => {
          const overrideRaw = cte[key];
          const isOverridden = typeof overrideRaw === 'boolean';
          const inheritedValue = inheritKey ? inherited[inheritKey] : undefined;
          const isInherited = !isOverridden && inheritedValue !== undefined;
          const checked = isOverridden
            ? overrideRaw
            : isInherited
              ? !!inheritedValue
              : false;

          // Click behaviour:
          //  - Overridden  -> toggle the override (true/false stays a override).
          //  - Inherited   -> first click overrides to the *opposite* of the
          //                   inherited value so the user gets a meaningful diff.
          //  - Default     -> override to true.
          const onToggle = () => {
            if (isOverridden) {
              setFlag(key, !overrideRaw);
              return;
            }
            if (isInherited) {
              setFlag(key, !inheritedValue);
              return;
            }
            setFlag(key, true);
          };

          return (
            <div key={String(key)} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onChange={() => onToggle()}
                className={
                  isInherited && !isOverridden ? 'opacity-60' : undefined
                }
              />
              <span
                className={
                  isInherited && !isOverridden
                    ? 'text-muted-foreground'
                    : 'text-foreground'
                }
              >
                {label}
              </span>
              {isOverridden && (
                <Button
                  variant="iconButton"
                  className="ml-1 p-0.5 text-muted-foreground hover:text-error hover:bg-surface"
                  title="Clear override (inherit from main model)"
                  aria-label={`Clear ${label} override`}
                  icon={<XMarkIcon className="w-3 h-3" />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFlag(key, undefined);
                  }}
                />
              )}
              {isInherited && (
                <span className={`ml-1 ${MUTED_CHIP}`}>inherited</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

interface CteJoinEditorProps {
  cteFrom: Record<string, unknown>;
  modelOptions: { label: string; value: string }[];
  cteOptions: { label: string; value: string }[];
  onPatch: (patch: Partial<CteState>) => void;
}

const JOIN_TYPE_OPTIONS = [
  { label: 'inner', value: 'inner' },
  { label: 'left', value: 'left' },
  { label: 'right', value: 'right' },
  { label: 'full', value: 'full' },
  { label: 'cross', value: 'cross' },
];

type JoinTargetKind = 'model' | 'cte';
type JoinConditionMode = 'none' | 'dims' | 'columns';

interface JoinRow {
  kind: JoinTargetKind;
  /** target identifier (model name or earlier CTE name) */
  target: string;
  /** `inner|left|right|full|cross` (cross omits `on`) */
  joinType: string;
  /** `dims` shorthand vs explicit column-name list vs absent */
  condMode: JoinConditionMode;
  /** list of column names when `condMode === 'columns'` */
  conditions: string[];
  /** alias override applied to the joined table */
  alias: string;
  /**
   * True when the raw join entry uses an `on.and` shape that contains
   * subqueries, expressions, or otherwise can't round-trip through the
   * inline editor. Such rows are shown read-only with a "JSON only"
   * badge so the user knows to edit them via the JSON tab.
   */
  complexOn: boolean;
}

/**
 * Translate a raw `from.join` entry into the editor's flat representation.
 * Falls back to `complexOn: true` for shapes the inline editor can't
 * round-trip; those rows stay editable only through the JSON tab.
 */
function rowFromJoinEntry(raw: unknown): JoinRow {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const kind: JoinTargetKind = typeof o.cte === 'string' ? 'cte' : 'model';
  const target =
    kind === 'cte'
      ? typeof o.cte === 'string'
        ? o.cte
        : ''
      : typeof o.model === 'string'
        ? o.model
        : '';
  const joinType = typeof o.type === 'string' && o.type ? o.type : 'inner';
  let condMode: JoinConditionMode = 'none';
  let conditions: string[] = [];
  let complexOn = false;
  if (o.on === 'dims') {
    condMode = 'dims';
  } else if (o.on && typeof o.on === 'object') {
    const onObj = o.on as Record<string, unknown>;
    if (Array.isArray(onObj.and)) {
      const cols: string[] = [];
      let anyNonString = false;
      for (const it of onObj.and) {
        if (typeof it === 'string') cols.push(it);
        else anyNonString = true;
      }
      if (anyNonString) {
        complexOn = true;
      } else {
        condMode = 'columns';
        conditions = cols;
      }
    } else {
      complexOn = true;
    }
  }
  const alias = typeof o.override_alias === 'string' ? o.override_alias : '';
  return {
    kind,
    target,
    joinType: joinType || 'inner',
    condMode,
    conditions,
    alias,
    complexOn,
  };
}

/** Serialize the row back to a `from.join` entry; preserves the raw entry
 *  verbatim for `complexOn` rows so we never trash user-authored complex
 *  conditions. */
function joinEntryFromRow(row: JoinRow, original?: unknown): unknown {
  if (row.complexOn && original) return original;
  const out: Record<string, unknown> = {};
  if (row.kind === 'cte') out.cte = row.target;
  else out.model = row.target;
  if (row.joinType === 'cross') {
    out.type = 'cross';
  } else {
    out.type = row.joinType;
    if (row.condMode === 'dims') {
      out.on = 'dims';
    } else if (row.condMode === 'columns') {
      out.on = { and: row.conditions.filter((c) => c.trim() !== '') };
    } else {
      // No condition selected -- the schema requires `on` for non-cross
      // joins, so we emit an empty AND list and let validation surface
      // the missing condition to the user.
      out.on = { and: [] };
    }
  }
  if (row.alias) out.override_alias = row.alias;
  return out;
}

/**
 * Inline editor for `from.join` on CTEs whose source is a single model or
 * CTE. Supports the four common variants the framework already validates:
 *
 *   - join a model (with `dims` shorthand or column-name list, any join type)
 *   - cross-join a model
 *   - join an earlier CTE (with `dims` shorthand or column-name list)
 *   - cross-join an earlier CTE
 *
 * `on.and` entries that aren't plain column names (subqueries / expressions)
 * are preserved verbatim and surface a "JSON only" badge so we never trash
 * user-authored complex conditions.
 */
const CteJoinEditor: React.FC<CteJoinEditorProps> = ({
  cteFrom,
  modelOptions,
  cteOptions,
  onPatch,
}) => {
  const rawJoins = Array.isArray(cteFrom.join)
    ? (cteFrom.join as unknown[])
    : [];
  const rows = rawJoins.map((r) => rowFromJoinEntry(r));

  const writeJoins = (nextRows: JoinRow[]) => {
    if (nextRows.length === 0) {
      const next: Record<string, unknown> = { ...cteFrom };
      delete next.join;
      onPatch({ from: next });
      return;
    }
    const nextEntries = nextRows.map((r, i) =>
      joinEntryFromRow(r, rawJoins[i]),
    );
    onPatch({ from: { ...cteFrom, join: nextEntries } });
  };

  const addJoin = (kind: JoinTargetKind) => {
    const row: JoinRow = {
      kind,
      target: '',
      joinType: 'inner',
      condMode: 'dims',
      conditions: [],
      alias: '',
      complexOn: false,
    };
    writeJoins([...rows, row]);
  };

  const updateRow = (idx: number, patch: Partial<JoinRow>) => {
    const copy = rows.slice();
    copy[idx] = { ...copy[idx], ...patch };
    writeJoins(copy);
  };

  const removeRow = (idx: number) => {
    writeJoins(rows.filter((_, i) => i !== idx));
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className={SECTION_HEADER_ROW + ' mb-0'}>
          <h3 className={SECTION_HEADING}>Joins</h3>
          <Tooltip content="Joins live on from.join. Schema supports joining either an upstream model or an earlier CTE; choose the kind below.">
            <span className="text-muted-foreground cursor-help">
              <InformationCircleIcon className="w-4 h-4" />
            </span>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="link"
            label="Add model join"
            icon={<PlusIcon className="w-4 h-4" />}
            onClick={() => addJoin('model')}
          />
          {cteOptions.length > 0 && (
            <Button
              variant="link"
              label="Add CTE join"
              icon={<PlusIcon className="w-4 h-4" />}
              onClick={() => addJoin('cte')}
            />
          )}
        </div>
      </div>

      {rows.length === 0 && (
        <p className={`${SECONDARY_HINT}`}>
          No joins. Add a model or earlier CTE to join against the current
          source.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <JoinCard
            key={idx}
            row={row}
            idx={idx}
            modelOptions={modelOptions}
            cteOptions={cteOptions}
            onUpdate={(patch) => updateRow(idx, patch)}
            onRemove={() => removeRow(idx)}
          />
        ))}
      </div>

      {rows.length > 0 && (
        <p className={`${SECONDARY_HINT} mt-2`}>
          Complex <span className="font-mono">on.and</span> shapes (mixing
          expressions, subqueries) remain JSON-only -- edit them via the JSON
          tab.
        </p>
      )}
    </section>
  );
};

interface JoinCardProps {
  row: JoinRow;
  idx: number;
  modelOptions: { label: string; value: string }[];
  cteOptions: { label: string; value: string }[];
  onUpdate: (patch: Partial<JoinRow>) => void;
  onRemove: () => void;
}

/**
 * Collapsible join card. Header always shows the target name (with a
 * "Choose model"/"Choose CTE" placeholder when unset) plus the join
 * type so users can scan an entire join chain at a glance. Click the
 * header (or the chevron) to expand and edit. Long target names are
 * truncated with `truncate` + `min-w-0` so the card never overflows
 * the popover.
 */
const JoinCard: React.FC<JoinCardProps> = ({
  row,
  idx,
  modelOptions,
  cteOptions,
  onUpdate,
  onRemove,
}) => {
  // Default: collapsed when the row already has a target (the user has
  // finished configuring it); expanded for fresh empty rows so the
  // user can start filling fields right away.
  const [collapsed, setCollapsed] = React.useState(
    Boolean(row.target) && !row.complexOn,
  );

  const headerName = row.target
    ? row.target
    : row.kind === 'cte'
      ? 'Choose CTE'
      : 'Choose model';
  const isPlaceholder = !row.target;

  return (
    <div className="border border-neutral rounded-md p-2 space-y-2 bg-card">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand join' : 'Collapse join'}
        >
          {/* Chevron flips between right/down to signal collapse state.
              Using a plain rotated triangle so we don't have to import
              another icon. */}
          <span
            className={`text-xs text-muted-foreground transition-transform inline-block ${
              collapsed ? '' : 'rotate-90'
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
            {row.kind === 'cte' ? 'CTE' : 'Model'}
          </span>
          <span
            className={`font-mono text-sm truncate min-w-0 ${
              isPlaceholder ? 'text-muted-foreground' : 'text-foreground'
            }`}
            title={row.target || undefined}
          >
            {headerName}
          </span>
          {row.target && (
            <span className="text-xs text-muted-foreground shrink-0">
              · {row.joinType}
              {row.condMode === 'dims' && row.joinType !== 'cross'
                ? ' on dims'
                : row.condMode === 'columns' && row.conditions.length > 0
                  ? ` on ${row.conditions.length} cols`
                  : ''}
            </span>
          )}
          {row.complexOn && (
            <span className={`${MUTED_CHIP} shrink-0`}>JSON only</span>
          )}
        </button>
        <Button
          variant="iconButton"
          aria-label="Remove join"
          className="p-1 text-muted-foreground hover:text-error"
          icon={<TrashIcon className="w-4 h-4" />}
          onClick={onRemove}
        />
      </div>

      {!collapsed && row.complexOn && (
        <p className={`${SECONDARY_HINT}`}>
          This join uses an <span className="font-mono">on.and</span> shape
          (subqueries / expressions) that the inline editor can't round-trip.
          Edit it via the JSON tab.
        </p>
      )}

      {!collapsed && !row.complexOn && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={FIELD_LABEL}>Target</label>
              {row.kind === 'cte' ? (
                <SelectSingle
                  options={cteOptions}
                  value={
                    row.target ? { label: row.target, value: row.target } : null
                  }
                  onChange={(opt) => onUpdate({ target: opt?.value || '' })}
                  onBlur={() => {}}
                  placeholder="Pick an earlier CTE"
                />
              ) : (
                <SelectSingle
                  options={modelOptions}
                  value={
                    row.target ? { label: row.target, value: row.target } : null
                  }
                  onChange={(opt) => onUpdate({ target: opt?.value || '' })}
                  onBlur={() => {}}
                  placeholder="Pick a model"
                />
              )}
            </div>
            <div>
              <label className={FIELD_LABEL}>Join type</label>
              <SelectSingle
                options={JOIN_TYPE_OPTIONS}
                value={
                  row.joinType
                    ? { label: row.joinType, value: row.joinType }
                    : null
                }
                onChange={(opt) =>
                  onUpdate({ joinType: opt?.value || 'inner' })
                }
                onBlur={() => {}}
                placeholder="inner"
              />
            </div>
          </div>

          {row.joinType !== 'cross' && (
            <div>
              <label className={FIELD_LABEL}>Condition</label>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={`join-cond-${idx}`}
                    checked={row.condMode === 'dims'}
                    onChange={() => onUpdate({ condMode: 'dims' })}
                  />
                  Join on dims
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={`join-cond-${idx}`}
                    checked={row.condMode === 'columns'}
                    onChange={() => onUpdate({ condMode: 'columns' })}
                  />
                  Columns
                </label>
              </div>
              {row.condMode === 'columns' && (
                <TagInput
                  value={row.conditions}
                  onChange={(tags: string[]) => onUpdate({ conditions: tags })}
                  placeholder="join_column_name"
                />
              )}
            </div>
          )}

          {/* Override alias is a sibling of `on` in the schema and is
              valid for both `on: "dims"` and `on: { and: [...] }`
              shapes, so we surface it for either condition mode. */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className={FIELD_LABEL + ' mb-0'}>
                Override alias (optional)
              </label>
              <Tooltip content="Renames the joined table inside the generated SQL. Supported in both 'Join on dims' and 'Columns' modes.">
                <span className="text-muted-foreground cursor-help">
                  <InformationCircleIcon className="w-3.5 h-3.5" />
                </span>
              </Tooltip>
            </div>
            <InputText
              value={row.alias}
              onChange={(e) => onUpdate({ alias: e.target.value })}
              placeholder="override_alias"
              className="font-mono"
            />
          </div>
        </>
      )}
    </div>
  );
};
