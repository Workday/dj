import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type {
  SchemaModelGroupBy,
  SchemaModelHaving,
  SchemaModelWhere,
} from '@shared/schema/types/model.schema';
import { Button } from '@web/elements';
import { type CteState, useModelStore } from '@web/stores/useModelStore';
import React, { useMemo } from 'react';

import { GroupByEditor } from '../components/GroupByEditor';
import { HavingEditor } from '../components/HavingEditor';
import { WhereEditor } from '../components/WhereEditor';
import {
  SECONDARY_HINT,
  SECTION_GAP,
  SECTION_HEADER_ROW,
  SECTION_HEADING,
  TAB_BODY,
} from './panelStyles';
import { useProjectModels } from './useProjectModels';

interface CteFiltersTabProps {
  cte: CteState;
  onPatch: (patch: Partial<CteState>) => void;
}

/**
 * CTE Filters tab: composes the controlled WhereEditor / GroupByEditor /
 * HavingEditor against the slot on the current CteState. Disables them
 * outright when `from.union` is set because UNION ALL applies filters per
 * branch -- combining them at the union level is rejected by the schema's
 * top-level CTE allOf at sync time.
 *
 * Forwards `cteOptions` to the WHERE/HAVING editors so that subqueries
 * authored inside CTE filters can reference earlier CTEs (matching the
 * sync-engine constraint that subquery from.cte must point upward in the
 * registry).
 */
export const CteFiltersTab: React.FC<CteFiltersTabProps> = ({
  cte,
  onPatch,
}) => {
  const ctes = useModelStore((s) => s.ctes);
  const editingCteIndex = useModelStore((s) => s.editingCteIndex);
  const { models, sources } = useProjectModels();

  const fromObj = cte.from ?? {};
  const isUnion = !!fromObj.union;

  const earlierCteOptions = useMemo(() => {
    const ix = editingCteIndex ?? ctes.length;
    return ctes.slice(0, ix).map((c) => ({ label: c.name, value: c.name }));
  }, [ctes, editingCteIndex]);

  const modelOptions = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );
  const sourceOptions = useMemo(
    () => sources.map((s) => ({ label: s, value: s })),
    [sources],
  );

  const handleWhereChange = (next: SchemaModelWhere | undefined) => {
    onPatch({ where: next });
  };
  const handleGroupByChange = (next: SchemaModelGroupBy | null | undefined) => {
    onPatch({ group_by: next });
  };
  const handleHavingChange = (next: SchemaModelHaving | undefined) => {
    onPatch({ having: next });
  };

  const disabledMessage = isUnion
    ? 'Disabled because this CTE unions multiple sources. Apply filters to the upstream CTEs/models instead.'
    : undefined;

  // Switching the General-tab variant to a union doesn't auto-clear filters
  // (handleVariantChange does that going forward, but loaded JSON can still
  // arrive with stale where/group_by/having on a union CTE). Surface a
  // one-click clear so the user can fix the sync-time validation error
  // without round-tripping through the General tab.
  const hasStaleFilters =
    isUnion &&
    (cte.where != null || cte.group_by != null || cte.having != null);

  const handleClearFilters = () => {
    onPatch({ where: undefined, group_by: undefined, having: undefined });
  };

  return (
    <div className={`${TAB_BODY} ${SECTION_GAP}`}>
      {hasStaleFilters && (
        <div className="flex items-start gap-2 border border-warning/40 bg-warning/5 rounded p-3">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className={SECONDARY_HINT}>
              This CTE unions multiple sources, so WHERE / GROUP BY / HAVING
              aren&apos;t applied. Existing values stay in the JSON and will
              fail sync-time validation until removed.
            </p>
          </div>
          <Button
            variant="secondary"
            label="Clear filters"
            onClick={handleClearFilters}
          />
        </div>
      )}
      <section>
        <div className={SECTION_HEADER_ROW}>
          <h3 className={SECTION_HEADING}>Where</h3>
        </div>
        <WhereEditor
          value={cte.where}
          onChange={handleWhereChange}
          modelOptions={modelOptions}
          sourceOptions={sourceOptions}
          cteOptions={earlierCteOptions}
          ctes={ctes}
          disabled={isUnion}
          disabledMessage={disabledMessage}
          idPrefix="cte-where"
        />
      </section>

      <section>
        <div className={SECTION_HEADER_ROW}>
          <h3 className={SECTION_HEADING}>Group by</h3>
        </div>
        <GroupByEditor
          value={cte.group_by}
          onChange={handleGroupByChange}
          disabled={isUnion}
          disabledMessage={disabledMessage}
        />
      </section>

      <section>
        <div className={SECTION_HEADER_ROW}>
          <h3 className={SECTION_HEADING}>Having</h3>
        </div>
        <HavingEditor
          value={cte.having as SchemaModelHaving | undefined}
          onChange={handleHavingChange}
          modelOptions={modelOptions}
          sourceOptions={sourceOptions}
          cteOptions={earlierCteOptions}
          ctes={ctes}
          disabled={isUnion}
          disabledMessage={disabledMessage}
          idPrefix="cte-having"
        />
      </section>
    </div>
  );
};
