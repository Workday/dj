import { useApp } from '@web/context';
import { useModelStore } from '@web/stores/useModelStore';
import { useEffect, useRef } from 'react';

/**
 * Tunable debounce window for the analysis call. ~300ms keeps the panel
 * responsive on quick keystrokes without spamming the extension host while
 * the user is typing. Independent of `dj.syncDebounceMs`, which controls the
 * SQL/YAML generation pipeline -- a much heavier operation.
 */
const ANALYSIS_DEBOUNCE_MS = 300;

/**
 * Drives the `framework-model-cte-analysis` request whenever the model JSON
 * draft changes. Stores the result under `cteAnalysis` in the model store and
 * keeps the previous response visible while a new request is in flight so the
 * panel does not flash on every keystroke.
 *
 * Supersede-cancel: each new request bumps a token so only the latest result
 * is committed. Older in-flight responses are discarded.
 *
 * Mount once near the wizard root (Phase 4 mounts it in `CteEditorPanel`'s
 * parent) -- it's a self-contained subscriber that returns nothing.
 */
export function useCteAnalysis(): void {
  const { api } = useApp();
  const ctes = useModelStore((s) => s.ctes);
  const buildModelJson = useModelStore((s) => s.buildModelJson);
  const projectName = useModelStore((s) => s.basicFields.projectName);
  const setCteAnalysis = useModelStore((s) => s.setCteAnalysis);

  // The request token is the current "latest request" id. Only callbacks
  // matching this id are allowed to commit results to the store.
  const tokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // No CTEs -> clear analysis state and skip the network call.
    if (!ctes || ctes.length === 0) {
      tokenRef.current += 1;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setCteAnalysis({
        columns: {},
        diagnostics: [],
        manifestTimestamp: null,
        loading: false,
        error: null,
      });
      return;
    }
    if (!projectName) {
      return;
    }

    // Schedule a fresh request on a debounce. If the user keeps typing, the
    // previous timer is cleared and only the latest snapshot fires.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      const myToken = ++tokenRef.current;
      setCteAnalysis({ loading: true, error: null });
      const modelJson = buildModelJson();
      api
        .post({
          type: 'framework-model-cte-analysis' as const,
          request: {
            projectName,
            modelJson: modelJson as Record<string, any>,
          },
        } as const)
        .then((resp) => {
          if (myToken !== tokenRef.current) {
            return;
          }
          setCteAnalysis({
            columns: resp.columns,
            diagnostics: resp.diagnostics,
            manifestTimestamp: resp.manifestTimestamp,
            loading: false,
            error: null,
          });
        })
        .catch((err) => {
          if (myToken !== tokenRef.current) {
            return;
          }
          setCteAnalysis({
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, ANALYSIS_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // `buildModelJson` is a stable Zustand action (returns latest state), so
    // re-running the analysis only on `ctes` / `projectName` keeps the call
    // count bounded.
  }, [api, buildModelJson, ctes, projectName, setCteAnalysis]);
}
