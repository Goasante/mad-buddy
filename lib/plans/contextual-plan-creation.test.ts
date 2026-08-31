import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Context should follow the user.
 *
 * Tapping "Make a Plan" on Kofi opened a composer with nobody selected, so the
 * next thing the product asked was "who is this with?" -- about the person
 * whose card they had just tapped.
 */

const home = stripComments(readFileSync("components/dashboard/dashboard-page.tsx", "utf8"));
const plans = stripComments(readFileSync("components/plans/plans-page.tsx", "utf8"));
const composer = plans.slice(plans.indexOf("function CreatePlanModal"), plans.indexOf("function PlanInviteePicker"));

describe("the person travels with the tap", () => {
  it("carries the Muddy in the link", () => {
    expect(home).toContain("`/plans?create=1&with=${encodeURIComponent(muddyId)}`");
  });

  it("reads it back in the composer", () => {
    expect(plans).toContain('searchParams.get("with")');
    expect(plans).toContain("contextMuddyId={contextMuddyId}");
  });

  it("preselects that person", () => {
    expect(composer).toContain("useState<string[]>(contextSelection)");
  });

  it("names them before asking anything", () => {
    expect(composer).toContain("Planning with");
    expect(composer).toContain("contextInvitee.name");
  });

  it("still works with no context at all", () => {
    /* The plain /plans?create=1 entry must keep working: an absent param
     * selects nobody rather than erroring. */
    expect(composer).toContain("contextMuddyId && invitees.some(");
    expect(composer).toContain(": []");
  });

  it("ignores an id the viewer is not Muddies with", () => {
    // Filtered against real invitees, so a stale or forged id selects nobody.
    expect(composer).toContain("invitees.some((invitee) => invitee.id === contextMuddyId)");
    expect(composer).toContain("invitees.find((invitee) => invitee.id === contextMuddyId)");
  });

  it("keeps the person selected when the form resets", () => {
    expect(composer).toContain("setSelected(contextSelection)");
  });
});

