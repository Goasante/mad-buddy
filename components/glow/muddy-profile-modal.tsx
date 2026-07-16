"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Hand, MessageCircle, MessagesSquare } from "lucide-react";
import { sendWaveAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { Modal } from "@/components/ui/modal";
import { CONNECTION_PROMPTS } from "@/lib/meetups/connection-prompts";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";

export type MuddyProfileSummary = {
  friendId?: string;
  displayName: string;
  username: string;
  about?: string;
  mutualMuddies?: number;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
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

  function sendWave() {
    const friendId = muddy?.friendId;
    if (!friendId) return;
    startWaveTransition(async () => {
      const result = await sendWaveAction(friendId);
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
    >
      {muddy ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <GlowAvatar
              name={muddy.displayName}
              proximityLevel={muddy.proximityLevel}
              glowStrength={muddy.glowStrength}
              confidence={muddy.confidence}
              size="lg"
            />
            <div className="min-w-0">
              {muddy.proximityLevel ? <ProximityBadge proximityLevel={muddy.proximityLevel} /> : null}
              {typeof muddy.mutualMuddies === "number" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {muddy.mutualMuddies} mutual {muddy.mutualMuddies === 1 ? "Muddy" : "Muddies"}
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</p>
            <p className="mt-1.5 text-sm leading-6">{muddy.about?.trim() || "No bio yet."}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {muddy.friendId ? (
              <Button
                type="button"
                variant="outline"
                disabled={waveSent || isWavePending}
                onClick={sendWave}
              >
                <Hand className="h-4 w-4" aria-hidden="true" />
                {isWavePending ? "Waving..." : waveSent ? "Wave sent" : "Wave"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setPingOpen((current) => !current)}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Ping
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/messages">
                <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                Message
              </Link>
            </Button>
          </div>

          {waveFeedback ? (
            <p className="text-sm text-muted-foreground" role="status">
              {waveFeedback}
            </p>
          ) : null}

          <Link
            href={`/friends/${muddy.username}`}
            className="focus-ring safe-motion inline-block text-sm font-medium text-primary hover:underline"
          >
            View full profile →
          </Link>

          {pingOpen ? (
            <div className="rounded-xl border border-border/70 bg-card/50 p-3">
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
        </div>
      ) : null}
    </Modal>
  );
}
