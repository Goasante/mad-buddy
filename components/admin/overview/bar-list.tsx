export type BarRow = { label: string; value: number; color: string };

/**
 * Horizontal bars with direct value labels — no legend needed. Rows are drawn
 * in the order given (an ordinal series). Bars anchor to the baseline with a
 * rounded data-end; the track shows the remaining scale.
 */
export function BarList({ rows, unitLabel }: { rows: BarRow[]; unitLabel?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = Math.round((row.value / max) * 100);
        return (
          <li key={row.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-sm">{row.label}</span>
              <span className="text-sm font-semibold tabular-nums">
                {row.value}
                {unitLabel ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unitLabel}</span> : null}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${row.label}: ${row.value}`}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, row.value > 0 ? 4 : 0)}%`, backgroundColor: row.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
