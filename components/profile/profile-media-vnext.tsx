"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Images, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { Card } from "@/components/ui/card";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";

export function ProfileMediaVNext({
  displayName,
  avatarUrl,
  photos,
  momentCount,
  momentsEnabled = false
}: {
  displayName: string;
  avatarUrl: string | null;
  photos: ProfilePhoto[];
  momentCount: number;
  /** Moments is pausable. When off, /moments redirects, so the card must not appear. */
  momentsEnabled?: boolean;
}) {
  const router = useRouter();
  const avatarSrc = avatarUrl ? "/api/profile/avatar" : null;

  return (
    <main className="mx-auto w-full max-w-3xl pb-24 pt-2 sm:pb-12">
      <header className="flex items-center gap-3 px-1 pb-4">
        <Link href="/profile-lab" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Back to Profile Lab">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Profile VNext</p>
          <h1 className="text-xl font-semibold tracking-tight">Media</h1>
        </div>
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <section className="relative overflow-hidden rounded-[2rem] border border-[#E88C2B]/20 bg-[#FEFBF3] p-5 shadow-[0_22px_60px_rgba(78,4,1,0.07)] dark:bg-card sm:p-7">
        <div className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-[#E88C2B]/12 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 top-0 h-36 w-36 rounded-full bg-[#4E0401]/8 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A65A17]">Your visual identity</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Showcase + Moments</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Mad Buddy does not pretend Showcase photos are Snapchat Highlights. Showcase is your persistent profile gallery; Moments are your real social activity.</p>
        </div>
      </section>

      <div className="mt-5 grid gap-5">
        <section aria-labelledby="profile-media-showcase-heading">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div>
              <h2 id="profile-media-showcase-heading" className="flex items-center gap-2 text-base font-semibold"><Images className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> Showcase</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Up to three profile photos, each with its own audience.</p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{photos.length}/3</span>
          </div>
          <Card className="border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">
            <ProfilePhotoCarousel
              photos={photos}
              isOwner
              ownerName={displayName}
              avatarUrl={avatarSrc}
              presentation="showcase"
              onChanged={() => router.refresh()}
            />
          </Card>
        </section>

        {momentsEnabled ? (
        <section aria-labelledby="profile-media-moments-heading">
          <div className="mb-2 px-1">
            <h2 id="profile-media-moments-heading" className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> Moments</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Your existing Moments remain the canonical story of what you have shared.</p>
          </div>
          <Link href="/moments" className="focus-ring safe-motion group flex min-h-28 items-center gap-4 rounded-[1.5rem] border border-border/60 bg-card/75 p-5 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[1.2rem] bg-[#E88C2B]/12 text-[#A65A17]"><Sparkles className="h-7 w-7" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold">{momentCount.toLocaleString()} {momentCount === 1 ? "Moment" : "Moments"}</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">Open the real Moments experience to view, create and manage what you have shared.</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </section>
        ) : null}

        <section className="rounded-[1.5rem] border border-[#4E0401]/10 bg-[#4E0401]/[0.035] p-5 dark:bg-card">
          <h2 className="text-sm font-semibold">Why there is no fake Highlights section</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Permanent named Highlight collections do not have a canonical Mad Buddy backend yet. VNext keeps the UI honest: persistent identity lives in Showcase; social sharing lives in Moments.</p>
        </section>
      </div>
    </main>
  );
}
