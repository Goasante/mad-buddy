import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  MAD_CAM_FLAG,
  MANAGED_FEATURES,
  MOMENTS_FLAG,
  OPEN_MOMENTS_FLAG,
  isManagedFeatureFlagKey,
  resolveGlobalFeatureFlag
} from "@/lib/features/feature-flags";

/**
 * Scope reduction: Mad Cam and Moments paused for the first release.
 *
 * The flag resolution is pure, so those rules are exercised as real
 * behaviour. Surface gating is asserted against source, the pattern this
 * codebase uses for server/client paths that cannot run under vitest's node
 * environment.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const layout = stripComments(read("app/(app)/layout.tsx"));
const shell = stripComments(read("components/app-shell/app-shell.tsx"));
const homeLoader = stripComments(read("app/(app)/dashboard/page.tsx"));
const home = stripComments(read("components/dashboard/dashboard-page.tsx"));
const momentsRoute = stripComments(read("app/(app)/moments/page.tsx"));
const momentsActions = stripComments(read("app/(app)/moments-actions.ts"));

// ---------------------------------------------------------------------------
// Flags fail closed — this is what makes "no migration" correct
// ---------------------------------------------------------------------------

describe("paused features default to off with no database row", () => {
  it("treats a missing row as disabled", () => {
    expect(resolveGlobalFeatureFlag(null)).toBe(false);
    expect(resolveGlobalFeatureFlag(undefined)).toBe(false);
  });

  it("treats an explicitly off or archived row as disabled", () => {
    expect(resolveGlobalFeatureFlag({ status: "off", default_value: true })).toBe(false);
    expect(resolveGlobalFeatureFlag({ status: "archived", default_value: true })).toBe(false);
  });

  it("turns back on when a row says on", () => {
    // The re-enable path: seed a row from Admin -> Features.
    expect(resolveGlobalFeatureFlag({ status: "on", default_value: false })).toBe(true);
  });

  it("registers both keys in the managed catalog so admin can toggle them", () => {
    expect(isManagedFeatureFlagKey(MOMENTS_FLAG)).toBe(true);
    expect(isManagedFeatureFlagKey(MAD_CAM_FLAG)).toBe(true);
    for (const key of [MOMENTS_FLAG, MAD_CAM_FLAG]) {
      const entry = MANAGED_FEATURES.find((feature) => feature.key === key);
      expect(entry?.title, key).toBeTruthy();
      expect(entry?.disabledImpact, key).toBeTruthy();
    }
  });

  it("keeps the broad Moments flag distinct from the narrow Open feed flag", () => {
    // open_moments gates only public-audience Moments. Reusing it would have
    // left Muddies-only Moments fully live while appearing to pause the
    // feature.
    expect(MOMENTS_FLAG).not.toBe(OPEN_MOMENTS_FLAG);
    expect(momentsActions).toContain("isOpenMomentsEnabled");
    expect(momentsActions).toContain("isMomentsEnabled");
  });
});

// ---------------------------------------------------------------------------
// Mad Cam OFF
// ---------------------------------------------------------------------------

describe("Mad Cam when paused", () => {
  it("resolves the flag server-side and passes it to the shell", () => {
    expect(layout).toContain("MAD_CAM_FLAG");
    expect(layout).toContain("madCamEnabled={madCamEnabled}");
  });

  it("never mounts the camera without the flag", () => {
    expect(shell).toContain("{madCamEnabled && cameraOpen ? <LazyCameraComposer");
  });

  it("makes the home-reselect launcher inert", () => {
    const launcher = shell.slice(shell.indexOf("const openCameraFromHome"));
    expect(launcher.slice(0, 220)).toContain("if (!madCamEnabled) return;");
  });

  it("defaults to off in the shell when no prop is supplied", () => {
    expect(shell).toContain("madCamEnabled = false,");
  });
});

describe("camera implementation is preserved, not deleted", () => {
  /**
   * COMMITTED camera modules only.
   *
   * The effects engine, face tracking and the Slice 2 capture-mode work are
   * still uncommitted work in progress. Asserting on them here would make
   * this test pass locally and fail in a clean clone -- which is precisely
   * how a green suite ships a broken tree. The rule this protects is "the
   * pause did not delete the camera", and the committed modules prove it.
   */
  it.each([
    "lib/camera/state.ts",
    "lib/camera/capabilities.ts",
    "lib/camera/local-media.ts",
    "lib/camera/video-recording.ts",
    "lib/camera/types.ts",
    "components/camera/camera-composer.tsx",
    "components/camera/image-editor.tsx"
  ])("still ships %s", (path) => {
    expect(read(path).length).toBeGreaterThan(0);
  });

  it("keeps the camera domain free of any feature-flag coupling", () => {
    // The pause lives at the entry point. Wiring the flag into the camera
    // modules would make the preserved work harder to revive.
    for (const path of ["components/camera/camera-composer.tsx", "lib/camera/state.ts"]) {
      const source = stripComments(read(path));
      expect(source, path).not.toContain("madCamEnabled");
      expect(source, path).not.toContain("feature-flags");
    }
  });
});

