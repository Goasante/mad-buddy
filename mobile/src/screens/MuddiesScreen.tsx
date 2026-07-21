import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, UserPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type SearchUser = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

type IncomingRequest = {
  id: string;
  senderId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

export function MuddiesScreen() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    const result = await api.get<{ requests: IncomingRequest[] }>("/api/friends/requests");
    setLoadingRequests(false);
    if (result.ok) setRequests(result.data.requests);
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return setFeedback("Type at least 2 characters.");
    setSearching(true);
    setFeedback("");
    const result = await api.get<{ users: SearchUser[]; message: string }>(
      `/api/friends/search?q=${encodeURIComponent(query.trim())}`
    );
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
    const result = await api.post<{ ok: boolean; message: string }>("/api/friends/request", {
      targetUserId: user.id
    });
    setFeedback(result.ok ? `Request sent to ${user.displayName}.` : result.error);
    if (result.ok) setResults((current) => current.filter((item) => item.id !== user.id));
  }

  async function respond(requestId: string, action: "accept" | "decline") {
    const result = await api.post<{ ok: boolean; message: string }>("/api/friends/respond", {
      requestId,
      action
    });
    if (result.ok) {
      setRequests((current) => current.filter((item) => item.id !== requestId));
    } else {
      setFeedback(result.error);
    }
  }

  return (
    <Screen title="Muddies">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="pl-9"
            placeholder="Search by name or username"
            autoCapitalize="none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={searching}>
          {searching ? "…" : "Search"}
        </Button>
      </form>

      {feedback ? <p className="mt-3 text-sm text-primary">{feedback}</p> : null}

      {results.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {results.map((user) => (
            <li key={user.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
              <button
                type="button"
                onClick={() => navigate(`/u/${user.id}`)}
                className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <Avatar name={user.displayName} />
                <div className="min-w-0 flex-1">
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

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Requests</h2>
        {loadingRequests ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : requests.length === 0 ? (
          <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            No pending requests.
          </p>
        ) : (
          <ul className="space-y-2">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
                <Avatar name={request.displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{request.username}</p>
                </div>
                <Button size="icon" onClick={() => void respond(request.id, "accept")} aria-label="Accept">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => void respond(request.id, "decline")} aria-label="Decline">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
