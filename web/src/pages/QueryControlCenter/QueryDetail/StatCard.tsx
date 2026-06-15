export type StatCardProps = React.PropsWithChildren<{ label: string }>;

/**
 * Bordered card cell with an uppercase label and a value. Used by
 * `StatsGrid` for the 4x2 metric tile layout in the Query Info card.
 */
export function StatCard({ label, children }: StatCardProps) {
  return (
    <div className="border border-neutral rounded px-2 py-1">
      <div className="text-xs uppercase opacity-70">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
