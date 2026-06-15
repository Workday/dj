import { useModelStore } from '@web/stores/useModelStore';
import React, { useMemo } from 'react';

import { MUTED_CHIP, SECONDARY_HINT, TAB_BODY } from './panelStyles';

interface CteValidationTabProps {
  cteIndex: number;
}

/**
 * Renders the diagnostic list returned by `framework-model-cte-analysis`,
 * filtered to the currently-edited CTE. The full Phase 8 implementation
 * adds click-to-jump links into the offending tab/field via the diagnostic
 * `path`; the basic listing here unblocks earlier phases.
 *
 * Manifest-staleness is surfaced by the `(updating)` pill on the Select
 * tab's header chip, not here.
 */
export const CteValidationTab: React.FC<CteValidationTabProps> = ({
  cteIndex,
}) => {
  const cteAnalysis = useModelStore((s) => s.cteAnalysis);
  const myDiagnostics = useMemo(
    () =>
      cteAnalysis.diagnostics.filter(
        (d) => d.cteIndex === undefined || d.cteIndex === cteIndex,
      ),
    [cteAnalysis.diagnostics, cteIndex],
  );

  return (
    <div className={TAB_BODY}>
      {cteAnalysis.error && (
        <div className="border border-error rounded p-2 text-sm text-error mb-3">
          {cteAnalysis.error}
        </div>
      )}
      {myDiagnostics.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No validation issues detected for this CTE.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {myDiagnostics.map((d, i) => (
            <li
              key={i}
              className={`border rounded p-2 ${
                d.severity === 'error'
                  ? 'border-error bg-error/5'
                  : 'border-warning bg-warning/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={`${MUTED_CHIP} ${
                    d.severity === 'error'
                      ? 'border-error/40 text-error'
                      : 'border-warning/40 text-warning'
                  }`}
                >
                  {d.severity}
                </span>
                {d.path && <span className={SECONDARY_HINT}>{d.path}</span>}
              </div>
              <div className="text-sm text-foreground">{d.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
