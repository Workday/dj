/**
 * Small formatters shared across the Query Control Center components.
 */

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number | string | undefined): string {
  if (bytes === undefined || bytes === null) return '—';
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (Number.isNaN(n)) return String(bytes);
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

export function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

export function formatDateTime(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export function relativeAge(s: string | undefined): string {
  if (!s) return '—';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return s;
  const diff = Date.now() - t;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function stateColor(state: string | undefined): string {
  switch (state) {
    case 'FINISHED':
      return 'text-green-600';
    case 'FAILED':
      return 'text-red-600';
    case 'RUNNING':
    case 'STARTING':
    case 'PLANNING':
      return 'text-blue-600';
    case 'QUEUED':
    case 'WAITING_FOR_PREREQUISITES':
      return 'text-amber-600';
    default:
      return 'text-gray-600';
  }
}
