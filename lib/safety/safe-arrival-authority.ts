import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type CanonicalTransition = {
  sessionId: string;
  status: string;
  changed: boolean;
  expectedArrivalAt: string;
};

export async function transitionSafeArrival(
  admin: Admin,
  input: {
    sessionId: string;
    actorId: string;
    action: "arrive" | "cancel" | "extend";
    extraMinutes?: number;
    /** One user intent, one id. Replaying it must not extend the clock twice. */
    clientMutationId?: string | null;
  }
): Promise<CanonicalTransition> {
  const { data, error } = await admin.rpc("transition_safe_arrival", {
    p_session_id: input.sessionId,
    p_actor_id: input.actorId,
    p_action: input.action,
    p_extra_minutes: input.extraMinutes ?? null,
    p_client_mutation_id: input.clientMutationId ?? null
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("safe_arrival_missing_canonical_result");
  return {
    sessionId: row.session_id,
    status: row.canonical_status,
    changed: row.changed,
    expectedArrivalAt: row.expected_arrival_at
  };
}

export async function processDueSafeArrivals(admin: Admin, limit = 200): Promise<number> {
  const { data, error } = await admin.rpc("process_due_safe_arrivals", { p_limit: limit });
  if (error) throw error;
  return data ?? 0;
}
