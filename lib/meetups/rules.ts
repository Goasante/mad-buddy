import { z } from "zod";

export const meetupModeSchema = z.enum(["come_over", "coming_to", "meet_somewhere"]);
export const arrivalSchema = z.enum(["not_started", "on_my_way", "late", "here", "left"]);
export const meetupProximityStageSchema = z.enum(["getting_closer", "nearby", "at_spot"]);

export const MEETUP_ACTIVE_BEFORE_MS = 2 * 60 * 60_000;
export const MEETUP_EXPIRES_AFTER_MS = 4 * 60 * 60_000;

export const meetupCreateSchema = z.object({
  mode: meetupModeSchema,
  participantIds: z.array(z.string().uuid()).min(1).max(49),
  placeLabel: z.string().trim().min(1).max(120),
  note: z.string().max(200).default(""),
  startsAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(60),
  requestKey: z.string().uuid()
}).strict().refine((v) => v.mode !== "coming_to" || v.participantIds.length === 1, {
  message: "Choose one Muddy to visit."
});

const commandFields = {
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  requestKey: z.string().uuid()
};

export const meetupUpdateSchema = z.discriminatedUnion("action", [
  z.object({ ...commandFields, action: z.literal("respond"), response: z.enum(["accepted", "declined"]) }).strict(),
  z.object({
    ...commandFields,
    action: z.literal("arrival"),
    arrival: z.enum(["on_my_way", "late", "here", "left"]),
    delayMinutes: z.number().int().min(1).max(120).optional()
  }).strict(),
  z.object({ ...commandFields, action: z.literal("suggest"), startsAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ ...commandFields, action: z.literal("reschedule"), startsAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ ...commandFields, action: z.enum(["met", "cancel", "end", "reset_beacon"]) }).strict()
]);

export const meetupSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  hostId: z.string().uuid().nullable(),
  mode: meetupModeSchema,
  placeLabel: z.string(),
  note: z.string(),
  startsAt: z.string(),
  timezone: z.string(),
  status: z.enum(["active", "cancelled", "ended"]),
  revision: z.number().int(),
  beaconState: z.enum(["unset", "provisional", "locked"]).default("unset"),
  beaconSetAt: z.string().nullable().optional(),
  members: z.array(z.object({
    key: z.string(),
    userId: z.string().uuid().nullable(),
    name: z.string(),
    response: z.enum(["invited", "accepted", "declined"]),
    arrival: arrivalSchema,
    delayMinutes: z.number().nullable(),
    metAt: z.string().nullable(),
    suggestedStartAt: z.string().nullable(),
    // Retained in the transport while the database column is phased into
    // "accepted = Meetup Proximity on". The UI no longer asks for a second opt-in.
    proximityEnabled: z.boolean(),
    proximityStage: meetupProximityStageSchema.optional(),
    observedAt: z.string().optional()
  }))
});

export type Meetup = z.infer<typeof meetupSchema>;
export type MeetupMode = z.infer<typeof meetupModeSchema>;
export type MeetupCreate = z.infer<typeof meetupCreateSchema>;
export type MeetupUpdate = z.infer<typeof meetupUpdateSchema>;
export type MeetupProximityStage = z.infer<typeof meetupProximityStageSchema>;
export type MeetupHomeItem = Pick<Meetup, "id" | "mode" | "startsAt" | "timezone" | "placeLabel"> & {
  response: "invited" | "accepted";
};

export const MEETUP_TITLES: Record<MeetupMode, string> = {
  come_over: "Come over",
  coming_to: "I'm coming to you",
  meet_somewhere: "Meet somewhere"
};

export const ARRIVAL_LABELS: Record<z.infer<typeof arrivalSchema>, string> = {
  not_started: "No arrival update",
  on_my_way: "On my way",
  late: "Running late",
  here: "Here",
  left: "Left"
};

export function meetupPhase(meetup: Meetup, nowMs: number): "upcoming" | "active" | "unconfirmed" | "past" {
  if (meetup.status !== "active") return "past";
  const start = Date.parse(meetup.startsAt);
  if (!Number.isFinite(start) || nowMs >= start + MEETUP_EXPIRES_AFTER_MS) return "past";
  if (nowMs < start - MEETUP_ACTIVE_BEFORE_MS) return "upcoming";
  if (nowMs > start + 30 * 60_000 && meetup.members.filter((m) => m.metAt).length < 2) return "unconfirmed";
  return "active";
}

export function canUpdateArrival(meetup: Meetup, viewerId: string, nowMs: number): boolean {
  const mine = meetup.members.find((m) => m.userId === viewerId);
  const host = meetup.hostId ? meetup.members.find((m) => m.userId === meetup.hostId) : null;
  const start = Date.parse(meetup.startsAt);
  return meetup.status === "active"
    && Number.isFinite(start)
    && nowMs >= start - MEETUP_ACTIVE_BEFORE_MS
    && nowMs < start + MEETUP_EXPIRES_AFTER_MS
    && mine?.response === "accepted"
    && (!meetup.hostId || host?.response === "accepted")
    && meetup.members.some((m) => m.userId !== viewerId && m.response === "accepted");
}

export function isMeetupHintFresh(observedAt: string | undefined, nowMs: number): boolean {
  const age = nowMs - Date.parse(observedAt ?? "");
  return Number.isFinite(age) && age >= -15_000 && age < 75_000;
}

export const MEETUP_NOTIFICATION_COPY: Record<string, string> = {
  invited: "A Muddy invited you to meet. Open the invitation to respond.",
  accepted: "A Muddy accepted your meetup invitation.",
  declined: "A Muddy cannot make this meetup.",
  suggested: "A Muddy suggested another time. Review their suggestion.",
  rescheduled: "The meetup time changed. Please accept the new arrangement.",
  cancelled: "This meetup was cancelled.",
  ended: "This meetup has ended.",
  beacon_reset: "The meetup point was reset. Open Meet Up for the latest status.",
  on_my_way: "A Muddy is on their way.",
  late: "A Muddy is running late. Open the meetup for their update.",
  here: "A Muddy says they have arrived.",
  left: "A Muddy has left.",
  met: "A Muddy confirmed meeting. Did you meet too?",
  reminder_30: "Your meetup is coming up in about 30 minutes.",
  reminder_5: "Your meetup starts soon. Are you on your way?",
  check_outcome: "Did you meet? Confirm, reschedule, or end the arrangement."
};
