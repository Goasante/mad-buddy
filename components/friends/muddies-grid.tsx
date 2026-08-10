"use client";

import { MessageCircle } from "lucide-react";

import { AppMenu, type AppMenuItem } from "@/components/ui/app-dropdown";
import { useState } from "react";

import { useLongPress } from "@/hooks/use-long-press";

import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { isOnline, presenceLabel, type MuddyProximity } from "@/lib/friends/muddies-presentation";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type MuddyCardPerson = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  plan: SubscriptionPlan;
  trustedSince?: string | null;
  /** Mad Buddy has verified this account. Independent of plan and standing. */
  isVerifiedAccount?: boolean;
};

/**
 * "My Muddies" — the card grid.
 *
 * A card carries identity and one action. Message is the primary thing a
 * person comes here to do, so it is a real button on the card rather than a
 * destination two taps away behind the profile sheet.
 */
export function MuddiesGrid({
  people,
  proximityByFriendId,
  onOpenProfile,
  onMessage,
  renderActions,
  messagingId
}: {
  people: readonly MuddyCardPerson[];
  proximityByFriendId: Readonly<Record<string, MuddyProximity>>;
  onOpenProfile: (id: string) => void;
  onMessage: (id: string) => void;
  /** Press-and-hold actions. Same set the list row menu offers. */
  renderActions?: (id: string) => AppMenuItem[];
  /** The card whose Message button is mid-flight, if any. */
  messagingId?: string | null;
}) {
  return (
    <ul className="muddies-grid">
      {people.map((person) => {
        const proximity = proximityByFriendId[person.id];
        const presence = presenceLabel(proximity);
        const online = isOnline(proximity);

        return (
          <li key={person.id} className="muddies-card">
            <MuddyCardIdentity
              person={person}
              onOpenProfile={() => onOpenProfile(person.id)}
              actions={renderActions?.(person.id)}
            >
              <span className="muddies-card-avatar">
                <UserAvatar
                  src={person.avatarUrl}
                  name={person.displayName}
                  decorative
                  size="lg"
                  membershipTier={publicMembershipTier(person.plan)}
                />
                {presence ? (
                  <span
                    className={cn("muddies-card-dot", online && "muddies-card-dot-online")}
                    aria-hidden="true"
                  />
                ) : null}
              </span>

              <span className="muddies-card-name-row">
                <span className="muddies-card-name">{person.displayName}</span>
                <PremiumPlanBadge plan={person.plan} compact />
                <VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount ?? false} compact />
                <TrustedMemberMark trustedSince={person.trustedSince ?? null} compact />
              </span>

              {presence ? (
                <span className="muddies-card-presence">
                  <span
                    className={cn("muddies-presence-dot", online && "muddies-presence-dot-online")}
                    aria-hidden="true"
                  />
                  {presence}
                </span>
              ) : null}
            </MuddyCardIdentity>

            <button
              type="button"
              onClick={() => onMessage(person.id)}
              disabled={messagingId === person.id}
              className="muddies-card-action focus-ring"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {messagingId === person.id ? "Opening…" : "Message"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The identity half of a card: tap opens the profile, press-and-hold opens the
 * actions.
 *
 * A phone has no right-click and no hover, so press-and-hold is the only
 * gesture left for "more about this". Without it a card offered exactly one
 * action and no way to reach the rest.
 */
function MuddyCardIdentity({
  person,
  onOpenProfile,
  actions,
  children
}: {
  person: MuddyCardPerson;
  onOpenProfile: () => void;
  actions?: AppMenuItem[];
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasActions = Boolean(actions?.length);
  const { pressing, handlers } = useLongPress(() => setMenuOpen(true), { disabled: !hasActions });

  return (
    <span className="relative block w-full">
      <button
        type="button"
        onClick={(event) => {
          // The hook swallows the click synthesised after a hold, so holding
          // cannot also open the profile behind the menu that just opened.
          handlers.onClick(event);
          if (event.defaultPrevented) return;
          onOpenProfile();
        }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onPointerCancel={handlers.onPointerCancel}
        onContextMenu={handlers.onContextMenu}
        className={cn(
          "muddies-card-identity focus-ring",
          pressing && "scale-95 transition-transform motion-reduce:transform-none"
        )}
      >
        {children}
      </button>

      {hasActions ? (
        <AppMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`Actions for ${person.displayName}`}
          trigger={
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 block h-0" />
          }
          items={actions ?? []}
        />
      ) : null}
    </span>
  );
}
