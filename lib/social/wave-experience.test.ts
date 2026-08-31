import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { planActionsForMuddy } from "@/lib/activation/state";

/**
 * A Wave is "hey, I'm around" -- not "I know where you are".
 *
 * It must be faster than a message, must never claim to have sent something it
 * did not, and must never survive its own cooldown as a button the server will
 * refuse.
 */

const action = readFileSync("app/(app)/social-actions.ts", "utf8");
const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const waveBlock = action.slice(
  action.indexOf("export async function sendWaveV2Action"),
  action.indexOf("export async function muteWavesFromAction")
);

describe("one canonical Wave path", () => {
  it("sends through the canonical action", () => {
    expect(home).toContain("sendWaveV2Action(muddyId)");
    expect(home).toContain('from "@/app/(app)/social-actions"');
  });

  it("writes no wave of its own from Home", () => {
    for (const banned of ['.from("waves")', "wave_mutes", "deliverNotification"]) {
      expect(home).not.toContain(banned);
    }
  });

  it("builds no second cooldown in the client", () => {
    /* The client REMEMBERS an outcome the server committed; it does not run a
     * timer. No duration, no countdown, no expiry maths. */
    const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));
    for (const banned of ["setTimeout", "WAVE_PAIR_COOLDOWN_MS", "Date.now()", "setInterval"]) {
      expect(handler).not.toContain(banned);
    }
  });

  it("keeps the cooldown authority on the server", () => {
    expect(waveBlock).toContain("wavePairCooldownRemaining");
    expect(waveBlock).toContain('.from("waves")');
  });
});

describe("a refused Wave is not a success", () => {
  it("reports the cooldown as a failure", () => {
    /* THE DEFECT: this returned ok:true, so the sender saw a success toast for
     * a wave that was never written, and any caller branching on `ok` treated
     * a refusal as a send. */
    const cooldown = waveBlock.slice(waveBlock.indexOf("if (cooldownRemaining > 0)"));
    expect(cooldown.slice(0, 700)).toContain("ok: false");
  });

  it("still reports a genuine send as success", () => {
    expect(waveBlock).toContain('return { ok: true, message: "Wave sent 👋" };');
  });

  it("fails when the write itself fails", () => {
    expect(waveBlock).toContain('return { ok: false, message: "Your wave was not sent. Try again." };');
  });
});

describe("no countdown is shown to anybody", () => {
  it("exposes no remaining time in the copy", () => {
    /* The design target showed "59m 57s". How long is left is Mad Buddy's
     * bookkeeping, not something to make somebody watch. */
    for (const leak of ["59m", "m 5", "remaining", "expires", "seconds"]) {
      expect(waveBlock).not.toContain(leak);
    }
  });

  it("renders no timer in Home", () => {
    const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));
    expect(handler).not.toContain("cooldownRemaining");
  });
});

describe("the button reconciles after sending", () => {
  it("records who was waved at, only on success", () => {
    /* Shape-tolerant: the reconciliation moved into a transition so the
     * success toast could paint first, but it is still gated on ok. */
    const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));
    expect(handler).toContain("if (result.ok)");
    expect(handler).toContain("setWavedMuddyIds");
    const gate = handler.indexOf("if (result.ok)");
    expect(gate).toBeLessThan(handler.indexOf("setWavedMuddyIds"));
  });

  it("feeds that back into the decision engine", () => {
    /* `waveAvailable: true` was hard-coded, so Wave survived its own success
     * and the next tap hit the cooldown branch. */
    expect(home).toContain("relationshipFocus.waveAvailable && !wavedMuddyIds.has(");
    expect(home).not.toContain("waveAvailable: true");
  });

  it("uses the server's own availability as the base", () => {
    const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));
    expect(projection).toContain("waveAvailable: !wavedRecently.has(m.id)");
    const focus = stripComments(readFileSync("lib/activation/relationship-focus.ts", "utf8"));
    expect(focus).toContain("waveAvailable: chosen.waveAvailable,");
  });

  it("guards a rapid second tap", () => {
    const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));
    expect(handler).toContain("if (isPending) return;");
  });
});

