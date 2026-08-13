export function StatTile({
  label,
  value,
  accent = "indigo",
}: {
  label: string;
  value: string | number;
  accent?: "indigo" | "amber" | "mint";
}) {
  const dot = {
    indigo: "bg-echo-indigo-500",
    amber: "bg-echo-amber-500",
    mint: "bg-echo-mint-500",
  }[accent];

  return (
    <div className="stat-tile">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-echo-muted">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="font-display text-3xl font-bold text-echo-ink">{value}</div>
    </div>
  );
}
