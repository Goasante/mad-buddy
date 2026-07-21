import { describe, expect, it } from "vitest";
import {
  ACTIVE_REQUEST_STATUSES,
  countActiveRequests,
  countPendingRequests,
  isActiveRequestStatus
} from "@/lib/social/hangout-requests";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

describe("active request status", () => {
  it("counts pending, accepted, and maybe as active", () => {
    for (const status of ACTIVE_REQUEST_STATUSES) expect(isActiveRequestStatus(status)).toBe(true);
  });

  it("excludes declined and cancelled", () => {
    expect(isActiveRequestStatus("declined")).toBe(false);
    expect(isActiveRequestStatus("cancelled")).toBe(false);
  });
});

describe("canonical owner count", () => {
  it("first request produces count 1", () => {
    expect(countActiveRequests([{ status: "pending" }])).toBe(1);
  });

  it("multiple requesters produce the correct count", () => {
    expect(countActiveRequests([{ status: "pending" }, { status: "accepted" }, { status: "maybe" }])).toBe(3);
  });

  it("a withdrawn/declined request decreases the active count", () => {
    expect(countActiveRequests([{ status: "pending" }, { status: "declined" }])).toBe(1);
    expect(countActiveRequests([{ status: "cancelled" }])).toBe(0);
  });

  it("acceptance keeps the requester counted; rejection removes them", () => {
    expect(countActiveRequests([{ status: "accepted" }])).toBe(1);
    expect(countActiveRequests([{ status: "declined" }])).toBe(0);
  });

  it("never goes negative and ignores unknown statuses", () => {
    expect(countActiveRequests([])).toBe(0);
    expect(countActiveRequests([{ status: "nonsense" }])).toBe(0);
  });

  it("separately tracks pending requests awaiting a decision", () => {
    expect(countPendingRequests([{ status: "pending" }, { status: "accepted" }, { status: "pending" }])).toBe(2);
  });
});

describe("notification destination for a hangout request", () => {
  it("opens the Hangout view from a session-scoped type", () => {
    const destination = resolveNotificationDestination("hangout:3f8c1e2a-0000-4000-8000-000000000000");
    expect(destination).toEqual({ type: "internal", href: "/hangout-mode" });
  });

  it("still resolves the legacy suffix", () => {
    expect(resolveNotificationDestination("hangout:request")).toEqual({ type: "internal", href: "/hangout-mode" });
  });
});
