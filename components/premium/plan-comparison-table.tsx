import { Check, X } from "lucide-react";
import { comparisonRows } from "@/components/premium/plans";

export function PlanComparisonTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-card/95 text-left backdrop-blur-xl">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Feature</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Free</th>
              <th className="bg-primary/[0.06] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">Buddy Plus</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Buddy Pro</th>
            </tr>
        </thead>
        <tbody>
            {comparisonRows.map((row) => (
              <tr key={row.feature} className="border-t border-border/60 transition-colors hover:bg-secondary/30">
                <td className="px-4 py-2.5 text-muted-foreground">{row.feature}</td>
                <td className="px-4 py-2.5">{renderValue(row.free)}</td>
                <td className="bg-primary/[0.035] px-4 py-2.5">{renderValue(row.plus)}</td>
                <td className="px-4 py-2.5">{renderValue(row.pro)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(value: boolean | string) {
  if (value === true) {
    return <Check className="h-4 w-4 text-blue-500 dark:text-blue-300" aria-label="Included" />;
  }

  if (value === false) {
    return <X className="h-4 w-4 text-muted-foreground" aria-label="Not included" />;
  }

  return <span className="font-medium">{value}</span>;
}
