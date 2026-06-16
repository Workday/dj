import {
  CheckCircleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid';

export type SlimBannerVariant = 'success' | 'info' | 'error';

export type SlimBannerProps = {
  variant: SlimBannerVariant;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Single-row banner. Compact sibling to `Alert` for messages that fit
 * in one line with optional right-aligned actions. Variant tokens
 * (`success` / `info` / `error`) share the same `bg-${variant}` and
 * `text-${variant}-contrast` Tailwind classes as `Alert`, so theme
 * parity is automatic across dark and light VS Code themes.
 */
export function SlimBanner({ variant, children, actions }: SlimBannerProps) {
  const Icon =
    variant === 'error'
      ? XCircleIcon
      : variant === 'info'
        ? InformationCircleIcon
        : CheckCircleIcon;
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded bg-${variant} text-${variant}-contrast`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <div className="text-sm min-w-0">{children}</div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
