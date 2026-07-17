import "server-only";

import { isFeatureKilled, activeRestrictions } from "@/lib/admin/service";
import type { EmergencyControl, RestrictionType } from "@/lib/admin/governance";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The single enforcement gate for emergency controls and user restrictions.
 *
 * Batch 13 built `isFeatureKilled` and `activeRestrictions` but nothing called
 * them, which meant: flipping a kill switch during an incident did nothing,
 * and a suspended user was not actually suspended. This module is the call
 * site, and every guarded action routes through it rather than each action
 * re-implementing the check (the mistake that produced seven copies of the
 * tier limits before batch 10 centralised them).
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Surfaces a suspension must block (batch 13 §19: no partial bypass). */
export type GuardedSurface =
  | "messaging"
  | "waves"
  | "pings"
  | "plans"
  | "moments"
  | "drops"
  | "communities"
  | "event_glow"
  | "invite_links"
  | "workspace_administration";

/**
 * Every surface this gate knows how to block. Kept in lockstep with batch 13's
 * SUSPENSION_BLOCKS by a test — if the two drift, a suspended user silently
 * keeps access to the surface that was forgotten (spec §19's partial bypass).
 */
export const GUARDED_SURFACES: readonly GuardedSurface[] = [
  "messaging",
  "waves",
  "pings",
  "plans",
  "moments",
  "drops",
  "communities",
  "event_glow",
  "invite_links",
  "workspace_administration"
];

/** Which restriction blocks which surface. A suspension blocks all of them. */
const SURFACE_RESTRICTIONS: Record<GuardedSurface, RestrictionType[]> = {
  messaging: ["messaging_disabled"],
  waves: [],
  pings: [],
  plans: [],
  moments: ["media_disabled"],
  drops: ["media_disabled"],
  communities: ["community_creation_disabled"],
  event_glow: [],
  invite_links: ["invites_disabled"],
  workspace_administration: ["community_creation_disabled"]
};

const SUSPENSIONS: readonly RestrictionType[] = ["suspended_temporary", "suspended_permanent"];

export type GuardResult = { allowed: boolean; message: string };

const ALLOWED: GuardResult = { allowed: true, message: "" };

/**
 * Gate for a user action. Checks, in order:
 *  1. The emergency kill switch for the feature, if one guards it.
 *  2. Whether the user is suspended (blocks every surface).
 *  3. Whether a targeted restriction blocks this specific surface.
 *
 * Fails closed on the privacy-critical controls via `isFeatureKilled`.
 * User-facing copy says what happened and points at appeal, without revealing
 * detection internals (batch 13 §13).
 */
export async function guardAction(
  admin: Admin,
  input: { userId: string; surface: GuardedSurface; control?: EmergencyControl }
): Promise<GuardResult> {
  if (input.control && (await isFeatureKilled(admin, input.control))) {
    return {
      allowed: false,
      message: "This is temporarily unavailable while we sort something out. Try again shortly."
    };
  }

  const restrictions = await activeRestrictions(admin, input.userId);
  if (restrictions.length === 0) return ALLOWED;

  if (restrictions.some((restriction) => SUSPENSIONS.includes(restriction))) {
    return { allowed: false, message: "Your account is suspended. You can appeal this decision." };
  }

  const blocking = SURFACE_RESTRICTIONS[input.surface] ?? [];
  if (blocking.some((restriction) => restrictions.includes(restriction))) {
    return { allowed: false, message: "This feature is limited on your account right now. You can appeal." };
  }

  return ALLOWED;
}

/**
 * Kill-switch-only gate, for read paths and endpoints with no acting user
 * (or where restrictions don't apply).
 */
export async function guardFeature(admin: Admin, control: EmergencyControl): Promise<GuardResult> {
  if (await isFeatureKilled(admin, control)) {
    return {
      allowed: false,
      message: "This is temporarily unavailable while we sort something out. Try again shortly."
    };
  }
  return ALLOWED;
}
