/** Pure release policy shared by navigation, SmartCard and delivery. */
export const OPTIONAL_FEATURES = {
  upfor: { flag: "upfor", title: "UpFor", href: "/hangout-mode", headline: "Good company is coming.", description: "Make spontaneous plans with people around you." },
  linkr: { flag: "socialize", title: "Linkr", href: "/linkr", headline: "New connections are coming.", description: "Meet people open to connecting nearby." },
  events: { flag: "events", title: "Events", href: "/events", headline: "More ways to come together.", description: "Discover experiences worth sharing." },
  conference: { flag: "conference", title: "Conference", href: "/conference", headline: "Your neighbourhood has a voice.", description: "Join the conversations happening around you." },
  safe_arrival: { flag: "safe_arrival", title: "Meet Up", href: "/meet-up", headline: "Make it happen, together.", description: "Invite Muddies, agree a time, and stay in touch as you meet." }
} as const;
export type OptionalFeature = keyof typeof OPTIONAL_FEATURES;
export type FeatureAvailability = Record<OptionalFeature, boolean>;
export const LOCKED_FEATURES: FeatureAvailability = { upfor: false, linkr: false, events: false, conference: false, safe_arrival: false };

export function featureForHref(href: string): OptionalFeature | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0].replace(/\/$/, "");
  const aliases: Record<string, OptionalFeature> = { "/discover": "linkr", "/socialize": "linkr", "/upfor": "upfor", "/safety": "safe_arrival", "/safe-arrival": "safe_arrival" };
  if (aliases[path]) return aliases[path];
  for (const [key, feature] of Object.entries(OPTIONAL_FEATURES)) {
    if (path === feature.href || path.startsWith(feature.href + "/")) return key as OptionalFeature;
  }
  return null;
}

/** Safe Arrival lifecycle alerts continue for journeys already in progress. */
export function featureForNotification(type: string): OptionalFeature | null {
  if (/^(hangout|upfor):/.test(type)) return "upfor";
  if (/^(event|event_room):/.test(type)) return "events";
  if (/^(linkr|socialize)[_:]/.test(type)) return "linkr";
  if (/^conference[_:]/.test(type)) return "conference";
  if (/^(meetup|meetup_discovery):/.test(type)) return "safe_arrival";
  return null;
}
