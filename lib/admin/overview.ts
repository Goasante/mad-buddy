/**
 * Admin overview aggregation logic (pure).
 *
 * Turns raw timestamp/plan rows into chart-ready aggregates. Everything here is
 * counts only — no private data, no identifiers. Shared by the Overview page
 * and unit-tested independently of the database.
 */

export type DailyBucket = { key: string; label: string; count: number };

function dayKey(date: Date): string {
  // UTC date key so buckets are stable regardless of server locale.
  return date.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function labelFor(key: string): string {
  const [, month, day] = key.split("-").map((part) => Number.parseInt(part, 10));
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * Buckets ISO timestamps into the last `days` daily counts, inclusive of today,
 * in chronological order. Timestamps outside the window are ignored.
 */
export function bucketDailyCounts(isoDates: (string | null | undefined)[], days: number, now: Date = new Date()): DailyBucket[] {
  const buckets: DailyBucket[] = [];
  const index = new Map<string, number>();

  // Build the ordered window ending today.
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = dayKey(date);
    index.set(key, buckets.length);
    buckets.push({ key, label: labelFor(key), count: 0 });
  }

  for (const iso of isoDates) {
    if (!iso) continue;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) continue;
    const key = dayKey(new Date(parsed));
    const position = index.get(key);
    if (position !== undefined) buckets[position].count += 1;
  }

  return buckets;
}

export function bucketTotal(buckets: DailyBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}

export function bucketMax(buckets: DailyBucket[]): number {
  return buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
}

// --- Plan mix -------------------------------------------------------------
export type PlanMixRow = { plan: string; label: string; count: number };

const PLAN_MIX_LABELS: Record<string, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

/**
 * Counts active subscriptions per plan, in tier order (an ordinal series). Only
 * plans present in the input with a non-zero count are considered; the caller
 * supplies already-filtered active rows.
 */
export function planMix(plans: string[]): PlanMixRow[] {
  const counts = new Map<string, number>();
  for (const plan of plans) counts.set(plan, (counts.get(plan) ?? 0) + 1);
  return (["free", "buddy_plus", "buddy_pro"] as const)
    .map((plan) => ({ plan, label: PLAN_MIX_LABELS[plan], count: counts.get(plan) ?? 0 }));
}
