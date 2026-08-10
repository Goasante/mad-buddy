import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { hasVerifiedAccountStatus, type VerificationRow } from "@/lib/trust/verified-account";

/**
 * Verified Account, across every identity surface.
 *
 * THREE INDEPENDENT SIGNALS, and the tests below exist mostly to keep them
 * that way:
 *
 *   Verified Account -- Mad Buddy verified this account.
 *   Trusted Member   -- standing earned in the product.
 *   Premium          -- a paid plan.
 *
 * Any combination is possible. The failure this guards against is one of them
 * quietly starting to imply another -- a Pro subscriber rendering as verified,
 * or an approved Trusted Member inheriting a verification they never went
 * through.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const mark = stripComments(read("components/trust/verified-account-mark.tsx"));
const source = stripComments(read("lib/trust/verified-account.ts"));
const searchService = stripComments(read("lib/friends/service.ts"));
const profileProjection = stripComments(read("lib/profile/public.ts"));
const linkrProjection = stripComments(read("lib/social/socialize-mobile.ts"));
const messaging = stripComments(read("lib/messaging/mobile.ts"));
const groupActions = stripComments(read("app/(app)/group-actions.ts"));
const profilePage = stripComments(read("components/friends/muddy-profile-page.tsx"));
const linkrCard = stripComments(read("components/socialize/socialize-person-card.tsx"));
const muddiesGrid = stripComments(read("components/friends/muddies-grid.tsx"));
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));
const messagesPage = stripComments(read("components/messages/messages-page.tsx"));

// ---------------------------------------------------------------------------
// The canonical source
// ---------------------------------------------------------------------------

describe("verification comes from one server-authoritative place", () => {
  it("counts only an actually verified row", () => {
    const cases: Array<[VerificationRow["status"], boolean]> = [
      ["verified", true],
      ["pending", false],
      ["failed", false],
      ["expired", false],
      ["revoked", false]
    ];
    for (const [status, expected] of cases) {
      expect(hasVerifiedAccountStatus([{ status }]), `${status} should be ${expected}`).toBe(expected);
    }
  });

  it("treats absence as unverified", () => {
    // Fails closed: no rows, null, undefined and an empty list all mean "not
    // verified", never "unknown, assume yes".
    expect(hasVerifiedAccountStatus([])).toBe(false);
    expect(hasVerifiedAccountStatus(null)).toBe(false);
    expect(hasVerifiedAccountStatus(undefined)).toBe(false);
  });

  it("verifies when any row qualifies", () => {
    // An account may hold several attempts; one success is enough.
    expect(hasVerifiedAccountStatus([{ status: "failed" }, { status: "verified" }])).toBe(true);
  });

  it("exposes no verification evidence", () => {
    // Documents, reviewer notes and provider detail must never reach a client.
    for (const forbidden of ["evidence_label", "provider", "review_note", "reviewed_by"]) {
      expect(source, `must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Independence -- the point of the whole file
// ---------------------------------------------------------------------------

describe("verification is never inferred from something else", () => {
  it("does not read plan, tenure, journeys or badges", () => {
    for (const forbidden of ["plan", "trusted_member_since", "journey", "premium", "subscription"]) {
      expect(source.toLowerCase(), `verification must not consider ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("renders from its own prop, not from plan or standing", () => {
    // The mark takes a boolean that only the verification source can produce.
    expect(mark).toContain("isVerifiedAccount");
    expect(mark).not.toContain("plan");
    expect(mark).not.toContain("trustedSince");
  });

  it("keeps three separate marks on the surfaces that show all three", () => {
    // If these ever collapsed into one component, one signal would start
    // implying the others.
    for (const [name, surface] of [
      ["profile", profilePage],
      ["group member list", groupPage]
    ] as const) {
      expect(surface, `${name} needs the verified mark`).toContain("<VerifiedAccountMark");
      expect(surface, `${name} needs the trusted mark`).toContain("<TrustedMemberMark");
      expect(surface, `${name} needs the premium badge`).toContain("<PremiumPlanBadge");
    }
  });

  it("does not let Trusted Member imply verification", () => {
    // The trusted mark is driven by trusted_member_since; the verified mark by
    // account_verifications. Neither reads the other's input.
    const trustedMark = stripComments(read("components/trust/trusted-member-mark.tsx"));
    expect(trustedMark).not.toContain("isVerifiedAccount");
    expect(trustedMark).not.toContain("account_verifications");
  });

  it("does not let Premium imply verification", () => {
    const premium = stripComments(read("components/premium/premium-plan-badge.tsx"));
    expect(premium).not.toContain("isVerifiedAccount");
    expect(premium).not.toContain("verified");
  });
});

// ---------------------------------------------------------------------------
// The badge itself
// ---------------------------------------------------------------------------

describe("the mark looks like Mad Buddy", () => {
  it("is a hand-drawn seal, not a borrowed icon", () => {
    // A generic check-circle reads as every other social product's badge.
    expect(mark).toContain("<svg");
    expect(mark).not.toContain("lucide-react");
    expect(mark).not.toContain("BadgeCheck");
  });

  it("uses the orange seal and gold crown rather than a blue check", () => {
    // Blue is the convention this deliberately avoids.
    expect(mark).toContain("#F97316");
    expect(mark).toContain("#FBBF24");
    expect(mark).not.toContain("sky-500");
    expect(mark).not.toContain("sky-400");
  });

  it("carries the seal, ring, crown and check as real geometry", () => {
    // Asserted on the DRAWING, not on comment text -- stripComments removes
    // the commentary, so naming the parts there would prove nothing.
    expect(mark, "seal silhouette").toContain("SEAL_PATH");
    // Two circles: the inner seal face and the gold ring that separates this
    // from a plain orange dot at small sizes.
    expect((mark.match(/<circle/g) ?? []).length, "ring, face and crown orbs").toBeGreaterThanOrEqual(4);
    // Three <path> elements: seal, crown, check.
    expect((mark.match(/<path/g) ?? []).length, "seal, crown and check paths").toBeGreaterThanOrEqual(3);
    expect(mark, "white check").toContain("CHECK");
  });

  it("renders nothing when the account is not verified", () => {
    // No placeholder, no reserved space, no caller needing to branch.
    expect(mark).toContain("if (!isVerifiedAccount) return null");
  });

  it("stays legible at inline size", () => {
    // Defaults land in the 14-20px band the spec asks for.
    expect(mark).toContain("compact ? 16 : 18");
  });

  it("uses no emoji", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(mark)).toBe(false);
  });
});

describe("the mark is announced correctly", () => {
  it("names itself for assistive tech when compact", () => {
    // The compact mark is a real button now rather than a labelled span, so
    // the label also says the explanation is reachable.
    expect(mark).toContain('aria-label="Verified account. Tap for details."');
  });

  it("explains itself by tap, not only by hover", () => {
    // A title attribute needs a hover, which a phone cannot produce -- so on
    // mobile the mark was previously unexplained.
    expect(mark).toContain("Popover.Root");
    expect(mark).toContain('type="button"');
    expect(mark).toContain("Mad Buddy has verified this account.");
  });

  it("does not trigger the row it sits inside", () => {
    // The mark frequently sits in a card that navigates on tap; without this,
    // explaining the badge would open somebody's profile instead.
    expect(mark).toContain("event.preventDefault()");
    expect(mark).toContain("event.stopPropagation()");
  });

  it("does not announce twice when a visible label is present", () => {
    // The glyph is aria-hidden; the wording carries the meaning.
    expect(mark).toContain('aria-hidden="true"');
  });

  it("explains what verification means without overclaiming", () => {
    expect(mark).toContain("Mad Buddy has verified this account.");
    // Never "safe", "trusted" or "official" -- different claims entirely.
    expect(mark.toLowerCase()).not.toContain("official");
    expect(mark.toLowerCase()).not.toContain("government");
  });
});

// ---------------------------------------------------------------------------
// Surface coverage
// ---------------------------------------------------------------------------

describe("every identity surface carries the mark", () => {
  it("renders on the full profile", () => {
    expect(profilePage).toContain("<VerifiedAccountMark isVerifiedAccount={muddy.isVerifiedAccount} compact />");
  });

  it("renders on Linkr cards", () => {
    expect(linkrCard).toContain("<VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount} compact />");
  });

  it("renders on Muddies cards", () => {
    expect(muddiesGrid).toContain("<VerifiedAccountMark");
  });

  it("renders on the group member list", () => {
    expect(groupPage).toContain("<VerifiedAccountMark isVerifiedAccount={member.isVerifiedAccount} compact />");
  });

  it("renders on group message sender identity", () => {
    expect(groupPage).toContain("<VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />");
  });

  it("renders on DM identity, not on every bubble", () => {
    // The other person does not change between messages; stating it once at
    // the identity surface says everything repeating it would.
    expect(messagesPage).toContain(
      "<VerifiedAccountMark isVerifiedAccount={conversation.otherIsVerifiedAccount} compact />"
    );
    expect(messagesPage.match(/<VerifiedAccountMark/g) ?? []).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// No N+1
// ---------------------------------------------------------------------------

describe("verification never costs a query per row", () => {
  it("batches the search projection", () => {
    // Ten results must not become ten verification reads.
    expect(searchService).toContain('.from("account_verifications").select("user_id, status").in("user_id", resultIds)');
    expect(searchService).toContain("Promise.all([");
  });

  it("batches the Linkr projection", () => {
    expect(linkrProjection).toContain('from("account_verifications")');
    expect(linkrProjection).toContain("verificationByUserId");
  });

  it("batches the messaging sender projection", () => {
    expect(messaging).toContain("verificationBySenderId");
    expect(messaging).toContain('.in("user_id", senderIds)');
  });

  it("batches the group member projection", () => {
    expect(groupActions).toContain('.in("user_id", memberIds)');
    expect(groupActions).toContain("verificationByUserId");
  });

  it("reads verification inside an existing batch on the profile", () => {
    // Folded into the Promise.all that already loads relationship and plan.
    const batch = profileProjection.slice(profileProjection.indexOf("await Promise.all(["));
    expect(batch.slice(0, 500)).toContain("account_verifications");
  });
});

// ---------------------------------------------------------------------------
// Ranking and ordering are untouched
// ---------------------------------------------------------------------------

describe("verification never buys position", () => {
  it("does not affect search result ordering", () => {
    // Annotates whoever was already going to appear, in the order they
    // already appeared.
    const ordering = searchService.slice(searchService.indexOf("export async function searchUsers"));
    expect(ordering).not.toContain("sort((a, b) => Number(b.isVerifiedAccount)");
    expect(ordering).not.toContain("orderBy(\"isVerifiedAccount\")");
  });

  it("does not affect group member ordering", () => {
    const presentation = stripComments(read("lib/groups/member-presentation.ts"));
    expect(presentation).not.toContain("isVerifiedAccount");
    expect(presentation).not.toContain("verified");
  });

  it("does not affect Linkr ranking", () => {
    expect(linkrProjection).not.toContain("order(\"isVerifiedAccount\"");
  });

  it("does not affect group roles or permissions", () => {
    // Owner/Admin/Member is authority; verification is identity.
    expect(groupActions).not.toContain("isVerifiedAccount ? \"admin\"");
    expect(groupActions).not.toContain("verified && role");
  });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

describe("a client cannot grant itself verification", () => {
  it("never writes to account_verifications from product code", () => {
    // The only policy on that table is an owner SELECT; there is no write
    // policy at all, so a client write fails at the database. Nothing in the
    // surfaces below should be attempting one either.
    for (const [name, surface] of [
      ["search", searchService],
      ["profile", profileProjection],
      ["linkr", linkrProjection],
      ["messaging", messaging],
      ["groups", groupActions]
    ] as const) {
      expect(surface, `${name} must not insert verification`).not.toContain(
        'from("account_verifications").insert'
      );
      expect(surface, `${name} must not update verification`).not.toContain(
        'from("account_verifications").update'
      );
      expect(surface, `${name} must not upsert verification`).not.toContain(
        'from("account_verifications").upsert'
      );
    }
  });

  it("keeps the mark presentational, with no write path of its own", () => {
    expect(mark).not.toContain("supabase");
    expect(mark).not.toContain("fetch(");
    expect(mark).not.toContain("action");
  });
});

// ---------------------------------------------------------------------------
// The admin path
// ---------------------------------------------------------------------------

describe("verification can be granted without hand-written SQL", () => {
  const adminService = stripComments(read("lib/trust/verified-account-admin.ts"));
  const adminAction = stripComments(read("app/(admin)/admin/actions.ts"));
  const adminPage = stripComments(read("app/(admin)/admin/verifications/page.tsx"));
  const controls = stripComments(read("components/admin/verification-controls.tsx"));

  it("requires the verification permission", () => {
    const action = adminAction.slice(adminAction.indexOf("decideAccountVerificationAction"));
    expect(action.slice(0, 1200)).toContain('requireAdminPermission(admin, context, "admin.verification.review")');
  });

  it("checks that permission at the page too", () => {
    // So the queue is not even rendered to someone who could not act on it.
    expect(adminPage).toContain('access.permissions.has("admin.verification.review")');
    expect(adminPage).toContain('redirect("/admin")');
  });

  it("records an audit entry for every decision", () => {
    const action = adminAction.slice(adminAction.indexOf("decideAccountVerificationAction"));
    expect(action.slice(0, 2000)).toContain("recordAdminAuditEvent");
    expect(action.slice(0, 2000)).toContain("account_verification_${parsed.data.decision}");
  });

  it("records what changed, not only where it landed", () => {
    const action = adminAction.slice(adminAction.indexOf("decideAccountVerificationAction"));
    expect(action.slice(0, 2000)).toContain("getAccountVerification");
    expect(action.slice(0, 2000)).toContain("previousState");
  });

  it("rate limits admin mutations", () => {
    const action = adminAction.slice(adminAction.indexOf("decideAccountVerificationAction"));
    expect(action.slice(0, 1200)).toContain('consumeRateLimit({ action: "admin.mutate"');
  });

  it("requires a note saying what was checked before verifying", () => {
    // Otherwise nothing records WHY an account carries the badge.
    expect(adminAction).toContain('value.decision !== "verified" || (value.evidenceLabel?.trim().length ?? 0) >= 3');
  });

  it("stores a label, never the evidence itself", () => {
    // Documents must not live on a row any reviewer can browse.
    expect(adminAction).toContain("z.string().trim().max(120).optional()");
    expect(adminService).not.toContain("document");
    expect(adminService).not.toContain("upload");
  });

  it("keeps one record per account, so revoking really revokes", () => {
    // Upserting on the unique key means there is no older verified row left
    // behind for hasVerifiedAccountStatus to find.
    expect(adminService).toContain('{ onConflict: "user_id,verification_type" }');
    expect(adminService).toContain('verified_at: decision === "verified" ? now : null');
  });

  it("needs two taps to verify someone", () => {
    // A single-tap approve on a queue is one mis-tap from an unreviewed badge.
    expect(controls).toContain('useState<Pending>(null)');
    expect(controls).toContain("Confirm ");
  });

  it("stays separate from the Trusted Member queue", () => {
    // One action covering both would be the first step towards one implying
    // the other.
    expect(adminService).not.toContain("trusted_member");
    expect(adminPage).not.toContain("TrustedMemberControls");
  });

  it("keeps the write server-side", () => {
    expect(read("lib/trust/verified-account-admin.ts")).toContain('import "server-only"');
  });

  it("batches the profile read for the queue", () => {
    expect(adminService).toContain('.in("user_id", userIds)');
  });
});
