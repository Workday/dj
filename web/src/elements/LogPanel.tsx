import { makeClassName } from '@web';
import { useEffect, useRef } from 'react';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export type LogEntry = {
  level: LogLevel;
  message: string;
  /** ISO timestamp string. */
  timestamp: string;
};

export type LogPanelProps = {
  logs: LogEntry[];
  /** Optional heading rendered above the log body. */
  title?: string;
  /** Message shown when `logs` is empty. */
  emptyMessage?: string;
  /** Auto-scroll the latest log into view. Defaults to `true`. */
  autoScroll?: boolean;
  className?: string;
  bodyClassName?: string;
};

function getLogColor(level: LogLevel): string {
  switch (level) {
    case 'success':
      return 'text-green-600 dark:text-green-500';
    case 'error':
      return 'text-red-600 dark:text-red-500';
    case 'warning':
      return 'text-amber-600 dark:text-amber-500';
    default:
      return 'text-surface-contrast/80';
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleTimeString();
}

/**
 * Reusable, auto-scrolling, color-coded streaming log viewer.
 * Mirrors the look of the Lightdash Preview Manager's "Process Logs"
 * panel so streaming CLI output is consistent across views.
 */
export function LogPanel({
  logs,
  title = 'Output',
  emptyMessage = 'No logs yet.',
  autoScroll = true,
  className,
  bodyClassName,
}: LogPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs, autoScroll]);

  return (
    <div
      className={makeClassName(
        'bg-card rounded-lg p-3 flex flex-col min-h-0',
        className,
      )}
    >
      {title && <h2 className="text-sm font-semibold mb-2">{title}</h2>}
      {logs.length === 0 ? (
        <p className="text-xs italic text-neutral-500">{emptyMessage}</p>
      ) : (
        <div
          className={makeClassName(
            'flex-1 font-mono text-xs overflow-y-auto space-y-0.5',
            bodyClassName,
          )}
        >
          {logs.map((log, idx) => (
            <div
              key={idx}
              className={makeClassName('flex gap-2', getLogColor(log.level))}
            >
              <span className="text-neutral-500 shrink-0">
                [{formatTime(log.timestamp)}]
              </span>
              <span className="break-words whitespace-pre-wrap">
                {log.message}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
