import { describe, expect, it } from "vitest";

import {
  hasStaleTarget,
  NOTIFICATION_STALE_TARGET_MESSAGE,
  notificationSourceLabel,
  notificationTimestampLabel,
  resolveNotificationBehaviour
} from "@/lib/notifications/detail";

/**
 * EVERY NOTIFICATION TAP DOES SOMETHING.
 *
 * The defect these pin: a notification with no resolver destination rendered
 * as a plain <article> -- not focusable, not tappable -- with its body clipped
 * to one line by `truncate`. Its reader could neither open it nor finish
 * reading it. These assert the DECISION each row makes, so a future change
 * that reintroduces a do-nothing branch fails here rather than in production.
 */

const UUID = "11111111-1111-4111-8111-111111111111";

describe("actionable notifications navigate", () => {
  it("sends a plan notification to that plan", () => {
    const behaviour = resolveNotificationBehaviour({ type: `plan:${UUID}`, handledInline: false });
    expect(behaviour.kind).toBe("navigate");
    if (behaviour.kind !== "navigate") throw new Error("expected navigate");
    expect(behaviour.destination.href).toContain("/plans");
    expect(behaviour.destination.href).toContain(UUID);
  });

  it("sends a message notification to that conversation", () => {
    const behaviour = resolveNotificationBehaviour({ type: `message:${UUID}`, handledInline: false });
    expect(behaviour.kind).toBe("navigate");
    if (behaviour.kind !== "navigate") throw new Error("expected navigate");
    expect(behaviour.destination.href).toBe(`/messages?conversation=${UUID}`);
  });

  it("routes every base type that claims a destination", () => {
    for (const type of [
      "friend_request_received",
      "plan",
      "event",
      "hangout",
      "message",
      "group",
      "achievement",
      "linkr_connection"
    ]) {
      const behaviour = resolveNotificationBehaviour({ type, handledInline: false });
      expect(behaviour.kind, `${type} had nowhere to go`).toBe("navigate");
    }
  });
});

describe("informational notifications open their detail", () => {
  /* THE DEAD TAP. system_alert deliberately has no destination -- it is the
     message. Before this, that meant the row did nothing at all. */
  it("gives a system alert somewhere to go", () => {
    expect(resolveNotificationBehaviour({ type: "system_alert", handledInline: false }).kind).toBe(
      "detail"
    );
  });

  it("gives an unrecognised type somewhere to go", () => {
    expect(
      resolveNotificationBehaviour({ type: "something_new_we_added_later", handledInline: false }).kind
    ).toBe("detail");
  });

  /* NO BRANCH RETURNS "DO NOTHING". This is the property that matters: whatever
     arrives, the row is interactive. */
  it("never leaves a notification with no behaviour at all", () => {
    const types = [
      "system_alert",
      "",
      "unknown",
      "plan",
      `plan:${UUID}`,
      "plan:not-a-uuid",
      "event_room:bad:worse",
      "achievement:first_plan",
      "birthday"
    ];
    for (const type of types) {
      const behaviour = resolveNotificationBehaviour({ type, handledInline: false });
      expect(["navigate", "inline", "detail"], `${type} produced no behaviour`).toContain(
        behaviour.kind
      );
    }
  });
});