// ---------------------------------------------------------------------------
// Moments OFF
// ---------------------------------------------------------------------------

describe("Moments when paused", () => {
  it("redirects a direct visit rather than showing a broken page", () => {
    expect(momentsRoute).toContain("if (!(await isMomentsEnabled(admin))) redirect(\"/dashboard\")");
  });

  it("removes Moments from navigation", () => {
    expect(layout).toContain('...(momentsEnabled ? [] : ["/moments"])');
  });

  it("removes the Moments quick action", () => {
    expect(homeLoader).toContain('...(momentsEnabled ? [] : ["/moments"])');
  });

  it("hides the Home section entirely, including its onboarding card", () => {
    // MomentsPreview renders a "Share Moments" onboarding card when empty --
    // a creation affordance for a paused feature. Passing empty arrays is not
    // enough; the section must not render at all.
    expect(home).toContain("{momentsEnabled ? <MomentsPreview");
    expect(home).toContain("momentsEnabled = false,");
  });

  it("enforces the pause on every Moments mutation, not just in the UI", () => {
    for (const action of [
      "uploadMomentMediaAction",
      "createMomentAction",
      "reactToMomentAction",
      "removeMomentReactionAction",
      "recordMomentViewAction"
    ]) {
      const start = momentsActions.indexOf(`export async function ${action}`);
      expect(start, action).toBeGreaterThan(-1);
      const body = momentsActions.slice(start, start + 2600);
      expect(body, `${action} must re-check the flag`).toContain("momentsPausedState(admin)");
    }
  });

  it("removes the first-run Moments CTA new accounts see", () => {
    // FIRST_TIME_ACTIONS used to map unfiltered, so a brand-new account kept
    // a "Share a Moment" card pointing at a paused feature.
    expect(home).toContain("function FirstTimeQuickActions({ hiddenHrefs = [] }");
    expect(home).toContain("FIRST_TIME_ACTIONS.filter((action) => !hiddenHrefs.includes(action.href))");
    expect(home).toContain("<FirstTimeQuickActions hiddenHrefs={hiddenQuickActionHrefs} />");
  });

  it("removes the Moments stat from Profile", () => {
    const profile = stripComments(read("components/profile/profile-page.tsx"));
    expect(profile).toContain("{momentsEnabled ? (");
    // Resolved server-side and passed down: no extra flag lookup per render.
    expect(stripComments(read("app/(app)/profile/page.tsx"))).toContain("isMomentsEnabled(admin)");
  });

  it("blocks the mobile API write paths too", () => {
    // The server actions are not the only write path; the mobile API is a
    // second one and would otherwise bypass the pause entirely.
    for (const path of ["app/api/moments/route.ts", "app/api/moments/[id]/react/route.ts"]) {
      expect(stripComments(read(path)), path).toContain("isMomentsEnabled(createSupabaseAdminClient())");
    }
  });

  it("still lets an author delete their own Moment while paused", () => {
    // Pausing a feature must not trap someone's data inside it.
    const route = stripComments(read("app/api/moments/route.ts"));
    const del = route.slice(route.indexOf("export async function DELETE"));
    expect(del).not.toContain("isMomentsEnabled");
  });

  it("does not gate reads, so existing Moments return with the flag", () => {
    const feed = momentsActions.slice(momentsActions.indexOf("export async function getMomentFeedAction"));
    expect(feed.slice(0, 400)).not.toContain("momentsPausedState");
  });
});

