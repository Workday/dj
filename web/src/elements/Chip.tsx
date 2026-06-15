import { makeClassName } from '@web';

export type ChipProps = {
  selected: boolean;
  /** Renders a dashed border (used for "+ New profile"-style affordances). */
  dashed?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
};

/**
 * Pill-style toggle. Compact alternative to `Button` for filter rows
 * and small chip strips. Pairs well with multi-select state filters
 * (free toggles) or single-select strips where every item is rendered
 * as its own pill.
 */
export function Chip({
  selected,
  dashed = false,
  onClick,
  title,
  children,
}: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={makeClassName(
        'px-2 py-1 text-xs rounded border transition-colors',
        dashed && 'border-dashed',
        selected
          ? 'bg-primary text-primary-contrast border-primary'
          : 'border-neutral hover:bg-list-item-hover',
      )}
    >
      {children}
    </button>
  );
}
