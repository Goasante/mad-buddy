"use client";
import { useState, type CSSProperties } from "react";
import { SmartCardHeroV2 } from "./smart-card-v2";
import { SmartCardArtwork } from "./smart-card-artwork";
import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";
import type { SmartCard, SmartCardId } from "@/lib/smart-card/smart-card";
import { FeatureAvailabilityContext } from "@/components/features/feature-availability-context";

const samples: SmartCard[] = [
  { id: "meetup_starting", priority: 0, illustration: "calendar", eyebrow: "MEETUP SOON", title: "Coffee with Ama", subtitle: "Meet at Osu. Open the Meetup to stay coordinated.", meta: "Starts in 45m", metaKind: "time", cta: "Open Meetup", destination: "/meet-up?meetup=sample" },
  { id: "meetup_upcoming", priority: 0, illustration: "calendar", eyebrow: "UPCOMING MEETUP", title: "Saturday football", subtitle: "Open the Meetup to stay coordinated.", meta: "Saturday · 4:00 PM", metaKind: "time", cta: "Open Meetup", destination: "/meet-up?meetup=sample" },
  { id: "meetup_fallback", priority: 0, illustration: "people", eyebrow: "MAKE IT REAL", title: "Turn a connection into a Meetup", subtitle: "Invite a Muddy, or meet someone new nearby when you're open to it.", cta: "Open Meetups", destination: "/meet-up" },
  { id: "muddy_birthday", priority: 0, illustration: "birthday", eyebrow: "TODAY", title: "It’s Ama’s birthday 🎉", person: { displayName: "Ama Mensah", avatarUrl: null }, subtitle: "Send them a birthday wish.", cta: "Open birthday wishes", destination: "/notifications" },
  { id: "journey", priority: 0, illustration: "target", eyebrow: "YOUR NEXT STEP", title: "Build your circle", subtitle: "Take the next step with your Muddies.", cta: "Continue", destination: "/friends", progress: { percent: 50, label: "Journey progress" } },
  { id: "core_fallback", priority: 0, illustration: "people", eyebrow: "YOUR MUDDIES", title: "Keep a real connection moving", subtitle: "Say hello to a Muddy or find someone you already know on Mad Buddy.", cta: "Open Muddies", destination: "/friends" }
];

export function SmartCardReview() {
  const [width, setWidth] = useState(390);
  return <FeatureAvailabilityContext.Provider value={{ linkr: true, events: true, conference: true, meet_up: true }}>
    <main className="mx-auto max-w-6xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">SmartCard presentation review</h1>
      <p>Sample content only. Actions are disabled and this route is unavailable in production.</p>
      <nav className="flex gap-2" aria-label="Review width">{[320, 390, 430, 720].map(value => <button key={value} onClick={() => setWidth(value)} aria-pressed={width === value} className="rounded-lg border px-3 py-2">{value}px</button>)}</nav>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2" onClickCapture={event => { if ((event.target as Element).closest("article a, article button")) { event.preventDefault(); event.stopPropagation(); } }}>
        {[false, true].map(dark => <div key={String(dark)} style={{ "--foreground": dark ? "38 30% 96%" : "3 25% 12%", "--muted-foreground": dark ? "26 10% 68%" : "20 12% 42%", "--background": dark ? "8 18% 8%" : "41 71% 98%" } as CSSProperties} className={dark ? "dark rounded-2xl bg-[#151517] sm:p-3" : "rounded-2xl bg-[#fdfaf5] sm:p-3"}>
          <div className="mx-auto max-w-full space-y-4" style={{ width }}>{samples.map(card => <SmartCardHeroV2 key={card.id} card={card} />)}</div>
        </div>)}
      </div>
      <h2 className="text-lg font-semibold">All {SMART_CARD_APPROVED_STATES.length} reviewed illustration viewports</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{SMART_CARD_APPROVED_STATES.map(state => <figure key={state.id} className="rounded-xl border p-2"><div className="aspect-[4/3]"><SmartCardArtwork card={{ id: state.id as SmartCardId }} /></div><figcaption className="mt-2 break-words text-xs">{state.id}</figcaption></figure>)}</div>
    </main>
  </FeatureAvailabilityContext.Provider>;
}
