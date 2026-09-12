import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { Link as RouterLink } from "react-router-dom";
import { toMobilePath } from "./routes.mobile";

/**
 * Platform Link — Capacitor/Vite implementation.
 *
 * Shared components are authored against the WEB route table (they have to be:
 * the web app is the source of truth and Next's typedRoutes checks those paths
 * at compile time). The mobile SPA has its own, partly different table —
 * /dashboard vs /home, /friends vs /muddies, /discover vs /socialize. So this
 * translates on the way through rather than requiring every shared component
 * to know which platform it is on.
 *
 * An unmapped path is passed through unchanged. That is the honest default:
 * most paths are identical across the two, and a route that genuinely does not
 * exist on mobile should land on the SPA's "*" catch-all rather than be
 * silently swallowed here.
 *
 * `prefetch` is accepted and ignored — it is a Next router hint with no
 * meaning in a bundled webview, and accepting it keeps call sites identical.
 */

type PlatformLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
};

export const Link = forwardRef<HTMLAnchorElement, PlatformLinkProps>(function Link(
  { href, prefetch: _prefetch, replace, children, onClick, ...rest },
  ref
) {
  const target = toMobilePath(href);

  // An absolute URL is a genuine external link (mailto:, tel:, https://...).
  // Routing those through the SPA router would produce a dead in-app
  // navigation, so they stay plain anchors and the webview hands them off.
  const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
  if (isExternal) {
    return (
      <a ref={ref} href={href} onClick={onClick} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink
      ref={ref}
      to={target}
      replace={replace}
      onClick={onClick as (event: MouseEvent<HTMLAnchorElement>) => void}
      {...rest}
    >
      {children}
    </RouterLink>
  );
});

export type LinkProps = PlatformLinkProps;