describe("the sender can actually perceive the success", () => {
  const handler = home.slice(home.indexOf("function waveAtMuddy"), home.indexOf("RSVP from the Home"));

  it("shows the confirmation outside a transition", () => {
    /* THE DEFECT. The whole handler sat inside startTransition, so the toast
     * was a non-urgent update batched with the re-render that dropped the Wave
     * button -- React painted them together and the sender saw only the button
     * change, for a wave that had genuinely been delivered. */
    const toastAt = handler.indexOf("showPromptFeedback(result.message");
    const transitionAt = handler.indexOf("startTransition(");
    expect(toastAt).toBeGreaterThan(-1);
    expect(transitionAt).toBeGreaterThan(-1);
    // The toast is raised BEFORE the reconciliation transition.
    expect(toastAt).toBeLessThan(transitionAt);
  });

  it("awaits the action directly rather than wrapping it", () => {
    expect(handler).toContain("await sendWaveV2Action(muddyId)");
    // Only the reconciliation is deferred.
    const transition = handler.slice(handler.indexOf("startTransition("));
    expect(transition).toContain("setWavedMuddyIds");
    expect(transition).not.toContain("sendWaveV2Action");
  });

  it("uses the existing toast rather than a second system", () => {
    expect(handler).toContain("showPromptFeedback(");
    for (const second of ["<Toaster", "useToast(", "sonner", "react-hot-toast"]) {
      expect(home).not.toContain(second);
    }
  });

  it("renders that toast in an announced live region", () => {
    const toast = home.slice(home.indexOf("{promptFeedback ? ("), home.indexOf("{promptFeedback ? (") + 600);
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
  });

  it("says the words, not just a colour", () => {
    expect(home).toContain("promptFeedback.message");
  });

  it("shows a pending phase on the wave button only", () => {
    // Say hi beside it must remain usable while a wave is in flight.
    expect(home).toContain('"Waving…"');
    expect(handler).toContain("setWavingMuddyId(muddyId)");
    expect(handler).toContain("setWavingMuddyId(null)");
  });

  it("clears the pending state on a thrown failure too", () => {
    const failure = handler.slice(handler.indexOf("catch {"));
    expect(failure).toContain("setWavingMuddyId(null)");
    expect(failure).toContain("Wave couldn't be sent right now.");
  });

  it("confirms only a genuine success", () => {
    // The message and its error flag both come from the server's answer.
    expect(handler).toContain("showPromptFeedback(result.message, !result.ok)");
  });
});

describe("the engine never offers a dead Wave", () => {
  const ctx = (over: Record<string, unknown> = {}) =>
    planActionsForMuddy({
      hasSharedUpcomingPlan: false,
      hasExistingConversation: false,
      conversationState: "none",
      isNearby: true,
      waveAvailable: true,
      ...over
    } as never);

  it("offers Say hi then Wave to a new nearby Muddy", () => {
    expect(ctx().primary).toBe("say_hi");
    expect(ctx().secondary).toBe("wave");
  });

  it("falls back once the cooldown is active", () => {
    // Say hi stays primary; the secondary becomes something that works.
    const cooled = ctx({ waveAvailable: false });
    expect(cooled.primary).toBe("say_hi");
    expect(cooled.secondary).toBe("make_plan");
    expect(cooled.secondary).not.toBe("wave");
  });

  it("drops Wave entirely for an established pair on cooldown", () => {
    const cooled = ctx({
      hasExistingConversation: true,
      conversationState: "established",
      waveAvailable: false
    });
    expect(cooled.primary).toBe("message");
    expect(cooled.secondary).not.toBe("wave");
  });

  it("keeps the fallback in the engine, not in JSX", () => {
    expect(home).not.toContain('secondary: "make_plan"');
    expect(home).toContain("planActionsForMuddy({");
  });
});

