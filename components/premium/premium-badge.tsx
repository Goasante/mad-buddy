import { Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PremiumBadgeProps = {
  label?: string;
};

export function PremiumBadge({ label = "Premium" }: PremiumBadgeProps) {
  return (
    <Badge variant="violet">
      <Crown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}
