import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type LoadingStateProps = {
  title?: string;
  description?: string;
  className?: string;
};

export function LoadingState({
  title = "Loading",
  description = "Getting things ready.",
  className
}: LoadingStateProps) {
  return (
    <div
      className={cn(
        "glass-panel flex min-h-40 flex-col items-center justify-center rounded-lg p-6 text-center",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-accent motion-reduce:animate-none" />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
