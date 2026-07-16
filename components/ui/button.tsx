import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring safe-motion inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border px-4 text-sm font-semibold shadow-[0_12px_30px_hsl(var(--shadow)/0.14)] transition-all duration-300 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_16px_36px_hsl(var(--primary)/0.25)]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
        ghost: "border-transparent bg-transparent text-foreground shadow-none hover:bg-secondary",
        outline: "border border-border bg-card/60 text-foreground hover:-translate-y-0.5 hover:bg-secondary",
        danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-5",
        icon: "h-10 w-10 px-0"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
