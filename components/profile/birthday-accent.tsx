import type { ReactNode } from "react";

/**
 * Birthday profile decoration intentionally disabled.
 *
 * Birthday data, reminders, wishes, and privacy rules remain unchanged; this
 * wrapper now preserves only its children so profile avatars keep their normal
 * visual treatment without confetti, a birthday ring, or a cake badge.
 */
export function BirthdayAccent({
  children
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <>{children}</>;
}
