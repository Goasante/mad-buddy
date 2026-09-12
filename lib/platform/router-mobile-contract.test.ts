import { describe, expect, it, vi } from "vitest";
import { toMobilePath } from "./routes.mobile";

/**
 * The mobile router's behavioural contract.
 *
 * router.mobile.ts itself is a thin binding over react-router's useNavigate,
 * and the repo has no DOM/hook test stack (vitest runs `environment: "node"`
 * over lib/**). So this tests the part that carries the actual decisions --
 * what path each method hands to the navigator -- by exercising the same
 * translation and the same navigate() shapes the hook builds.
 *
 * Keeping this in lib/ means it runs in the existing suite rather than needing
 * new infrastructure, which matters because a wrong answer here is a dead link
 * on a device rather than a build error.
 */

type NavigateOptions = { scroll?: boolean };

/** Mirrors the useRouter() body in router.mobile.ts. */
function makeRouter(navigate: (to: string | number, opts?: { replace?: boolean }) => void) {
  return {
    push: (href: string, _options?: NavigateOptions) => navigate(toMobilePath(href)),
    replace: (href: string, _options?: NavigateOptions) =>
      navigate(toMobilePath(href), { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    prefetch: () => {},
    refresh: () => {}
  };
}

describe("push translates and navigates forward", () => {
  it("maps a divergent route", () => {
    const navigate = vi.fn();
    makeRouter(navigate).push("/dashboard");
    expect(navigate).toHaveBeenCalledWith("/home");
  });

  it("leaves a shared route alone", () => {
    const navigate = vi.fn();
    makeRouter(navigate).push("/messages");
    expect(navigate).toHaveBeenCalledWith("/messages");
  });

  it("carries a query string through", () => {
    const navigate = vi.fn();
    makeRouter(navigate).push("/messages?conversation=abc-123");
    expect(navigate).toHaveBeenCalledWith("/messages?conversation=abc-123");
  });

  it("translates a dynamic profile route", () => {
    const navigate = vi.fn();
    makeRouter(navigate).push("/friends/ama");
    expect(navigate).toHaveBeenCalledWith("/u/ama");
  });
});

describe("replace does not add a history entry", () => {
  it("passes replace:true alongside the translated path", () => {
    const navigate = vi.fn();
    makeRouter(navigate).replace("/friends");
    expect(navigate).toHaveBeenCalledWith("/muddies", { replace: true });
  });
});

/**
 * REGRESSION: Next's optional second argument must be accepted.
 * components/moments calls router.replace(..., { scroll: false }); a
 * one-argument mobile signature makes that a type error on migration.
 */
describe("navigation options are accepted and safely ignored", () => {
  it("accepts { scroll: false } on replace and still navigates", () => {
    const navigate = vi.fn();
    makeRouter(navigate).replace("/moments?tab=live", { scroll: false });
    expect(navigate).toHaveBeenCalledWith("/moments?tab=live", { replace: true });
  });

  it("accepts { scroll: false } on push and still navigates", () => {
    const navigate = vi.fn();
    makeRouter(navigate).push("/plans", { scroll: false });
    expect(navigate).toHaveBeenCalledWith("/plans");
  });

  it("does not forward scroll to react-router", () => {
    // Ignoring it is correct rather than lossy: `scroll` suppresses Next's
    // restore-scroll-on-navigate, which the SPA does not do anyway, so the
    // observable result is what the caller asked for.
    const navigate = vi.fn();
    makeRouter(navigate).push("/plans", { scroll: false });
    const [, options] = navigate.mock.calls[0]!;
    expect(options).toBeUndefined();
  });
});

describe("history movement", () => {
  it("back goes one entry back", () => {
    const navigate = vi.fn();
    makeRouter(navigate).back();
    // -1 is react-router's delta form; the Android hardware back button and
    // in-app back affordances both land here.
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("forward goes one entry forward", () => {
    const navigate = vi.fn();
    makeRouter(navigate).forward();
    expect(navigate).toHaveBeenCalledWith(1);
  });
});

describe("prefetch and refresh never navigate", () => {
  it("prefetch is inert", () => {
    const navigate = vi.fn();
    makeRouter(navigate).prefetch();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refresh does not navigate, and must not silently reload the route", () => {
    // Re-running the route would LOOK like a refresh while re-mounting the
    // screen, which is a different and surprising behaviour. The contract is
    // that refresh() does nothing on mobile and callers use useRevalidate.
    const navigate = vi.fn();
    makeRouter(navigate).refresh();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("external URLs are never fed to the SPA router", () => {
  // Link handles this by rendering a plain <a>; this pins the translation
  // half, so an absolute URL is never rewritten into an in-app path.
  it.each([
    "https://mad-buddy.vercel.app/settings/access",
    "mailto:hello@example.com",
    "tel:+233000000000"
  ])("leaves %s untouched", (href) => {
    expect(toMobilePath(href)).toBe(href);
  });
});
