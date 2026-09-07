export interface BarListItem {
  label: string;
  value: number;
}

// Magnitude-by-category comparison — one hue, direct labels, sorted
// descending. Per the dataviz form heuristic: comparing categories on one
// measure doesn't need a color per category (that's for showing multiple
// series at once); a single hue + labels reads faster and avoids burning
// through the design system's small fixed categorical palette.
export function HorizontalBarList({ items, currency }: { items: BarListItem[]; currency: string }) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((i) => i.value));

  if (sorted.length === 0) {
    return <p className="py-6 text-center text-sm text-signal-ink-dim">No data yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-bold text-signal-ink">{item.label}</span>
            <span className="font-mono tabular-nums text-signal-ink-dim">
              {currency} {item.value.toLocaleString()}
            </span>
          </div>
          <div className="h-3 w-full border border-signal-border bg-signal-bg-elevated">
            <div
              className="h-full bg-signal-brand"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
