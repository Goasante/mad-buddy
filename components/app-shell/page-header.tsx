"use client";

import type { Route } from "next";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { useAppMenu } from "@/hooks/app-menu-context";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";

/**
 * The canonical header, pre-wired to the shell.
 *
 * Every screen needs the same three things — the app menu, the unread count,
 * and the header itself — so this binds them once instead of repeating the
 * hooks in every page component. It is NOT a second header system:
 * MobilePageHeader still owns all layout, sizing and variants.
 *
 * Being a client component, it also lets SERVER page components render the
 * header without becoming client components themselves.
 *
 * Two shapes:
 *   <PageHeader title="Events" />                     root screen
 *   <PageHeader title="Scan" backHref="/friends" />   nested screen
 */
export function PageHeader({
  title,
  backHref,
  showNotifications,
  showAddMuddy,
  incomingRequestCount
}: {
  title: string;
  /** Present = nested screen: shows Back instead of Menu. */
  backHref?: Route;
  showNotifications?: boolean;
  showAddMuddy?: boolean;
  incomingRequestCount?: number;
}) {
  const openAppMenu = useAppMenu();
  const unreadNotificationCount = useUnreadNotifications();
  const nested = Boolean(backHref);

  return (
    <MobilePageHeader
      title={title}
      leadingAction={nested ? "back" : "menu"}
      backHref={backHref}
      onOpenMenu={openAppMenu}
      // Quick Controls is Home's alone — its sheet (visibility, ghost mode,
      // refresh Nearby) has no equivalent on any other screen.
      showQuickControls={false}
      // Nested screens default to a quiet header: the way back and the title
      // are the point, not app-level shortcuts.
      showNotifications={showNotifications ?? !nested}
      showAddMuddy={showAddMuddy ?? !nested}
      incomingRequestCount={incomingRequestCount}
      unreadNotificationCount={unreadNotificationCount}
    />
  );
}
