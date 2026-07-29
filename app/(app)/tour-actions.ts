"use server";

import { z } from "zod";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getCurrentUser } from "@/lib/supabase/auth";
import { recordTourProgress, recordTourStepEvent } from "@/lib/tours/service";

// NOTE: this module exports no types. A "use server" file that re-exports a
// type breaks every action in it at runtime under Turbopack, and tsc does not
// catch it — see the repo convention. Shapes live in lib/tours/model.ts.

const progressSchema = z.object({
  tourVersionId: z.string().uuid(),
  status: z.enum(["started", "completed", "skipped", "dismissed"]),
  currentStepKey: z.string().max(64).nullable().optional(),
  preview: z.boolean().optional()
});

const stepEventSchema = z.object({
  stepId: z.string().uuid(),
  event: z.enum(["tour_step_viewed", "tour_step_completed", "tour_cta_clicked", "tour_shown"]),
  preview: z.boolean().optional()
});

/**
 * Records where the user is in a tour. Tour progress is deliberately
 * low-stakes: a failure here is swallowed into `{ ok: false }` and never
 * surfaced as an error, because feature education must not be able to interrupt
 * or fail the app it is explaining.
 */
export async function recordTourProgressAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCurrentUser();
  if (!user) return { ok: false };

  // Bounded so a stuck client cannot spam progress writes. Reuses the existing
  // Postgres-backed limiter, so it holds across instances.
  const limit = await consumeRateLimit({ action: "tours.progress", userId: user.id });
  if (!limit.allowed) return { ok: false };

  const ok = await recordTourProgress({
    userId: user.id,
    tourVersionId: parsed.data.tourVersionId,
    status: parsed.data.status,
    currentStepKey: parsed.data.currentStepKey ?? null,
    preview: parsed.data.preview
  });
  return { ok };
}

/** Fire-and-forget step analytics. Never writes progress, never blocks the UI. */
export async function recordTourStepEventAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = stepEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const ok = await recordTourStepEvent({
    userId: user.id,
    stepId: parsed.data.stepId,
    event: parsed.data.event,
    preview: parsed.data.preview
  });
  return { ok };
}
