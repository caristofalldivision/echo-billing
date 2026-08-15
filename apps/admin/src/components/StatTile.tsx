export function StatTile({
  label,
  value,
  accent = "brand",
}: {
  label: string;
  value: string | number;
  accent?: "brand" | "pulse" | "voucher" | "alert";
}) {
  const dot = {
    brand: "bg-signal-brand",
    pulse: "bg-signal-pulse",
    voucher: "bg-signal-voucher",
    alert: "bg-signal-alert",
  }[accent];

  return (
    <div className="stat-tile">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-signal-ink-faint">
        <span className={`h-2.5 w-2.5 ${dot}`} />
        {label}
      </div>
      <div className="font-mono text-3xl font-bold tabular-nums text-signal-ink">{value}</div>
    </div>
  );
}
