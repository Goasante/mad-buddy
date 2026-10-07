import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Safe Arrival is retired as a standalone product. There are no active legacy
 * journeys at retirement time; safety-oriented coordination now lives inside
 * the scheduled Meet Up lifecycle and Safe Home flow.
 */
export default function SafeArrivalRoute() {
  redirect("/meet-up");
}
