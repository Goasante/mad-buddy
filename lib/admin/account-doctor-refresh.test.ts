import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const route = source("app/api/account/support-refresh/route.ts");
const boundary = source("components/auth/session-boundary.tsx");
const doctorActions = source("app/(admin)/admin/repairs/doctor-actions.ts");
const supportDetail = source("app/(admin)/admin/support/[issueId]/page.tsx");
const repairsPage = source("app/(admin)/admin/repairs/page.tsx");

describe("Account Doctor refresh signal", () => {
  it("is self-scoped to the authenticated user and accepts no target user parameter", () => {
    /* The helper split renamed this. These are PRIVILEGED paths, so the
       assertion is strengthened rather than merely renamed: they must use
       the AUTHORITATIVE record, which notices a global sign-out or a
       deleted account, never the fast identity path. */
    expect(route).toContain("const user = await getCurrentUserRecord()");
    expect(route).not.toContain("getCurrentIdentity");
    expect(route).toContain('.eq("target_id", user.id)');
    expect(route).not.toContain("searchParams");
    expect(route).not.toContain("request.url");
  });

  it("returns only an opaque version, never audit content", () => {
    expect(route).toContain('.select("id, created_at")');
    expect(route).not.toContain("reason,");
    expect(route).not.toContain("actor_id");
    expect(route).not.toContain("new_state");
    expect(route).not.toContain("previous_state");
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
  });

  it("uses an audited no-data-mutation signal from Admin", () => {
    const signalStart = doctorActions.indexOf("export async function signalAccountRefreshAction");
    const signalBody = doctorActions.slice(signalStart, doctorActions.indexOf("function otherUserFromDirectKey", signalStart));
    expect(signalBody).toContain('action: "repair:refresh_account_state"');
    expect(signalBody).toContain("recordAdminAuditEvent");
    expect(signalBody).not.toContain('.update(');
    expect(signalBody).not.toContain('.delete(');
    expect(signalBody).not.toContain('.insert(');
  });

  it("refreshes only after a post-baseline version change", () => {
    expect(boundary).toContain("previousVersion !== undefined && nextVersion && nextVersion !== previousVersion");
    expect(boundary).toContain("router.refresh()");
    expect(boundary).toContain('window.addEventListener("focus"');
    expect(boundary).toContain('document.addEventListener("visibilitychange"');
    expect(boundary).toContain("60_000");
  });
});

describe("Support to Account Doctor handoff", () => {
  it("offers diagnosis from a user-backed support issue", () => {
    expect(supportDetail).toContain("Diagnose account");
    expect(supportDetail).toContain("/admin/repairs?q=");
    expect(supportDetail).toContain("encodeURIComponent(userSummary.username)");
  });

  it("sanitizes the prefilled search query before rendering the repair client", () => {
    expect(repairsPage).toContain('replace(/[,%()]/g, "")');
    expect(repairsPage).toContain("initialQuery={initialQuery}");
  });
});
