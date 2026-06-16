import * as Headless from '@headlessui/react';
import { makeClassName } from '@web';
import { Spinner } from '@web/elements';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  label?: string;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  variant?:
    | 'primary'
    | 'secondary'
    | 'outlineIconButton'
    | 'error'
    | 'neutral'
    | 'iconButton'
    | 'link';
  icon?: React.ReactNode;
  className?: string;
  iconLabelClassName?: string;
};

export function Button({
  className,
  fullWidth,
  label,
  loading,
  type = 'button',
  variant,
  icon,
  iconLabelClassName,
  ...props
}: ButtonProps) {
  const _props = {
    ...props,
    disabled: loading || props.disabled,
    children: loading ? <Spinner size={10} /> : label ?? '',
    type,
  };
  switch (variant) {
    case 'secondary': {
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'rounded bg-background px-2 py-1 text-xs font-semibold text-primary shadow-sm ring-1 ring-inset ring-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            fullWidth && 'w-full',
            className,
          )}
        />
      );
    }

    case 'error': {
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'rounded bg-red-700 py-2 px-4 text-sm text-white hover:bg-red-600 disabled:opacity-50',
            fullWidth && 'w-full',
            className,
          )}
        />
      );
    }

    case 'neutral': {
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'rounded bg-gray-600 py-2 px-4 text-sm text-white hover:bg-gray-700 disabled:opacity-50',
            fullWidth && 'w-full',
            className,
          )}
        />
      );
    }

    case 'iconButton':
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'p-2 rounded flex gap-1 items-center hover:text-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-inherit',
            !className?.includes('justify-') && 'justify-center',
            fullWidth && 'w-full',
            className,
          )}
        >
          {icon}
          {label && (
            <span className={makeClassName('w-max', iconLabelClassName)}>
              {label}
            </span>
          )}
        </Headless.Button>
      );

    case 'outlineIconButton':
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'p-2 rounded flex gap-2 items-center justify-center text-primary border border-primary',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            fullWidth && 'w-full',
            className,
          )}
        >
          {icon}
          {label}
        </Headless.Button>
      );

    case 'link':
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
            fullWidth && 'w-full',
            className ? className : 'px-4 py-2',
          )}
        />
      );

    case 'primary':
    default:
      return (
        <Headless.Button
          {..._props}
          className={makeClassName(
            'rounded bg-primary py-2 px-4 text-sm text-primary-contrast disabled:opacity-50 disabled:cursor-not-allowed',
            'flex items-center gap-2 justify-center',
            fullWidth && 'w-full',
            className,
          )}
        >
          {icon}
          {label}
        </Headless.Button>
      );
  }
}
