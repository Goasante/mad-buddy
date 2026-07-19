import { describe, expect, it } from "vitest";
import { actionableFriendRequests } from "@/lib/friends/relationship-state";

const request = {
  id: "request-1",
  sender_id: "user-b",
  receiver_id: "user-a",
  created_at: "2026-07-19T10:00:00.000Z"
};

describe("actionableFriendRequests", () => {
  it("keeps a genuine pending request", () => {
    expect(actionableFriendRequests("user-a", [request], [], new Set())).toEqual([request]);
  });

  it("hides a stale request when the pair is already friends", () => {
    expect(
      actionableFriendRequests(
        "user-a",
        [request],
        [{ user_one_id: "user-a", user_two_id: "user-b" }],
        new Set()
      )
    ).toEqual([]);
  });

  it("hides a request when either relationship is blocked", () => {
    expect(actionableFriendRequests("user-a", [request], [], new Set(["user-b"]))).toEqual([]);
  });
});
