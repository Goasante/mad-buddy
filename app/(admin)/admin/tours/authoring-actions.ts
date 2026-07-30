"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { KNOWN_ENTITLEMENT_KEYS, KNOWN_FEATURE_FLAG_KEYS } from "@/lib/tours/admin-service";
import { isSafeInternalPath } from "@/lib/tours/admin-model";
import { createStep, createTour, deleteStep, duplicateStep, moveStep, updateStep } from "@/lib/tours/authoring-service";

// No type exports from a "use server" module: a re-exported type here breaks
// every action in the file at runtime under Turbopack and tsc will not catch it.

const internalPath = z
  .string()
  .trim()
  .refine((value) => isSafeInternalPath(value), "Use an internal path such as /plans.");

const stepSchema = z.object({
  stepKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,64}$/, "Use lowercase letters, numbers and hyphens."),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(600),
  targetId: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,64}$/)
    .nullable(),
  route: internalPath.nullable(),
  mediaPath: z
    .string()
    .trim()
    .regex(/^\/tours\/[a-zA-Z0-9/._-]{3,160}$/, "Media must be a path under /tours/.")
    .nullable(),
  ctaLabel: z.string().trim().min(2).max(40).nullable(),
  ctaHref: internalPath.nullable(),
  // Constrained to the canonical catalogues, so an arbitrary feature string or
  // a made-up entitlement can never be authored.
  requiresFeatureFlag: z
    .string()
    .refine((value) => KNOWN_FEATURE_FLAG_KEYS.includes(value), "Unknown feature.")
    .nullable(),
  entitlementKeys: z
    .array(z.string().refine((value) => KNOWN_ENTITLEMENT_KEYS.includes(value), "Unknown entitlement."))
    .max(6)
});

const createTourSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,64}$/, "Use lowercase letters, numbers and hyphens."),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500),
  kind: z.enum(["main", "feature"]),
  plans: z.array(z.enum(["free", "buddy_plus", "buddy_pro"])).min(1),
  cohort: z.enum(["all", "new", "existing"]),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional()
});

const versionStepSchema = z.object({ versionId: z.string().uuid(), step: stepSchema });
const stepKeySchema = z.object({ versionId: z.string().uuid(), stepKey: z.string().trim().min(2).max(64) });
const editStepSchema = stepKeySchema.extend({ step: stepSchema });
const moveSchema = stepKeySchema.extend({ direction: z.enum(["up", "down"]) });

type AuthorizeResult =
  | { kind: "ok"; admin: ReturnType<typeof createSupabaseAdminClient>; actorId: string; actorRole: string }
  | { kind: "denied"; message: string };

/**
 * Enforces admin.tours.manage server-side. Support does not hold it, so a
 * support account calling these directly is refused here rather than relying on
 * the Admin nav hiding the page.
 */
async function authorize(): Promise<AuthorizeResult> {
  const context = await getSafetyAdminContext();
  if (!context.ok) return { kind: "denied", message: "You do not have permission to manage tours." };

  const admin = createSupabaseAdminClient();
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.tours.manage")) {
    return { kind: "denied", message: "You do not have permission to manage tours." };
  }

  const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
  if (!limit.allowed) return { kind: "denied", message: rateLimitMessage(limit.resetAt) };

  return { kind: "ok", admin, actorId: context.userId, actorRole: access.role };
}

// Targeted revalidation only: the tour list and the one version being edited.
function refresh(versionId?: string) {
  revalidatePath("/admin/tours");
  if (versionId) revalidatePath(`/admin/tours/${versionId}`);
}

export async function createTourAction(input: unknown): Promise<{ ok: boolean; message: string; versionId?: string }> {
  const parsed = createTourSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await createTour({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: parsed.data.description,
    kind: parsed.data.kind,
    plans: parsed.data.plans,
    cohort: parsed.data.cohort,
    startsAt: parsed.data.startsAt ?? null,
    endsAt: parsed.data.endsAt ?? null
  });
  if (result.ok) refresh(result.versionId);
  return result;
}

export async function createStepAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = versionStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the step details." };
  }
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await createStep({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    step: parsed.data.step
  });
  if (result.ok) refresh(parsed.data.versionId);
  return result;
}

export async function updateStepAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = editStepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the step details." };
  }
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await updateStep({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    stepKey: parsed.data.stepKey,
    step: parsed.data.step
  });
  if (result.ok) refresh(parsed.data.versionId);
  return result;
}

export async function deleteStepAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = stepKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the step details." };
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await deleteStep({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    stepKey: parsed.data.stepKey
  });
  if (result.ok) refresh(parsed.data.versionId);
  return { ok: result.ok, message: result.message };
}

export async function duplicateStepAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = stepKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the step details." };
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await duplicateStep({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    stepKey: parsed.data.stepKey
  });
  if (result.ok) refresh(parsed.data.versionId);
  return result;
}

export async function moveStepAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the step details." };
  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await moveStep({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    stepKey: parsed.data.stepKey,
    direction: parsed.data.direction
  });
  if (result.ok) refresh(parsed.data.versionId);
  return result;
}
