"use client";

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

export function UpForVisualHarness() {
  return (
    <main className="upfor-review-screen">
      <header className="upfor-review-header">
        <button type="button" aria-label="Back"><ArrowLeft aria-hidden /></button>
        <div><h1>UpFor</h1><p>See what people are up for right now.</p></div>
        <button type="button" className="upfor-review-create" aria-label="Create an UpFor"><Plus aria-hidden /></button>
      </header>
      <section className="upfor-review-body">
        <UpForFeed
          items={ITEMS}
          viewerId="viewer"
          nowMs={NOW}
          onJoin={() => undefined}
          onWithdraw={() => undefined}
          onOpen={() => undefined}
          onCreatePlan={() => undefined}
        />
      </section>
      <nav className="upfor-review-nav" aria-label="Preview navigation">
        <span><MessageCircle aria-hidden />Messages</span>
        <span><Users aria-hidden />Muddies</span>
        <strong>MB</strong>
        <span><Hand aria-hidden />Linkr</span>
        <span className="is-active"><Hand aria-hidden />UpFor</span>
      </nav>
    </main>
  );
}
