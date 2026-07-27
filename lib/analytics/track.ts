import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ProductEventName } from "@/lib/analytics/product-analytics";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Records a trusted server event without making the product action depend on
 * reporting availability. The database function owns plan snapshots,
 * deduplication, feature gating, and daily aggregation.
 */
export async function recordProductEvent(
  admin: Admin,
  input: {
    eventName: ProductEventName;
    actorId: string;
    resourceType: string;
    resourceId: string;
    featureKey?: string;
    occurredAt?: string;
  }
): Promise<boolean> {
  try {
    const { error } = await admin.rpc("record_product_event", {
      p_event_name: input.eventName,
      p_actor_id: input.actorId,
      p_resource_type: input.resourceType,
      p_resource_id: input.resourceId,
      p_feature_key: input.featureKey ?? "core",
      p_occurred_at: input.occurredAt ?? new Date().toISOString()
    });
    return !error;
  } catch {
    return false;
  }
}
