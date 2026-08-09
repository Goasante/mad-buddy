import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/content/strip-comments";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TRUSTED_MEMBER_MIN_PREMIUM_DAYS,
  TRUSTED_MEMBER_REQUIRED_JOURNEYS,
  canApplyForTrustedMember,
  premiumDaysSince,
  trustedMemberEligibility,
  trustedMemberStatusMessage
} from "@/lib/trust/trusted-member";
import { JOURNEY_STEP_IDS } from "@/lib/journey/journey";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260808220000_trusted_member_and_photos.sql");

const NOW = Date.parse("2026-08-08T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("the badge never claims an identity check", () => {
  it("is stored apart from account_verifications", () => {
    // That table models email, phone and institution checks — evidence that
    // someone IS who they say. This is a different claim, and storing them
    // together would blur the two.
    expect(migration).toContain("create table if not exists public.trusted_member_applications");
    expect(migration).not.toContain("alter table public.account_verifications");
  });

  it("says so in the column comment, where a future reader will look", () => {
    expect(migration).toContain("NOT an identity check");
  });

  it("is never named Verified anywhere in the rules", () => {
    // Premium must never imply identity verification.
    // Comments stripped: the doc block above the module explains WHY the
    // word is avoided, and matching that would be matching the explanation
    // rather than the code.
    const rules = stripComments(read("lib/trust/trusted-member.ts"));
    expect(rules).not.toContain("Verified");
    expect(trustedMemberStatusMessage("approved")).toBe("You're a Trusted Member.");
  });
});

