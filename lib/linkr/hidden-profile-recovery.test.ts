import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Linkr hidden-profile recovery", () => {
  it("keeps permanent hides separate from account blocks", () => {
    const service = read("lib/linkr/collections-service.ts");
    const settings = read("components/linkr/linkr-settings.tsx");
    expect(service).toContain('.eq("action", "pass")');
    expect(service).toContain('.is("expires_at", null)');
    expect(settings).toContain("Hidden profiles");
    expect(settings).toContain("Blocked people");
    expect(settings).toContain("Show again");
  });

  it("restores only the viewer-owned permanent pass", () => {
    const service = read("lib/linkr/connection-service.ts");
    expect(service).toContain("export async function restoreHiddenProfile");
    expect(service).toContain('.eq("actor_id", viewerId)');
    expect(service).toContain('.eq("target_id", parsed.data)');
    expect(service).toContain('.eq("action", "pass")');
    expect(service).toContain('.is("expires_at", null)');
  });

  it("keeps undo reachable when the deck is empty", () => {
    const page = read("components/linkr/linkr-page.tsx");
    expect(page).toContain("Undo last pass");
    expect(page).toContain("<LinkrEmptyState");
    expect(page).toMatch(/LinkrEmptyState[\s\S]*canUndo[\s\S]*Undo last pass/);
  });
});
