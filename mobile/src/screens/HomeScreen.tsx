import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquareText,
  EyeOff,
  Eye,
  RefreshCcw,
  Smile,
  ShieldCheck,
  Image as ImageIcon,
  PartyPopper,
  Users,
  Share2,
  UserPlus,
  AlarmClock,
  Target,
  MapPinOff,
  Bell
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { AVAILABILITY_TYPES, availabilityLabels } from "@/lib/social/rules";
import type { AvailabilityType } from "@/lib/supabase/database.types";
import type { ProximityLevel, ConfidenceLevel } from "@/lib/proximity";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api, postCurrentLocation } from "../lib/api";

type NearbyFriend = {
  friend_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  proximity_level: ProximityLevel;
  glow_strength: number;
  confidence?: ConfidenceLevel;
};
type Plan = { id: string; title: string; startAt: string | null; placeText: string | null; status: string; goingCount: number; myRsvp: string };
type Activity = { id: string; type: string; title: string; message: string; created_at: string };

const quickActions = [
  { label: "Hangout", icon: Smile, to: "/socialize" },
  { label: "Safe Arrival", icon: ShieldCheck, to: "/safety" },
  { label: "Moments", icon: ImageIcon, to: "/moments" },
  { label: "Events", icon: PartyPopper, to: "/events" },
  { label: "Groups", icon: Users, to: "/groups" },
  { label: "Socialize", icon: Share2, to: "/socialize" },
  { label: "Invites", icon: UserPlus, to: "/muddies" },
  { label: "Reminders", icon: AlarmClock, to: "/plans" },
  { label: "Focus", icon: Target, to: "/settings" }
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [ghost, setGhost] = useState(false);
  const [composing, setComposing] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityType>("free");
  const [customText, setCustomText] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [friends, setFriends] = useState<NearbyFriend[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(true);
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [sharingLocation, setSharingLocation] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("full_name, visibility_status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { full_name?: string; visibility_status?: string } | null;
        setFirstName((row?.full_name ?? "").split(" ")[0] ?? "");
        setGhost(row?.visibility_status === "ghost");
      });
  }, [user]);

  const loadNearby = useCallback(async () => {
    setLoadingNearby(true);
    const result = await api.get<{ friends: NearbyFriend[] }>("/api/friends/nearby");
    setLoadingNearby(false);
    if (result.ok) {
      setFriends(result.data.friends);
      setNearbyMessage(result.data.friends.length === 0 ? "No Muddies around right now." : "");
    } else setNearbyMessage(result.error);
  }, []);

  useEffect(() => {
    void loadNearby();
    void api.get<{ plans: Plan[] }>("/api/plans").then((r) => {
      if (r.ok) setPlans(r.data.plans.filter((p) => p.status !== "cancelled" && p.status !== "completed").sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? "")).slice(0, 3));
    });
    void api.get<{ notifications: Activity[] }>("/api/notifications?limit=5").then((r) => {
      if (r.ok) setActivity(r.data.notifications);
    });
  }, [loadNearby]);

  const visibleFriends = friends.filter((f) => f.proximity_level !== "hidden" && f.proximity_level !== "far");
  const nearbyCount = visibleFriends.length;

  async function toggleVisibility() {
    const next = ghost ? "visible" : "ghost";
    setGhost(!ghost);
    await api.post("/api/settings/visibility", next);
  }

  async function shareLocation() {
    setSharingLocation(true);
    const result = await postCurrentLocation();
    setSharingLocation(false);
    if (result.ok) await loadNearby();
    else setNearbyMessage(result.error);
  }

  async function setStatus() {
    setStatusBusy(true);
    setStatusMessage("");
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const result = await api.post<{ ok: boolean; message: string }>("/api/status", {
      availabilityType: availability,
      customText: customText.trim() || undefined,
      expiresAt
    });
    setStatusBusy(false);
    if (result.ok) {
      setStatusMessage(result.data.message);
      setComposing(false);
    } else setStatusMessage(result.error);
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-4 pt-5">
      {/* Greeting */}
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting()}
        {firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">See which approved Muddies are nearby.</p>

      {/* Add status pill */}
      <button
        type="button"
        onClick={() => setComposing((v) => !v)}
        className="focus-ring safe-motion mt-3 inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card/50 px-3 text-sm font-medium text-foreground hover:bg-secondary/60"
      >
        <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Add status
      </button>

      {composing ? (
        <section className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex flex-wrap gap-2">
            {AVAILABILITY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAvailability(type)}
                className={cn(
                  "focus-ring rounded-full border px-3 py-1.5 text-sm",
                  availability === type ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                )}
              >
                {availabilityLabels[type]}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Input placeholder="Add a note (optional)" maxLength={60} value={customText} onChange={(e) => setCustomText(e.target.value)} />
          </div>
          {statusMessage ? <p className="mt-2 text-sm text-primary">{statusMessage}</p> : null}
          <Button className="mt-3 w-full" onClick={setStatus} disabled={statusBusy}>
            {statusBusy ? "Saving…" : "Set status"}
          </Button>
        </section>
      ) : null}

      {/* Visibility card */}
      <section className="mt-4 rounded-2xl bg-card/55 p-5 dark:bg-white/[0.035]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", ghost ? "bg-muted-foreground" : "bg-emerald-400")} aria-hidden="true" />
            <span className="text-sm font-semibold">{ghost ? "Visibility paused" : "Visible"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void toggleVisibility()}
              aria-label={ghost ? "Turn visibility on" : "Turn visibility off"}
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {ghost ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => void loadNearby()}
              aria-label="Refresh"
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <RefreshCcw className={cn("h-4 w-4", loadingNearby && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-sm font-medium">
          {ghost ? "You're hidden" : `${nearbyCount} ${nearbyCount === 1 ? "Muddy" : "Muddies"} nearby`}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {ghost ? "Turn visibility on to appear nearby." : "Approved Muddies can see when you're nearby."}
        </p>
      </section>

      {/* Nearby Muddies */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Nearby Muddies</h2>
        {loadingNearby ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : visibleFriends.length > 0 ? (
          <div className="glow-strip no-scrollbar -mx-4 flex gap-5 overflow-x-auto px-4 pb-3 pt-6" aria-label="Nearby Muddies">
            {visibleFriends.map((friend) => (
              <button key={friend.friend_id} type="button" onClick={() => navigate(`/u/${friend.friend_id}`)} className="focus-ring flex w-24 shrink-0 flex-col items-center gap-2">
                <GlowAvatar name={friend.display_name} src={friend.avatar_url} proximityLevel={friend.proximity_level} glowStrength={friend.glow_strength} confidence={friend.confidence ?? "medium"} size="lg" />
                <span className="max-w-full truncate text-sm font-medium">{friend.display_name.split(" ")[0]}</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {friend.proximity_level === "very_close" ? "Very close" : friend.proximity_level === "nearby" ? "Nearby" : "Around"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/40 p-4">
            <p className="text-sm text-muted-foreground">{nearbyMessage || "No Muddies around right now."}</p>
            <Button variant="outline" className="mt-3 w-full" onClick={() => void shareLocation()} disabled={sharingLocation}>
              {sharingLocation ? "Getting your location…" : "Share my location"}
            </Button>
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Quick actions</h2>
        <div className="grid grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.to)}
              className="focus-ring flex flex-col items-center gap-2 rounded-2xl border border-border bg-card/40 py-4 active:bg-secondary"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <action.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-sm font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Upcoming plans */}
      {plans.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Upcoming plans</h2>
            <button type="button" onClick={() => navigate("/plans")} className="text-sm font-medium text-primary hover:underline">View all</button>
          </div>
          <div className="rounded-2xl border border-border bg-card/40 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-lg font-semibold">{plans[0].title}</p>
              <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs capitalize text-muted-foreground">
                {plans[0].myRsvp === "going" ? "Going" : plans[0].myRsvp}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {plans[0].startAt ? new Date(plans[0].startAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Anytime"}
            </p>
            {plans[0].placeText ? <p className="text-sm text-muted-foreground">{plans[0].placeText}</p> : null}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {Array.from({ length: Math.min(3, plans[0].goingCount) }).map((_, i) => (
                    <span key={i} className="h-7 w-7 rounded-full border-2 border-background bg-secondary" />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{plans[0].goingCount} going</span>
              </div>
              <Button size="sm" onClick={() => navigate("/plans")}>View plan</Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Recent activity */}
      {activity.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
            <button type="button" onClick={() => navigate("/notifications")} className="text-sm font-medium text-primary hover:underline">View all</button>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-border">
            {activity.map((item, index) => (
              <li key={item.id} className={cn("flex items-start gap-3 bg-card/40 p-3", index > 0 && "border-t border-border")}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  {item.type.startsWith("achievement") ? <Bell className="h-4 w-4" aria-hidden="true" /> : <MapPinOff className="h-4 w-4" aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.message}</p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(item.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Muddies open to plans */}
      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Muddies open to plans</h2>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">No Muddies are available right now</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Check again later or start a new plan.</p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("/plans")}>New plan</Button>
        </div>
      </section>
    </div>
  );
}
