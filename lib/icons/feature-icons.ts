/**
 * Central feature-icon mapping.
 *
 * One source of truth for the owner-selected Flaticon feature assets in
 * public/icons/features/, so components reference a feature by key instead of
 * importing raw asset paths. The files are local project assets — never
 * hotlinked or fetched from Flaticon. The base filenames on disk are used
 * verbatim (some are singular: event, group, invite, plan; safeArrival maps to
 * arrival). Attribution lives on the legal page (see FEATURE_ICON_CREDITS).
 */

export type FeatureIconKey =
  | "moments"
  | "safeArrival"
  | "hangout"
  | "events"
  | "groups"
  | "socialize"
  | "invites"
  | "reminders"
  | "focus"
  | "plans"
  | "ping"
  | "wave";

export type FeatureIconSource = { src: string; label: string };

/** Maps each feature key to the exact local asset that exists on disk. */
export const FEATURE_ICON_SOURCES: Record<FeatureIconKey, FeatureIconSource> = {
  moments: { src: "/icons/features/moments.png", label: "Moments" },
  safeArrival: { src: "/icons/features/arrival.png", label: "Safe Arrival" },
  hangout: { src: "/icons/features/hangout.png", label: "Hangout" },
  events: { src: "/icons/features/event.png", label: "Events" },
  groups: { src: "/icons/features/group.png", label: "Groups" },
  socialize: { src: "/icons/features/socialize.png", label: "Socialize" },
  invites: { src: "/icons/features/invite.png", label: "Invites" },
  reminders: { src: "/icons/features/reminders.png", label: "Reminders" },
  focus: { src: "/icons/features/focus.png", label: "Focus" },
  plans: { src: "/icons/features/plan.png", label: "Plans" },
  ping: { src: "/icons/features/ping.png", label: "Ping" },
  wave: { src: "/icons/features/wave.png", label: "Wave" }
};

export const FEATURE_ICON_KEYS = Object.keys(FEATURE_ICON_SOURCES) as FeatureIconKey[];

export function featureIconSource(feature: FeatureIconKey): FeatureIconSource {
  return FEATURE_ICON_SOURCES[feature];
}

/** Required Flaticon attribution, rendered on the legal/credits surface. */
export const FEATURE_ICON_CREDITS: { label: string; author: string; href: string }[] = [
  { label: "Gallery", author: "Azland Studio", href: "https://www.flaticon.com/free-icons/gallery" },
  { label: "Arrival Time", author: "I3oundless", href: "https://www.flaticon.com/free-icons/arrival-time" },
  { label: "Hangout", author: "Mayor Icons", href: "https://www.flaticon.com/free-icons/hangout" },
  { label: "Event", author: "Magnific", href: "https://www.flaticon.com/free-icons/event" },
  { label: "Members", author: "KP Arts", href: "https://www.flaticon.com/free-icons/members" },
  { label: "Social Media Management", author: "mia elysia", href: "https://www.flaticon.com/free-icons/social-media-management" },
  { label: "Add User", author: "uicon", href: "https://www.flaticon.com/free-icons/add-user" },
  { label: "Notification", author: "Aldo Cervantes", href: "https://www.flaticon.com/free-icons/notification" },
  { label: "Eye", author: "kmg design", href: "https://www.flaticon.com/free-icons/eye" },
  { label: "Business Plan", author: "ekays.dsgn", href: "https://www.flaticon.com/free-icons/business-plan" },
  { label: "Send", author: "Tanah Basah", href: "https://www.flaticon.com/free-icons/send" },
  { label: "Wave Hand", author: "ekays.dsgn", href: "https://www.flaticon.com/free-icons/wave-hand" }
];
