import { z } from "zod";

export const MEET_NEW_PEOPLE_RADIUS_METERS = 15_000;
export const MEET_NEW_PEOPLE_RESPONSE_LIMIT = 6;
export const MEETUP_OWNER_ACTIVE_LIMIT = 3;

export const meetupDiscoveryCategorySchema = z.enum([
  "food","study","sports","gym","walk","gaming","chill","anything",
  "coffee","football","drinks","movie","drive","party"
]);
export const meetupDiscoveryStyleSchema = z.enum(["one_to_one","group"]);

export type MeetupDiscoveryCategory = z.infer<typeof meetupDiscoveryCategorySchema>;
export type MeetupDiscoveryStyle = z.infer<typeof meetupDiscoveryStyleSchema>;

export const MEETUP_DISCOVERY_CATEGORY_OPTIONS: ReadonlyArray<{
  id: MeetupDiscoveryCategory;
  label: string;
  emoji: string;
}> = [
  { id: "coffee", label: "Coffee", emoji: "☕" },
  { id: "food", label: "Food", emoji: "🍽️" },
  { id: "sports", label: "Sports", emoji: "⚽" },
  { id: "football", label: "Football", emoji: "🥅" },
  { id: "gym", label: "Gym", emoji: "🏋️" },
  { id: "walk", label: "Outdoors", emoji: "🌿" },
  { id: "gaming", label: "Gaming", emoji: "🎮" },
  { id: "study", label: "Study", emoji: "📚" },
  { id: "movie", label: "Movies", emoji: "🎬" },
  { id: "drinks", label: "Drinks", emoji: "🥤" },
  { id: "drive", label: "Drive", emoji: "🚗" },
  { id: "party", label: "Social", emoji: "🎉" },
  { id: "chill", label: "Chill", emoji: "✨" },
  { id: "anything", label: "Other", emoji: "•••" }
];

export const meetupDiscoveryCreateSchema = z.object({
  title: z.string().trim().min(2).max(40).refine(
    (value) => value.split(/\s+/).filter(Boolean).length <= 5,
    "Keep the title to five words or fewer."
  ),
  category: meetupDiscoveryCategorySchema,
  style: meetupDiscoveryStyleSchema,
  startsAt: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(60),
  durationMinutes: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120), z.literal(240)]),
  requestKey: z.string().uuid()
}).strict();

export const meetupDiscoveryEditSchema = meetupDiscoveryCreateSchema.pick({
  title: true, category: true, startsAt: true, timezone: true, requestKey: true
}).extend({ action: z.literal("edit"), id: z.string().uuid() }).strict();

export const meetupDiscoveryCommandSchema = z.discriminatedUnion("action", [
  meetupDiscoveryEditSchema,
  z.object({ action: z.literal("interest"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("withdraw"), id: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("decide"),
    id: z.string().uuid(),
    userId: z.string().uuid(),
    response: z.enum(["accepted","declined"])
  }).strict(),
  z.object({ action: z.literal("close"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("refresh"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }).strict()
]);

export const meetupDiscoveryPersonSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.enum(["pending", "accepted", "declined", "withdrawn"])
});

export const meetupDiscoveryItemSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorName: z.string(),
  creatorUsername: z.string(),
  creatorAvatarUrl: z.string().nullable(),
  title: z.string(),
  category: meetupDiscoveryCategorySchema,
  style: meetupDiscoveryStyleSchema,
  startsAt: z.string(),
  timezone: z.string(),
  listingExpiresAt: z.string(),
  listingDurationMinutes: z.number().int(),
  status: z.enum(["active", "matched", "expired", "cancelled"]),
  maxAttendees: z.number().int(),
  interestLimit: z.number().int(),
  interestCount: z.number().int(),
  refreshCount: z.number().int().min(0).max(2),
  attendeeCount: z.number().int().default(0),
  renewable: z.boolean().default(false),
  meetupStatus: z.enum(["active", "ended", "cancelled"]).nullable().optional(),
  myInterestStatus: z.enum(["pending", "accepted", "declined", "withdrawn"]).nullable(),
  meetupId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  interestedPeople: z.array(meetupDiscoveryPersonSchema)
});

export const meetupDiscoveryHubSchema = z.object({
  nearby: z.array(meetupDiscoveryItemSchema),
  mine: z.array(meetupDiscoveryItemSchema),
  requests: z.array(meetupDiscoveryItemSchema).default([]),
  activeSlots: z.number().int().min(0),
  maxActiveSlots: z.number().int().positive()
});

export type MeetupDiscoveryPerson = z.infer<typeof meetupDiscoveryPersonSchema>;
export type MeetupDiscoveryItem = z.infer<typeof meetupDiscoveryItemSchema>;
export type MeetupDiscoveryHub = z.infer<typeof meetupDiscoveryHubSchema>;

export function discoveryTimeLeft(expiresAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "Ending soon" : `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

export function discoveryCategoryLabel(category: MeetupDiscoveryCategory): string {
  return MEETUP_DISCOVERY_CATEGORY_OPTIONS.find((item) => item.id === category)?.label ?? "Other";
}
