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

/** Mirrors the useRouter() body in router.mobile.ts. */
function makeRouter(navigate: (to: string | number, opts?: { replace?: boolean }) => void) {
  return {
    push: (href: string) => navigate(toMobilePath(href)),
    replace: (href: string) => navigate(toMobilePath(href), { replace: true }),
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
