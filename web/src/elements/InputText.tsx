import { Description, Field, Input, Label } from '@headlessui/react';
import { makeClassName } from '@web';
import { Tooltip } from '@web/elements';

export type InputTextProps = React.ComponentProps<'input'> & {
  description?: string;
  error?: boolean | string;
  innerRef?: React.Ref<HTMLInputElement>;
  label?: string;
  tooltipText?: string;
  placeholder?: string;
  labelClassName?: string;
  inputClassName?: string;
};

export function InputText({
  description,
  error,
  innerRef,
  label,
  value = '',
  tooltipText,
  placeholder,
  inputClassName = '',
  labelClassName = '',
  ...props
}: InputTextProps) {
  return (
    <Field className="w-full">
      {label && (
        <Label
          className={makeClassName(
            'text-sm/6 font-semibold leading-6 mt-2 text-background-contrast flex gap-1 items-center',
            labelClassName,
          )}
        >
          {label}
          {tooltipText && <Tooltip content={tooltipText} />}
        </Label>
      )}
      {!tooltipText && description && (
        <Description className="text-sm/6">{description}</Description>
      )}
      <Input
        {...props}
        className={makeClassName(
          'block bg-background ring-1 rounded-lg px-3 h-10 text-sm text-background-contrast w-full',
          'focus:ring-2 focus:ring-primary focus:outline-none',
          error ? 'ring-2 ring-error' : 'ring-[#D9D9D9] dark:ring-[#4A4A4A]',
          label && 'mt-3',
          inputClassName,
        )}
        ref={innerRef}
        value={value}
        placeholder={placeholder}
      />
      {error && typeof error === 'string' && (
        <p className="inline-block text-error text-xs italic pt-1">{error}</p>
      )}
    </Field>
  );
}
