import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const declaration = (code: string, signature: string) => {
  const start = code.indexOf(signature);
  if (start < 0) throw new Error(`missing ${signature}`);
  const next = code.indexOf("\nexport ", start + signature.length);
  return code.slice(start, next < 0 ? code.length : next);
};

describe("Add Muddy request badge", () => {
  const service = read("lib/friends/service.ts");
  const count = declaration(service, "export async function countIncomingRequests");

  it("counts only requests sent TO the user", () => {
    expect(count).toContain('.eq("receiver_id", userId)');
    expect(count).not.toContain('.eq("sender_id", userId)');
  });

  it("counts only pending requests, so accepted and declined drop off", () => {
    expect(count).toContain('.eq("status", "pending")');
  });

  it("uses the same predicate as the Requests tab, so the two cannot disagree", () => {
    const list = declaration(service, "export async function listIncomingRequests");
    for (const predicate of ['.eq("receiver_id", userId)', '.eq("status", "pending")']) {
      expect(list).toContain(predicate);
      expect(count).toContain(predicate);
    }
  });

  it("reads friend_requests only — never notifications or messages", () => {
    expect(count).toContain('.from("friend_requests")');
    for (const table of ["notifications", "messages", "conversations", "friend_suggestions"]) {
      expect(count, `badge must not read ${table}`).not.toContain(`"${table}"`);
    }
  });

  it("is a head-only count, not a full row fetch", () => {
    expect(count).toContain("head: true");
    expect(count).toContain('count: "exact"');
  });

  it("returns zero instead of throwing, so a badge cannot break Home", () => {
    expect(count).toContain("return error ? 0 : count ?? 0;");
  });
});

describe("Add Muddy header control", () => {
  // The control lives in the shared mobile header now, not inline on Home,
  // so every primary screen renders an identical one.
  const header = read("components/app-shell/mobile-page-header.tsx");

  it("takes the count from the server, never a hardcoded number", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).toContain("incomingRequestCount={incomingRequestCount}");
    expect(header).toContain("incomingRequestCount");
    const page = read("app/(app)/dashboard/page.tsx");
    expect(page).toContain("countIncomingRequests(user.id)");
  });

  it("hides the badge at zero and caps the display at 9+", () => {
    expect(header).toContain("const hasRequests = incomingRequestCount > 0;");
    // The cap now lives in the shared HeaderBadge, used by both the Add Muddy
    // and Notifications badges so the two can never format differently.
    expect(header).toContain('count > 9 ? "9+" : count');
    expect(header).toContain("<HeaderBadge count={incomingRequestCount} />");
  });

  it("routes to the existing Muddies requests experience", () => {
    // No new destination: /friends already owns requests, accept/decline,
    // search, send and invite.
    expect(header).toContain('href="/friends?tab=requests"');
  });

  it("announces the pending count to screen readers", () => {
    expect(header).toContain("pending ${incomingRequestCount === 1 ? \"request\" : \"requests\"}");
  });
});
