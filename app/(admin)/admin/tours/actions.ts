"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminAccess } from "@/lib/admin/access";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cloneVersion, setVersionAudience, setVersionStatus } from "@/lib/tours/admin-service";

// No type exports from a "use server" module (repo convention: a re-exported
// type here breaks every action in the file at runtime under Turbopack and tsc
// does not catch it). Shapes live in lib/tours/admin-model.ts.

const statusSchema = z.object({
  versionId: z.string().uuid(),
  to: z.enum(["published", "paused", "retired"]),
  // Publishing is a global consumer-facing change, so it carries a reason for
  // the audit trail (brief §12).
  reason: z.string().trim().min(3).max(280).optional()
});

const cloneSchema = z.object({ sourceVersionId: z.string().uuid() });

const audienceSchema = z.object({
  versionId: z.string().uuid(),
  plans: z.array(z.enum(["free", "buddy_plus", "buddy_pro"])).min(1),
  cohort: z.enum(["all", "new", "existing"])
});

/**
 * Resolves the actor and enforces `admin.tours.manage`. Support deliberately
 * does not hold this permission, so a support account calling these actions
 * directly is refused here rather than relying on the page being hidden.
 */
type AuthorizeResult =
  | { kind: "ok"; admin: ReturnType<typeof createSupabaseAdminClient>; actorId: string; actorRole: string }
  | { kind: "denied"; message: string };

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

export async function setTourStatusAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the details and try again." };

  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  if (parsed.data.to === "published" && !parsed.data.reason) {
    return { ok: false, message: "Add a short reason before publishing." };
  }

  const result = await setVersionStatus({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    to: parsed.data.to,
    reason: parsed.data.reason
  });

  if (result.ok) {
    revalidatePath("/admin/tours");
    revalidatePath(`/admin/tours/${parsed.data.versionId}`);
  }
  return { ok: result.ok, message: result.message };
}

export async function cloneTourVersionAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = cloneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the details and try again." };

  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await cloneVersion({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    sourceVersionId: parsed.data.sourceVersionId
  });

  if (result.ok) revalidatePath("/admin/tours");
  return { ok: result.ok, message: result.message };
}

export async function setTourAudienceAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = audienceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose at least one plan." };

  const auth = await authorize();
  if (auth.kind === "denied") return { ok: false, message: auth.message };

  const result = await setVersionAudience({
    admin: auth.admin,
    actorId: auth.actorId,
    actorRole: auth.actorRole,
    versionId: parsed.data.versionId,
    plans: parsed.data.plans,
    cohort: parsed.data.cohort
  });

  if (result.ok) {
    revalidatePath("/admin/tours");
    revalidatePath(`/admin/tours/${parsed.data.versionId}`);
  }
  return result;
}
