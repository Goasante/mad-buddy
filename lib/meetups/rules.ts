import { z } from "zod";
import { meetupDiscoveryCategorySchema } from "@/lib/meetups/discovery";

export const meetupModeSchema = z.enum(["come_over", "coming_to", "meet_somewhere"]);
export const arrivalSchema = z.enum(["not_started", "on_my_way", "late", "here", "left"]);
export const journeyStateSchema = z.enum(["waiting", "on_the_way", "approaching", "nearby", "at_spot", "here", "left"]);
export const beaconStatusSchema = z.enum(["unset", "provisional", "locked"]);

export const meetupCreateSchema = z.object({
  mode: meetupModeSchema,
  participantIds: z.array(z.string().uuid()).min(1).max(49),
  placeLabel: z.string().trim().min(1).max(120),
  note: z.string().max(200).default(""),
  category: meetupDiscoveryCategorySchema.default("anything"),
  startsAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(60),
  requestKey: z.string().uuid()
}).strict().refine(
  (v) => v.mode !== "coming_to" || v.participantIds.length === 1,
  { message: "Choose one Muddy whose place you are going to." }
);

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
  z.object({ ...commandFields, action: z.literal("place"), placeLabel: z.string().trim().min(1).max(120) }).strict(),
  z.object({ ...commandFields, action: z.literal("beacon") }).strict(),
  z.object({ ...commandFields, action: z.literal("reset_beacon") }).strict(),
  z.object({ ...commandFields, action: z.literal("home_start") }).strict(),
  z.object({ ...commandFields, action: z.literal("home_arrived") }).strict(),
  z.object({ ...commandFields, action: z.enum(["met", "cancel", "end"]) }).strict()
]);

const memberSchema = z.object({
  key: z.string(),
  userId: z.string().uuid().nullable(),
  name: z.string(),
  response: z.enum(["invited", "accepted", "declined"]),
  arrival: arrivalSchema,
  delayMinutes: z.number().nullable(),
  metAt: z.string().nullable(),
  suggestedStartAt: z.string().nullable(),
  journeyState: journeyStateSchema,
  observedAt: z.string().nullable().optional(),
  homeStartedAt: z.string().nullable(),
  homeArrivedAt: z.string().nullable()
});

const activitySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string(),
  event: z.string(),
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string()
});

export const meetupSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  hostId: z.string().uuid().nullable(),
  mode: meetupModeSchema,
  placeLabel: z.string(),
  note: z.string(),
  title: z.string().nullable().optional(),
  category: meetupDiscoveryCategorySchema.default("anything"),
  sourceDiscoveryId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  startsAt: z.string(),
  expiresAt: z.string(),
  timezone: z.string(),
  status: z.enum(["active", "cancelled", "ended"]),
  endedAt: z.string().nullable().optional(),
  endReason: z.enum(["ended", "cancelled", "expired"]).nullable().optional(),
  revision: z.number().int(),
  beaconStatus: beaconStatusSchema,
  togetherAt: z.string().nullable(),
  members: z.array(memberSchema),
  activity: z.array(activitySchema).default([])
});

export type Meetup = z.infer<typeof meetupSchema>;
export type MeetupMode = z.infer<typeof meetupModeSchema>;
export type MeetupCreate = z.infer<typeof meetupCreateSchema>;
export type MeetupUpdate = z.infer<typeof meetupUpdateSchema>;
export type MeetupJourneyState = z.infer<typeof journeyStateSchema>;
export type MeetupHomeItem = Pick<Meetup, "id" | "mode" | "startsAt" | "timezone" | "placeLabel" | "title" | "category" | "sourceDiscoveryId"> & {
  response: "invited" | "accepted";
};

export const MEETUP_TITLES: Record<MeetupMode, string> = {
  come_over: "Come over",
  coming_to: "I'm coming to you",
  meet_somewhere: "Meet somewhere"
};

export const ARRIVAL_LABELS: Record<z.infer<typeof arrivalSchema>, string> = {
  not_started: "Going",
  on_my_way: "On my way",
  late: "Running late",
  here: "Here",
  left: "Left"
};

