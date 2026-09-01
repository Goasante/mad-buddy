import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Account Hub — the app-wide hamburger menu.
 *
 * Its one job is FAST ACCESS: who am I, where is my access, how am I
 * progressing, where are my controls, how do I get help, how do I sign out.
 * Settings remains the complete control center. These tests exist because
 * the failure mode is gradual — every individually reasonable row makes the
 * hub a little more like a second Settings directory, and each stale label
 * ("Membership", "Location & Permissions") keeps promising a destination the
 * app does not have.
 *
 * Asserted against the SOURCE rather than a render: the contract here is the
 * route table and the labels attached to it, which is exactly what the
 * source states once and a render would only re-derive.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Comments discuss the removed concepts by name; the code must not use them. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const hubSource = read("components/dashboard/home-settings-sheet.tsx");
const hub = stripComments(hubSource);

describe("account hub identity", () => {
  it("makes the whole identity header the one way into the profile", () => {
    expect(hub).toContain('href={"/profile" as Route}');
    expect(hub).toContain("View my profile");
  });

  it("keeps exactly one profile entry, so the header has no duplicate row", () => {
    // The old menu had a read-only header AND a "View My Profile" row
    // pointing at the same screen. One destination, one entry.
    expect(hub).not.toContain('label: "View My Profile"');
    expect([...hub.matchAll(/\/profile/g)]).toHaveLength(1);
  });

  it("does not decorate identity with plan status", () => {
    // Mad Buddy Access is access, not a badge people wear. A tier ring or
    // pill on the avatar turns it into social status.
    expect(hubSource).not.toContain("PremiumPlanBadge");
    expect(hubSource).not.toContain("premiumBadgeIdentity");
    expect(hubSource).not.toContain("subscriptionPlan");
  });
});

