import { ExclamationCircleIcon } from '@heroicons/react/24/outline';
import React from 'react';

const ERROR_MESSAGES = {
  model_name: 'A model must be selected before you can continue.',
  source_name: 'A source must be selected before you can continue.',
  join_model_name: 'A join model must be selected before you can continue.',
  operation: 'At least one join operation is required to proceed.',
  lookback_days: 'A lookback period is required to proceed.',
  rollup_interval: 'A rollup interval is required to proceed.',
  union_models: 'At least one model or source must be selected to proceed.',
  join_column_selection: 'A column must be selected to proceed.',
  join_column_fields: 'At least one field must be added to proceed.',
} as const;

type ErrorMessageType = keyof typeof ERROR_MESSAGES;

interface ErrorMessageProps {
  type: ErrorMessageType;
  message?: string;
  className?: string;
  variant?: 'error' | 'warning';
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  type,
  message,
  className,
  variant = 'error',
}) => {
  const defaultMsg = ERROR_MESSAGES[type] || '';

  // Variant-specific classes
  // style with border & bg: text-rose-600 bg-rose-50 border border-rose-100'
  const variantClasses =
    variant === 'warning'
      ? 'text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-600'
      : 'text-error';

  return (
    <div
      className={`flex items-center gap-2 text-sm italic ${variantClasses} rounded ${
        className || ''
      }`}
      role="alert"
      aria-live="polite"
    >
      {/* eslint-disable-next-line no-constant-binary-expression -- Feature flag for icon display */}
      {false && (
        <ExclamationCircleIcon
          className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
            variant === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-error'
          }`}
        />
      )}
      <div className="leading-tight">
        <div className="font-normal text-sm">{message || defaultMsg}</div>
      </div>
    </div>
  );
};

export default ErrorMessage;
