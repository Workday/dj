import { makeClassName } from '@web';

export type BannerVariant = 'info' | 'warning' | 'success' | 'error';

export type BannerProps = {
  variant?: BannerVariant;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  /**
   * Layout. `inline` (default) is a compact horizontal strip suited to sit
   * inside a toolbar/header; `card` is a centered empty-state block — the
   * caller positions it (e.g. centered in an empty panel).
   */
  layout?: 'inline' | 'card';
  /** Action slot: right-aligned when inline, below the body in card mode. */
  actions?: React.ReactNode;
  className?: string;
  /** Body content. A string, or rich nodes (e.g. an inline `<code>`). */
  children?: React.ReactNode;
};

const VARIANT_CLASS: Record<BannerVariant, string> = {
  info: 'bg-message-info border-message-info text-message-info-contrast',
  warning:
    'bg-message-warning border-message-warning text-message-warning-contrast',
  success:
    'bg-message-success border-message-success text-message-success-contrast',
  error: 'bg-message-error border-message-error text-message-error-contrast',
};

/**
 * Reusable callout/banner. Used for inline empty-state strips (e.g. the
 * Data Explorer "no Lightdash content" prompt) and centered empty-state
 * cards (e.g. the Lightdash Lineage panel prerequisite states). Body and
 * actions are slots so each call site keeps full control of its content.
 */
export function Banner({
  variant = 'info',
  icon,
  title,
  layout = 'inline',
  actions,
  className,
  children,
}: BannerProps) {
  if (layout === 'card') {
    return (
      <div
        className={makeClassName(
          'border rounded-lg p-5 shadow-sm max-w-md w-full',
          VARIANT_CLASS[variant],
          className,
        )}
      >
        {(icon || title) && (
          <div className="flex items-center gap-2 font-semibold">
            {icon}
            {title}
          </div>
        )}
        {children && (
          <div className="mt-2 text-sm opacity-90 whitespace-pre-line">
            {children}
          </div>
        )}
        {actions && (
          <div className="mt-4 flex items-center gap-2">{actions}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className={makeClassName(
        'border rounded-lg px-3 py-2 flex items-center justify-between gap-3 text-xs',
        VARIANT_CLASS[variant],
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <div className="min-w-0">
          {title && <span className="font-semibold mr-1">{title}</span>}
          {children}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}
