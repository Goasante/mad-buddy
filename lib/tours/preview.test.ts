import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeTourPreview,
  encodeTourPreview,
  isValidPreviewReturnPath,
  TOUR_PREVIEW_COOKIE,
  TOUR_PREVIEW_MAX_AGE_SECONDS
} from "@/lib/tours/preview";

const ROOT = join(__dirname, "..", "..");
const VERSION = "6ff7bdc0-8ab5-4a00-843c-98bfca165de8";

describe("preview session encoding", () => {
  it("round-trips a valid session", () => {
    const session = { versionId: VERSION, returnTo: "/admin/tours/abc" };
    expect(decodeTourPreview(encodeTourPreview(session))).toEqual(session);
  });

  it("rejects a tampered or malformed cookie instead of throwing", () => {
    for (const bad of [
      undefined,
      "",
      "no-separator",
      "not-a-uuid|/admin/tours/abc",
      `${VERSION}`,
      `${VERSION}|`
    ]) {
      expect(decodeTourPreview(bad)).toBeNull();
    }
  });

  it("refuses a return path that could leave the admin area", () => {
    // A tampered cookie must not be able to turn Exit preview into an open
    // redirect or a traversal.
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/dashboard",
      "/admin/../dashboard",
      "/settings/walkthrough"
    ]) {
      expect(decodeTourPreview(`${VERSION}|${bad}`)).toBeNull();
      expect(isValidPreviewReturnPath(bad)).toBe(false);
    }
    expect(isValidPreviewReturnPath("/admin/tours/abc")).toBe(true);
  });

  it("keeps the session short lived", () => {
    expect(TOUR_PREVIEW_MAX_AGE_SECONDS).toBeGreaterThan(0);
    expect(TOUR_PREVIEW_MAX_AGE_SECONDS).toBeLessThanOrEqual(60 * 60);
  });
});

describe("preview is permission gated, not cookie gated", () => {
  const previewService = readFileSync(join(ROOT, "lib/tours/preview-service.ts"), "utf8");
  const previewActions = readFileSync(join(ROOT, "app/(admin)/admin/tours/preview-actions.ts"), "utf8");

  it("checks admin.tours.manage before reading any draft", () => {
    expect(previewService).toContain('access.permissions.has("admin.tours.manage")');
    // The permission check must precede the draft query, so possessing the
    // cookie alone reveals nothing.
    const gate = previewService.indexOf("canPreviewTours()");
    const query = previewService.indexOf('.from("tour_versions")');
    expect(gate).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(gate);
  });

  it("re-checks the permission when starting a preview session", () => {
    expect(previewActions).toContain("canPreviewTours()");
  });

  it("stores the session in an httpOnly cookie so page scripts cannot forge it", () => {
    expect(previewActions).toContain("httpOnly: true");
    // Uses the shared constant rather than a duplicated literal, so the cookie
    // name cannot drift between the writer and the reader.
    expect(previewActions).toContain("TOUR_PREVIEW_COOKIE");
    expect(TOUR_PREVIEW_COOKIE).toBe("mb_tour_preview");
  });
});

describe("draft content cannot leak to consumers", () => {
  it("the consumer loader only ever reads published versions", () => {
    const service = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");
    expect(service).toContain('.eq("status", "published")');
    // The consumer path must not reference the preview loader at all.
    expect(service).not.toContain("loadTourForPreview");
  });

  it("RLS exposes only published versions to authenticated users", () => {
    const migration = readFileSync(
      join(ROOT, "supabase/migrations/20260729120000_guided_product_tours.sql"),
      "utf8"
    );
    expect(migration).toContain("using (status = 'published')");
  });

  it("the consumer notifications API and eligibility never load drafts", () => {
    // getTourToOffer is the only consumer entry point; it filters on published
    // and phase 1's eligibility additionally requires a live version.
    const model = readFileSync(join(ROOT, "lib/tours/model.ts"), "utf8");
    expect(model).toContain('if (version.status !== "published") return false;');
  });
});

describe("preview has no consumer side effects", () => {
  const service = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");

  it("short-circuits both progress writes and step analytics", () => {
    const bails = [...service.matchAll(/if \(input\.preview\) return true;/g)].length;
    expect(bails).toBe(2);
  });

  it("bails out before touching the database or analytics", () => {
    for (const fn of ["recordTourProgress", "recordTourStepEvent"]) {
      const start = service.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = service.slice(start, start + 900);
      const bail = body.indexOf("if (input.preview) return true;");
      const write = body.search(/createSupabaseAdminClient|recordProductEvent/);
      expect(bail).toBeGreaterThan(-1);
      expect(write).toBeGreaterThan(bail);
    }
  });
});

describe("preview runs the real renderer inside the real shell", () => {
  const host = readFileSync(join(ROOT, "components/tours/tour-host.tsx"), "utf8");
  const runner = readFileSync(join(ROOT, "components/tours/tour-runner.tsx"), "utf8");

  it("reuses TourRunner rather than a second admin-only renderer", () => {
    expect(host).toContain("TourRunner");
    // Exactly one renderer component exists.
    expect(runner).toContain("export function TourRunner");
  });

  it("mounts preview in the shell so it survives route changes", () => {
    // The host lives in the (app) layout, so a route-aware step navigating away
    // does not tear the preview down.
    const layout = readFileSync(join(ROOT, "app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain("TourHost");
    expect(host).toContain("decodeTourPreview");
  });

  it("passes preview and a return path, and never records", () => {
    expect(host).toMatch(/preview\s*$|preview\n/m);
    expect(host).toContain("previewReturnTo");
  });

  it("warns about a missing target only in preview", () => {
    expect(runner).toContain("Target not found in preview");
    // The warning is gated on preview so consumers never see it.
    const warn = runner.indexOf("Target not found in preview");
    const gate = runner.lastIndexOf("preview && targetMissing", warn);
    expect(gate).toBeGreaterThan(-1);
  });

  it("always offers a way out of preview", () => {
    expect(runner).toContain("Exit preview");
    expect(runner).toContain("exitTourPreviewAction");
  });
});

describe("published replay still works independently of preview", () => {
  it("the replay screen still renders published tours without a preview session", () => {
    const replay = readFileSync(join(ROOT, "components/tours/walkthrough-replay.tsx"), "utf8");
    expect(replay).toContain("TourRunner");
    // Replay is deliberately NOT preview: a deliberate user replay is real
    // engagement and is recorded. Checked against code with comments stripped,
    // since the file legitimately explains that distinction in prose.
    const code = replay
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\bpreview\b/);
    const page = readFileSync(join(ROOT, "app/(app)/settings/walkthrough/page.tsx"), "utf8");
    expect(page).toContain("getReplayableTours");
  });
});
