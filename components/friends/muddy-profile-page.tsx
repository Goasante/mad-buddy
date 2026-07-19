"use client";

import Link from "next/link";
import { BadgeCheck, ChevronLeft, Hand, MessagesSquare } from "lucide-react";
import { useState, useTransition } from "react";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { CONNECTION_PROMPTS } from "@/lib/meetups/connection-prompts";
import type { PublicTrustSummary } from "@/lib/discovery/trust";
import type { VisibleProfileFields } from "@/lib/profile/service";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";

export type MuddyProfileData = {
  friendId: string;
  displayName: string;
  username: string;
  bio: string;
  moodStatus: string;
  mutualMuddies: number;
  proximityLevel?: ProximityLevel;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
};

export function MuddyProfilePage({
  muddy,
  trust = null,
  fields = null
}: {
  muddy: MuddyProfileData;
  trust?: PublicTrustSummary | null;
  fields?: VisibleProfileFields | null;
}) {
  const [pingOpen, setPingOpen] = useState(false);
  const [waveSent, setWaveSent] = useState(false);
  const [waveFeedback, setWaveFeedback] = useState("");
  const [isWavePending, startWaveTransition] = useTransition();
  const [isPingPending, startPingTransition] = useTransition();

  function sendWave() {
    startWaveTransition(async () => {
      const result = await sendWaveV2Action(muddy.friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) setWaveSent(true);
    });
  }

  function sendPing(message: string) {
    startPingTransition(async () => {
      const result = await createMeetupRequestAction({ receiverId: muddy.friendId, message });
      setWaveFeedback(result.message);
      if (result.ok) setPingOpen(false);
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <Link href="/friends" className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Muddies
      </Link>

      <Card className="overflow-hidden p-0">
        <div className="h-28 bg-[linear-gradient(135deg,hsl(var(--primary)/0.55),hsl(24_90%_35%/0.85))] sm:h-36" />
        <div className="px-5 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-col items-start gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-3">
              <GlowAvatar
                name={muddy.displayName}
                proximityLevel={muddy.proximityLevel}
                glowStrength={muddy.glowStrength}
                confidence={muddy.confidence}
                size="xl"
                className="border-4 border-card"
              />
              <div className="pb-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{muddy.displayName}</h1>
                </div>
                <p className="text-sm text-muted-foreground">@{muddy.username}</p>
                {muddy.proximityLevel ? <div className="mt-1"><ProximityBadge proximityLevel={muddy.proximityLevel} /></div> : null}
                {trust ? (
                  // Safe public trust signals only (batch 8 §57), never
                  // internal risk data.
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {trust.badgeLabel ? (
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {trust.badgeLabel}
                      </span>
                    ) : null}
                    {trust.mutualCount > 0 ? (
                      <span>
                        {trust.mutualCount} mutual {trust.mutualCount === 1 ? "Muddy" : "Muddies"}
                      </span>
                    ) : null}
                    <span>{trust.accountAgeLabel}</span>
                    {trust.sharedCommunity ? <span>{trust.sharedCommunity}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant={waveSent ? "outline" : "primary"}
              disabled={waveSent || isWavePending}
              onClick={sendWave}
            >
              <Hand className="h-4 w-4" aria-hidden="true" />
              {isWavePending ? "Waving..." : waveSent ? "Wave sent" : "Wave"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPingOpen((current) => !current)}>
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
              Ping
            </Button>
          </div>
          {waveFeedback ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {waveFeedback}
            </p>
          ) : null}

          {pingOpen ? (
            <div className="mt-4 rounded-xl border border-border/70 bg-card/50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send a ping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CONNECTION_PROMPTS.map((prompt) => (
                  <Button key={prompt.label} type="button" variant="outline" size="sm" className="justify-start" disabled={isPingPending} onClick={() => sendPing(prompt.message)}>
                    {prompt.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</p>
            <p className="mt-2 text-sm leading-6">{muddy.bio || "No bio yet."}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You have in common</p>
            <p className="mt-2 text-sm">{muddy.mutualMuddies} mutual Muddies</p>
          </div>
          {fields &&
          (fields.pronouns || fields.institution || fields.programme || fields.graduationYear || fields.generalArea) ? (
            <div className="rounded-xl border border-border/70 bg-card/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
              <dl className="mt-2 space-y-1 text-sm">
                {fields.pronouns ? <DetailRow label="Pronouns" value={fields.pronouns} /> : null}
                {fields.institution ? <DetailRow label="Institution" value={fields.institution} /> : null}
                {fields.programme ? <DetailRow label="Programme" value={fields.programme} /> : null}
                {fields.graduationYear ? <DetailRow label="Class of" value={String(fields.graduationYear)} /> : null}
                {fields.generalArea ? <DetailRow label="Around" value={fields.generalArea} /> : null}
              </dl>
            </div>
          ) : null}
          {fields?.interests?.length ? (
            <div className="rounded-xl border border-border/70 bg-card/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interests</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fields.interests.map((interest) => (
                  <span key={interest} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        {muddy.moodStatus ? (
        <div className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
          <p className="mt-2 text-sm leading-6">{muddy.moodStatus}</p>
        </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
