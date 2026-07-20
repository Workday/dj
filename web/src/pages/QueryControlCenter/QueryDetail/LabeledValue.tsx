export type LabeledValueProps = {
  label: string;
  value?: string;
};

/**
 * Uppercase label paired with a monospace value. Used inside
 * `MetadataCard` for the Identification / Timing rows. Renders `—`
 * when the value is missing so the column doesn't collapse.
 */
export function LabeledValue({ label, value }: LabeledValueProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase opacity-70">{label}</span>
      <span className="text-sm font-mono break-all">{value || '—'}</span>
    </div>
  );
}
