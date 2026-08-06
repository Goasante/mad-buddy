"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Hand, MessageCircle, MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import { conversationHref } from "@/lib/messaging/open-conversation";
import { Button } from "@/components/ui/button";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { Modal } from "@/components/ui/modal";
import { CONNECTION_PROMPTS } from "@/lib/meetups/connection-prompts";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export type MuddyProfileSummary = {
  friendId?: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  statusText?: string;
  mutualMuddies?: number;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  glowColorId?: string | null;
  plan?: SubscriptionPlan;
};

export type MuddyProfileModalProps = {
  muddy: MuddyProfileSummary | null;
  onOpenChange: (open: boolean) => void;
  onSendPing?: (message: string) => void;
};

export function MuddyProfileModal({ muddy, onOpenChange, onSendPing }: MuddyProfileModalProps) {
  const [pingOpen, setPingOpen] = useState(false);
  const [waveSent, setWaveSent] = useState(false);
  const [waveFeedback, setWaveFeedback] = useState("");
  const [isWavePending, startWaveTransition] = useTransition();
  const [isMessagePending, startMessageTransition] = useTransition();
  const router = useRouter();

  /**
   * Open (or create) the direct conversation and go straight to it.
   *
   * This used to be a bare <Link href="/messages">, which navigated to the
   * inbox and left the user to find the person again — the Message button
   * never resolved a conversation at all.
   *
   * Identity is the stable friendId, never the username. The server resolves
   * one canonical direct conversation from the user pair, re-checks
   * eligibility, and returns its id.
   */
  function openConversation() {
    const friendId = muddy?.friendId;
    if (!friendId || isMessagePending) return;
    startMessageTransition(async () => {
      const result = await openDirectConversationAction(friendId);
      if (result.ok && result.conversationId) {
        // The exact conversation, never a bare push to the inbox.
        onOpenChange(false);
        router.push(conversationHref(result.conversationId));
        return;
      }
      // Already-generalised server copy: never a raw database error, and
      // never a reason that would reveal a block.
      setWaveFeedback(result.message);
    });
  }

  function sendWave() {
    const friendId = muddy?.friendId;
    if (!friendId) return;
    startWaveTransition(async () => {
      const result = await sendWaveV2Action(friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) setWaveSent(true);
    });
  }

  return (
    <Modal
      open={Boolean(muddy)}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) {
          setPingOpen(false);
          setWaveSent(false);
          setWaveFeedback("");
        }
      }}
      title={muddy?.displayName ?? "Muddy"}
      description={muddy ? `@${muddy.username}` : undefined}
      variant="sheet"
      compact
    >
      {muddy ? (
        <div className="space-y-3 pb-0.5">
          <section className="muddy-profile-preview flex items-center gap-2 rounded-xl bg-secondary/45 px-2 py-1.5 sm:gap-3 sm:px-3">
            <div className="grid shrink-0 place-items-center p-6 sm:p-7">
              <GlowAvatar
                src={muddy.avatarUrl}
                name={muddy.displayName}
                proximityLevel={muddy.proximityLevel}
                glowStrength={muddy.glowStrength}
                confidence={muddy.confidence}
                glowColorId={muddy.glowColorId}
                size="lg"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <PremiumPlanBadge plan={muddy.plan} />
                {muddy.proximityLevel ? <ProximityBadge proximityLevel={muddy.proximityLevel} /> : null}
                {muddy.confidence ? (
                  <span className="text-xs capitalize text-muted-foreground">{muddy.confidence} confidence</span>
                ) : null}
              </div>
              {muddy.statusText?.trim() && !/^glow confidence/i.test(muddy.statusText) ? (
                <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{muddy.statusText}</p>
              ) : null}
              {typeof muddy.mutualMuddies === "number" ? (
                <p className="text-xs text-muted-foreground">
                  {muddy.mutualMuddies} mutual {muddy.mutualMuddies === 1 ? "Muddy" : "Muddies"}
                </p>
              ) : null}
            </div>
          </section>

          <div className="grid grid-cols-3 gap-2">
            {muddy.friendId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-w-0 px-2 text-xs shadow-none sm:text-sm"
                disabled={waveSent || isWavePending}
                onClick={sendWave}
              >
                <Hand className="h-4 w-4" aria-hidden="true" />
                {isWavePending ? "Waving..." : waveSent ? "Wave sent" : "Wave"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 px-2 text-xs shadow-none sm:text-sm"
              onClick={() => setPingOpen((current) => !current)}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Ping
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 px-2 text-xs shadow-none sm:text-sm"
              // Guard the double tap: two in-flight opens would race to create
              // the same conversation. The server de-duplicates on direct_key
              // regardless, but there is no reason to send the second request.
              disabled={!muddy?.friendId || isMessagePending}
              onClick={openConversation}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
              {isMessagePending ? "Opening…" : "Message"}
            </Button>
          </div>

          {waveFeedback ? (
            <p className="text-sm text-muted-foreground" role="status">
              {waveFeedback}
            </p>
          ) : null}

          {pingOpen ? (
            <div className="rounded-xl border border-border/70 bg-secondary/25 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Send a ping
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CONNECTION_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      onSendPing?.(prompt.message);
                      setPingOpen(false);
                    }}
                  >
                    {prompt.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">No exact location is shared.</p>
            </div>
          ) : null}

          <Link
            href={`/friends/${muddy.username}`}
            className="focus-ring safe-motion flex min-h-10 items-center justify-between rounded-lg border-t border-border/70 px-1 pt-2 text-sm font-semibold text-primary hover:text-primary/80"
          >
            <span>View full profile</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}
