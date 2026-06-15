import { XMarkIcon } from '@heroicons/react/20/solid';
import type { SchemaModelWhere } from '@shared/schema/types/model.schema';
import { useApp } from '@web/context';
import { Button } from '@web/elements';
import { WhereEditor } from '@web/features/DataModeling/components/WhereEditor';
import { ActionType } from '@web/features/DataModeling/types';
import { useModelStore } from '@web/stores/useModelStore';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';

/**
 * Canvas-level Where Clause node. This is a thin React Flow wrapper around
 * the shared {@link WhereEditor} so all WHERE editing -- in the CTE popover
 * tabs and on the main canvas -- routes through a single implementation.
 *
 * Uses `idPrefix="model-where"` so its radio groups can't collide with
 * editors mounted simultaneously in the CTE popover (which use
 * `cte-where` / `cte-having`).
 */
export const WhereClauseNode: React.FC<NodeProps> = () => {
  const { api } = useApp();

  const { setWhereState, setPendingRemovalAction } = useModelStore();
  const ctes = useModelStore((state) => state.ctes);
  const whereData = useModelStore((state) => state.where);

  // Manifest-derived options for inline SubqueryEditor dropdowns. Fetched
  // lazily on mount; if the project isn't available we silently fall back
  // to text inputs inside the shared SubqueryEditor.
  const [models, setModels] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        const projectsResponse = await api.post({
          type: 'dbt-fetch-projects',
          request: null,
        });
        const projects = projectsResponse || [];
        if (projects.length === 0) return;

        const project = projects[0];
        if (project.manifest) {
          setManifest(project.manifest as Record<string, unknown>);
        }
        if (project.manifest?.nodes) {
          const modelNames = Object.keys(project.manifest.nodes)
            .filter(
              (key) =>
                key.startsWith('model.') ||
                key.startsWith('seed.') ||
                key.startsWith('source.'),
            )
            .map((key: string) => project.manifest.nodes[key]?.name)
            .filter((name: unknown): name is string => Boolean(name));
          setModels(modelNames);
        }
        if (project.manifest?.sources) {
          const sourceNames = Object.keys(project.manifest.sources)
            .filter((key: string) => key.startsWith('source.'))
            .map((key: string) => {
              const source = project.manifest.sources[key];
              return source?.source_name && source?.name
                ? `${source.source_name}.${source.name}`
                : null;
            })
            .filter((name: unknown): name is string => Boolean(name));
          setSources(sourceNames);
        }
      } catch {
        // Silently fail - subquery dropdowns fall back to text inputs.
      }
    };
    void fetchProjectData();
  }, [api]);

  const modelOptions = useMemo(
    () => models.map((m) => ({ label: m, value: m })),
    [models],
  );
  const sourceOptions = useMemo(
    () => sources.map((s) => ({ label: s, value: s })),
    [sources],
  );
  const cteOptions = useMemo(
    () => ctes.map((c) => ({ label: c.name, value: c.name })),
    [ctes],
  );

  const handleWhereChange = (next: SchemaModelWhere | undefined) => {
    setWhereState(next ?? null);
  };

  const handleRemoveWhereClause = () => {
    setPendingRemovalAction(ActionType.WHERE);
  };

  return (
    <div
      className="bg-background border-2 rounded-lg border-neutral shadow-lg p-4 flex flex-col gap-4 w-[40rem] cursor-default"
      data-tutorial-id="where-node"
    >
      <Handle type="target" position={Position.Top} id="input" />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Where Clause</h2>
        <Button
          onClick={() => handleRemoveWhereClause()}
          variant="iconButton"
          title="Remove where clause"
          label=""
          icon={<XMarkIcon className="w-7 h-7 text-foreground" />}
        />
      </div>

      <div className="flex flex-col gap-3 p-3 border border-neutral rounded-md bg-card">
        <WhereEditor
          value={whereData ?? undefined}
          onChange={handleWhereChange}
          modelOptions={modelOptions}
          sourceOptions={sourceOptions}
          cteOptions={cteOptions}
          ctes={ctes}
          manifest={manifest}
          idPrefix="model-where"
        />
      </div>

      <Handle type="source" position={Position.Bottom} id="output" />
    </div>
  );
};
