import { useCallback, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AVAILABILITY_TYPES, availabilityLabels } from "@/lib/social/rules";
import type { AvailabilityType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type NearbyFriend = {
  friend_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  proximity_level: "very_close" | "nearby" | "around" | "far" | "hidden";
  glow_strength: number;
};

const proximityLabels: Record<NearbyFriend["proximity_level"], string> = {
  very_close: "Very close",
  nearby: "Nearby",
  around: "Around",
  far: "Far",
  hidden: "Hidden"
};

export function HomeScreen() {
  const [availability, setAvailability] = useState<AvailabilityType>("free");
  const [customText, setCustomText] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [friends, setFriends] = useState<NearbyFriend[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(true);
  const [nearbyMessage, setNearbyMessage] = useState("");

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

  useEffect(() => {
    void loadNearby();
  }, [loadNearby]);

  async function setStatus() {
    setStatusBusy(true);
    setStatusMessage("");
    // Glow for the next 4 hours (server clamps/validates the window).
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
    <Screen title="Home">
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

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Around you</h2>
          <button type="button" onClick={() => void loadNearby()} className="focus-ring text-sm text-primary">
            Refresh
          </button>
        </div>

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
