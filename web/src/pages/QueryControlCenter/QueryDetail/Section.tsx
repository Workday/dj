export type SectionProps = React.PropsWithChildren<{ title: string }>;

/**
 * Divider-separated content section with a small heading. Adjacent
 * sections share a top border; the first one drops it via the
 * `first:` Tailwind variants. Used inside `MetadataCard` to group
 * Identification and Timing fields.
 */
export function Section({ title, children }: SectionProps) {
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-neutral first:border-t-0 first:pt-0">
      <span className="text-xs font-semibold opacity-80">{title}</span>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
