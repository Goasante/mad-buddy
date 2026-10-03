"use server";
import { blogOwnerContext } from "@/lib/blog/admin";
import { recordAdminAuditEvent } from "@/lib/admin/service";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { uploadJournalImage } from "@/lib/blog/image-service";
import { JOURNAL_IMAGE_UPLOAD_MAX_BYTES } from "@/lib/blog/image-model";

export async function uploadArticleImageAction(formData: FormData) {
  const auth = await blogOwnerContext();
  if (!auth) return { ok: false, message: "Only the owner can upload journal images." };
  const file = formData instanceof FormData ? formData.get("image") : null;
  if (!(file instanceof File) || !file.size || file.size > JOURNAL_IMAGE_UPLOAD_MAX_BYTES) return { ok: false, message: "Choose an image smaller than 5 MB." };
  const rate = await consumeRateLimit({ action: "media.upload", userId: auth.context.userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };
  const logged = await recordAdminAuditEvent(auth.admin, { actorId: auth.context.userId, actorRole: "owner", action: "blog.image_upload.requested", targetType: "blog_image", newState: { sourceBytes: file.size } });
  if (!logged) return { ok: false, message: "The upload was not recorded, so it was not applied." };
  return uploadJournalImage(auth.admin, auth.context.userId, file);
}
