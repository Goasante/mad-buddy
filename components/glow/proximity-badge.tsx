import { Badge } from "@/components/ui/badge";
import type { ProximityLevel } from "@/lib/proximity";
import { proximityLabels } from "@/lib/proximity";

export type ProximityBadgeProps = {
  proximityLevel: ProximityLevel;
  className?: string;
};

export function ProximityBadge({ proximityLevel, className }: ProximityBadgeProps) {
  const variant = proximityLevel === "far" || proximityLevel === "hidden" ? "default" : "orange";
  return (
    <Badge variant={variant} className={className}>
      {proximityLabels[proximityLevel]}
    </Badge>
  );
}
