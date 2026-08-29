import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
};

/**
 * NO DEFAULT ICON.
 *
 * This used to default to Sparkles, so twenty of the twenty-six call sites
 * chose a meaningful glyph and the remaining six silently got a decorative one
 * -- the app's most common "nothing here yet" surface wearing an AI-magic mark
 * that said nothing about what was missing.
 *
 * An empty state does not inherently need an illustration. Callers that have a
 * real symbol still pass one and are unchanged; the rest now show their title
 * and description, which is what actually explains the state. The circle only
 * renders when there is something to put in it.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className
}: EmptyStateProps) {
  return (
    <div className={cn("glass-panel rounded-lg p-6 text-center", className)}>
      {Icon ? (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.08] text-accent">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      ) : null}
      <h3 className={cn("text-lg font-semibold", Icon && "mt-4")}>{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
