import { Description, Field, Label, Textarea } from '@headlessui/react';
import { makeClassName } from '@web';
import { Tooltip } from '@web/elements';

export type TextAreaProps = React.ComponentProps<'textarea'> & {
  description?: string;
  error?: boolean | string;
  innerRef?: React.Ref<HTMLTextAreaElement>;
  label?: string;
  tooltipText?: string;
  placeholder?: string;
  labelClassName?: string;
  textareaClassName?: string;
};

export function TextArea({
  description,
  error,
  innerRef,
  label,
  value = '',
  tooltipText,
  placeholder,
  rows = 4,
  textareaClassName = '',
  labelClassName = '',
  ...props
}: TextAreaProps) {
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
      <Textarea
        {...props}
        rows={rows}
        className={makeClassName(
          'block bg-background ring-1 rounded-lg px-3 py-2 text-sm text-background-contrast w-full font-mono',
          'focus:ring-2 focus:ring-primary focus:outline-none resize-y',
          error ? 'ring-2 ring-error' : 'ring-[#D9D9D9] dark:ring-[#4A4A4A]',
          label && 'mt-3',
          textareaClassName,
        )}
        ref={innerRef}
        value={value}
        placeholder={placeholder}
      />
      {error && typeof error === 'string' && (
        <p className="inline-block text-error text-xs italic">{error}</p>
      )}
    </Field>
  );
}
