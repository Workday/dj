import type { DbtProjectManifest } from '@shared/dbt/types';
import { useApp } from '@web/context';
import { useEffect, useState } from 'react';

/**
 * Hook returning the manifest model + source identifiers for the first
 * configured dbt project. Used by the CTE side-panel tabs to populate the
 * `from` / `join` pickers without each tab fetching independently.
 *
 * Returns model names (without the `model.` prefix), source identifiers
 * formatted as `<source_name>.<table_name>` for display, and the raw
 * manifest itself so callers that need richer per-node data (e.g. column
 * metadata for the CTE Select tab's upstream picker) can look it up via
 * `findModelNode` / `extractColumnsFromNode`.
 */
export function useProjectModels(): {
  models: string[];
  sources: string[];
  manifest: DbtProjectManifest | null;
  loading: boolean;
  error: string | null;
} {
  const { api } = useApp();
  const [models, setModels] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [manifest, setManifest] = useState<DbtProjectManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .post({
        type: 'dbt-fetch-projects' as const,
        request: null,
      } as const)
      .then((projects) => {
        if (cancelled) return;
        const project = (projects ?? [])[0];
        if (!project?.manifest) {
          setModels([]);
          setSources([]);
          setManifest(null);
          setLoading(false);
          return;
        }
        const nodes = project.manifest.nodes ?? {};
        const modelNames = Object.keys(nodes)
          .filter((k) => k.startsWith('model.') || k.startsWith('seed.'))
          .map((k) => nodes[k]?.name)
          .filter((n): n is string => Boolean(n));
        const srcMap = project.manifest.sources ?? {};
        const sourceNames = Object.keys(srcMap)
          .filter((k) => k.startsWith('source.'))
          .map((k) => {
            const s = srcMap[k];
            return s?.source_name && s?.name
              ? `${s.source_name}.${s.name}`
              : null;
          })
          .filter((n): n is string => Boolean(n));
        setModels(modelNames);
        setSources(sourceNames);
        setManifest(project.manifest);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return { models, sources, manifest, loading, error };
}