describe("eligibility is earned, not bought", () => {
  it("requires a long premium tenure", () => {
    // Short enough to buy on Monday and wear on Friday would make it a
    // purchase with extra steps.
    expect(TRUSTED_MEMBER_MIN_PREMIUM_DAYS).toBeGreaterThanOrEqual(90);
  });

  it("requires every journey, not most of them", () => {
    expect(TRUSTED_MEMBER_REQUIRED_JOURNEYS).toBe(JOURNEY_STEP_IDS.length);
  });

  it("admits an account meeting both", () => {
    const result = trustedMemberEligibility({ premiumDays: 90, journeysComplete: 10 });
    expect(result.eligible).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("refuses one day short", () => {
    const result = trustedMemberEligibility({ premiumDays: 89, journeysComplete: 10 });
    expect(result.eligible).toBe(false);
    expect(result.missing[0]).toContain("1 more day");
  });

  it("refuses one journey short, however long the tenure", () => {
    const result = trustedMemberEligibility({ premiumDays: 3650, journeysComplete: 9 });
    expect(result.eligible).toBe(false);
    expect(result.missing[0]).toContain("1 more journey");
  });

  it("lists everything missing, so the path is visible", () => {
    const result = trustedMemberEligibility({ premiumDays: 10, journeysComplete: 2 });
    expect(result.missing).toHaveLength(2);
  });
});

describe("premium tenure is floored", () => {
  it("counts whole days only", () => {
    // 89.9 days in is not 90 days, and rounding up lets an afternoon cross
    // the threshold.
    expect(premiumDaysSince(daysAgo(89.9), NOW)).toBe(89);
    expect(premiumDaysSince(daysAgo(90), NOW)).toBe(90);
  });

  it("treats a missing or future start as zero", () => {
    expect(premiumDaysSince(null, NOW)).toBe(0);
    expect(premiumDaysSince(daysAgo(-5), NOW)).toBe(0);
    expect(premiumDaysSince("not-a-date", NOW)).toBe(0);
  });
});

describe("applying", () => {
  it("needs eligibility first", () => {
    expect(canApplyForTrustedMember({ eligible: false, existingStatus: null })).toBe(false);
  });

  it("blocks a second application while one is pending", () => {
    // The queue is a queue, not a way to ask louder.
    expect(canApplyForTrustedMember({ eligible: true, existingStatus: "pending" })).toBe(false);
  });

  it("has nothing left to ask once approved", () => {
    expect(canApplyForTrustedMember({ eligible: true, existingStatus: "approved" })).toBe(false);
  });

  it("lets a declined or revoked member try again", () => {
    // People change; a permanent refusal for a reversible reason would be its
    // own unfairness.
    expect(canApplyForTrustedMember({ eligible: true, existingStatus: "declined" })).toBe(true);
    expect(canApplyForTrustedMember({ eligible: true, existingStatus: "revoked" })).toBe(true);
  });

  it("keeps one row per person", () => {
    expect(migration).toContain("unique (user_id)");
  });
});

describe("the applicant cannot approve themselves", () => {
  it("grants insert but never update", () => {
    // Status, reviewer and note are staff decisions. A policy letting the
    // subject write them would make the badge self-granted.
    expect(migration).toContain('create policy "own trusted application insertable"');
    expect(migration).not.toContain('create policy "own trusted application updatable"');
  });

  it("pins new applications to pending", () => {
    expect(migration).toMatch(/with check \(auth\.uid\(\) = user_id and status = 'pending'\)/);
  });
});

describe("what the applicant is told", () => {
  it("reports the outcome without the reasoning", () => {
    // Staff record why for each other. "Declined because we suspect X" turns
    // a moderation decision into an argument.
    expect(trustedMemberStatusMessage("declined")).not.toContain("because");
    expect(trustedMemberStatusMessage("declined")).toContain("apply again");
  });

  it("says nothing at all when there is no application", () => {
    expect(trustedMemberStatusMessage(null)).toBeNull();
  });
});

describe("the review record explains itself later", () => {
  it("captures what was true at the moment of applying", () => {
    // A reviewer weeks later must see what the applicant qualified on, not a
    // fresh reading that may have drifted.
    expect(migration).toContain("premium_days_at_apply");
    expect(migration).toContain("journeys_complete_at_apply");
  });
});

describe("review is a staff decision, recorded", () => {
  const adminActions = stripComments(read("app/(admin)/admin/actions.ts"));
  const decide = adminActions.slice(adminActions.indexOf("export async function decideTrustedMemberAction"));
  const service = stripComments(read("lib/trust/trusted-member-admin.ts"));

  it("reuses the existing review permission rather than inventing one", () => {
    // admin.verification.review already means "may judge an account's
    // standing"; a new permission would be a second name for it.
    expect(decide).toContain('requireAdminPermission(admin, context, "admin.verification.review")');
  });

  it("requires a note to decline or revoke, but not to approve", () => {
    // Staff need to know why somebody was turned down, especially before a
    // second application. An approval speaks for itself.
    expect(adminActions).toContain('value.decision === "approved" || (value.reviewNote?.trim().length ?? 0) >= 3');
  });

  it("never shows the reviewer's note to the applicant", () => {
    const rules = stripComments(read("lib/trust/trusted-member.ts"));
    expect(rules).not.toContain("review_note");
    expect(rules).not.toContain("reviewNote");
  });

  it("writes the badge and the decision together", () => {
    expect(service).toContain("trusted_member_since: input.decision === \"approved\" ? nowIso : null");
  });

  it("rolls the decision back if the badge cannot be written", () => {
    // Otherwise the queue says one thing and the profile another.
    expect(service).toContain("Nothing was changed.");
  });

  it("keeps decided applications in the queue as history", () => {
    // How a reviewer sees somebody was declined twice before.
    expect(service).toContain('if (filter === "pending") query = query.eq("status", "pending")');
  });

  it("reviews the longest wait first", () => {
    expect(service).toContain('.order("created_at", { ascending: true })');
  });

  it("audits every decision", () => {
    expect(decide).toContain("recordAdminAuditEvent");
    expect(decide).toContain("trusted_member_${parsed.data.decision}");
  });
});

describe("direct admin recognition", () => {
  const userActions = stripComments(read("app/(admin)/admin/users/actions.ts"));
  const userPage = stripComments(read("app/(admin)/admin/users/page.tsx"));
  const controls = stripComments(read("components/admin/admin-user-controls.tsx"));
  const service = stripComments(read("lib/trust/trusted-member-admin.ts"));
  const governance = stripComments(read("lib/admin/governance.ts"));

  it("gives trust and safety admins the existing review permission", () => {
    const role = governance.slice(
      governance.indexOf("trust_safety_administrator:"),
      governance.indexOf("customer_support_agent:")
    );
    expect(role).toContain('"admin.verification.review"');
  });

  it("does not grant the permission to support", () => {
    const role = governance.slice(
      governance.indexOf("customer_support_agent:"),
      governance.indexOf("billing_support_agent:")
    );
    expect(role).not.toContain('"admin.verification.review"');
  });

  it("enforces permission and blocks self-recognition on the server", () => {
    expect(userActions).toContain('requireAdminPermission(admin, context, "admin.verification.review")');
    expect(userActions).toContain("parsed.data.userId === context.userId");
  });

  it("uses the canonical badge and preserves the permanent review history", () => {
    expect(service).toContain('.from("trusted_member_applications")');
    expect(service).toContain("trusted_member_since: input.trusted ? nowIso : null");
    expect(service).toContain('status = input.trusted ? "approved" : "revoked"');
  });

  it("requires a reason and audits grants and removals", () => {
    expect(userActions).toContain("reason: z.string().trim().min(3).max(500)");
    expect(userActions).toContain("trusted_member_staff_granted");
    expect(userActions).toContain("trusted_member_staff_revoked");
    expect(userActions).toContain("recordAdminAuditEvent");
  });

  it("shows the current mark and only exposes controls to authorised staff", () => {
    expect(userPage).toContain("trusted_member_since");
    expect(userPage).toContain("<TrustedMemberMark");
    expect(userPage).toContain('access.permissions.has("admin.verification.review")');
    expect(controls).toContain("Grant Trusted Member");
    expect(controls).toContain("Remove Trusted Member");
  });
});

describe("tenure stops accruing when premium lapses", () => {
  it("counts days only while the subscription is active", () => {
    // Otherwise a cancelled subscriber keeps earning standing they are no
    // longer paying for.
    const actions = stripComments(read("app/(app)/trusted-member-actions.ts"));
    expect(actions).toContain('subscription.status === "active"');
  });

  it("recomputes eligibility at submit rather than trusting the client", () => {
    const actions = stripComments(read("app/(app)/trusted-member-actions.ts"));
    expect(actions).toContain("const standing = await getTrustedMemberStandingAction()");
  });
});

describe("the mark on Linkr discovery cards", () => {
  const deck = stripComments(read("components/socialize/swipe-deck.tsx"));
  const projection = stripComments(read("lib/social/socialize-mobile.ts"));
  const css = read("app/globals.css");
  const mark = stripComments(read("components/trust/trusted-member-mark.tsx"));

  it("reuses the one canonical mark component", () => {
    expect(deck).toContain('import { TrustedMemberMark } from "@/components/trust/trusted-member-mark"');
  });

  it("sits beside the name, not as its own pill or banner", () => {
    const nameRow = deck.slice(deck.indexOf("linkr-deck-name"), deck.indexOf("linkr-deck-note"));
    expect(nameRow).toContain("<TrustedMemberMark");
  });

  it("keeps premium and Trusted Member as separate signals", () => {
    // One is a plan someone pays for; the other is standing they earned.
    // Merging them into a single badge would make the first imply the second.
    const nameRow = deck.slice(deck.indexOf("linkr-deck-name"), deck.indexOf("linkr-deck-note"));
    expect(nameRow).toContain("<PremiumPlanBadge");
    expect(nameRow).toContain("<TrustedMemberMark");
  });

  it("renders compact, so it stays quieter than the name", () => {
    expect(deck).toContain("<TrustedMemberMark trustedSince={person.trustedSince} compact />");
  });

  it("comes from the server projection, never inferred on the client", () => {
    expect(projection).toContain("trustedSince:");
    expect(projection).toContain("trusted_member_since");
    // Never derived from plan, tenure or anything the client can see.
    expect(deck).not.toMatch(/trusted[A-Za-z]*\s*=\s*.*plan/);
  });

  it("adds no query: the profiles read was already batched", () => {
    // A card-level lookup would be one query per person shown.
    expect(projection).toContain(
      '.select("user_id, full_name, username, avatar_url, visibility_status, trusted_member_since")'
    );
  });

  it("never calls itself Verified, and says what it means", () => {
    expect(mark).toContain('aria-label="Trusted Member"');
    expect(mark).not.toContain("Verified");
    expect(mark).not.toContain("identity");
  });

  it("survives a long name beside both badges on a narrow card", () => {
    // The name yields and the marks hold: a half-rendered badge reads as a
    // glitch, a truncated name reads as a long name.
    const rule = css.slice(css.indexOf(".linkr-deck-name > :first-child"));
    expect(rule.slice(0, 300)).toContain("text-overflow: ellipsis");
    const shrink = css.slice(css.indexOf(".linkr-deck-name .premium-plan-badge"));
    expect(shrink.slice(0, 200)).toContain("flex-shrink: 0");
  });

  it("does not change how cards are ordered", () => {
    // Standing is not rank. The feed sorts on proximity and recency only.
    expect(projection).not.toMatch(/sort[\s\S]{0,120}trusted/i);
  });
});
