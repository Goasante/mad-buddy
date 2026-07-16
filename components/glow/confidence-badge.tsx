import { Badge } from "@/components/ui/badge";
import type { ConfidenceLevel } from "@/lib/proximity";
import { confidenceLabels } from "@/lib/proximity";

export type ConfidenceBadgeProps = {
  confidence: ConfidenceLevel;
};

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const variant = confidence === "high" ? "green" : confidence === "medium" ? "warning" : "blue";

  return <Badge variant={variant}>{confidenceLabels[confidence]}</Badge>;
}
