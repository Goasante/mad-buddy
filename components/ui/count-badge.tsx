import { cn } from "@/lib/utils";

/**
 * The one numeric unread/count badge for the whole app.
 *
 * Three near-identical copies of this used to exist (the mobile header's
 * notification/request badges, the shell's nav-tab badges, and the Messages
 * V5 shortcut badges) with drifted sizing (18px vs 20px) and drifted caps
 * (9+ vs 99+) that had no documented reason to differ — organic duplication,
 * not a deliberate design decision. This is the single implementation; call
 * sites choose only their accent colour, which IS a deliberate per-surface
 * choice (Messages V5 uses the brand primary rather than red).
 */
export function CountBadge({
  count,
  tone = "danger",
  className
}: {
  count: number;
  /** danger = the app-wide red alert badge. primary = the brand-orange accent Messages V5 uses for its own shortcut row. */
  tone?: "danger" | "primary";
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        "absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-background px-1 text-[10px] font-bold leading-none",
        tone === "danger" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground",
        className
      )}
      aria-hidden="true"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