describe("account hub destinations", () => {
  /** Every consumer-facing row: label, subtitle, and the route it owns. */
  const ROWS = [
    ["Mad Buddy Access", "Manage your access", "/settings/access"],
    ["Progress & Achievements", "Buddy Score & badges", "/buddy-score"],
    ["Settings", "Preferences & account", "/settings"],
    ["Privacy & Safety", "Control your data & safety", "/settings/privacy"],
    ["Glow & Visibility", "Manage your presence", "/settings/glow-visibility"],
    ["Invite Buddies", "Invite people you know", "/invites"],
    ["Help & Support", "Get help and contact us", "/help"],
    ["Send Feedback", "Share your thoughts", "/settings/feedback"],
    ["About Mad Buddy", "Version, legal, and more", "/about"]
  ] as const;

  it.each(ROWS)("%s points at %s", (label, subtitle, href) => {
    expect(hub).toContain(`{ href: "${href}", label: "${label}", subtitle: "${subtitle}"`);
  });

  it("gives every row a subtitle", () => {
    // The type carries it, so a row added without one does not compile.
    expect(hub).toContain("subtitle: string;");
    const rows = [...hub.matchAll(/\{ href: "[^"]+", label: "[^"]+"/g)];
    expect(rows.length).toBe(ROWS.length + 1); // + Administration
    for (const row of [...hub.matchAll(/\{ href: "[^"]+", label: "([^"]+)", (\w+)/g)]) {
      expect(row[2], `${row[1]} is missing its subtitle`).toBe("subtitle");
    }
  });

  it("never routes ordinary accounts at billing", () => {
    // /billing stays historical compatibility infrastructure, not a
    // consumer destination.
    expect(hub).not.toContain("/billing");
  });

  it("invents no route to match the label", () => {
    // "Progress & Achievements" is a name, not a new screen: /buddy-score
    // already carries the badges handoff, and both canonical screens survive.
    expect(hub).not.toContain('"/progress"');
    expect(hub).not.toContain('"/account-hub"');
  });

  it("keeps the deeper Settings surfaces out of the fast hub", () => {
    for (const settingsOnly of ["Sessions", "Appearance", "Language", "Data & Storage", "Delete account"]) {
      expect(hub, `${settingsOnly} leaked into the fast account hub`).not.toContain(settingsOnly);
    }
  });
});

describe("account hub consumer language", () => {
  it("retires every stale label", () => {
    // Each of these promised something the destination does not deliver:
    // "Location & Permissions" routed at Mad Buddy's own visibility settings
    // rather than the OS permission screen, and "Membership" at /billing.
    for (const stale of [
      "Membership",
      "Location & Permissions",
      "Invite Friends",
      "My Progress",
      'label: "Achievements"',
      "Upgrade account",
      "Log out"
    ]) {
      expect(hub, `stale label "${stale}" still in the account hub`).not.toContain(stale);
    }
  });

  it("names no plan tier anywhere a person can read it", () => {
    // Checked against the rendered STRINGS rather than the whole source, so
    // an icon named UserPlus/ShieldPlus is not mistaken for a Plus tier.
    const labels = [...hub.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
    for (const label of labels) {
      for (const tier of ["Premium", "Plus", "Pro ", "Upgrade"]) {
        expect(label, `plan tier "${tier}" surfaced in the account hub`).not.toContain(tier);
      }
    }
  });

  it("uses Sign out, once, for ending the session", () => {
    expect(hub).toContain('>Sign out<');
    expect(hub).toContain("useSecureLogout");
    expect(hub).toContain("onClick={logout}");
  });
});

describe("account hub administration", () => {
  it("carries an Administration entry", () => {
    expect(hub).toContain('label: "Administration"');
    expect(hub).toContain('href: "/admin"');
  });

  it("renders it only when the server says the account is staff", () => {
    expect(hub).toContain("{showAdminLink ? (");
    // No row, no heading, no gap for everyone else.
    expect(hub).not.toContain("hidden={showAdminLink");
  });

  it("defaults to hidden, so a caller that forgets the prop cannot leak it", () => {
    expect(hub).toContain("showAdminLink = false");
  });

  it("stays a visibility decision, never an authorization one", () => {
    // The flag is resolved by the authenticated layout from getAdminContext();
    // /admin re-checks server-side regardless of what this sheet drew.
    expect(read("app/(app)/layout.tsx")).toContain("showAdminLink={adminContext.ok}");
    expect(read("components/app-shell/app-shell.tsx")).toContain("showAdminLink={showAdminLink}");
  });
});

describe("account hub interaction contract", () => {
  it("has no drag handle, because the sheet does not drag", () => {
    // A visual affordance must represent real behaviour.
    expect(hubSource).not.toContain("Drag handle");
    expect(hub).not.toContain("h-1 w-9 rounded-full");
  });

  it("has a visible, labelled close control with a 44px target", () => {
    expect(hub).toContain('aria-label="Close account menu"');
    expect(hub).toContain("h-11 w-11");
    // A real Dialog.Close, so Escape and the overlay keep working too.
    expect(hub).toMatch(/<Dialog\.Close\s+aria-label="Close account menu"/);
  });

  it("closes on route selection without cancelling the navigation", () => {
    // Dialog.Close wrapping the Link makes the close the click's own
    // consequence. useDismissOnBack would call history.back() during the
    // same click and cancel the in-flight App Router navigation.
    expect(hub).toContain("<Dialog.Close asChild>");
    expect(hub).not.toContain("useDismissOnBack");
    // Every navigating row is a Link, never a router.push in an onClick.
    expect(hub).not.toContain("router.push");
  });

  it("keeps one scroll owner and no horizontal overflow", () => {
    expect([...hub.matchAll(/overflow-y-auto/g)]).toHaveLength(1);
    expect(hub).toContain("overscroll-contain");
    // Long names and long translated labels truncate rather than pushing the
    // chevron off-screen; the chevron itself never shrinks.
    expect(hub).toContain("min-w-0 flex-1");
    expect(hub).toContain("shrink-0 text-muted-foreground");
  });

  it("names the dialog for screen readers", () => {
    expect(hub).toContain('<Dialog.Title className="sr-only">');
  });

  it("gives every row a comfortable target", () => {
    expect([...hub.matchAll(/min-h-\[56px\]/g)].length).toBeGreaterThanOrEqual(2);
    expect(hub).toContain("min-h-[52px]"); // sign out
  });
});

describe("account hub presentation", () => {
  it("is a bottom sheet on phones and a compact panel on desktop", () => {
    expect(hub).toContain("inset-x-0 bottom-0");
    // Anchored top-right, not a giant centred modal.
    expect(hub).toContain("sm:right-4");
    expect(hub).toContain("sm:w-[24rem]");
    expect(hub).not.toContain("sm:-translate-x-1/2");
  });

  it("stays one component with one responsive presentation", () => {
    // Two implementations drift; this is the single mounted menu.
    expect([...hub.matchAll(/<Dialog\.Content/g)]).toHaveLength(1);
    expect([...hub.matchAll(/export function/g)]).toHaveLength(1);
  });

  it("respects both safe areas", () => {
    expect(hub).toContain("env(safe-area-inset-bottom)");
    // A viewport-relative cap measured from the bottom still reaches the
    // notch unless it subtracts the top inset.
    expect(hub.match(/max-h-\[\d+[sd]vh\]/g) ?? []).toEqual([]);
    expect(hub).toContain("max-h-[calc(90svh-env(safe-area-inset-top,0px))]");
  });

  it("keeps the shared sheet transition and its reduced-motion opt-out", () => {
    expect(hub).toContain("menu-sheet-panel");
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf('.menu-sheet-panel[data-state="open"]'));
    expect(block.slice(0, block.indexOf("@media (min-width"))).toContain("animation: none");
    // The desktop panel scales out of the corner it is anchored to.
    expect(css).toContain("transform-origin: top right");
  });

  it("uses brand tokens rather than hardcoded colour, so dark mode is designed", () => {
    // The tokens already carry Warm Paper / orange / maroon-tinted shadow and
    // have deliberate dark values; a literal hex would only be right once.
    expect(hub).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(hub).toContain("bg-card");
  });

  it("keeps Sign out legible in the light theme", () => {
    // The shared --destructive token is tuned for FILLED controls, where it
    // is a background under white text. As text on this hub's light card it
    // measures 2.72:1, under the 4.5:1 minimum, so Sign out takes a scoped
    // darker red instead. Dark mode already clears it and keeps the token.
    expect(hub).toContain("account-hub-danger");
    const css = read("app/globals.css");
    expect(css).toContain(".account-hub-danger {");
    expect(css).toContain("html.dark .account-hub-danger");
  });
});

describe("account hub prop surface", () => {
  it("asks the shell for identity only", () => {
    // The old header showed Buddy Score level and profile completion as
    // read-only status. Removing that display removed its last consumer, so
    // the layout no longer runs the query that fed it.
    expect(hub).not.toContain("buddyScoreLevelLabel");
    expect(hub).not.toContain("profileCompletionPercent");
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).not.toContain("buddyScoreLevelLabel");
    expect(shell).not.toContain("profileCompletionPercent");
    const layout = read("app/(app)/layout.tsx");
    expect(layout).not.toContain("loadBuddyScoreLevel");
    expect(layout).not.toContain("profileCompletionPercent");
  });

  it("stays mounted once for the whole app", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain("<HomeSettingsSheet");
    expect(shell).toContain("<AppMenuProvider openMenu={() => setAppMenuOpen(true)}>");
  });
});
