export type SectionHeaderProps = { title: string };

/**
 * Standalone underlined heading row. Visually distinct from `Section`:
 * just a heading line with a bottom border, intended to head a free-
 * form content block below (e.g. the Connection / Authentication
 * groups inside `ConnectionEditor`).
 */
export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="text-xs font-semibold opacity-70 tracking-wider pb-1 border-b border-neutral">
      {title}
    </div>
  );
}
