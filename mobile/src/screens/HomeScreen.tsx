import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, MapPin, CalendarPlus, UserPlus, CalendarDays, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { AVAILABILITY_TYPES, availabilityLabels } from "@/lib/social/rules";
import type { AvailabilityType } from "@/lib/supabase/database.types";
import type { ProximityLevel, ConfidenceLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";
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

type Plan = {
  id: string;
  title: string;
  startAt: string | null;
  placeText: string | null;
  organiserName: string;
  status: string;
  goingCount: number;
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
      setPlans(
        result.data.plans
          .filter((plan) => plan.status !== "cancelled" && plan.status !== "completed")
          .sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""))
          .slice(0, 3)
      );
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

  const visibleFriends = friends.filter((friend) => friend.proximity_level !== "hidden" && friend.proximity_level !== "far");

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-4 pt-6">
      {/* Greeting header (mirrors the web dashboard) */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">See which approved Muddies are nearby.</p>
      </header>

      {/* Quick actions */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <QuickAction icon={CalendarPlus} label="New plan" onClick={() => navigate("/plans")} />
        <QuickAction icon={UserPlus} label="Add Muddy" onClick={() => navigate("/muddies")} />
        <QuickAction icon={CalendarDays} label="Plans" onClick={() => navigate("/plans")} />
      </div>

      {/* Glow / status composer */}
      <section className="mt-5 glass-panel rounded-2xl p-5">
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
          <Input placeholder="Add a note (optional)" maxLength={60} value={customText} onChange={(e) => setCustomText(e.target.value)} />
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

      {/* Nearby Muddies — real glow strip (reuses the web GlowAvatar) */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Nearby Muddies</h2>
          <button
            type="button"
            onClick={() => void loadNearby()}
            className="focus-ring safe-motion inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-card/50 text-muted-foreground hover:bg-secondary/60"
            aria-label="Refresh"
          >
            <RefreshCcw className={cn("h-4 w-4", loadingNearby && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </button>
        </div>

        {loadingNearby ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : visibleFriends.length > 0 ? (
          <div className="glow-strip no-scrollbar -mx-4 flex gap-5 overflow-x-auto px-4 pb-3 pt-6" aria-label="Nearby Muddies">
            {visibleFriends.map((friend) => (
              <button
                key={friend.friend_id}
                type="button"
                onClick={() => navigate(`/u/${friend.friend_id}`)}
                className="focus-ring flex w-20 shrink-0 flex-col items-center gap-2"
              >
                <GlowAvatar
                  name={friend.display_name}
                  src={friend.avatar_url}
                  proximityLevel={friend.proximity_level}
                  glowStrength={friend.glow_strength}
                  confidence={friend.confidence ?? "medium"}
                  size="lg"
                />
                <span className="max-w-full truncate text-xs font-medium">{friend.display_name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/40 p-4">
            <p className="text-sm text-muted-foreground">{nearbyMessage || "No Muddies around right now."}</p>
          </div>
        )}

        <Button variant="outline" className="mt-3 w-full" onClick={() => void shareLocation()} disabled={sharingLocation}>
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {sharingLocation ? "Getting your location…" : "Share my location to see who's near"}
        </Button>
      </section>

      {/* Upcoming plans */}
      {plans.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Upcoming plans</h2>
            <button type="button" onClick={() => navigate("/plans")} className="text-sm font-medium text-primary hover:underline">
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
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: typeof CalendarPlus; label: string; onClick: () => void }) {
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