describe("a stale or malformed target never produces a broken URL", () => {
  /* WHAT THE RESOLVER ACTUALLY DOES, which is better than what this test first
     assumed. A notification outlives the thing it points at, and an id that no
     longer parses falls through to the FEATURE SECTION rather than to a dead
     per-item URL -- `message:not-a-uuid` lands on /messages, not on
     /messages?conversation=not-a-uuid. That is a deliberate documented choice
     in lib/notifications/destination.ts, and it is a better outcome than an
     error page, so these assert it rather than overriding it.

     The property that matters is the same either way: the tap goes somewhere
     valid, and it never carries a malformed id into a URL. */
  it("drops an unparseable id rather than putting it in the URL", () => {
    const behaviour = resolveNotificationBehaviour({
      type: "message:not-a-uuid",
      handledInline: false
    });
    expect(behaviour.kind).toBe("navigate");
    if (behaviour.kind !== "navigate") throw new Error("expected navigate");
    expect(behaviour.destination.href).toBe("/messages");
    expect(behaviour.destination.href, "a malformed id reached the URL").not.toContain("not-a-uuid");
  });

  it("falls back to the Event rather than a broken Room link", () => {
    const behaviour = resolveNotificationBehaviour({
      type: "event_room:nope:also-nope",
      handledInline: false
    });
    expect(behaviour.kind).toBe("navigate");
    if (behaviour.kind !== "navigate") throw new Error("expected navigate");
    expect(behaviour.destination.href).toBe("/events");
    expect(behaviour.destination.href).not.toContain("nope");
  });

  /* The genuinely unresolvable case: a base nobody routes. It opens the
     detail, where the sheet can say why there is nowhere to go. */
  it("opens the detail when even the base cannot be routed", () => {
    expect(
      resolveNotificationBehaviour({ type: "retired_feature:whatever", handledInline: false }).kind
    ).toBe("detail");
  });

  it("has copy explaining why there is nowhere to go", () => {
    expect(NOTIFICATION_STALE_TARGET_MESSAGE).toMatch(/no longer available/i);
  });

  /* WHEN THAT COPY ACTUALLY SHOWS. An earlier version of this condition was
     unreachable -- it required a known source label AND no destination AND an
     id suffix, and every labelled base has a destination, so it could never
     fire. hasStaleTarget asks the narrower, real question: did this
     notification name a specific item that the resolver could not use? */
  it("reports a stale target when a named item could not be resolved", () => {
    expect(hasStaleTarget("plan:not-a-uuid")).toBe(true);
    expect(hasStaleTarget("message:gone")).toBe(true);
    expect(hasStaleTarget("event_room:nope:also-nope")).toBe(true);
  });

  it("reports nothing stale when the item resolved", () => {
    expect(hasStaleTarget(`plan:${UUID}`)).toBe(false);
    expect(hasStaleTarget(`message:${UUID}`)).toBe(false);
    expect(hasStaleTarget("achievement:first_plan")).toBe(false);
  });

  /* A notification that never named an item has lost nothing. Saying "no
     longer available" there would invent a loss. */
  it("never claims a loss for a notification that named no item", () => {
    expect(hasStaleTarget("system_alert")).toBe(false);
    expect(hasStaleTarget("plan")).toBe(false);
    expect(hasStaleTarget("friend_request_received")).toBe(false);
    expect(hasStaleTarget("")).toBe(false);
  });
});

describe("inline handling wins over everything", () => {
  /* A meetup request opens a reply modal and has no resolver destination, so
     without this it would be mistaken for informational and open a detail
     sheet instead of the reply it is for. */
  it("keeps a meetup request inline", () => {
    expect(resolveNotificationBehaviour({ type: "meetup_request", handledInline: true }).kind).toBe(
      "inline"
    );
  });

  it("keeps a birthday inline even though it has a destination", () => {
    expect(resolveNotificationBehaviour({ type: "birthday", handledInline: true }).kind).toBe(
      "inline"
    );
  });
});

describe("the detail sheet says when and where", () => {
  it("gives an absolute date rather than a relative one", () => {
    const label = notificationTimestampLabel("2026-08-30T19:05:00.000Z", "en-GB");
    expect(label).toBeTruthy();
    expect(label).toContain("Aug");
    expect(label).toContain("2026");
    // "2h" tells a reader nothing a week later; the sheet is not a scan view.
    expect(label).not.toMatch(/^\d+[hmd]$/);
  });

  it("omits the date rather than printing rubbish", () => {
    expect(notificationTimestampLabel("not a date")).toBeNull();
    expect(notificationTimestampLabel("")).toBeNull();
  });

  it("names the surface a notification came from", () => {
    expect(notificationSourceLabel(`plan:${UUID}`)).toBe("Plans");
    expect(notificationSourceLabel("event_room:a:b")).toBe("Event Rooms");
    expect(notificationSourceLabel("friend_request_received")).toBe("Muddies");
    expect(notificationSourceLabel("system_alert")).toBe("Mad Buddy");
  });

  it("omits the source for a type it does not recognise", () => {
    expect(notificationSourceLabel("something_new")).toBeNull();
  });
});
