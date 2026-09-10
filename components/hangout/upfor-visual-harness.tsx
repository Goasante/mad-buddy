"use client";

import { useState } from "react";
import { QuickActionsLauncher } from "@/components/app-shell/quick-actions-launcher";
import { UpForCard } from "@/components/hangout/upfor-card";
import { ArrowLeft, Hand, MessageCircle, Plus, Users } from "lucide-react";
import { UpForFeed, type UpForFeedItem } from "@/components/hangout/upfor-feed";

const NOW = Date.parse("2026-08-26T18:00:00.000Z");
const endsIn = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const ITEMS: UpForFeedItem[] = [
  {
    id: "coffee", ownerId: "ama", ownerName: "Ama Boateng", ownerAvatarUrl: "/visuals/activities/coffee.jpg",
    activityType: "coffee", message: "Looking for someone to grab coffee around Cantonments.", areaTier: "close_by",
    broadAreaText: null, startsAt: new Date(NOW - 12 * 60_000).toISOString(), endsAt: endsIn(40), status: "active",
    goingCount: 3, myRequestStatus: null, allowPings: true,
    participants: [{ userId: "p1", name: "Kojo", avatarUrl: "/visuals/activities/picnic.jpg" }, { userId: "p2", name: "Naa", avatarUrl: null }],
    isMuddy: true, viaGroup: false
  },
  {
    id: "lunch", ownerId: "efua", ownerName: "Efua Sarpong", ownerAvatarUrl: "/visuals/activities/dinner.jpg",
    activityType: "food", message: "Let's grab lunch somewhere good and catch up.", areaTier: "nearby",
    broadAreaText: null, startsAt: new Date(NOW - 8 * 60_000).toISOString(), endsAt: endsIn(75), status: "active",
    goingCount: 2, myRequestStatus: "accepted", allowPings: true,
    participants: [{ userId: "p3", name: "Yaw", avatarUrl: null }], isMuddy: true, viaGroup: false
  },
  {
    id: "football", ownerId: "kwesi", ownerName: "Kwesi Mensah", ownerAvatarUrl: "/visuals/activities/football.jpg",
    activityType: "football", message: "Need two more for a quick game at the park.", areaTier: "close_by",
    broadAreaText: null, startsAt: new Date(NOW - 20 * 60_000).toISOString(), endsAt: endsIn(50), status: "active",
    goingCount: 4, myRequestStatus: null, allowPings: true,
    participants: [{ userId: "p4", name: "Joe", avatarUrl: null }, { userId: "p5", name: "Kofi", avatarUrl: null }, { userId: "p6", name: "Esi", avatarUrl: null }],
    isMuddy: false, viaGroup: true
  },
  {
    id: "walk", ownerId: "naa", ownerName: "Naa Quartey", ownerAvatarUrl: "/visuals/activities/beach.jpg",
    activityType: "walk", message: "Beach walk and good vibes. Anyone around?", areaTier: "wider_area",
    broadAreaText: null, startsAt: new Date(NOW - 5 * 60_000).toISOString(), endsAt: endsIn(30), status: "active",
    goingCount: 1, myRequestStatus: null, allowPings: true, participants: [], isMuddy: false, viaGroup: false
  },
  {
    id: "study", ownerId: "viewer", ownerName: "You", ownerAvatarUrl: null,
    activityType: "study", message: "Quiet study session before tomorrow's lecture.", areaTier: "nearby",
    broadAreaText: null, startsAt: new Date(NOW - 3 * 60_000).toISOString(), endsAt: endsIn(110), status: "active",
    goingCount: 3, myRequestStatus: null, allowPings: true,
    participants: [{ userId: "p7", name: "Akos", avatarUrl: null }, { userId: "p8", name: "Sam", avatarUrl: null }], isMuddy: true, viaGroup: false
  },
  {
    id: "movie", ownerId: "adwoa", ownerName: "Adwoa Nyarko", ownerAvatarUrl: "/visuals/activities/movie.jpg",
    activityType: "movie", message: "Last-minute movie night; choosing between two new releases.", areaTier: null,
    broadAreaText: null, startsAt: new Date(NOW - 7 * 60_000).toISOString(), endsAt: endsIn(12), status: "active",
    goingCount: 1, myRequestStatus: "pending", allowPings: true, participants: [], isMuddy: true, viaGroup: false
  },
  {
    id: "party", ownerId: "jo", ownerName: "Jo Ansah", ownerAvatarUrl: "/visuals/activities/party.jpg",
    activityType: "party", message: "Small rooftop party with friends from the creative group.", areaTier: "nearby",
    broadAreaText: null, startsAt: new Date(NOW - 25 * 60_000).toISOString(), endsAt: endsIn(150), status: "active",
    goingCount: 5, myRequestStatus: null, allowPings: true,
    participants: [{ userId: "p9", name: "Mawuli", avatarUrl: null }], isMuddy: false, viaGroup: true
  },
  {
    id: "ended", ownerId: "kobby", ownerName: "Kobby Osei", ownerAvatarUrl: null,
    activityType: "gaming", message: "One quick round before I head out.", areaTier: "nearby", broadAreaText: null,
    startsAt: new Date(NOW - 70 * 60_000).toISOString(), endsAt: new Date(NOW - 60_000).toISOString(), status: "ended",
    goingCount: 1, myRequestStatus: null, allowPings: false, participants: [], isMuddy: true, viaGroup: false
  }
];

