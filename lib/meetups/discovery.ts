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
  { id: "walk", label: "Outdoors", emoji: "🌿" },
  { id: "gaming", label: "Gaming", emoji: "🎮" },
  { id: "study", label: "Study", emoji: "📚" },
  { id: "movie", label: "Movies", emoji: "🎬" },
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
  durationMinutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240)]),
  requestKey: z.string().uuid()
}).strict();

export const meetupDiscoveryCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("interest"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("withdraw"), id: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("decide"),
    id: z.string().uuid(),
    userId: z.string().uuid(),
    response: z.enum(["accepted","declined"])
  }).strict(),
  z.object({ action: z.literal("close"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("refresh"), id: z.string().uuid() }).strict()
]);

export type MeetupDiscoveryPerson = {
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  status: "pending" | "accepted" | "declined" | "withdrawn";
};

export type MeetupDiscoveryItem = {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorUsername: string;
  creatorAvatarUrl: string | null;
  title: string;
  category: MeetupDiscoveryCategory;
  style: MeetupDiscoveryStyle;
  startsAt: string;
  timezone: string;
  listingExpiresAt: string;
  listingDurationMinutes: number;
  status: "active" | "matched" | "expired" | "cancelled";
  maxAttendees: number;
  interestLimit: number;
  interestCount: number;
  myInterestStatus: "pending" | "accepted" | "declined" | "withdrawn" | null;
  meetupId: string | null;
  conversationId: string | null;
  interestedPeople: MeetupDiscoveryPerson[];
};

export type MeetupDiscoveryHub = {
  nearby: MeetupDiscoveryItem[];
  mine: MeetupDiscoveryItem[];
  activeSlots: number;
  maxActiveSlots: number;
};

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
