import { makeClassName } from '@web';

export type MessageProps = {
  children: React.ReactNode;
  variant?: 'info' | 'error' | 'warning' | 'success';
  className?: string;
};

export function Message({
  children,
  variant = 'info',
  className,
}: MessageProps) {
  const variantClasses = {
    info: 'bg-message-info border-message-info text-message-info-contrast',
    error: 'bg-message-error border-message-error text-message-error-contrast',
    warning:
      'bg-message-warning border-message-warning text-message-warning-contrast',
    success:
      'bg-message-success border-message-success text-message-success-contrast',
  };

  return (
    <div
      className={makeClassName(
        'border p-4 rounded-lg',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}
