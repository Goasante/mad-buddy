"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/admin/access";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { createMadBuddyEmailAlias, deleteMadBuddyEmailAlias } from "@/lib/email/cloudflare-aliases";
import { requireSafetyAdmin } from "@/lib/safety/admin";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export type AliasActionState = { ok: boolean; message: string };

const createSchema = z.object({
  localPart: z.string().trim().min(1).max(64)
});

const deleteSchema = z.object({
  ruleId: z.string().trim().min(1).max(64),
  address: z.string().email().endsWith("@mad-buddy.com")
});

export async function createEmailAliasAction(input: unknown): Promise<AliasActionState> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid alias name." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const requestedAddress = `${parsed.data.localPart.trim().toLowerCase()}@mad-buddy.com`;
    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_alias_create_requested",
      targetType: "email_alias",
      newState: { address: requestedAddress, provider: "cloudflare_email_routing" },
      reason: "Create Cloudflare Email Routing alias"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the alias was not created." };

    const alias = await createMadBuddyEmailAlias(parsed.data.localPart);

    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_alias_created",
      targetType: "email_alias",
      newState: {
        address: alias.address,
        provider: "cloudflare_email_routing",
        providerRuleId: alias.id,
        enabled: alias.enabled
      },
      reason: "Cloudflare Email Routing alias created"
    });

    revalidatePath("/admin/communications");
    return { ok: true, message: `${alias.address} is ready to receive forwarded mail.` };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "cloudflare_aliases_not_configured") {
      return { ok: false, message: "Cloudflare alias management is not configured on the server yet." };
    }
    if (code === "alias_exists") return { ok: false, message: "That Mad Buddy email alias already exists." };
    if (code === "invalid_alias") return { ok: false, message: "Use letters, numbers, dots, dashes, or underscores for the alias." };
    return { ok: false, message: "The email alias could not be created." };
  }
}

export async function deleteEmailAliasAction(input: unknown): Promise<AliasActionState> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That email alias could not be identified." };

  try {
    const { admin, context } = await requireSafetyAdmin();
    await requireAdminPermission(admin, context, "admin.support.manage");
    const limit = await consumeRateLimit({ action: "admin.mutate", userId: context.userId });
    if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

    const logged = await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_alias_delete_requested",
      targetType: "email_alias",
      previousState: {
        address: parsed.data.address,
        provider: "cloudflare_email_routing",
        providerRuleId: parsed.data.ruleId
      },
      reason: "Delete Cloudflare Email Routing alias"
    });
    if (!logged) return { ok: false, message: "The audit entry could not be recorded, so the alias was not deleted." };

    await deleteMadBuddyEmailAlias(parsed.data.ruleId);

    await recordAdminAuditEvent(admin, {
      actorId: context.userId,
      action: "admin_email_alias_deleted",
      targetType: "email_alias",
      previousState: {
        address: parsed.data.address,
        provider: "cloudflare_email_routing",
        providerRuleId: parsed.data.ruleId
      },
      newState: { deleted: true },
      reason: "Cloudflare Email Routing alias deleted"
    });

    revalidatePath("/admin/communications");
    return { ok: true, message: `${parsed.data.address} was removed.` };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "cloudflare_aliases_not_configured") {
      return { ok: false, message: "Cloudflare alias management is not configured on the server yet." };
    }
    return { ok: false, message: "The email alias could not be removed." };
  }
}
