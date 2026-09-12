import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from "react-router-dom";
import { toMobilePath } from "./routes.mobile";

/**
 * Platform router — Capacitor/Vite implementation.
 *
 * Provides the subset of next/navigation that shared components actually use,
 * backed by react-router. Paths are translated through toMobilePath for the
 * same reason as Link: shared components are authored against web routes.
 */

/**
 * Next's optional second argument to push/replace. Shared pages really do use
 * it -- components/moments calls
 * `router.replace(..., { scroll: false })` -- so the mobile signature must
 * accept it or those call sites become type errors the moment they migrate.
 *
 * The options are accepted and ignored, which is honest here rather than
 * lossy: `scroll` suppresses Next's restore-scroll-on-navigate, and the SPA
 * does not do that in the first place, so ignoring it produces the SAME
 * observable behaviour the caller asked for.
 */
type NavigateOptions = {
  scroll?: boolean;
};

type PlatformRouter = {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
  prefetch: (href: string) => void;
  refresh: () => void;
};

export function useRouter(): PlatformRouter {
  const navigate = useNavigate();

  return useMemo(
    () => ({
      // The options argument is accepted for signature compatibility and
      // intentionally not forwarded -- see NavigateOptions above.
      push: (href: string, _options?: NavigateOptions) => navigate(toMobilePath(href)),
      replace: (href: string, _options?: NavigateOptions) =>
        navigate(toMobilePath(href), { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      // A Next router hint with no meaning in a bundled webview.
      prefetch: () => {},
      /**
       * DELIBERATELY A NO-OP, AND DELIBERATELY NOT SILENT IN DEV.
       *
       * On web, refresh() re-runs the Server Component tree and re-streams
       * fresh props — that is how the app re-reads data after a mutation.
       * A Vite bundle has no server tree, so there is nothing to re-run: data
       * arrives from /api/* through each screen's own fetch.
       *
       * Pretending to succeed would be the worst option, because the failure
       * mode is invisible — a mutation appears to work and the screen shows
       * stale data until something else happens to reload it. That is exactly
       * the "a screen that reads once looks broken with a perfect backend"
       * trap recorded in the live-surface-refresh-contract notes.
       *
       * So: any shared component that needs to re-read after a mutation must
       * call the `revalidate` contract (lib/platform/revalidate) instead,
       * which each platform implements for real. This warns in dev to make an
       * unmigrated call site obvious while that work is in progress.
       */
      refresh: () => {
        if (import.meta.env?.DEV) {
          console.warn(
            "router.refresh() does nothing on mobile — there is no Server Component tree to re-run. " +
              "Use the revalidate contract (lib/platform/revalidate) so the screen actually re-reads its data."
          );
        }
      }
    }),
    [navigate]
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const [params] = useRouterSearchParams();
  return params;
}

/**
 * Mobile half of the data-refresh contract.
 *
 * Web's implementation is router.refresh(); there is no single equivalent
 * here, because each screen owns its own fetch. Callers pass the reload they
 * want re-run, which keeps the decision with the screen that knows what its
 * data is.
 */
export function useRevalidate(reload?: () => void | Promise<void>): () => void {
  return useCallback(() => {
    void reload?.();
  }, [reload]);
}
