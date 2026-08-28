/**
 * Scan result shape, kept OUT of the "use server" action file.
 *
 * A "use server" module may export only async functions: Turbopack rewrites
 * every export into a server reference, so a re-exported type becomes a
 * runtime ReferenceError that breaks every action in the file. tsc does not
 * catch it -- only a production build does. So the type lives here.
 */
export type ScanResultState = {
  ok: boolean;
  message: string;
  kind?: "personal" | "event_check_in" | "circle_join";
  /** Set on a successful event check-in, so the caller can open the Event. */
  eventId?: string;
  /** Set on a successful room join, so the caller can open the Room. */
  roomId?: string;
};
