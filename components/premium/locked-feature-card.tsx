import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type LockedFeatureCardProps = {
  title: string;
  description: string;
  requiredPlan: string;
};

export function LockedFeatureCard({ title, description, requiredPlan }: LockedFeatureCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-300/10 text-violet-100">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
          <p className="mt-3 text-xs text-muted-foreground">Requires {requiredPlan}</p>
        </div>
      </div>
      <Button type="button" variant="outline" className="mt-5 w-full" asChild>
        <Link href="/upgrade">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          View upgrade
        </Link>
      </Button>
    </Card>
  );
}
