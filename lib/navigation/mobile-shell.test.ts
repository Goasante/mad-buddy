import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const shell = read("components/app-shell/app-shell.tsx");
const header = read("components/app-shell/mobile-page-header.tsx");
const css = read("app/globals.css");
const ptr = read("components/ui/pull-to-refresh.tsx");

// ---------------------------------------------------------------------------
// The top gap: the safe-area inset must be reserved exactly once
// ---------------------------------------------------------------------------

describe("mobile shell top offset", () => {
  it("reserves the fixed mobile header's footprint on <main>", () => {
    // The header is FIXED (out of flow), so <main> must offset by exactly its
    // height — one canonical variable, never a spacer element.
    expect(shell).toContain('"pt-[var(--mobile-header-height)] md:pt-0"');
  });

  it("defines the header height once, including the safe-area inset", () => {
    expect(css).toContain("--mobile-header-height: calc(");
    expect(css).toContain("env(safe-area-inset-top, 0px) + var(--mobile-header-content-height)");
  });

  it("keeps the inset on the header, which is what must clear the notch", () => {
    expect(header).toContain("pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]");
  });

  it("uses no spacer element to push content below the header", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).not.toMatch(/aria-hidden[^>]*className="h-\[var\(--mobile-header-height\)\]"/);
    expect(shell).not.toContain('role="presentation"');
  });

  it("does not hide the gap behind a negative margin", () => {
    expect(header).not.toMatch(/-mt-\d/);
    expect(shell).not.toMatch(/-mt-\d/);
  });
});

// ---------------------------------------------------------------------------
// Header behaviour
// ---------------------------------------------------------------------------

describe("mobile header behaviour", () => {
  it("is FIXED to the viewport, not sticky inside the scroll container", () => {
    // Sticky put the header inside the Home scroll container, where the
    // pull-to-refresh transform became a transformed ancestor — which re-bases
    // sticky onto that ancestor instead of the viewport, so the header rode
    // down with the pull and appeared to float.
    expect(header).toContain("fixed inset-x-0 top-0");
    expect(header).not.toContain("sticky top-0");
  });

  it("documents the transformed-ancestor failure so it is not reintroduced", () => {
    expect(header).toContain("transformed ANCESTOR");
  });

  it("renders above page content", () => {
    expect(header).toContain("z-40");
  });

  it("uses an OPAQUE theme surface so content cannot show through", () => {
    // Content scrolls underneath a fixed header; a translucent surface would
    // reveal it passing behind the title.
    expect(header).toContain("bg-background dark:bg-[#111112]");
    expect(header).not.toContain("bg-background/85");
    expect(header).not.toContain("backdrop-blur-xl");
  });

  it("shows its divider only once content scrolls beneath it", () => {
    // The hook moved to hooks/use-has-scrolled so Linkr's own header shares
    // the same threshold and listener — two copies would drift, and the
    // symptom is two headers growing dividers at different scroll offsets.
    expect(header).toContain("useHasScrolled()");
    expect(header).toContain("border-transparent shadow-none");
  });

  it("transitions the divider without fighting reduced motion", () => {
    expect(header).toContain("motion-reduce:transition-none");
  });
});

// ---------------------------------------------------------------------------
// Bottom navigation
// ---------------------------------------------------------------------------

describe("mobile bottom navigation", () => {
  const nav = shell.slice(shell.indexOf("function MobileNav"), shell.indexOf("function MobileNavTab"));

  it("is fixed to the bottom across the full width", () => {
    expect(nav).toContain("fixed inset-x-0 bottom-0");
  });

  it("reads as attached, not as a floating pill", () => {
    // The old bar was a max-w rounded-full card with a detached drop shadow
    // and an outer bottom gap.
    expect(nav).not.toContain("rounded-full border border-border/70");
    expect(nav).not.toContain("max-w-[26rem]");
    expect(nav).toContain("border-t");
  });

  it("pads the safe area inside its own surface", () => {
    // Inside, so the bar's background reaches the screen edge rather than
    // leaving a strip of page visible below it.
    expect(nav).toContain("pb-[env(safe-area-inset-bottom,0px)]");
  });

  it("keeps the raised Create button from clipping the top border", () => {
    expect(nav).not.toContain("-translate-y-2");
  });

  it("stays mobile-only", () => {
    expect(nav).toContain("md:hidden");
  });
});

