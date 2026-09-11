"use client";

import { MessageCircle, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { AppMenu, type AppMenuItem } from "@/components/ui/app-dropdown";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useLongPress } from "@/hooks/use-long-press";
import { type MuddyProximity } from "@/lib/friends/muddies-presentation";
import { proximityBandLabel, proximityBandRangeLabel } from "@/lib/proximity/bands";
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
        // Proximity only. No presence: see the note in muddies-presentation.ts.
        const band =
          proximity?.proximityBand && proximity.proximityBand !== "outside_range"
            ? proximity.proximityBand
            : null;
        const proximityText = band ? proximityBandLabel(band) : null;
        const proximityRange = band ? proximityBandRangeLabel(band) : null;

        return (
          <li key={person.id} className="muddies-card">
            <MuddyCardIdentity
              person={person}
              onOpenProfile={() => onOpenProfile(person.id)}
              actions={renderActions?.(person.id)}
            >
              <span className="muddies-card-avatar">
                <ProximityGlowAvatar
                  src={person.avatarUrl}
                  name={person.displayName}
                  band={band}
                  decorative
                  size="lg"
                />
              </span>

              <span className="muddies-card-name-row">
                <span className="muddies-card-name">{person.displayName}</span>
                <PremiumPlanBadge plan={person.plan} compact />
                <VerifiedAccountMark isVerifiedAccount={person.isVerifiedAccount ?? false} compact />
                <TrustedMemberMark trustedSince={person.trustedSince ?? null} compact />
              </span>

              {proximityText ? (
                <span className="muddies-card-presence">
                  <span className="block font-semibold">{proximityText}</span>
                  {proximityRange ? (
                    <span className="mt-0.5 block text-[11px] font-medium leading-4 text-muted-foreground/75">
                      {proximityRange}
                    </span>
                  ) : null}
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
 *
 * WHY THE CONTAINER IS NOT A BUTTON.
 *
 * It used to be, and the identity content it wraps includes the verified mark
 * -- which is itself a real button (it opens a popover explaining what
 * verification means). A <button> inside a <button> is invalid HTML: React
 * reported a hydration error on every render of this page, and browsers are
 * free to reparent the inner control, so the badge's own tap target was never
 * guaranteed to survive.
 *
 * The fix separates the two roles rather than removing either. The container is
 * a plain element that carries the press-and-hold gestures; navigation lives in
 * ONE absolutely-positioned button stretched behind the content. The badge then
 * sits ABOVE that button in the stacking order, so both targets are real,
 * neither is nested, and the markup is valid.
 *
 * The navigation button is the card's accessible name, so a screen reader
 * announces "Ama Boateng, open profile" once -- the visible identity text is
 * decorative, exactly as it was before.
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
      <span
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onPointerCancel={handlers.onPointerCancel}
        onContextMenu={handlers.onContextMenu}
        className={cn(
          "relative block w-full",
          pressing && "scale-95 transition-transform motion-reduce:transform-none"
        )}
      >
        <button
          type="button"
          onClick={(event) => {
            handlers.onClick(event);
            if (event.defaultPrevented) return;
            onOpenProfile();
          }}
          aria-label={`${person.displayName}, open profile`}
          className="focus-ring absolute inset-0 z-0 block w-full rounded-[inherit]"
        />

        <span className="muddies-card-identity pointer-events-none relative z-10 [&_button]:pointer-events-auto">
          {children}
        </span>
      </span>

      {hasActions ? (
        <AppMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`Actions for ${person.displayName}`}
          trigger={
            <button
              type="button"
              aria-label={`More actions for ${person.displayName}`}
              className="muddies-card-more focus-ring"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          }
          items={actions ?? []}
        />
      ) : null}
    </span>
  );
}
