import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listingsAwaitingReview, pendingReviewCount, requestStatusMessage } from "./discovery-review";
import { meetupDiscoveryHubSchema, type MeetupDiscoveryHub, type MeetupDiscoveryItem } from "./discovery";

const now = Date.parse("2026-10-07T21:00:00Z");
const item: MeetupDiscoveryItem = {
  id: "11111111-1111-4111-8111-111111111111", creatorId: "22222222-2222-4222-8222-222222222222",
  creatorName: "You", creatorUsername: "host", creatorAvatarUrl: null, title: "Coffee later", category: "coffee",
  style: "group", startsAt: "2026-10-07T22:00:00Z", timezone: "UTC", listingExpiresAt: "2026-10-07T20:30:00Z",
  listingDurationMinutes: 30, status: "expired", maxAttendees: 6, interestLimit: 6, interestCount: 1,
  refreshCount: 0, myInterestStatus: "pending", meetupId: null, conversationId: null,
  interestedPeople: [{ userId: "33333333-3333-4333-8333-333333333333", name: "Ama", username: "ama", avatarUrl: null, status: "pending" }]
};
const hub: MeetupDiscoveryHub = { mine: [item], nearby: [], requests: [item], activeSlots: 0, maxActiveSlots: 3 };

describe("interest survives posting expiry but not meetup start", () => {
  it("keeps pending responses available for review after the public listing expires", () => {
    expect(listingsAwaitingReview(hub, now)).toEqual([item]);
    expect(pendingReviewCount(hub, now)).toBe(1);
    expect(requestStatusMessage(item, now)).toContain("still waiting for the host");
  });
  it("stops review exactly at the scheduled start", () => {
    const start = Date.parse(item.startsAt);
    expect(listingsAwaitingReview(hub, start)).toEqual([]);
    expect(pendingReviewCount(hub, start)).toBe(0);
    expect(requestStatusMessage(item, start)).toContain("didn’t respond in time");
  });
  it("does not reopen cancelled listings or auto-accept a request", () => {
    expect(listingsAwaitingReview({ ...hub, mine: [{ ...item, status: "cancelled" }] }, now)).toEqual([]);
    expect(requestStatusMessage({ ...item, status: "cancelled" }, now)).toContain("ended this listing");
    expect(item.interestedPeople[0].status).toBe("pending");
  });
  it("counts requests rather than listings, excluding completed responses", () => {
    const mixed = { ...item, interestedPeople: [...item.interestedPeople, { ...item.interestedPeople[0], status: "accepted" as const }] };
    expect(pendingReviewCount({ ...hub, mine: [mixed] }, now)).toBe(1);
  });
  it("supports an expired requester status while retaining old hub compatibility", () => {
    expect(meetupDiscoveryHubSchema.safeParse({ ...hub, requests: [{ ...item, myInterestStatus: "expired" }] }).success).toBe(true);
    expect(meetupDiscoveryHubSchema.safeParse({ nearby: [], mine: [], activeSlots: 0, maxActiveSlots: 3 }).success).toBe(true);
    expect(requestStatusMessage({ ...item, myInterestStatus: "expired" }, now)).toContain("didn’t respond in time");
    expect(requestStatusMessage({ ...item, myInterestStatus: "declined" }, Date.parse(item.startsAt))).toContain("passed on your request");
  });
  it("has server-side start cutoffs and keeps public discovery restricted", () => {
    const sql = readFileSync("supabase/migrations/20261007214532_meetup_pending_interest_review.sql", "utf8");
    expect(sql).toContain("v_d.starts_at<=clock_timestamp()");
    expect(sql).toContain("DISCOVERY_REQUEST_EXPIRED");
    expect(sql).toContain("set status='expired',updated_at=now()");
    expect(sql).toContain("item->>'status'='active'");
    expect(sql).toContain("public.meetup_discovery_nearby_allowed(p_actor_id,creator_id)");
    expect(sql).toContain("from public,anon,authenticated");
  });
});
