import type { Route } from "next";
import Link from "next/link";

/**
 * The canonical Home section header: a large title with an optional
 * brand-orange action on the right.
 *
 * Near, Upcoming Plans and Suggestions each hand-wrote this markup, so the
 * type scale and the action styling had to be kept in step by hand. This is
 * that one pattern, so a new section cannot drift from the others.
 *
 * The action is a link (`href`), a button (`onAction`, for a section that
 * opens a sheet rather than navigating), or nothing. Both render identically,
 * so a sheet-opening section cannot drift from a navigating one.
 */
export function PageSectionHeader({
  id,
  title,
  href,
  onAction,
  actionLabel = "See all",
  actionAriaLabel
}: {
  id: string;
  title: string;
  /** Navigating action. Mutually exclusive with onAction. */
  href?: Route;
  /** In-place action (e.g. opening a sheet). Ignored when href is set. */
  onAction?: () => void;
  actionLabel?: string;
  actionAriaLabel?: string;
}) {
  const label = actionAriaLabel ?? `${actionLabel} ${title.toLowerCase()}`;
  // One class for both, so the link and the button are visually identical.
  const actionClass =
    "focus-ring shrink-0 rounded-md text-base font-medium text-[var(--color-brand-orange)] hover:underline";

  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-[1.75rem] font-bold leading-none tracking-tight">
        {title}
      </h2>
      {href ? (
        <Link href={href} aria-label={label} className={actionClass}>
          {actionLabel}
        </Link>
      ) : onAction ? (
        <button type="button" onClick={onAction} aria-label={label} className={actionClass}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
