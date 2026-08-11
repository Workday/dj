import { SelectSingle } from '@web/elements';
import { forwardRef, useMemo } from 'react';
import type { ControllerRenderProps, FieldError } from 'react-hook-form';

export type FieldSelectSingleProps = ControllerRenderProps & {
  error?: FieldError;
  label?: string;
  options: { label: string; value: string }[];
  tooltipText?: string;
  className?: string;
  inputClassName?: string;
  labelClass?: string;
  helpIcon?: React.ReactNode; // Help icon for Assist Me
  /**
   * Virtualize the options list. Enable for large option sets (hundreds+),
   * e.g. Trino tables, so the dropdown doesn't render every row into the DOM
   * and hang the webview.
   */
  virtualized?: boolean;
  /** Debounce (ms) applied to the typed query before filtering large lists. */
  filterDebounceMs?: number;
};

export const FieldSelectSingle = forwardRef<
  HTMLSelectElement,
  FieldSelectSingleProps
>(({ error, onChange, options, value, ...props }, ref) => {
  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value],
  );
  return (
    <>
      <SelectSingle
        {...props}
        error={error ? error?.message || true : undefined}
        innerRef={ref}
        tooltipText={props.tooltipText}
        onChange={(o) => onChange(o?.value || null)}
        options={options}
        value={selected}
      />
    </>
  );
});