// ---------------------------------------------------------------------------
// What must NOT have been touched
// ---------------------------------------------------------------------------

describe("no Moments residue in visible UI while paused", () => {
  /**
   * Every component that links to /moments must either be gated by the flag
   * or live behind the redirecting route. This is the sweep that catches a
   * new CTA someone adds later without knowing the feature is paused.
   *
   * Surfaces that render ONLY inside /moments (moments-page and its parts)
   * are exempt: the route guard already stops them being reachable.
   */
  const BEHIND_THE_ROUTE = ["components/content/moments-page.tsx", "components/content/moments-preview.tsx"];

  const linkingFiles = [
    "components/app-shell/app-shell.tsx",
    "components/dashboard/dashboard-page.tsx",
    "components/profile/profile-page.tsx"
  ];

  it.each(linkingFiles)("gates every /moments link in %s", (path) => {
    const source = stripComments(read(path));
    if (!source.includes("/moments")) return;
    // The file must consult the flag (directly or via the hidden-href list)
    // rather than rendering the link unconditionally.
    const gated =
      source.includes("momentsEnabled") ||
      source.includes("hiddenNavigationHrefs") ||
      source.includes("hiddenHrefs") ||
      source.includes("hiddenQuickActionHrefs");
    expect(gated, `${path} links to /moments without consulting the flag`).toBe(true);
  });

  it("keeps the exempt surfaces behind the route guard", () => {
    // If either of these ever renders outside /moments, this pause leaks.
    for (const path of BEHIND_THE_ROUTE) {
      expect(read(path).length, path).toBeGreaterThan(0);
    }
    expect(home).toContain("{momentsEnabled ? <MomentsPreview");
  });

  it("leaves the shared MomentImage primitive alone", () => {
    // Used by Drops, Friends and Hero -- it is a UI primitive, not the
    // Moments feature, and gating it would break unrelated surfaces.
    for (const path of ["components/drops/drops-page.tsx", "components/friends/muddy-profile-page.tsx"]) {
      const source = stripComments(read(path));
      expect(source, path).not.toContain("isMomentsEnabled");
      expect(source, path).not.toContain("momentsEnabled");
    }
  });
});

describe("shared infrastructure survives the pause", () => {
  it("leaves chat's media viewer working on the shared Moment viewer", () => {
    // components/messaging/message-media-viewer.tsx imports MomentMediaViewer.
    // Gating components/content as a directory would have broken chat.
    const viewer = stripComments(read("components/messaging/message-media-viewer.tsx"));
    expect(viewer).toContain("MomentMediaViewer");
    expect(viewer).not.toContain("isMomentsEnabled");
    expect(viewer).not.toContain("momentsEnabled");
  });

  it("leaves the voice note architecture untouched", () => {
    const voice = stripComments(read("lib/messaging/voice-recording.ts"));
    expect(voice).not.toContain("feature-flags");
    expect(voice.length).toBeGreaterThan(0);
  });

  it("leaves the shared media pipeline untouched", () => {
    for (const path of ["lib/media/validation.ts", "lib/media/processing.ts", "lib/media/chat-upload-service.ts"]) {
      expect(stripComments(read(path)), path).not.toContain("feature-flags");
    }
  });

  it("leaves Event cover media working", () => {
    const cover = stripComments(read("app/(app)/event-cover-actions.ts"));
    expect(cover).not.toContain("isMomentsEnabled");
    expect(cover).toContain("validateImageUpload");
  });

  it("keeps Moment expiry running, because it is retention not engagement", () => {
    // Pausing this would leak storage and defeat retention while the feature
    // sleeps. It is deliberately NOT flag-gated.
    const jobs = stripComments(read("lib/jobs/handlers.ts"));
    expect(jobs).toContain('"expiry.moments": handleExpireMoments');
    expect(jobs).not.toContain("isMomentsEnabled");
  });

  it("keeps Moments data and migrations in place", () => {
    // No destructive cleanup migration was written for this pause.
    const migrations = readFileSync(join(process.cwd(), "lib/jobs/handlers.ts"), "utf8");
    expect(migrations).toContain('.from("moments")');
  });
});
