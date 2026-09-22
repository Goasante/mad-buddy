"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowRight, Bell, Hand, MapPin, MessagesSquare, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import { conversationHref } from "@/lib/messaging/open-conversation";
import { feedback } from "@/lib/feedback/feedback";
import { Button } from "@/components/ui/button";
import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import { PROXIMITY_BAND_LABELS, type ProximityBand } from "@/lib/proximity/bands";
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
  /** Six-state presentation band from the API; drives the Glow and badge. */
  proximityBand?: ProximityBand | null;
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

const PROXIMITY_SUPPORT_COPY: Partial<Record<ProximityBand, string>> = {
  right_here: "Right here ✨",
  around_you: "Very close by ✨",
  close_by: "Close by",
  nearby: "In your area",
  around_town: "Around town",
  further_away: "Nearby"
};

function proximityLabel(muddy: MuddyProfileSummary): string | null {
  if (muddy.proximityBand && muddy.proximityBand !== "outside_range") {
    return PROXIMITY_BAND_LABELS[muddy.proximityBand];
  }

  if (muddy.proximityLevel === "close") return "Very Close";
  if (muddy.proximityLevel === "near") return "In Area";
  if (muddy.proximityLevel === "far") return "Far";
  return null;
}

function supportingLine(muddy: MuddyProfileSummary): string | null {
  const status = muddy.statusText?.trim();
  if (status && !/glow confidence|\bconfidence\b/i.test(status)) return status;
  if (muddy.proximityBand && muddy.proximityBand !== "outside_range") {
    return PROXIMITY_SUPPORT_COPY[muddy.proximityBand] ?? null;
  }
  if (muddy.proximityLevel === "close") return "Very close by ✨";
  if (muddy.proximityLevel === "near") return "In your area";
  if (muddy.proximityLevel === "far") return "Nearby";
  return null;
}

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
        onOpenChange(false);
        router.push(conversationHref(result.conversationId));
        return;
      }
      feedback.error();
      setWaveFeedback(result.message);
    });
  }

  function sendWave() {
    const friendId = muddy?.friendId;
    if (!friendId || isWavePending || waveSent) return;
    startWaveTransition(async () => {
      const result = await sendWaveV2Action(friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) {
        feedback.wave();
        setWaveSent(true);
      } else {
        feedback.error();
      }
    });
  }

  const label = muddy ? proximityLabel(muddy) : null;
  const support = muddy ? supportingLine(muddy) : null;

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
      hideTitle
      owner="MuddyProfileModal"
      widthClassName="max-w-[30rem]"
    >
      {muddy ? (
        <div className="relative isolate overflow-hidden rounded-[1.45rem] border border-border/55 bg-[radial-gradient(circle_at_14%_16%,rgba(232,140,43,0.18),transparent_34%),linear-gradient(160deg,hsl(var(--card)/0.98),hsl(var(--card)/0.90))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-5">
          <div
            className="pointer-events-none absolute -left-10 top-8 -z-10 h-40 w-40 rounded-full bg-[#E88C2B]/10 blur-3xl"
            aria-hidden="true"
          />

          <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 pb-4 pt-5 sm:gap-5 sm:pb-5 sm:pt-3">
            <div className="grid shrink-0 place-items-center px-1 sm:px-2">
              <ProximityGlowAvatar
                src={muddy.avatarUrl}
                name={muddy.displayName}
                band={muddy.proximityBand ?? null}
                glowColorId={muddy.glowColorId}
                size="hero"
                decorative
              />
            </div>

            <div className="min-w-0 pr-9 sm:pr-10">
              <h2 className="truncate text-[1.6rem] font-bold leading-tight tracking-[-0.025em] text-foreground sm:text-[2rem]">
                {muddy.displayName}
              </h2>
              <p className="mt-1 truncate text-sm font-medium text-muted-foreground sm:text-base">@{muddy.username}</p>

              {label ? (
                <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#E88C2B]/60 bg-[#E88C2B]/[0.08] px-3 py-2 text-sm font-semibold text-[#D97718] shadow-[0_0_24px_rgba(232,140,43,0.10)] dark:text-[#FFB15B]">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </div>
              ) : null}

              {support ? (
                <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{support}</p>
              ) : null}
            </div>
          </section>

          {muddy.friendId ? (
            <Button
              type="button"
              size="lg"
              className="safe-motion h-14 w-full rounded-full border border-[#FF9B3A]/40 bg-gradient-to-r from-[#F79A32] via-[#F18424] to-[#E96F17] text-base font-bold text-white shadow-[0_10px_30px_rgba(232,140,43,0.22)] hover:brightness-105 active:scale-[0.985]"
              disabled={waveSent || isWavePending}
              onClick={sendWave}
            >
              <Hand className="h-5 w-5" aria-hidden="true" />
              {isWavePending ? "Waving..." : waveSent ? "Wave sent" : "Wave"}
            </Button>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="safe-motion h-12 min-w-0 rounded-full border-border/80 bg-background/20 px-3 text-sm font-semibold shadow-none backdrop-blur-sm hover:bg-secondary/45 active:scale-[0.985] sm:text-base"
              onClick={() => setPingOpen((current) => !current)}
              aria-expanded={pingOpen}
            >
              <Bell className="h-5 w-5 shrink-0" aria-hidden="true" />
              Ping
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="safe-motion h-12 min-w-0 rounded-full border-border/80 bg-background/20 px-3 text-sm font-semibold shadow-none backdrop-blur-sm hover:bg-secondary/45 active:scale-[0.985] sm:text-base"
              disabled={!muddy?.friendId || isMessagePending}
              onClick={openConversation}
            >
              <MessagesSquare className="h-5 w-5 shrink-0" aria-hidden="true" />
              {isMessagePending ? "Opening…" : "Message"}
            </Button>
          </div>

          {waveFeedback ? (
            <p className="mt-3 rounded-xl bg-secondary/35 px-3 py-2 text-sm text-muted-foreground" role="status">
              {waveFeedback}
            </p>
          ) : null}

          {pingOpen ? (
            <div className="mt-3 rounded-2xl border border-border/65 bg-background/35 p-3 backdrop-blur-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send a ping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CONNECTION_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start rounded-xl"
                    onClick={() => {
                      feedback.selection();
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
            onClick={() => onOpenChange(false)}
            className="focus-ring safe-motion mt-4 flex min-h-14 items-center gap-3 border-t border-border/70 px-1 pt-4 text-sm font-semibold text-foreground hover:text-primary sm:text-base"
          >
            <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">View full profile</span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}
