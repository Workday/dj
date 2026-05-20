import { Checkbox as HeadlessCheckbox, Field, Label } from '@headlessui/react';
import { CheckIcon, MinusIcon } from '@heroicons/react/24/solid';
import { makeClassName } from '@web';
import React, { useEffect, useRef } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean | React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  hideCheckbox?: boolean;
  icon?: React.ReactNode;
  title?: string;
  indeterminate?: boolean;
  description?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  id,
  className = '',
  disabled = false,
  hideCheckbox = false,
  icon,
  title,
  indeterminate = false,
  description,
}) => {
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Handle indeterminate state using native checkbox property
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <Field className={`flex items-center gap-2 ${className}`}>
      <HeadlessCheckbox
        ref={checkboxRef as never}
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={makeClassName(
          'group size-4 rounded border data-[checked]:bg-blue-500 data-[checked]:border-blue-500 border-neutral-contrast transition-colors duration-200 ease-in-out focus:outline-none',
          'data-[focus]:outline-2 data-[focus]:outline-blue-500 data-[focus]:outline-offset-2 data-[disabled]:opacity-50',
          hideCheckbox ? 'hidden' : 'block',
          disabled
            ? 'cursor-not-allowed bg-slate-400'
            : 'cursor-pointer bg-background',
          indeterminate ? 'bg-blue-500 border-blue-500' : '',
        )}
      >
        {indeterminate ? (
          <MinusIcon className="fill-white" />
        ) : (
          <CheckIcon className="hidden fill-white group-data-[checked]:block" />
        )}
      </HeadlessCheckbox>
      {icon}
      <div className="flex flex-col gap-1">
        {label && (
          <Label
            htmlFor={id}
            title={title}
            className={makeClassName(
              'text-sm select-none',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            )}
          >
            {label}
          </Label>
        )}
        {description && (
          <p className="text-sm text-neutral-500">{description}</p>
        )}
      </div>
    </Field>
  );
};
