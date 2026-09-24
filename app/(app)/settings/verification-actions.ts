"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { activeRestrictions } from "@/lib/admin/service";
import {
  actorHasPermission,
  type AdminAssignment,
  type AdminRole
} from "@/lib/admin/governance";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCurrentUserRecord } from "@/lib/supabase/auth";
import {
  createVerificationUploadIntent,
  finalizeVerificationEvidence,
  submitVerificationRequest,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_EVIDENCE_KINDS,
  verificationRestrictionReason
} from "@/lib/trust/verification-application";

export type VerificationActionState = { ok: boolean; message: string };

const uploadSchema = z.object({
  legalName: z.string().trim().min(2).max(120),
  documentType: z.enum(VERIFICATION_DOCUMENT_TYPES),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  evidenceKind: z.enum(VERIFICATION_EVIDENCE_KINDS),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(180)
});

const finalizeSchema = z.object({ evidenceId: z.string().uuid() });
const submitSchema = z.object({ requestId: z.string().uuid() });

async function eligibleUser() {
  const user = await requireCurrentUserRecord();
  const admin = createSupabaseAdminClient();
  if (!user.email_confirmed_at) return { ok: false as const, message: "Confirm your email before applying." };

  const [{ data: profile }, restrictions] = await Promise.all([
    admin.from("profiles").select("is_onboarded, deleted_at").eq("user_id", user.id).maybeSingle(),
    activeRestrictions(admin, user.id)
  ]);
  if (!profile?.is_onboarded || profile.deleted_at) {
    return { ok: false as const, message: "Complete your active profile before applying." };
  }
  const restrictionMessage = verificationRestrictionReason(restrictions);
  if (restrictionMessage) return { ok: false as const, message: restrictionMessage };
  return { ok: true as const, user, admin };
}

async function notifyVerificationReviewers(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<void> {
  const { data: rows } = await admin
    .from("admin_assignments")
    .select("user_id, status, starts_at, expires_at, admin_roles(name)");
  if (!rows?.length) return;

  const assignmentsByUser = new Map<string, AdminAssignment[]>();
  for (const row of rows) {
    const relation = row.admin_roles as unknown as { name: string } | { name: string }[] | null;
    const role = Array.isArray(relation) ? relation[0]?.name : relation?.name;
    if (!role) continue;
    const assignments = assignmentsByUser.get(row.user_id) ?? [];
    assignments.push({
      role: role as AdminRole,
      status: row.status as AdminAssignment["status"],
      startsAtMs: Date.parse(row.starts_at),
      expiresAtMs: row.expires_at ? Date.parse(row.expires_at) : null
    });
    assignmentsByUser.set(row.user_id, assignments);
  }

  const nowMs = Date.now();
  const reviewerIds = [...assignmentsByUser.entries()]
    .filter(([, assignments]) => actorHasPermission({ assignments, permission: "admin.verification.review", nowMs }))
    .map(([userId]) => userId);
  await Promise.allSettled(reviewerIds.map((userId) => deliverNotification(admin, {
    userId,
    type: "system_alert",
    priority: "normal",
    title: "Verification application",
    message: "A new identity verification request is ready for review."
  })));
}

export async function createVerificationEvidenceUploadAction(input: unknown) {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Check your details and choose a valid file." };

  try {
    const eligible = await eligibleUser();
    if (!eligible.ok) return eligible;
    const limit = await consumeRateLimit({ action: "verification.apply", userId: eligible.user.id });
    if (!limit.allowed) return { ok: false as const, message: rateLimitMessage(limit.resetAt) };
    return createVerificationUploadIntent(eligible.admin, { userId: eligible.user.id, ...parsed.data });
  } catch {
    return { ok: false as const, message: "Sign in again to continue." };
  }
}

export async function finalizeVerificationEvidenceAction(input: unknown): Promise<VerificationActionState> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That upload is unavailable." };
  try {
    const eligible = await eligibleUser();
    if (!eligible.ok) return eligible;
    return finalizeVerificationEvidence(eligible.admin, { userId: eligible.user.id, evidenceId: parsed.data.evidenceId });
  } catch {
    return { ok: false, message: "Sign in again to continue." };
  }
}

export async function submitVerificationRequestAction(input: unknown): Promise<VerificationActionState> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That verification request is unavailable." };
  try {
    const eligible = await eligibleUser();
    if (!eligible.ok) return eligible;
    const result = await submitVerificationRequest(eligible.admin, {
      userId: eligible.user.id,
      requestId: parsed.data.requestId
    });
    if (result.ok) {
      await Promise.all([
        deliverNotification(eligible.admin, {
          userId: eligible.user.id,
          type: "system_alert",
          title: "Verification submitted",
          message: "Your identity verification request is waiting for review."
        }),
        notifyVerificationReviewers(eligible.admin)
      ]);
      revalidatePath("/settings/verification");
      revalidatePath("/admin/verifications");
    }
    return result;
  } catch {
    return { ok: false, message: "Sign in again to continue." };
  }
}
