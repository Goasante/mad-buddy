import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canTransitionStatus,
  categoryLabel,
  describeSupportEvent,
  isAssignableStaff,
  isReopen,
  isStatusFilterKey,
  isTerminalStatus,
  priorityLabel,
  priorityRequiresReason,
  priorityTone,
  statusLabel,
  STATUS_FILTER_GROUPS,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportStatus
} from "@/lib/admin/support";

describe("support status transitions", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransitionStatus("new", "open")).toBe(true);
    expect(canTransitionStatus("open", "waiting_on_user")).toBe(true);
    expect(canTransitionStatus("open", "resolved")).toBe(true);
    expect(canTransitionStatus("waiting_on_user", "open")).toBe(true);
    expect(canTransitionStatus("resolved", "open")).toBe(true);
  });

  it("rejects arbitrary / illegal transitions", () => {
    expect(canTransitionStatus("new", "resolved")).toBe(false);
    expect(canTransitionStatus("closed", "resolved")).toBe(false);
    expect(canTransitionStatus("closed", "waiting_on_user")).toBe(false);
    // A no-op is not a valid transition.
    expect(canTransitionStatus("open", "open")).toBe(false);
  });

  it("lets a closed issue leave ONLY through reopen (closed → open)", () => {
    expect(allowedTransitions("closed")).toEqual(["open"]);
    expect(canTransitionStatus("closed", "open")).toBe(true);
    expect(isReopen("closed", "open")).toBe(true);
    expect(isReopen("resolved", "open")).toBe(true);
    expect(isReopen("open", "resolved")).toBe(false);
  });

  it("flags terminal statuses", () => {
    expect(isTerminalStatus("resolved")).toBe(true);
    expect(isTerminalStatus("closed")).toBe(true);
    expect(isTerminalStatus("open")).toBe(false);
    expect(isTerminalStatus("new")).toBe(false);
  });

  it("never produces a transition target outside the canonical status set", () => {
    for (const from of SUPPORT_STATUSES) {
      for (const to of allowedTransitions(from)) {
        expect(SUPPORT_STATUSES).toContain(to);
      }
    }
  });
});

describe("support priority", () => {
  it("labels urgent as Critical", () => {
    expect(priorityLabel("urgent")).toBe("Critical");
    expect(priorityLabel("normal")).toBe("Normal");
  });

  it("requires a reason only for the Critical tier", () => {
    expect(priorityRequiresReason("urgent")).toBe(true);
    expect(priorityRequiresReason("high")).toBe(false);
    expect(priorityRequiresReason("normal")).toBe(false);
    expect(priorityRequiresReason("low")).toBe(false);
  });

  it("tones Critical as danger and High as warning", () => {
    expect(priorityTone("urgent")).toBe("danger");
    expect(priorityTone("high")).toBe("warning");
    expect(priorityTone("normal")).toBe("default");
  });

  it("keeps every priority within the canonical set", () => {
    expect(SUPPORT_PRIORITIES).toContain("urgent");
    expect(SUPPORT_PRIORITIES).toHaveLength(4);
  });
});

describe("support assignment eligibility", () => {
  it("accepts active staff of any staff standing", () => {
    expect(isAssignableStaff({ standing: "owner", active: true })).toBe(true);
    expect(isAssignableStaff({ standing: "admin", active: true })).toBe(true);
    expect(isAssignableStaff({ standing: "support", active: true })).toBe(true);
  });

  it("rejects standard users and inactive staff", () => {
    expect(isAssignableStaff({ standing: "standard", active: true })).toBe(false);
    expect(isAssignableStaff({ standing: "support", active: false })).toBe(false);
    expect(isAssignableStaff({ standing: "admin", active: false })).toBe(false);
  });
});

describe("support labels & filters", () => {
  it("maps canonical statuses to friendly labels", () => {
    expect(statusLabel("open")).toBe("In progress");
    expect(statusLabel("waiting_on_user")).toBe("Waiting for user");
  });

  it("provides a label for every category", () => {
    for (const category of SUPPORT_CATEGORIES) {
      expect(categoryLabel(category)).not.toBe(category);
    }
  });

  it("recognises the primary status filter keys and maps them to real statuses", () => {
    expect(isStatusFilterKey("in_progress")).toBe(true);
    expect(isStatusFilterKey("bogus")).toBe(false);
    for (const statuses of Object.values(STATUS_FILTER_GROUPS)) {
      for (const status of statuses) {
        expect(SUPPORT_STATUSES).toContain(status as SupportStatus);
      }
    }
  });

  it("describes events without leaking machine values for known types", () => {
    expect(
      describeSupportEvent({ eventType: "status_changed", fromValue: "open", toValue: "resolved" })
    ).toBe("Status changed from In progress to Resolved");
    expect(describeSupportEvent({ eventType: "reopened", fromValue: null, toValue: null })).toBe("Issue reopened");
  });
});
