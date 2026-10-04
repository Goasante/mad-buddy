"use client";
import NextLink, { type LinkProps } from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ReactElement, type RefAttributes } from "react";
import { LockKeyhole } from "lucide-react";
import { useFeatureAvailability } from "@/components/features/feature-availability-context";
import { featureForHref } from "@/lib/features/availability";
export type { LinkProps } from "next/link";
type Props<RouteType> = LinkProps<RouteType> & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps<RouteType>> & { featureLockIndicator?: boolean };
export const Link = forwardRef<HTMLAnchorElement, Props<string>>(function Link({ href, children, featureLockIndicator = true, ...props }, ref) {
  const availability = useFeatureAvailability();
  const rawHref = typeof href === "string" ? href : href.pathname ?? "";
  const feature = featureForHref(rawHref);
  const locked = Boolean(feature && availability && !availability[feature]);
  return <NextLink {...props} ref={ref} href={href} title={locked ? "Coming soon" : props.title} data-feature-locked={locked || undefined}>
    {children}{locked && featureLockIndicator ? <LockKeyhole className="ml-1 inline-block h-3.5 w-3.5 shrink-0 align-middle" aria-label="Coming soon" /> : null}
  </NextLink>;
}) as <RouteType>(props: Props<RouteType> & RefAttributes<HTMLAnchorElement>) => ReactElement;
