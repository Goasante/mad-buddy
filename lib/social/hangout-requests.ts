/**
 * Hangout join-request domain logic (pure).
 *
 * The canonical "Requests to join" count for a Hangout owner is derived from
 * active request rows only — never from client-supplied numbers. Declined and
 * cancelled requests are terminal and must not inflate the count. Shared by the
 * owner UI and unit-tested independently of the database.
 */

import type { HangoutRequestStatus } from "@/lib/supabase/database.types";

/** Statuses that represent a live expression of interest the owner should count. */
export const ACTIVE_REQUEST_STATUSES: readonly HangoutRequestStatus[] = ["pending", "accepted", "maybe"];

export function isActiveRequestStatus(status: string): boolean {
  return (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** Canonical active-request count for a Hangout, from its request rows. */
export function countActiveRequests(requests: { status: string }[]): number {
  return requests.reduce((total, request) => (isActiveRequestStatus(request.status) ? total + 1 : total), 0);
}

/** Pending requests still awaiting an owner decision. */
export function countPendingRequests(requests: { status: string }[]): number {
  return requests.reduce((total, request) => (request.status === "pending" ? total + 1 : total), 0);
}
