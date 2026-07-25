import { resolveNotificationDestination } from "@/lib/notifications/destination";

export type SafePushPayload = {
  title: string;
  body: string;
  url: string;
};

const PRIVATE_COPY: Record<string, string> = {
  message: "You have a new Mad Buddy message.",
  safe_arrival: "There is an update to a Safe Arrival session.",
  hangout: "You have a new Hangout update.",
  meeting_ping: "You have a new Meet Ping.",
  meetup_request: "A Muddy wants to connect.",
  moment: "A Muddy shared a new Moment."
};

/**
 * Lock-screen copy is deliberately less detailed than the authenticated
 * in-app notification. Entity identifiers are used only for an internal URL.
 */
export function privacySafePushPayload(input: {
  type: string;
  title: string;
  message: string;
}): SafePushPayload {
  const base = input.type.split(":")[0];
  const privateBody = PRIVATE_COPY[base];
  return {
    title: privateBody ? "Mad Buddy" : input.title,
    body: privateBody ?? input.message,
    url: resolveNotificationDestination(input.type)?.href ?? "/notifications"
  };
}
