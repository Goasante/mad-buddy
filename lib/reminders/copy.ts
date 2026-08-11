import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import type { ReminderDomain, ReminderStage } from "@/lib/reminders/rules";

/**
 * Reminder notification copy (Stage D).
 *
 * Pure and separate from delivery so the wording is testable without a
 * database, and so a copy change never means touching the job handler.
 *
 * NO CHECK-IN LANGUAGE. "Are you here?", "Check in now" and anything else
 * about presence belongs to Stage E; Stage D stops at telling someone the
 * thing they committed to is about to start.
 */

export type ReminderCopyInput = {
  domain: ReminderDomain;
  stage: ReminderStage;
  /** Canonical title from the record. Never a manufactured or guessed name. */
  title: string;
  startAtMs: number;
  /** Hosts get their own wording rather than being addressed as attendees. */
  isHost: boolean;
  /**
   * True when the recipient answered "maybe" rather than committing. The copy
   * softens: reminding an undecided person is useful, but telling them their
   * plan "starts in 30 minutes" as though they had said yes is not what they
   * told us.
   */
  isTentative?: boolean;
};

export type ReminderCopy = { title: string; message: string };

/**
 * Start time in the recipient's local zone.
 *
 * Formatting happens HERE, at the very end, from a canonical UTC instant --
 * every scheduling decision upstream is done in absolute milliseconds. The
 * timezone is the product default until per-user timezones are stored, the
 * same constant quiet hours already resolve against, so a reminder's stated
 * time and the quiet-hours window can never disagree about what "7pm" means.
 */
function localTimeLabel(startAtMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DEFAULT_RECIPIENT_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12"
  })
    .format(new Date(startAtMs))
    .replace(/\s?(am|pm)/i, (match) => match.trim().toUpperCase());
}

export function reminderCopy(input: ReminderCopyInput): ReminderCopy {
  const { domain, stage, title, startAtMs, isHost, isTentative } = input;
  const noun = domain === "plan" ? "plan" : "event";
  const time = localTimeLabel(startAtMs);

  if (stage === "24h") {
    return {
      title: isHost ? `Your ${noun} is tomorrow` : `Your ${noun} is tomorrow`,
      message: isTentative
        ? `${title} starts tomorrow at ${time}. You said maybe.`
        : `${title} starts tomorrow at ${time}.`
    };
  }

  if (stage === "2h") {
    return {
      title: domain === "plan" ? "Coming up soon" : "Event coming up",
      message: isTentative
        ? `${title} starts in about 2 hours. You said maybe.`
        : `${title} starts in about 2 hours.`
    };
  }

  return {
    title: "Starting soon",
    message: isTentative
      ? `${title} starts in 30 minutes. You said maybe.`
      : `${title} starts in 30 minutes.`
  };
}

/**
 * The notification `type` string, which is also what routing keys off.
 *
 * `plan:<uuid>` and `event:<uuid>` are the existing convention that
 * resolveNotificationDestination already understands (lib/notifications/
 * destination.ts), so a reminder opens the real record -- /plans?plan=<id> or
 * /events?event=<id> -- rather than a dead link or a bare section. No new
 * routing was added for Stage D because none was needed.
 */
export function reminderNotificationType(
  domain: ReminderDomain,
  itemId: string
): `plan:${string}` | `event:${string}` {
  // Returned as the narrow template-literal type the notification layer
  // enforces, not a bare string: that union is what guarantees the value
  // routes to a real destination, and widening it here would quietly opt out
  // of the check.
  return domain === "plan" ? `plan:${itemId}` : `event:${itemId}`;
}
