"use client";

import { Bell, Hand, MessageCircle, Settings, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { CandidateCard } from "@/components/linkr/candidate-card";
import type { LinkrCandidate } from "@/lib/linkr/candidate-service";

const candidate: LinkrCandidate = {
  userId: "visual-ama",
  displayName: "Ama",
  age: 24,
  intent: "friends",
  bio: "Good coffee, live music and spontaneous plans around Accra.",
  interests: ["Music", "Football", "Travel", "Food"],
  photos: [
    "/visuals/activities/party.jpg",
    "/visuals/activities/coffee.jpg",
    "/visuals/activities/beach.jpg"
  ],
  proximityLabel: "Close By",
  activeNow: true,
  isVerifiedAccount: true,
  eventName: null
};

export function LinkrCardVisualHarness() {
  return (
    <main className="linkr-review-screen">
      <div className="linkr-safe-screen">
        <div className="linkr-shell">
          <header className="linkr-topbar">
            <div>
              <h1 className="linkr-topbar__title">Linkr</h1>
              <p className="linkr-review-subtitle">Meet people. Real vibes.</p>
            </div>
            <div className="linkr-topbar__actions">
              <button type="button" aria-label="Notifications"><Bell aria-hidden /></button>
              <button type="button" aria-label="My Linkr profile"><UserRound aria-hidden /></button>
              <button type="button" aria-label="Filters"><SlidersHorizontal aria-hidden /></button>
              <button type="button" aria-label="Settings"><Settings aria-hidden /></button>
            </div>
          </header>
          <nav className="linkr-chips" aria-label="Discovery distance">
            <span className="linkr-chip linkr-chip--tab is-selected">Around you</span>
            <span className="linkr-chip linkr-chip--tab">Very close</span>
            <span className="linkr-chip linkr-chip--tab">Wider</span>
          </nav>
          <CandidateCard
            candidate={candidate}
            onPass={() => undefined}
            onConnect={() => undefined}
            onUndo={() => undefined}
            canUndo={false}
          />
        </div>
      </div>

      <nav className="linkr-review-nav" aria-label="Preview navigation">
        <span><MessageCircle aria-hidden />Messages</span>
        <span><Users aria-hidden />Muddies</span>
        <strong>MB</strong>
        <span className="is-active"><Hand aria-hidden />Linkr</span>
        <span><Hand aria-hidden />UpFor</span>
      </nav>
    </main>
  );
}