describe("mobile content clearance", () => {
  it("reserves the bottom bar's real footprint so the last section is reachable", () => {
    const main = shell.slice(shell.indexOf('<main'));
    expect(main).toContain(
      "pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)"
    );
  });

  it("reserves the bottom bar on the scroll owner only", () => {
    const beforeMain = shell.slice(0, shell.indexOf('<main'));
    expect(beforeMain).not.toContain(
      'pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))]'
    );
    expect(shell).toContain("data-app-scroll-owner");
  });

  it("defines the bar height once, next to the header height", () => {
    expect(css).toContain("--mobile-nav-height:");
  });
});

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

describe("mobile scrolling", () => {
  it("kills scroll chaining at the root rather than per page", () => {
    expect(css).toContain("overscroll-behavior: none");
  });

  it("uses dynamic viewport units so browser chrome cannot crop the shell", () => {
    expect(shell).toContain("h-[100svh]");
    expect(shell).toContain("h-[100dvh]");
  });

  it("keeps the document fixed while main owns mobile vertical scrolling", () => {
    expect(shell).toContain("min-h-0 flex-1 overflow-y-auto overscroll-y-contain");
    expect(shell).toContain("flex h-[100svh] h-[100dvh] min-h-0 flex-col overflow-hidden");
  });
});

// ---------------------------------------------------------------------------
// Pull to refresh
// ---------------------------------------------------------------------------

