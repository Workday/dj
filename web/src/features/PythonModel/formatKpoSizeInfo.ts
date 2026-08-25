import type { KpoSizeSpec } from '@shared/framework/types';

export function formatKpoSizeInfo(spec: KpoSizeSpec): string {
  const cpuLabel =
    spec.cpu === '1' ? '1 vCPU' : `${spec.cpu} vCPUs`;
  const guidance = spec.guidance ? ` — ${spec.guidance}` : '';
  return `${cpuLabel}, ${spec.memory} memory${guidance}`;
}
