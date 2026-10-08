import type { MeetupDiscoveryHub, MeetupDiscoveryItem } from "./discovery";

export function listingsAwaitingReview(hub: MeetupDiscoveryHub, nowMs: number): MeetupDiscoveryItem[] {
  return hub.mine.filter((item) => item.status !== "cancelled" && Date.parse(item.startsAt) > nowMs
    && item.interestedPeople.some((person) => person.status === "pending"));
}

export function pendingReviewCount(hub: MeetupDiscoveryHub, nowMs: number): number {
  return listingsAwaitingReview(hub, nowMs).reduce((count, item) =>
    count + item.interestedPeople.filter((person) => person.status === "pending").length, 0);
}

export function requestStatusMessage(item: MeetupDiscoveryItem, nowMs: number): string {
  if (item.status === "cancelled") return "The host ended this listing.";
  if (item.myInterestStatus === "declined") return "The host passed on your request.";
  if (item.myInterestStatus === "expired" || Date.parse(item.startsAt) <= nowMs) return "The host didn’t respond in time.";
  return Date.parse(item.listingExpiresAt) <= nowMs
    ? "The listing ended. Your request is still waiting for the host."
    : "Waiting for the host to respond.";
}