describe("pull to refresh structure", () => {
  it("never wraps children in a transform", () => {
    // THE structural bug: a transformed wrapper around {children} moved the
    // header with the pull AND became a containing block that broke sticky
    // positioning for everything inside it.
    expect(ptr).not.toMatch(/transform: active \?/);
    expect(ptr).toContain("{children}");
  });

  it("adds no document-flow height above the content", () => {
    // The indicator is a fixed overlay; it must never occupy layout space,
    // which is what previously pushed the header and content downward.
    expect(ptr).toContain('className={cn("contents", className)}');
    expect(ptr).toContain("pointer-events-none fixed inset-x-0");
  });

  it("pins the strip below the fixed header rather than behind it", () => {
    // Behind an opaque header the indicator would be invisible.
    expect(ptr).toContain('top: "var(--mobile-header-height)"');
  });

  it("caps the strip at a compact fixed height independent of pull distance", () => {
    expect(ptr).toContain("const STRIP_HEIGHT_PX = 44");
    expect(ptr).toContain("height: active ? STRIP_HEIGHT_PX : 0");
    // Height must not be derived from the pull.
    expect(ptr).not.toMatch(/height: active \? Math\.max\(pull/);
  });

  it("clips the indicator inside the strip", () => {
    expect(ptr).toContain("overflow-hidden");
  });

  it("gives the strip a full-width opaque surface that does not move", () => {
    // A transformed or partial surface exposes the content beneath it.
    expect(ptr).toContain("flex h-full w-full items-center justify-center gap-2 bg-background");
  });

  it("retracts to zero height when inactive", () => {
    expect(ptr).toContain("height: active ? STRIP_HEIGHT_PX : 0");
    expect(ptr).toContain("opacity: active ? 1 : 0");
  });
});

describe("pull to refresh states", () => {
  it("defines the five states with one label each", () => {
    for (const phase of ["resting", "pulling", "ready", "refreshing", "complete"]) {
      expect(ptr, `missing phase ${phase}`).toContain(phase);
    }
    expect(ptr).toContain('"Pull to refresh"');
    expect(ptr).toContain('"Release to refresh"');
    expect(ptr).toContain('"Refreshing nearby…"');
    expect(ptr).toContain('"You\'re up to date"');
  });

  it("derives the phase once so the visual and the label always agree", () => {
    expect(ptr).toContain("const phase: RefreshPhase");
    expect(ptr).toContain("PHASE_LABEL[phase]");
  });

  it("uses the brand orange accent in both themes", () => {
    expect(ptr).toContain("var(--color-brand-orange)");
  });

  it("confirms completion with a check and failure with a quieter mark", () => {
    expect(ptr).toContain("function RefreshCheckMark");
    expect(ptr).toContain("function RefreshAlertMark");
  });

  it("respects reduced motion", () => {
    expect(ptr).toContain("reducedMotion");
    expect(ptr).toContain('phase === "refreshing" && !reducedMotion && "pull-refresh-spin"');
  });

  it("announces only the outcome, not every pixel of the pull", () => {
    expect(ptr).toContain('aria-live="polite"');
    expect(ptr).toContain('phase === "refreshing" ? "Refreshing"');
  });
});

describe("pull to refresh guard rails", () => {
  it("only arms at the very top of the page", () => {
    expect(ptr).toContain("const atTop = ()");
    expect(ptr).toContain('[data-app-scroll-owner]');
    expect(ptr).toContain("scrollOwner.scrollTop <= 0");
    expect(ptr).toContain("if (!atTop()");
  });

  it("ignores multi-touch so pinch-zoom is never hijacked", () => {
    expect(ptr).toContain("event.touches.length !== 1");
  });

  it("bails when the gesture is horizontal, keeping carousels scrollable", () => {
    expect(ptr).toContain("deltaX > Math.abs(deltaY)");
  });

  it("skips gestures inside horizontal scrollers", () => {
    expect(ptr).toContain("node.scrollWidth > node.clientWidth");
  });

  it("blocks while any modal or sheet is open, even when portalled", () => {
    // Radix portals overlays to <body>, so an ancestor check alone misses them.
    expect(ptr).toContain("document.querySelector(\"[role='dialog'][data-state='open']\")");
  });

  it("blocks while a text input is focused", () => {
    expect(ptr).toContain('active.tagName === "INPUT"');
    expect(ptr).toContain("active.isContentEditable");
  });

  it("only suppresses native overscroll once the pull is committed", () => {
    expect(ptr).toContain("if (event.cancelable) event.preventDefault();");
    expect(ptr).toContain("committed.current = true;");
  });

  it("applies a resistance curve and a threshold", () => {
    expect(ptr).toContain("THRESHOLD_PX");
    expect(ptr).toContain("deltaY * 0.5");
  });
});

describe("pull to refresh behaviour", () => {
  it("prevents concurrent refreshes", () => {
    expect(ptr).toContain("if (refreshingRef.current) return;");
  });

  it("handles network failure without blanking the page", () => {
    expect(ptr).toContain("setFailed(true)");
    expect(ptr).toContain("Couldn't refresh. Pull to try again.");
  });

  it("re-runs the server render rather than reloading the PWA", () => {
    expect(ptr).toContain("router.refresh()");
    expect(ptr).not.toContain("window.location.reload");
  });

  it("is mounted once in the shell, not per page", () => {
    expect(shell).toContain("<PullToRefresh>");
    const mounts = shell.match(/<PullToRefresh/g) ?? [];
    expect(mounts.length).toBe(1);
  });

  it("lets Home reuse its existing Nearby action instead of a second implementation", () => {
    const home = read("components/dashboard/dashboard-page.tsx");
    expect(home).toContain("usePullRefreshListener(loadNearbyFriends)");
    // Home must not mount its own gesture handler.
    expect(home).not.toContain("<PullToRefresh");
    expect(home).not.toContain("touchmove");
  });

  it("keeps Refresh Nearby available in Quick Controls as an alternative", () => {
    expect(read("components/dashboard/quick-controls-sheet.tsx")).toMatch(/Refresh [Nn]earby/);
  });
});
