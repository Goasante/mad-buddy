import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * A paused feature must close EVERY door, not just the obvious one.
 *
 * The layout already removes a paused feature from navigation, and documents
 * why: "A paused feature stops existing in navigation rather than appearing as
 * a dead or 'coming soon' entry." But the Create menu was built from a
 * module-level constant that no filter touched, so with Moments off the menu
 * still offered "Share a Moment" -- a CTA leading to a route that redirects
 * straight back out.
 */

const shell = stripComments(readFileSync("components/app-shell/app-shell.tsx", "utf8"));
const layout = stripComments(readFileSync("app/(app)/layout.tsx", "utf8"));
const groupPage = stripComments(readFileSync("components/groups/group-detail-page.tsx", "utf8"));

describe("a paused feature offers no way in", () => {
  it("filters the Create menu, not only the navigation", () => {
    expect(shell).toContain("visibleCreateActions");
    expect(shell).toContain("visibleCreateActions.map((action)");
  });

  it("does not render the unfiltered action list", () => {
    expect(shell).not.toContain("{createActions.map((action)");
  });

  it("filters both surfaces from the same pause list", () => {
    // Two independent lists would drift the moment a feature is paused.
    const filterLine = shell.slice(shell.indexOf("const visibleCreateActions"));
    expect(filterLine.slice(0, 260)).toContain("hiddenNavigationHrefs");
  });

  it("still hides paused features from navigation", () => {
    expect(layout).toContain('momentsEnabled ? [] : ["/moments"]');
    expect(layout).toContain('socializeEnabled ? [] : ["/discover"]');
  });
});

describe("Circle chat converges without an app restart", () => {
  it("refreshes after a reconnect rather than trusting a silent socket", () => {
    // channel.subscribe() took no status callback, so a socket that dropped
    // and reattached never triggered a resync and the thread stayed stale.
    expect(groupPage).toContain("hasSubscribedOnce");
    expect(groupPage).toContain('status !== "SUBSCRIBED"');
  });

  it("refreshes when the app returns to the foreground", () => {
    expect(groupPage).toContain('addEventListener("visibilitychange"');
    expect(groupPage).toContain('addEventListener("focus"');
  });

  it("only refreshes when actually visible", () => {
    expect(groupPage).toContain('document.visibilityState === "visible"');
  });

  it("removes its listeners on unmount", () => {
    // A Circle page is mounted and unmounted repeatedly; leaked listeners
    // would stack a refresh per visit.
    expect(groupPage).toContain('removeEventListener("visibilitychange"');
    expect(groupPage).toContain('removeEventListener("focus"');
  });
});
