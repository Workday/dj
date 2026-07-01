import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Label,
} from '@headlessui/react';
import {
  CheckIcon,
  ChevronDownIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import { makeClassName } from '@web';
import { Tooltip } from '@web/elements';
import { useDebounce } from '@web/hooks';
import React, { useEffect, useMemo, useRef, useState } from 'react';

type Option = { label: string; value: string };

/** Stable equality-by-value comparator for the virtualized `by` prop. */
const compareByValue = (a: Option | null, b: Option | null) =>
  (a?.value ?? null) === (b?.value ?? null);

export type SelectSingleProps = {
  disabled?: boolean;
  error?: boolean | string;
  innerRef?: React.Ref<HTMLSelectElement>;
  label?: string;
  onBlur: () => void;
  onChange: (value: Option | null) => void;
  options: Option[];
  value: Option | null;
  tooltipText?: string;
  placeholder?: string;
  className?: string;
  labelClass?: string;
  showClearButton?: boolean;
  inputClassName?: string;
  /** Custom function to display the selected value in the input (defaults to showing the label) */
  selectedDisplayValue?: (option: Option | null) => string;
  /** Title attribute for the input (shows as tooltip on hover) */
  title?: string;
  /** Custom function to render option label in dropdown (receives option, focus, selected states) */
  renderOptionLabel?: (
    option: Option,
    state: { focus: boolean; selected: boolean },
  ) => React.ReactNode;
  /** Function to extract group key from option for showing separators between groups */
  getOptionGroup?: (option: Option) => string;
  /**
   * Virtualize the options list (Headless UI windowing). Use for very large
   * option sets (hundreds+) to avoid rendering every row into the DOM.
   * Mutually exclusive with `getOptionGroup` (group separators need
   * neighbor awareness, which the virtual render-prop can't provide).
   */
  virtualized?: boolean;
  /**
   * Debounce (ms) applied to the typed query before filtering. Defaults to
   * `0` (immediate, unchanged behavior). Useful with large option sets.
   */
  filterDebounceMs?: number;
};

export function SelectSingle({
  disabled,
  error,
  label,
  options,
  onBlur,
  onChange,
  value = null,
  tooltipText,
  placeholder = '',
  className,
  labelClass,
  showClearButton = true,
  inputClassName = '',
  selectedDisplayValue,
  title,
  renderOptionLabel,
  getOptionGroup,
  virtualized,
  filterDebounceMs,
}: SelectSingleProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Add direct event listeners to prevent React Flow interference
  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;

    // Stop propagation to prevent React Flow from interfering
    // We only stop mousedown/mouseup to prevent drag behavior
    // Let click events through for React synthetic events
    const stopPropagation = (e: Event) => {
      e.stopPropagation();
    };

    // For wheel events, use passive: true
    const stopWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };

    const events = ['mousedown', 'mouseup', 'dblclick'];
    events.forEach((event) => {
      containerElement.addEventListener(event, stopPropagation, false);
    });

    containerElement.addEventListener('wheel', stopWheel, { passive: true });

    return () => {
      events.forEach((event) => {
        containerElement.removeEventListener(event, stopPropagation, false);
      });
      containerElement.removeEventListener('wheel', stopWheel);
    };
  }, []);

  // Debounce only when a delay is opted into, so existing call sites keep
  // their immediate-filter behavior. Filtering is memoized either way.
  const debouncedQuery = useDebounce(query, filterDebounceMs ?? 0);
  const effectiveQuery = (filterDebounceMs ?? 0) > 0 ? debouncedQuery : query;
  const filteredOptions = useMemo(
    () =>
      effectiveQuery === ''
        ? options
        : options.filter((o) =>
            o.label.toLowerCase().includes(effectiveQuery.toLowerCase()),
          ),
    [options, effectiveQuery],
  );

  // Single option row, shared by the static (.map) and virtualized
  // (render-prop) paths so their markup stays identical.
  const renderOptionRow = (o: Option) => (
    <ComboboxOption
      key={o.value}
      value={o}
      className={({ focus }) =>
        makeClassName(
          // `block w-full` so the focus highlight spans the full row even in
          // virtualized mode, where each option is absolutely positioned and
          // would otherwise shrink to its content width.
          'relative block w-full cursor-default select-none py-2 pl-3 pr-9 text-background-contrast text-sm',
          focus
            ? 'bg-primary text-primary-contrast'
            : 'text-background-contrast',
        )
      }
    >
      {({ focus, selected }) => (
        <>
          {renderOptionLabel ? (
            renderOptionLabel(o, { focus, selected })
          ) : (
            <span
              className={makeClassName(
                'block truncate',
                selected && 'font-semibold',
              )}
            >
              {o.label}
            </span>
          )}
          {selected && (
            <span
              className={makeClassName(
                'absolute inset-y-0 right-0 flex items-center pr-4',
                focus ? 'text-background-contrast' : 'text-primary',
              )}
            >
              <CheckIcon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
        </>
      )}
    </ComboboxOption>
  );

  return (
    <div
      ref={containerRef}
      className="w-full"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Combobox<Option | null>
        disabled={disabled}
        immediate
        virtual={virtualized ? { options: filteredOptions } : undefined}
        by={virtualized ? compareByValue : undefined}
        onChange={(o) => {
          setQuery('');
          onChange(o);
        }}
        onClose={virtualized ? () => setQuery('') : undefined}
        value={value}
      >
        {label && (
          <Label
            className={makeClassName(
              'text-sm/6 font-semibold leading-6 mt-2 text-background-contrast flex gap-1 items-center',
              labelClass,
            )}
          >
            {label}
            {tooltipText && <Tooltip content={tooltipText} />}
          </Label>
        )}

        <div className="relative w-full">
          <ComboboxInput<Option | null>
            ref={inputRef}
            autoComplete="one-time-code" // Should disable autofill in browser
            className={
              className ||
              makeClassName(
                'w-full rounded-md border-0 bg-background h-10 py-2.5 pl-3 pr-16 text-background-contrast text-sm shadow-sm ring-1 ring-inset',
                'focus:ring-2 focus:ring-inset focus:ring-primary',
                error ? 'ring-error' : 'ring-[#D9D9D9] dark:ring-[#4A4A4A]',
                label && 'mt-1',
                inputClassName,
              )
            }
            placeholder={placeholder}
            displayValue={(o) =>
              selectedDisplayValue ? selectedDisplayValue(o) : o?.label || ''
            }
            onChange={(e) => setQuery(e.target.value)}
            onBlur={onBlur}
            title={title}
          />
          {value && showClearButton && (
            <button
              type="button"
              className={makeClassName(
                'absolute cursor-pointer inset-y-0 right-8 flex items-center justify-center w-4 h-4 my-auto z-10',
                'focus:outline-none text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setQuery('');
                onChange(null);
                // Blur the input to close any open dropdown
                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }}
              tabIndex={-1}
              aria-label="Clear selection"
            >
              <XMarkIcon aria-hidden="true" className="w-4 h-4" />
            </button>
          )}
          <ComboboxButton
            className={makeClassName(
              'absolute inset-y-0 right-0 flex items-center rounded-r-md px-2',
              'focus:outline-none',
            )}
          >
            <ChevronDownIcon
              className="h-5 w-5 text-background-contrast"
              aria-hidden="true"
            />
          </ComboboxButton>
          <ComboboxOptions
            static={false}
            anchor="bottom"
            className={makeClassName(
              'z-[9999] mt-1 w-[var(--input-width)] rounded-md bg-background py-1 text-base shadow-lg ring-1 ring-background-contrast ring-opacity-5',
              'empty:invisible',
              '[--anchor-max-height:18rem] max-h-[--anchor-max-height] overflow-auto',
            )}
          >
            {virtualized
              ? ({ option }: { option: Option }) => renderOptionRow(option)
              : filteredOptions.map((o, index) => {
                  // Check if we need to show a separator before this option
                  const showSeparator =
                    getOptionGroup &&
                    index > 0 &&
                    getOptionGroup(o) !==
                      getOptionGroup(filteredOptions[index - 1]);

                  return (
                    <div key={o.value}>
                      {showSeparator && (
                        <hr className="my-1 border-t border-gray-300 dark:border-gray-600" />
                      )}
                      {renderOptionRow(o)}
                    </div>
                  );
                })}
          </ComboboxOptions>
        </div>
      </Combobox>
    </div>
  );
}
