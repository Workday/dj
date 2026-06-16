import type { TrinoStage } from '@shared/trino/types';
import { Text } from '@web/elements';

import { StageNode } from './StageNode';

export type StageTreeProps = {
  stage: TrinoStage | undefined;
};

/**
 * Renders the recursive Trino stage tree starting from the root
 * stage. Returns a placeholder line when the query info doesn't
 * carry a root stage (e.g. queries that failed during planning).
 *
 * The container scrolls inside the Tab panel so a deeply nested tree
 * doesn't push the surrounding QueryDetail layout.
 */
export function StageTree({ stage }: StageTreeProps) {
  if (!stage) {
    return <Text>No stage tree available for this query.</Text>;
  }
  return (
    <div className="h-full min-h-0 overflow-auto font-mono">
      <StageNode stage={stage} depth={0} />
    </div>
  );
}
