import { Description, Field, Label } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { makeClassName } from '@web';
import { Tooltip } from '@web/elements';
import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';

export type TagInputProps = {
  value?: string[];
  onChange?: (tags: string[]) => void;
  onBlur?: () => void;
  description?: string;
  error?: boolean | string;
  label?: string;
  tooltipText?: string;
  placeholder?: string;
  predefinedTags?: string[];
  disabled?: boolean;
  restrictToPredefined?: boolean;
};

export function TagInput({
  value = [],
  onChange,
  onBlur,
  description,
  error,
  label,
  tooltipText,
  placeholder = 'Type and press Enter to add tags',
  predefinedTags = [],
  disabled = false,
  restrictToPredefined = false,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAddTag = (tag: string) => {
    if (!tag || tag.trim() === '') {
      return;
    }

    const trimmedTag = tag.trim();
    if (restrictToPredefined && !predefinedTags.includes(trimmedTag)) {
      return;
    }
    if (trimmedTag && !value.includes(trimmedTag)) {
      onChange?.([...value, trimmedTag]);
    }
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onChange?.(value.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag when backspace is pressed on empty input
      handleRemoveTag(value[value.length - 1]);
    }
  };

  const filteredSuggestions = predefinedTags.filter(
    (tag) =>
      !value.includes(tag) &&
      tag.toLowerCase().includes(inputValue.toLowerCase()),
  );

  return (
    <Field className="flex flex-col gap-1">
      {label && (
        <Label className="text-sm/6 font-semibold leading-6 mt-2 text-background-contrast flex gap-1 items-center">
          {label}
          {tooltipText && <Tooltip content={tooltipText} />}
        </Label>
      )}
      {!tooltipText && description && (
        <Description className="text-sm/6">{description}</Description>
      )}

      <div className="relative w-full">
        <div
          className={makeClassName(
            'flex bg-background ring-1 rounded-lg p-2 text-sm text-background-contrast w-full min-h-[44px]',
            'focus-within:ring-2 focus-within:ring-primary',
            error ? 'ring-2 ring-error' : 'ring-[#D9D9D9] dark:ring-[#4A4A4A]',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div className="flex flex-wrap flex-grow gap-2 items-center">
            {/* Display existing tags */}
            {value.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 bg-tag text-tag-contrast rounded-md text-sm font-medium"
              >
                {tag}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="rounded-full p-0.5 text-tag-contrast"
                    aria-label={`Remove ${tag}`}
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}

            {/* Input field */}
            <input
              autoComplete="off"
              name="tag-input"
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Delay to allow clicking on suggestions
                setTimeout(() => {
                  setShowSuggestions(false);
                  onBlur?.();
                }, 200);
              }}
              disabled={disabled}
              placeholder={value.length === 0 ? placeholder : ''}
              className="flex-1 min-w-[120px] bg-transparent border-none outline-none focus:outline-none text-sm disabled:cursor-not-allowed"
            />
          </div>
        </div>
        {/* Suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-10 mt-1 bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleAddTag(suggestion)}
                className="w-full text-left px-3 py-2 hover:bg-surface text-sm text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && typeof error === 'string' && (
        <p className="inline-block text-error text-xs italic mt-1">{error}</p>
      )}
    </Field>
  );
}
