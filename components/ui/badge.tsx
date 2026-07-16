import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-foreground",
        green: "border-emerald-400/25 bg-emerald-400/12 text-emerald-700 dark:text-emerald-100",
        blue: "border-blue-400/25 bg-blue-400/12 text-blue-700 dark:text-blue-100",
        orange: "border-orange-400/25 bg-orange-400/12 text-orange-700 dark:text-orange-200",
        violet: "border-violet-400/25 bg-violet-400/12 text-violet-700 dark:text-violet-100",
        warning: "border-amber-400/25 bg-amber-400/12 text-amber-700 dark:text-amber-100",
        danger: "border-red-400/25 bg-red-400/12 text-red-700 dark:text-red-100"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