describe("authorization is re-checked at send time", () => {
  it("verifies the relationship on the server", () => {
    expect(waveBlock).toContain("verifyMuddyRelationship(admin, userId, recipientId)");
    expect(waveBlock).toContain('"You can only wave at approved Muddies."');
  });

  it("honours suspension", () => {
    expect(waveBlock).toContain('guardAction(admin, { userId, surface: "waves" })');
  });

  it("refuses a self-wave", () => {
    expect(waveBlock).toContain("You cannot wave at yourself.");
  });

  it("applies anti-spam windows beyond the pair cooldown", () => {
    expect(waveBlock).toContain('["waves.send", "waves.send.daily"]');
  });
});

describe("the receiver learns nothing about where you are", () => {
  const notification = waveBlock.slice(waveBlock.indexOf("deliverNotification"));

  it("says only that a Wave happened", () => {
    expect(notification).toContain("waved at you");
  });

  it("leaks no location of any kind", () => {
    for (const leak of ["metres", " km", "away", "distance", "latitude", "coordinates", "street", "nearby you"]) {
      expect(notification).not.toContain(leak);
    }
  });

  it("uses no surveillance phrasing", () => {
    for (const creepy of ["I see you", "found you", "right beside", "at your location", "is outside"]) {
      expect(waveBlock).not.toContain(creepy);
    }
  });

  it("respects a mute without telling the sender", () => {
    /* The wave record exists either way; a muted recipient just is not pinged,
     * and revealing that would expose the recipient's own setting. */
    expect(waveBlock).toContain('.from("wave_mutes")');
    expect(waveBlock).toContain("if (!mute) {");
  });

  it("goes through the canonical delivery path", () => {
    expect(waveBlock).toContain("deliverNotification(admin, {");
    expect(notification).toContain('category: "waves"');
  });
});

describe("Wave is one concept, consistently named", () => {
  it("does not drift into other vocabulary", () => {
    const senderCopy = [
      "Wave sent 👋",
      "You already waved recently. Give them a little time.",
      "Your wave was not sent. Try again."
    ];
    for (const copy of senderCopy) expect(waveBlock).toContain(copy);
    for (const other of ["Poke", "Nudge", "Buzz"]) expect(waveBlock).not.toContain(other);
  });

  it("leaks no internals to the sender", () => {
    for (const internal of ["RLS", "rpc", "constraint", "supabase", "stack"]) {
      expect(waveBlock.toLowerCase()).not.toContain(`message: "${internal}`);
    }
  });
});

describe("first value, not maturity", () => {
  it("records the milestone on a real send", () => {
    expect(waveBlock).toContain('recordMilestone(admin, userId, "first_wave_sent")');
  });

  it("does not make one Wave an established user", async () => {
    const { deriveHomeMaturity } = await import("@/lib/activation/home-maturity");
    const waved = deriveHomeMaturity({
      milestones: new Set(["first_muddy_added", "first_wave_sent"]),
      twoSidedConversationCount: 0,
      planParticipationCount: 0,
      muddyCount: 2
    });
    expect(waved).toBe("early_value");
  });

  it("keeps the nearby moment above generic Home", async () => {
    const { composeHome } = await import("@/lib/activation/home-composition");
    const composed = composeHome({
      activationState: "muddy_nearby",
      acknowledgingFirstMuddy: false,
      milestones: new Set(["first_muddy_added", "first_wave_sent"]),
      hasSafetyCard: false,
      upcomingPlanCount: 0,
      twoSidedConversationCount: 0,
      planParticipationCount: 0,
      muddyCount: 2,
      nextUnspokenMuddy: null,
      missingProfileItems: ["photo"]
    });
    expect(composed.showNearby).toBe(true);
    expect(composed.showTrending).toBe(false);
    expect(composed.showJourneyCard).toBe(false);
    expect(composed.nextBestAction).toBeNull();
  });
});

describe("accessibility and guidance readiness", () => {
  it("labels the action with words", () => {
    expect(home).toContain("ACTION_LABEL[soloNearbyPlan.primary]");
    expect(home).toContain("ACTION_LABEL[soloSecondary]");
  });

  it("carries a stable target for future guidance", () => {
    expect(home).toContain("data-home-action={soloNearbyPlan.primary}");
  });

  it("adds no coach mark yet", () => {
    for (const premature of ["CoachMark", "Tooltip", "TourStep"]) {
      expect(home).not.toContain(premature);
    }
  });
});
