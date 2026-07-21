import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, MapPin, CalendarPlus, UserPlus, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AVAILABILITY_TYPES, availabilityLabels } from "@/lib/social/rules";
import type { AvailabilityType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api, postCurrentLocation } from "../lib/api";

type NearbyFriend = {
  friend_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  proximity_level: "very_close" | "nearby" | "around" | "far" | "hidden";
  glow_strength: number;
};

type Plan = {
  id: string;
  title: string;
  startAt: string | null;
  placeText: string | null;
  organiserName: string;
  status: string;
  goingCount: number;
};

const proximityLabels: Record<NearbyFriend["proximity_level"], string> = {
  very_close: "Very close",
  nearby: "Nearby",
  around: "Around",
  far: "Far",
  hidden: "Hidden"
};

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
  const [availability, setAvailability] = useState<AvailabilityType>("free");
  const [customText, setCustomText] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [friends, setFriends] = useState<NearbyFriend[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(true);
  const [nearbyMessage, setNearbyMessage] = useState("");
  const [sharingLocation, setSharingLocation] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as { full_name?: string } | null)?.full_name ?? "";
        setFirstName(name.split(" ")[0] ?? "");
      });
  }, [user]);

  const loadNearby = useCallback(async () => {
    setLoadingNearby(true);
    const result = await api.get<{ friends: NearbyFriend[] }>("/api/friends/nearby");
    setLoadingNearby(false);
    if (result.ok) {
      setFriends(result.data.friends);
      setNearbyMessage(result.data.friends.length === 0 ? "No Muddies around right now." : "");
    } else {
      setNearbyMessage(result.error);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    const result = await api.get<{ plans: Plan[] }>("/api/plans");
    if (result.ok) {
      const upcoming = result.data.plans
        .filter((plan) => plan.status !== "cancelled" && plan.status !== "completed")
        .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""))
        .slice(0, 3);
      setPlans(upcoming);
    }
  }, []);

  useEffect(() => {
    void loadNearby();
    void loadPlans();
  }, [loadNearby, loadPlans]);

  async function shareLocation() {
    setSharingLocation(true);
    setNearbyMessage("");
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
    setStatusMessage(result.ok ? result.data.message : result.error);
  }

  async function clearStatus() {
    setStatusBusy(true);
    setStatusMessage("");
    const result = await api.del<{ ok: boolean; message: string }>("/api/status");
    setStatusBusy(false);
    setStatusMessage(result.ok ? "Status cleared." : result.error);
  }

  return (
    <Screen title={firstName ? `${greeting()}, ${firstName}` : "Home"}>
      {/* Quick actions */}
      <div className="mb-5 grid grid-cols-3 gap-2">
        <QuickAction icon={CalendarPlus} label="New plan" onClick={() => navigate("/plans")} />
        <QuickAction icon={UserPlus} label="Add Muddy" onClick={() => navigate("/muddies")} />
        <QuickAction icon={CalendarDays} label="Plans" onClick={() => navigate("/plans")} />
      </div>

      {/* Glow */}
      <section className="glass-panel rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Your glow</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Let your Muddies know you're around. Nothing shows until you set it.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
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

        <div className="mt-4">
          <Input
            placeholder="Add a note (optional)"
            maxLength={60}
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
          />
        </div>

        {statusMessage ? <p className="mt-3 text-sm text-primary">{statusMessage}</p> : null}

        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={setStatus} disabled={statusBusy}>
            {statusBusy ? "Saving…" : "Turn glow on"}
          </Button>
          <Button variant="outline" size="icon" onClick={clearStatus} disabled={statusBusy} aria-label="Clear status">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </section>

      {/* Upcoming plans */}
      {plans.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming plans</h2>
            <button type="button" onClick={() => navigate("/plans")} className="focus-ring text-sm text-primary">
              See all
            </button>
          </div>
          <ul className="space-y-2">
            {plans.map((plan) => (
              <li key={plan.id} className="rounded-xl border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{plan.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{plan.goingCount} going</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {plan.startAt ? new Date(plan.startAt).toLocaleString() : "Anytime"}
                  {plan.placeText ? ` · ${plan.placeText}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Around you */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Around you</h2>
          <button type="button" onClick={() => void loadNearby()} className="focus-ring text-sm text-primary">
            Refresh
          </button>
        </div>

        <Button variant="outline" className="mb-3 w-full" onClick={() => void shareLocation()} disabled={sharingLocation}>
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {sharingLocation ? "Getting your location…" : "Share my location to see who's near"}
        </Button>

        {loadingNearby ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : friends.length === 0 ? (
          <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            {nearbyMessage || "No Muddies around right now."}
          </p>
        ) : (
          <ul className="space-y-2">
            {friends.map((friend) => (
              <li key={friend.friend_id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold"
                  style={{ boxShadow: `0 0 ${8 + friend.glow_strength / 4}px hsl(var(--primary) / ${friend.glow_strength / 130})` }}
                >
                  {friend.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{friend.display_name}</p>
                  <p className="truncate text-xs text-muted-foreground">@{friend.username}</p>
                </div>
                <span className="text-xs font-medium text-primary">{proximityLabels[friend.proximity_level]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof CalendarPlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card/40 py-3 active:bg-secondary"
    >
      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
