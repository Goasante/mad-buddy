import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Check, X, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import type { ProximityLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Muddy = { id: string; displayName: string; username: string; avatarUrl: string | null };
type NearbyItem = { friend_id: string; proximity_level: ProximityLevel; glow_strength: number };
type SearchUser = { id: string; displayName: string; username: string; avatarUrl: string | null };
type Request = { id: string; senderId: string; displayName: string; username: string; avatarUrl: string | null };

type Tab = "all" | "close" | "requests" | "blocked";
const tabs: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "close", label: "Close Friends" },
  { id: "requests", label: "Requests" },
  { id: "blocked", label: "Blocked" }
];

export function MuddiesScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [muddies, setMuddies] = useState<Muddy[]>([]);
  const [proximity, setProximity] = useState<Record<string, NearbyItem>>({});
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [friendsRes, nearbyRes, requestsRes] = await Promise.all([
      api.get<{ muddies: Muddy[] }>("/api/friends"),
      api.get<{ friends: NearbyItem[] }>("/api/friends/nearby"),
      api.get<{ requests: Request[] }>("/api/friends/requests")
    ]);
    setLoading(false);
    if (friendsRes.ok) setMuddies(friendsRes.data.muddies);
    if (nearbyRes.ok) {
      setProximity(Object.fromEntries(nearbyRes.data.friends.map((f) => [f.friend_id, f])));
    }
    if (requestsRes.ok) setRequests(requestsRes.data.requests);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (addQuery.trim().length < 2) return setFeedback("Type at least 2 characters.");
    setSearching(true);
    setFeedback("");
    const result = await api.get<{ users: SearchUser[]; message: string }>(`/api/friends/search?q=${encodeURIComponent(addQuery.trim())}`);
    setSearching(false);
    if (result.ok) {
      setResults(result.data.users);
      if (result.data.users.length === 0) setFeedback("No one matched that search.");
    } else {
      setResults([]);
      setFeedback(result.error);
    }
  }

  async function sendRequest(user: SearchUser) {
    const result = await api.post<{ ok: boolean; message: string }>("/api/friends/request", { targetUserId: user.id });
    setFeedback(result.ok ? `Request sent to ${user.displayName}.` : result.error);
    if (result.ok) setResults((current) => current.filter((item) => item.id !== user.id));
  }

  async function respond(requestId: string, action: "accept" | "decline") {
    const result = await api.post<{ ok: boolean; message: string }>("/api/friends/respond", { requestId, action });
    if (result.ok) {
      setRequests((current) => current.filter((item) => item.id !== requestId));
      if (action === "accept") void load();
    } else setFeedback(result.error);
  }

  const filteredMuddies = muddies.filter(
    (m) =>
      query.trim().length === 0 ||
      m.displayName.toLowerCase().includes(query.toLowerCase()) ||
      m.username.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg space-y-6 px-4 pt-6">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-sm leading-6 text-muted-foreground">Your people, your circles, and quick ways to connect.</p>
        <Button type="button" className="shrink-0 whitespace-nowrap" onClick={() => setAddOpen((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Muddy
        </Button>
      </header>

      {/* Add Muddy search panel */}
      {addOpen ? (
        <section className="rounded-2xl border border-border bg-card/50 p-4">
          <form onSubmit={search} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="pl-9" placeholder="Search by name or username" autoCapitalize="none" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} />
            </div>
            <Button type="submit" disabled={searching}>{searching ? "…" : "Search"}</Button>
          </form>
          {results.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {results.map((user) => (
                <li key={user.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => navigate(`/u/${user.id}`)} className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left">
                    <Avatar name={user.displayName} src={user.avatarUrl} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{user.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                    </div>
                  </button>
                  <Button size="sm" variant="outline" onClick={() => void sendRequest(user)}>
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* Tabs */}
      <nav className="max-w-full overflow-x-auto border-b border-border/70" aria-label="Muddies tabs">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setQuery("");
                setFeedback("");
              }}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              )}
            >
              {tab.label}
              {tab.id === "requests" && requests.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{requests.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : activeTab === "all" ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" placeholder="Search your Muddies" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {filteredMuddies.length === 0 ? (
            <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
              {muddies.length === 0 ? "No Muddies yet. Tap “Add Muddy” to find people." : "No matches."}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredMuddies.map((muddy) => {
                const near = proximity[muddy.id];
                return (
                  <li key={muddy.id}>
                    <button type="button" onClick={() => navigate(`/u/${muddy.id}`)} className="focus-ring flex w-full items-center gap-3 rounded-xl p-2 text-left active:bg-secondary">
                      <GlowAvatar
                        name={muddy.displayName}
                        src={muddy.avatarUrl}
                        proximityLevel={near?.proximity_level ?? "far"}
                        glowStrength={near?.glow_strength ?? 0}
                        confidence="medium"
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{muddy.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">@{muddy.username}</p>
                      </div>
                      {near && near.proximity_level !== "far" && near.proximity_level !== "hidden" ? (
                        <span className="shrink-0 text-xs font-medium text-primary">
                          {near.proximity_level === "very_close" ? "Very close" : near.proximity_level === "nearby" ? "Nearby" : "Around"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : activeTab === "requests" ? (
        requests.length === 0 ? (
          <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">No pending requests.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
                <button type="button" onClick={() => navigate(`/u/${request.senderId}`)} className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Avatar name={request.displayName} src={request.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{request.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{request.username}</p>
                  </div>
                </button>
                <Button size="icon" onClick={() => void respond(request.id, "accept")} aria-label="Accept">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => void respond(request.id, "decline")} aria-label="Decline">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          {activeTab === "close" ? "Close friends appear here." : "Blocked accounts appear here."}
        </p>
      )}
    </div>
  );
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-semibold">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : name.slice(0, 1).toUpperCase()}
    </div>
  );
}
