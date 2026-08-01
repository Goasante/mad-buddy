import { CakeSlice } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A celebration layer around an avatar. It never changes the avatar's own
 * proximity or premium glow classes, so the three visual systems stay separate. */
export function BirthdayAccent({
  active,
  children,
  className
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return <>{children}</>;
  return (
    <span className={cn("birthday-accent relative inline-grid place-items-center", className)}>
      <span className="birthday-accent__ring" aria-hidden="true" />
      <span className="birthday-accent__confetti birthday-accent__confetti--one" aria-hidden="true" />
      <span className="birthday-accent__confetti birthday-accent__confetti--two" aria-hidden="true" />
      {children}
      <span
        className="absolute -right-1 -top-1 z-20 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-amber-400 text-amber-950 shadow-md"
        title="Birthday today"
        aria-label="Birthday today"
      >
        <CakeSlice className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </span>
  );
}
