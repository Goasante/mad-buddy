import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const plans = read("components/plans/plans-page.tsx");
const safeArrival = read("components/safety/safe-arrival-page.tsx");
const upFor = read("components/hangout/hangout-mode-page.tsx");
const longPress = read("components/ui/long-press-actions.tsx");
const messageActions = read("components/messaging/message-actions-menu.tsx");
const messages = read("components/messages/messages-page-v4.tsx");
const quickActions = read("components/app-shell/quick-actions-launcher.tsx");
const friends = read("components/friends/friends-page.tsx");
const muddyProfile = read("components/friends/muddy-profile-page.tsx");
const findMuddies = read("components/contacts/find-muddies-sheet.tsx");
const socialize = read("components/socialize/socialize-page.tsx");

describe("approved product feedback map", () => {
  it("acknowledges Plan mutations only after their server result", () => {
    expect(plans).toContain('from "@/lib/feedback/feedback"');
    expect(plans).toContain("if (result.ok) interactionFeedback.success()");
    expect(plans).toContain("interactionFeedback.error()");
    expect(plans).toContain("interactionFeedback.warning()");
    expect(plans).toContain("interactionFeedback.selection()");

    // RSVP deliberately declares `result` before the try/catch so a rejected
    // Server Action can restore the optimistic state. Assert ordering rather
    // than requiring a brittle `const result = await ...` spelling.
    const rsvp = plans.slice(plans.indexOf("function changeRsvp"), plans.indexOf("function vote("));
    expect(rsvp.indexOf("result = await rsvpAction(planId, rsvp)")).toBeGreaterThanOrEqual(0);
    expect(rsvp.indexOf("interactionFeedback.success()")).toBeGreaterThan(
      rsvp.indexOf("result = await rsvpAction(planId, rsvp)")
    );
    expect(rsvp.lastIndexOf("interactionFeedback.error()")).toBeGreaterThan(
      rsvp.indexOf("result = await rsvpAction(planId, rsvp)")
    );

    const create = plans.slice(plans.indexOf("function createPlan(input"));
    expect(create.indexOf("const result = await createPlanAction")).toBeGreaterThanOrEqual(0);
    expect(create.indexOf("interactionFeedback.success()")).toBeGreaterThan(
      create.indexOf("const result = await createPlanAction")
    );
  });

  it("gives Safe Arrival confirmation the strongest success feedback", () => {
    expect(safeArrival).toContain('from "@/lib/feedback/feedback"');
    expect(safeArrival).toContain("confirmSafeArrivalAction(activeJourney.id)");
    expect(safeArrival).toContain("interactionFeedback.importantSuccess()");
    expect(safeArrival).toContain("interactionFeedback.warning()");
    expect(safeArrival).toContain("interactionFeedback.error()");
  });

  it("covers UpFor create/join/accept/end/conversion without vibrating pending state", () => {
    expect(upFor).toContain('from "@/lib/feedback/feedback"');
    expect(upFor).toContain("interactionFeedback.light()");
    expect(upFor).toContain('if (response === "accepted") interactionFeedback.success()');
    expect(upFor).toContain("interactionFeedback.warning()");
    expect(upFor).toContain("interactionFeedback.error()");

    const request = upFor.slice(upFor.indexOf("async function requestToJoin"), upFor.indexOf("async function leaveUpFor"));
    expect(request.indexOf("await requestHangoutAction")).toBeGreaterThanOrEqual(0);
    expect(request.indexOf("interactionFeedback.light()")).toBeGreaterThan(
      request.indexOf("await requestHangoutAction")
    );
  });

  it("covers Muddy requests and Waves on the production friendship surfaces", () => {
    expect(friends).toContain('from "@/lib/feedback/feedback"');
    expect(friends).toContain("interactionFeedback.success()");
    expect(friends).toContain("interactionFeedback.error()");
    expect(friends).toContain("acceptFriendRequestAction");
    expect(friends).toContain("sendFriendRequestAction");

    expect(muddyProfile).toContain("interactionFeedback.wave()");
    expect(muddyProfile).toContain("interactionFeedback.success()");
    expect(muddyProfile).toContain("interactionFeedback.error()");
    expect(findMuddies).toContain("interactionFeedback.success()");
    expect(findMuddies).toContain("interactionFeedback.error()");

    const socializeWave = socialize.slice(
      socialize.indexOf("function wave(person"),
      socialize.indexOf("function passPerson")
    );
    expect(socializeWave).toContain("await sendFriendRequestAction");
    expect(socializeWave).toContain("interactionFeedback.wave()");
    expect(socializeWave.indexOf("interactionFeedback.wave()")).toBeGreaterThan(
      socializeWave.indexOf("await sendFriendRequestAction")
    );
  });

  it("acknowledges message reaction success and real send failure", () => {
    expect(messages).toContain('from "@/lib/feedback/feedback"');
    const reaction = messages.slice(messages.indexOf("function react(messageId"));
    expect(reaction).toContain("await reactToMessageAction");
    expect(reaction).toContain("interactionFeedback.selection()");
    expect(reaction).toContain("interactionFeedback.error()");

    const settle = messages.slice(
      messages.indexOf("function settleOptimistic"),
      messages.indexOf("function retryOptimistic")
    );
    expect(settle).toContain('if (outcome === "failed") interactionFeedback.error()');
    expect(settle.indexOf("interactionFeedback.error()")).toBeGreaterThan(
      settle.indexOf("updateOptimistic")
    );
  });

  it("uses semantic long-press feedback on shared and message context menus", () => {
    expect(longPress).toContain("feedback.longPress()");
    expect(messageActions).toContain("feedback.longPress()");
    expect(messageActions).toContain("feedback.warning()");
    expect(messageActions).toContain("feedback.selection()");
    expect(longPress).not.toContain("navigator.vibrate");
    expect(messageActions).not.toContain("navigator.vibrate");
  });

  it("uses snap feedback only when the draggable quick action settles", () => {
    const release = quickActions.slice(
      quickActions.indexOf("function onPointerUp"),
      quickActions.indexOf("function toggle")
    );
    expect(release).toContain("saveQuickActionsPosition");
    expect(release).toContain("feedback.snap()");
    expect(release.indexOf("feedback.snap()")).toBeGreaterThan(release.indexOf("saveQuickActionsPosition"));
  });
});