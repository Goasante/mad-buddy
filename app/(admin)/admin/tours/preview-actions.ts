"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { canPreviewTours } from "@/lib/tours/preview-service";
import {
  encodeTourPreview,
  isValidPreviewReturnPath,
  TOUR_PREVIEW_COOKIE,
  TOUR_PREVIEW_MAX_AGE_SECONDS
} from "@/lib/tours/preview";

// No type exports from a "use server" module.

const startSchema = z.object({
  versionId: z.string().uuid(),
  returnTo: z.string().refine(isValidPreviewReturnPath, "Invalid return path.")
});

/**
 * Opens a draft preview session.
 *
 * The cookie only NAMES a version; it confers no access. Every render that
 * loads draft content re-checks `admin.tours.manage` server-side, so a copied
 * cookie is inert for a consumer. httpOnly so page scripts cannot read or forge
 * it, and short-lived because a preview is a few minutes of clicking.
 */
export async function startTourPreviewAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Could not start preview." };

  if (!(await canPreviewTours())) {
    return { ok: false, message: "You do not have permission to preview tours." };
  }

  const store = await cookies();
  store.set(TOUR_PREVIEW_COOKIE, encodeTourPreview(parsed.data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOUR_PREVIEW_MAX_AGE_SECONDS
  });

  return { ok: true, message: "Preview started." };
}

/** Ends the preview session. Safe for anyone to call: it only clears a cookie. */
export async function exitTourPreviewAction(): Promise<{ ok: boolean }> {
  const store = await cookies();
  store.delete(TOUR_PREVIEW_COOKIE);
  return { ok: true };
}
