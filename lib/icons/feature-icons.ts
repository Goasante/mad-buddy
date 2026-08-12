import {
  Bell,
  CalendarCheck2,
  Hand,
  Images,
  Moon,
  Send,
  ShieldCheck,
  UserPlus,
  Users2,
  type LucideIcon
} from "lucide-react";
import { HangoutIcon, LinkrIcon } from "@/components/brand/brand-icons";

/**
 * Central feature-icon mapping.
 *
 * One source of truth so components reference a feature by key instead of
 * importing an icon per call site.
 *
 * These were previously third-party Flaticon raster assets rendered as
 * CSS masks. They are now Lucide components, for three reasons:
 *   1. As masked PNGs they could not share Lucide's stroke weight, so every
 *      surface mixing the two systems read as two different icon sets.
 *   2. They were rendered at seven different sizes across nine call sites.
 *   3. Being raster, they blurred at sizes their source bitmap did not match.
 *
 * The key-based indirection is kept deliberately: call sites still say what a
 * thing IS ("wave", "safeArrival") rather than which glyph to draw, so the
 * visual language stays changeable from this one file.
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

/** A Lucide icon or a brand mark: both take className and render an svg. */
export type FeatureIconSource = { icon: LucideIcon | typeof LinkrIcon; label: string };

/**
 * Chosen for meaning, not resemblance to the old asset:
 *  - moments      Images        — a temporary shared picture
 *  - safeArrival  ShieldCheck   — arrived safely, confirmed
 *  - hangout      HangoutIcon   — the Iconly Swap mark: two people trading time
 *  - socialize    LinkrIcon     — the Linkr brand mark
 *  - events       CalendarCheck2 — something scheduled
 *  - groups       Users2        — more than one person
 *  - socialize    Compass       — discovery, finding people
 *  - invites      UserPlus      — bringing someone in
 *  - reminders    Bell          — a nudge
 *  - focus        Moon          — quiet hours / do not disturb
 *  - plans        CalendarCheck2 — a committed plan
 *  - ping         Send          — reaching out to one person
 *  - wave         Hand          — the literal gesture
 */
export const FEATURE_ICON_SOURCES: Record<FeatureIconKey, FeatureIconSource> = {
  moments: { icon: Images, label: "Moments" },
  safeArrival: { icon: ShieldCheck, label: "Safe Arrival" },
  hangout: { icon: HangoutIcon, label: "Hangout" },
  events: { icon: CalendarCheck2, label: "Events" },
  groups: { icon: Users2, label: "Circles" },
  socialize: { icon: LinkrIcon, label: "Linkr" },
  invites: { icon: UserPlus, label: "Invites" },
  reminders: { icon: Bell, label: "Reminders" },
  focus: { icon: Moon, label: "Focus" },
  plans: { icon: CalendarCheck2, label: "Plans" },
  ping: { icon: Send, label: "Ping" },
  wave: { icon: Hand, label: "Wave" }
};

export const FEATURE_ICON_KEYS = Object.keys(FEATURE_ICON_SOURCES) as FeatureIconKey[];

export function featureIconSource(feature: FeatureIconKey): FeatureIconSource {
  return FEATURE_ICON_SOURCES[feature];
}
