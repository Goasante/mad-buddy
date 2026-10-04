"use client";
import { useState } from "react";
import { SmartCardHeroV2 } from "./smart-card-v2";
import { SmartCardArtwork } from "./smart-card-artwork";
import { SMART_CARD_APPROVED_STATES } from "@/lib/smart-card/catalog";
import type { SmartCard, SmartCardId } from "@/lib/smart-card/smart-card";
import { FeatureAvailabilityContext } from "@/components/features/feature-availability-context";

const samples: SmartCard[] = [
  { id: "weekend_plans", priority: 0, illustration: "calendar", eyebrow: "THIS WEEKEND", title: "Make weekend plans", subtitle: "Nothing on yet. Put something together with your Muddies.", cta: "Create a Plan", destination: "/plans?create=1" },
  { id: "plan_rsvp", priority: 0, illustration: "calendar", eyebrow: "NEEDS YOUR RESPONSE", title: "A very long picnic Plan title needs your answer", subtitle: "A Muddy invited you. Choose whether you'd like to join.", meta: "Starts tomorrow", metaKind: "time", socialProof: "3 going · 1 maybe", cta: "Respond", destination: "/plans", secondaryAction: { label: "Open Plans", destination: "/plans" } },
  { id: "safe_arrival", priority: 0, illustration: "people", eyebrow: "SAFE ARRIVAL · CHECK IN", title: "Confirm you arrived", subtitle: "Your Muddies are checking on you. Let them know you arrived.", cta: "Open Safe Arrival", destination: "/safe-arrival" },
  { id: "muddy_birthday", priority: 0, illustration: "birthday", eyebrow: "A MUDDY'S BIRTHDAY", title: "Make someone's day", subtitle: "A thoughtful hello goes a long way.", cta: "Say happy birthday", destination: "/messages" },
  { id: "journey", priority: 0, illustration: "target", eyebrow: "YOUR NEXT STEP", title: "Build your circle", subtitle: "Take the next step with your Muddies.", cta: "Continue", destination: "/friends", progress: { percent: 50, label: "Journey progress" } },
  { id: "core_fallback", priority: 0, illustration: "people", eyebrow: "YOUR MUDDIES", title: "Make room for a real connection", subtitle: "Say hello to a Muddy or make a Plan to catch up.", cta: "Open Muddies", destination: "/friends" }
];

export function SmartCardReview() {
  const [width, setWidth] = useState(360);
  return <FeatureAvailabilityContext.Provider value={{ upfor: true, linkr: true, events: true, conference: true, safe_arrival: true }}>
    <main className="mx-auto max-w-6xl space-y-6 p-4">
      <h1 className="text-xl font-semibold">SmartCard presentation review</h1>
      <p>Sample content only. Actions are disabled and this route is unavailable in production.</p>
      <nav className="flex gap-2" aria-label="Review width">{[320, 360, 480, 720].map(value => <button key={value} onClick={() => setWidth(value)} aria-pressed={width === value} className="rounded-lg border px-3 py-2">{value}px</button>)}</nav>
      <div className="grid items-start gap-6 lg:grid-cols-2" onClickCapture={event => { if ((event.target as Element).closest("article a, article button")) { event.preventDefault(); event.stopPropagation(); } }}>
        {[false, true].map(dark => <div key={String(dark)} className={dark ? "dark rounded-2xl bg-[#151517] p-3" : "rounded-2xl bg-[#fdfaf5] p-3"}>
          <div className="mx-auto max-w-full space-y-4" style={{ width }}>{samples.map(card => <SmartCardHeroV2 key={card.id} card={card} />)}</div>
        </div>)}
      </div>
      <h2 className="text-lg font-semibold">All 58 reviewed illustration viewports</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{SMART_CARD_APPROVED_STATES.map(state => <figure key={state.id} className="rounded-xl border p-2"><div className="aspect-[4/3]"><SmartCardArtwork card={{ id: state.id as SmartCardId }} /></div><figcaption className="mt-2 break-words text-xs">{state.id}</figcaption></figure>)}</div>
    </main>
  </FeatureAvailabilityContext.Provider>;
}
