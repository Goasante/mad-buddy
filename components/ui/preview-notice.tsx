import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Honest labeling for features whose UI is complete but whose backend is not
 * yet wired (audit I-05). Anything inside a page carrying this notice runs on
 * sample data: interactions work, but nothing is saved or shared with other
 * people yet. Remove the notice from a page only when its feature is backed
 * by real persistence.
 */
export function PreviewNotice({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3",
        className
      )}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <p className="text-sm leading-6 text-amber-800 dark:text-amber-100">
        <span className="font-semibold">Preview</span>, this feature shows sample data. You can
        try everything, but changes aren&apos;t saved or shared with anyone yet.
      </p>
    </div>
  );
}

export function PreviewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200",
        className
      )}
    >
      <FlaskConical className="h-3 w-3" aria-hidden="true" />
      Preview
    </span>
  );
}
