import "server-only";

import { buildLifeEvent, type LifeEventInput } from "@/lib/life/events";
import { errorType, logBackendEvent } from "@/lib/observability/logger";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Life event emission.
 *
 * COMPENSATING, NOT TRANSACTIONAL — the approved decision, and the important
 * property of this module: recording history must never be able to undo the
 * thing that happened. If two people become Muddies and the event insert
 * fails, they are still Muddies. The timeline is a derived convenience; the
 * friendship is the fact.
 *
 * So every emit:
 *   - runs AFTER the underlying action has already succeeded,
 *   - never throws into its caller,
 *   - is logged when it fails, so a missing event is observable rather than
 *     silent,
 *   - is idempotent, so a retry cannot double-record.
 *
 * Recovery is by replay: because the projection is rebuildable from
 * `domain_events`, a dropped event can be re-emitted later from the source
 * tables without any repair to user-facing data.
 */

export type LifeEmitResult =
  | { status: "recorded" }
  /** The dedupe key already existed. Expected on a retry, not a failure. */
  | { status: "duplicate" }
  /** Recorded for diagnosis; the caller's action still succeeded. */
  | { status: "failed"; reason: string };

/**
 * Append one Life event.
 *
 * Never throws. A caller may ignore the result entirely — that is the point
 * of compensating emission — but the result is returned so a caller that
 * cares (a rebuild, a test) can count outcomes.
 */
export async function emitLifeEvent(admin: Admin, input: LifeEventInput): Promise<LifeEmitResult> {
  const startedAt = Date.now();
  let record;

  try {
    // buildLifeEvent throws on a forbidden payload key. That is a programming
    // error, not a runtime condition, so it is caught and logged here rather
    // than propagating into an unrelated action.
    record = buildLifeEvent(input);
  } catch (caught) {
    logBackendEvent("error", {
      route: "life/emit",
      errorType: errorType(caught),
      latencyMs: Date.now() - startedAt
    });
    return { status: "failed", reason: "invalid_event" };
  }

  const { data, error } = await admin
    .from("domain_events")
    .upsert(
      {
        event_type: record.eventType,
        resource_type: record.resourceType,
        resource_id: null,
        resource_key: record.resourceKey,
        actor_id: record.actorId,
        dedupe_key: record.dedupeKey,
        // The payload is built from primitives only (buildLifeEvent rejects
        // anything else), so this is a Json value by construction.
        payload: record.payload as never,
        occurred_at: record.occurredAt
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    logBackendEvent("info", {
      route: "life/emit",
      statusCode: 200,
      latencyMs: Date.now() - startedAt
    });
    return { status: "recorded" };
  }

  if (!error) {
    return { status: "duplicate" };
  }

  // A real failure. Logged so the gap is visible, but never rethrown: the
  // friendship, plan or close-friend change already happened.
  logBackendEvent("warn", {
    route: "life/emit",
    errorType: errorType(error),
    latencyMs: Date.now() - startedAt
  });
  return { status: "failed", reason: "insert_failed" };
}


/**
 * Emit several events without letting one failure stop the rest.
 *
 * Used by rebuild, where a single bad row must not abandon an entire replay.
 */
export async function emitLifeEvents(admin: Admin, inputs: readonly LifeEventInput[]) {
  const results = await Promise.all(inputs.map((input) => emitLifeEvent(admin, input)));
  return {
    recorded: results.filter((result) => result.status === "recorded").length,
    duplicates: results.filter((result) => result.status === "duplicate").length,
    failed: results.filter((result) => result.status === "failed").length
  };
}
