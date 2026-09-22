import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Linkr rewind request reporting", () => {
  it("keeps a persistent user-facing request history inside Linkr", () => {
    const service = read("lib/linkr/collections-service.ts");
    const actions = read("app/(app)/linkr-actions.ts");
    const settings = read("components/linkr/linkr-settings.tsx");
    expect(service).toContain('diagnostics->>workflow", "linkr_pass_reversal"');
    expect(service).toContain("loadLinkrRewindRequests");
    expect(actions).toContain("loadLinkrRewindRequestsAction");
    expect(settings).toContain("Rewind requests");
    expect(settings).toContain("Admin decisions stay visible here");
  });

  it("gives admins an obvious dedicated Linkr request queue", () => {
    const shell = read("components/admin/admin-shell.tsx");
    const page = read("app/(admin)/admin/linkr-requests/page.tsx");
    expect(shell).toContain('href: "/admin/linkr-requests"');
    expect(shell).toContain('label: "Linkr requests"');
    expect(page).toContain('diagnostics->>workflow", "linkr_pass_reversal"');
    expect(page).toContain("Review request");
  });

  it("writes the review outcome into the existing support conversation", () => {
    const review = read("app/(admin)/admin/support/linkr-reversal-actions.ts");
    expect(review).toContain('.from("support_ticket_messages")');
    expect(review).toContain('sender_type: "agent"');
    expect(review).toContain("Your Linkr rewind was approved");
    expect(review).toContain("was not approved");
  });
});