export const JOURNEY_LABELS: Record<MeetupJourneyState, string> = {
  waiting: "Going",
  on_the_way: "On the way",
  approaching: "Getting closer",
  nearby: "Nearby",
  at_spot: "Looks like they're here",
  here: "Here",
  left: "Left"
};

export function meetupPhase(meetup: Meetup, nowMs: number): "upcoming" | "active" | "unconfirmed" | "past" {
  if (meetup.status !== "active") return "past";
  const start = Date.parse(meetup.startsAt);
  const expires = Date.parse(meetup.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(expires) || nowMs >= expires) return "past";
  if (nowMs < start - 2 * 60 * 60_000) return "upcoming";
  if (nowMs > start + 30 * 60_000 && meetup.members.filter((m) => m.metAt).length < 2) return "unconfirmed";
  return "active";
}

export function meetupTimeState(meetup: Meetup, nowMs: number): string {
  if (meetup.status === "cancelled") return "Cancelled";
  if (meetup.status === "ended") return meetup.endReason === "expired" ? "Expired" : "Ended";
  const start = Date.parse(meetup.startsAt);
  if (nowMs >= Date.parse(meetup.expiresAt)) return "Expired";
  if (nowMs < start) return nowMs >= start - 2 * 60 * 60_000
    ? "Coming up · arrival updates open" : "Upcoming";
  return "Happening now";
}

export function canUpdateArrival(meetup: Meetup, viewerId: string, nowMs: number): boolean {
  const mine = meetup.members.find((m) => m.userId === viewerId);
  const host = meetup.hostId ? meetup.members.find((m) => m.userId === meetup.hostId) : null;
  const start = Date.parse(meetup.startsAt);
  const expires = Date.parse(meetup.expiresAt);
  return meetup.status === "active"
    && mine?.response === "accepted"
    && (!meetup.hostId || host?.response === "accepted")
    && meetup.members.some((m) => m.userId !== viewerId && m.response === "accepted")
    && Number.isFinite(start)
    && Number.isFinite(expires)
    && nowMs >= start - 2 * 60 * 60_000
    && nowMs < expires;
}

export function meetupReadyForHome(meetup: Meetup, viewerId: string, nowMs: number): boolean {
  const mine = meetup.members.find((member) => member.userId === viewerId);
  const accepted = meetup.members.filter((member) => member.response === "accepted").length;
  return meetup.status === "active"
    && mine?.response === "accepted"
    && accepted >= 2
    && Date.parse(meetup.startsAt) > nowMs - 2 * 60 * 60_000;
}

export function isMeetupHintFresh(observedAt: string | null | undefined, nowMs: number): boolean {
  const age = nowMs - Date.parse(observedAt ?? "");
  return Number.isFinite(age) && age >= -15_000 && age < 2 * 60_000;
}

export const MEETUP_NOTIFICATION_COPY: Record<string, string> = {
  invited: "A Muddy invited you to meet. Open the invitation to respond.",
  place_changed: "The agreed meetup place changed. Open the meetup to review it.",
  accepted: "A Muddy accepted your meetup invitation.",
  declined: "A Muddy cannot make this meetup.",
  suggested: "A Muddy suggested another time. Review their suggestion.",
  rescheduled: "The meetup time changed. Please accept the new arrangement.",
  cancelled: "This meetup was cancelled.",
  ended: "This meetup has ended.",
  beacon_set: "The Meetup Glow point has been set.",
  beacon_locked: "The Meetup Glow point is confirmed.",
  on_my_way: "A Muddy is on their way.",
  late: "A Muddy is running late. Open the meetup for their update.",
  here: "A Muddy says they have arrived.",
  left: "A Muddy has left.",
  met: "A Muddy confirmed meeting. Did you meet too?",
  home_started: "A Muddy is heading home and wants you to know when they arrive.",
  home_arrived: "A Muddy checked in safely at home.",
  reminder_30: "Your meetup is coming up in about 30 minutes.",
  reminder_5: "Your meetup starts soon. Are you on your way?",
  check_outcome: "Did you meet? Confirm, reschedule, or leave the meetup."
};