describe("nearby context is a person, never a location", () => {
  it("passes only the Muddy id", () => {
    /* Scoped to the make_plan BRANCH. A wider slice ran into the nearby hero
     * markup, where proximityLevel is legitimately rendered -- flagging it
     * would have forced unrelated UI to rename a prop for a privacy rule. */
    const branch = home.slice(
      home.indexOf('if (action === "make_plan")'),
      home.indexOf("startTransition(async () => {", home.indexOf('if (action === "make_plan")'))
    );
    for (const leak of ["proximityLevel", "glowStrength", "latitude", "longitude", "distance"]) {
      expect(branch).not.toContain(leak);
    }
    expect(branch).toContain("muddyId");
  });

  it("puts no proximity in the URL", () => {
    expect(home).not.toMatch(/plans\?create=1[^`"]*proximity/);
    expect(home).not.toMatch(/plans\?create=1[^`"]*lat/);
  });

  it("sends no location into plan creation", () => {
    const submit = plans.slice(plans.indexOf("createPlanAction({"), plans.indexOf("setFeedback(result.message)"));
    for (const leak of ["latitude", "longitude", "coordinates", "proximity", "distance"]) {
      expect(submit).not.toContain(leak);
    }
  });

  it("never auto-fills the place from a location", () => {
    /* People agree on the intent before the venue, and the composer must not
     * quietly turn "nearby" into a meeting point. */
    expect(composer).toContain('const [placeText, setPlaceText] = useState("")');
    expect(composer).not.toContain("navigator.geolocation");
    expect(composer).not.toContain("getCurrentPosition");
  });

  it("requests no location permission on opening", () => {
    expect(plans).not.toContain("navigator.geolocation");
  });
});

describe("the canonical lifecycle is untouched", () => {
  it("submits through the one action", () => {
    expect(plans).toContain("createPlanAction({");
    expect(plans).toContain('from "@/app/(app)/plans-actions"');
  });

  it("builds no parallel creation path", () => {
    for (const banned of ["createNearbyPlan", "createQuickPlan", "create_plan_lifecycle"]) {
      expect(plans).not.toContain(banned);
    }
    for (const banned of ["createNearbyPlan", "createQuickPlan"]) {
      expect(home).not.toContain(banned);
    }
  });

  it("keeps the RPC as the server's authority", () => {
    const service = readFileSync("lib/plans/service.ts", "utf8");
    expect(service).toContain('admin.rpc("create_plan_lifecycle"');
  });

  it("writes no plan rows from the client", () => {
    for (const banned of ['.from("plans")', '.from("plan_participants")']) {
      expect(plans).not.toContain(banned);
      expect(home).not.toContain(banned);
    }
  });

  it("stays idempotent across a double submit", () => {
    // One request key per composer session; reused if the first send retries.
    expect(plans).toContain("createRequestKeyRef");
    expect(plans).toContain("requestKey:");
  });
});

describe("the composer asks for the decision, not paperwork", () => {
  it("leads with what you are doing", () => {
    expect(composer).toContain('label="What are we doing?"');
  });

  it("keeps place and notes optional", () => {
    expect(composer).toContain('label="Where? (optional)"');
    expect(composer).toContain('label="Notes (optional)"');
  });

  it("names the action plainly", () => {
    expect(composer).toContain("Create plan");
    /* Visible LABELS only. A bare "Submit" scan flagged the poll form's
     * `onSubmit` prop in a different component -- banning it there would make
     * a React convention illegal to satisfy a copy rule. */
    for (const admin of [">Submit<", ">Save<", ">Schedule event<"]) {
      expect(composer).not.toContain(admin);
    }
  });

  it("shows a pending state rather than a fake completion", () => {
    expect(composer).toContain("pending");
  });
});

describe("guidance never interrupts a task already underway", () => {
  const controller = stripComments(
    readFileSync("components/tours/tour-offer-controller.tsx", "utf8")
  );

  it("withdraws an offered guide when a dialog opens", () => {
    /* THE DEFECT. `blockingInterfaceIsOpen` refused to OFFER a tour over a
     * dialog, but only before one was chosen: navigating to /plans?create=1
     * mounts page and composer together, the 350ms inspect fired first, and
     * once activeTourId was set the effect returned early and never looked
     * again -- so the Plans guide explained "create social plans" over the
     * composer of somebody who had just tapped Make a Plan. */
    expect(controller).toContain("if (!activeTourId) return;");
    expect(controller).toContain("if (blockingInterfaceIsOpen()) setActiveTourId(null);");
  });

  it("watches for a dialog appearing, not just once at mount", () => {
    expect(controller).toContain("new MutationObserver(withdrawIfBlocked)");
    expect(controller).toContain('attributeFilter: ["aria-modal", "role"]');
  });

  it("keeps one predicate deciding both offer and withdrawal", () => {
    // Two rules would drift; the same function answers both questions.
    expect(controller.split("blockingInterfaceIsOpen()").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("replaces it with no coach mark", () => {
    const composer2 = plans.slice(plans.indexOf("function CreatePlanModal"), plans.indexOf("function PlanInviteePicker"));
    for (const premature of ["CoachMark", "Tooltip", "TourStep", "Tap here"]) {
      expect(composer2).not.toContain(premature);
    }
  });

  it("leaves the guide itself intact for deliberate use", () => {
    // Removed from the interruption path, not deleted from the product.
    expect(controller).toContain("TourRunner");
  });
});

describe("the composer stays a decision, not a catalogue", () => {
  it("shows a small set of categories before More", () => {
    /* All fifteen wrapped across several rows and became the tallest thing on
     * the screen -- a taxonomy to browse rather than a shortcut. */
    expect(plans).toContain("QUICK_CATEGORY_COUNT = 6");
    expect(composer).toContain("shownCategories.map");
    expect(composer).toContain("setShowAllCategories(true)");
  });

  it("keeps a chosen category visible even when it came from More", () => {
    expect(composer).toContain("category && !quick.includes(category)");
  });

  it("keeps every category reachable", () => {
    // Reduced on screen, never removed from the model.
    expect(composer).toContain("if (showAllCategories) return PLAN_CATEGORIES;");
  });

  it("keeps the category optional", () => {
    expect(composer).toContain("(optional)");
  });

  it("says the send is under way rather than faking completion", () => {
    expect(composer).toContain('pending ? "Creating…" : "Create plan"');
  });

  it("offers an idea as the placeholder, not an idea plus a time", () => {
    expect(composer).toContain('placeholder="Grab food"');
    expect(composer).not.toContain('placeholder="Lunch later"');
  });
});

describe("the same person either side of the tap", () => {
  const service = readFileSync("lib/plans/service.ts", "utf8");

  it("selects the avatar the composer needs", () => {
    /* THE DEFECT. The invitee query fetched user_id, full_name and username
     * only, so a Muddy shown with their real photo on Home arrived in the
     * composer as a bare initial. */
    expect(service).toContain('.select("user_id, full_name, username, avatar_url")');
    expect(service).toContain("avatarUrl: profile.avatar_url");
  });

  it("adds no extra round trip to do it", () => {
    // One more column on a query that already runs -- not an N+1 per invitee.
    const inviteeBlock = service.slice(service.indexOf("const inviteeProfiles"), service.indexOf("const planIds"));
    expect(inviteeBlock.split('from("profiles")').length - 1).toBe(1);
  });

  it("uses the canonical avatar in every participant surface", () => {
    // Context line, picker rows and selected chips all read the same source.
    expect(composer).toContain("src={contextInvitee.avatarUrl ?? null}");
    expect(composer).toContain("icon: <UserAvatar src={invitee.avatarUrl ?? null}");
    expect(plans).toContain('<UserAvatar src={invitee.avatarUrl ?? null} name={invitee.name} size="xs" />');
  });

  it("leaves the fallback to the canonical component", () => {
    // UserAvatar owns the no-photo case; nothing here invents an image.
    expect(composer).not.toContain("placeholder.");
    expect(plans).toContain('from "@/components/ui/user-avatar"');
  });

  it("carries no proximity into the composer", () => {
    for (const leak of ["proximityLevel", "glowStrength", "latitude", "longitude", "geohash"]) {
      expect(composer).not.toContain(leak);
    }
  });
});

describe("a participant is a Muddy, not a subscription tier", () => {
  it("shows no premium badge among the people you are meeting", () => {
    /* Scoped to the composer's participant field. An open-ended slice ran on
     * into the plan DETAIL attendee list, which is a different surface and
     * explicitly out of scope for this task. */
    const participants = plans.slice(
      plans.indexOf("function InviteMuddiesField"),
      plans.indexOf("function PlanDetailsModal")
    );
    expect(participants).not.toContain("<PremiumPlanBadge");
  });

  /* The scoped removal became the general rule.
   *
   * This test used to assert the OPPOSITE -- that the detail and organiser
   * surfaces still carried the badge -- because the composer was the only
   * surface in scope at the time. Seeing the same tier beside a real invitee's
   * name in a real Plan settled it: the rule was never about the composer, it
   * was about not ranking the people you are meeting. The rule now lives in
   * plan-roster-semantics.test.ts, which owns every Plans surface. */
});

describe("the participant control says what it does next", () => {
  it("does not echo the selection it already renders below", () => {
    /* The trigger summarised the chosen names while the chips beneath
     * repeated them -- the control describing what is already on screen
     * instead of its remaining job. */
    expect(plans).toContain('placeholder={invitees.length === 0 ? "Add Muddies first" : "Add Muddy"}');
    expect(plans).toContain("alwaysShowPlaceholder");
  });

  it("leaves every other multi-select summarising as before", () => {
    const dropdown = stripComments(readFileSync("components/ui/app-dropdown.tsx", "utf8"));
    expect(dropdown).toContain("alwaysShowPlaceholder = false");
    expect(dropdown).toContain("alwaysShowPlaceholder || selected.length === 0");
  });

  it("keeps removal labelled for screen readers", () => {
    expect(plans).toContain("aria-label={`Remove ${invitee.name}`}");
  });
});

describe("a Plan may name a real meeting place", () => {
  it("drops the exact-address prohibition", () => {
    /* The rule Mad Buddy protects is that GLOW never exposes where a friend
     * is -- not that Muddies may never tell each other where to meet. */
    expect(plans).not.toContain("no exact addresses");
    expect(plans).not.toContain("Keep it general");
  });

  it("keeps Where optional and user-typed", () => {
    expect(composer).toContain('label="Where? (optional)"');
    expect(composer).toContain('placeholder="Café, cinema, campus…"');
    expect(composer).not.toContain("nearby area");
  });

  it("states the scope once, in the footer", () => {
    expect(plans).toContain("Only invited Muddies will see this plan.");
  });

  it("still prefills nothing and asks for no permission", () => {
    expect(plans).not.toContain("navigator.geolocation");
    expect(composer).toContain('const [placeText, setPlaceText] = useState("")');
  });
});

describe("the dialog does not open on its own exit", () => {
  const modal = stripComments(readFileSync("components/ui/modal.tsx", "utf8"));

  it("moves initial focus off the close button", () => {
    /* The orange ring was the FOCUS state: Radix focuses the first focusable
     * element, which is the close button, so every sheet opened highlighting
     * its exit. */
    expect(modal).toContain("onOpenAutoFocus");
    expect(modal).toContain("tabIndex={-1}");
  });

  it("suppresses no focus indication", () => {
    // The ring itself is correct and stays; only its initial target moved.
    expect(modal).not.toContain("focus:outline-none");
    const button = stripComments(readFileSync("components/ui/button.tsx", "utf8"));
    expect(button).toContain("focus-ring");
  });

  it("keeps the close control reachable and named", () => {
    expect(modal).toContain('aria-label="Close"');
    expect(modal).toContain("<Dialog.Close asChild>");
    expect(modal).toContain('size="icon"');
  });
});

describe("first value and milestones", () => {
  it("records the plan milestone only after canonical success", () => {
    /* Recorded by the job handler that runs off a created plan -- never on
     * opening the composer, typing, or abandoning it. */
    const handlers = readFileSync("lib/jobs/handlers.ts", "utf8");
    expect(handlers).toContain('recordMilestone(admin, actorId, "first_plan_created")');
    expect(plans).not.toContain("first_plan_created");
  });

  it("lets a real plan count as established usage", async () => {
    const { deriveHomeMaturity } = await import("@/lib/activation/home-maturity");
    expect(
      deriveHomeMaturity({
        milestones: new Set(["first_muddy_added", "first_plan_created"]),
        twoSidedConversationCount: 0,
        planParticipationCount: 1,
        muddyCount: 2
      })
    ).toBe("established");
  });

  it("does not invent a second milestone", () => {
    expect(plans).not.toContain("recordMilestone");
  });
});
