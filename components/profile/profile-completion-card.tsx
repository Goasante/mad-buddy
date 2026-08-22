"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui/card";
import type { CompletionTask } from "@/lib/profile/rules";

/**
 * Profile completion.
 *
 * The percentage and the task list both come from `lib/profile/rules` — the
 * same authority onboarding uses — rather than being counted here, so the two
 * surfaces can never disagree about how complete a profile is.
 *
 * Private by design (spec §10): this is a nudge to the owner, never a score
 * shown to anyone else.
 */
export function ProfileCompletionCard({
  percent,
  tasks,
  onEditProfile,
  onEditInterests
}: {
  percent: number;
  tasks: CompletionTask[];
  /** Opens the identity editor in place — name, bio, institution, photo. */
  onEditProfile: () => void;
  onEditInterests: () => void;
}) {
  const router = useRouter();

  // Nothing left to do: the card would be a congratulation that costs a
  // scroll on every visit.
  if (tasks.length === 0) return null;

  const next = tasks[0];

  /* Each task routes to the place that can actually complete it. A CTA that
   * scrolled to a generic editor would be the "dead UI" this rebuild exists
   * to remove. */
  function startTask(task: CompletionTask) {
    switch (task.id) {
      case "interests":
        onEditInterests();
        return;
      case "first_muddy":
        router.push("/friends" as Route);
        return;
      // photo / bio / institution are all fields of the identity editor.
      default:
        onEditProfile();
    }
  }

  return (
    <section aria-labelledby="profile-completion-heading">
      <h3
        id="profile-completion-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Complete your profile
      </h3>
      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            {tasks.length} {tasks.length === 1 ? "thing" : "things"} left
          </p>
          <span className="text-sm font-semibold tabular-nums text-primary">{percent}%</span>
        </div>

        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Profile completion"
        >
          <span
            className="block h-full rounded-full bg-primary safe-motion"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ul className="mt-4 grid gap-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => startTask(task)}
                className=// min-h-11 (44px): these completion rows are the primary calls to action
                // for a new user finishing their profile, and padding alone left
                // them at 42px.
                "focus-ring safe-motion flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/50 px-3.5 py-2.5 text-left hover:bg-secondary/40"
              >
                <span className="min-w-0 truncate text-sm font-medium">{task.label}</span>
                <span
                  aria-hidden="true"
                  className={
                    task.id === next.id
                      ? "shrink-0 text-xs font-semibold text-primary"
                      : "shrink-0 text-xs font-semibold text-muted-foreground"
                  }
                >
                  {task.id === next.id ? "Start" : "Add"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