// Synthetic fixtures only; the route is unavailable in production.
const REVIEW_ITEMS: UpForFeedItem[] = [
  { ...ITEMS[0], id: "fresh-food", ownerId: "ama", activityType: "food", message: null, participants: [], endsAt: endsIn(0.5) },
  { ...ITEMS[0], id: "fresh-sports", ownerId: "ama", activityType: "sports", message: null, participants: [], endsAt: endsIn(183) },
  { ...ITEMS[1], id: "going", message: null, participants: [] },
  { ...ITEMS[5], id: "pending", message: null },
  { ...ITEMS[0], id: "legacy-joined", myRequestStatus: "maybe", message: null, participants: [] },
  { ...ITEMS[3], id: "scheduled", startsAt: endsIn(123), endsAt: endsIn(183), status: "scheduled", message: null },
  { ...ITEMS[0], id: "long-name", ownerName: "Alexandria Akosua Mensah Asante", activityType: "anything", ownerAvatarUrl: null, message: null, participants: [] },
  { ...ITEMS[4], id: "owner", message: null },
  { ...ITEMS[0], id: "image-error", ownerId: "other", ownerName: "Kojo Mensah", ownerAvatarUrl: "/missing-profile-review.jpg", message: "A longer optional invitation remains readable without colliding with the action rail.", participants: [] },
];

export function UpForVisualHarness() {
  const [items, setItems] = useState(REVIEW_ITEMS);
  const [opened, setOpened] = useState<string | null>(null);
  const respond = (id: string, status: string | null) => setItems(rows => rows.map(row => row.id === id ? { ...row, myRequestStatus: status } : row));
  return (
    <main className="upfor-review-screen" style={{ paddingBottom: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + 1.5rem)" }}>
      <div className="upfor-page" style={{ paddingInline: "1rem" }}>
        <header className="upfor-header">
          <button type="button" className="upfor-back" aria-label="Back"><ArrowLeft aria-hidden /></button>
          <div className="min-w-0 flex-1"><h1 className="upfor-title">UpFor</h1><p className="upfor-subtitle">See what people are up for</p></div>
          <div className="upfor-header-actions"><button type="button" className="upfor-create-button" aria-label="Create an UpFor"><Plus aria-hidden /></button></div>
        </header>
        <UpForFeed items={items} viewerId="viewer" nowMs={NOW}
          onJoin={id => respond(id, "pending")} onWithdraw={id => respond(id, null)}
          onOpen={setOpened} onCreatePlan={setOpened} />
        <UpForCard upfor={ITEMS[7]} viewerId="viewer" nowMs={NOW} responseState="idle" onJoin={() => undefined} onWithdraw={() => undefined} />
        {opened ? <p role="status">Opened {opened}</p> : null}
      </div>
      <QuickActionsLauncher />
      <nav className="fixed inset-x-0 bottom-0 z-50" aria-label="Mobile navigation">
        <ul>
          <li><a href="#" aria-label="Messages"><MessageCircle /></a></li>
          <li><a href="#" aria-label="Muddies"><Users /></a></li>
          <li><a href="#" aria-label="Home"><strong>MB</strong></a></li>
          <li><a href="#" aria-label="Linkr"><Hand /></a></li>
          <li><a href="#" aria-label="UpFor" aria-current="page"><Hand /></a></li>
        </ul>
      </nav>
    </main>
  );
}
