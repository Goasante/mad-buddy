import { useFeatureAvailability } from "@/components/features/feature-availability-context";
import { LockedFeaturePreview } from "@/components/features/locked-feature-preview";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Session = {
  id: string;
  destinationLabel: string;
  expectedArrivalAt: string;
  note: string | null;
  status: string;
  travellerName: string;
  isTraveller: boolean;
};
type Contact = { id: string; name: string; isCloseFriend: boolean };
type Data = { mySessions: Session[]; watching: Session[]; contacts: Contact[] };


export function SafetyScreen() {
  const availability = useFeatureAvailability();
  const [data, setData] = useState<Data>({ mySessions: [], watching: [], contacts: [] });
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const result = await api.get<Data>("/api/safe-arrival");
    setLoading(false);
    if (result.ok) setData(result.data);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(session: Session, action: "confirm" | "cancel") {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/safe-arrival/${session.id}`, { action });
    setFeedback(result.ok ? result.data.message : result.error);
    if (result.ok) void load();
  }

  if (!loading && availability && !availability.safe_arrival && !data.mySessions.length && !data.watching.length) return <LockedFeaturePreview feature="safe_arrival" />;
  if (!loading && !data.mySessions.length && !data.watching.length) return <Navigate to="/meet-up" replace />;
  return (
    <Screen title="Safe Arrival">
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          <Link to="/meet-up" className="block rounded-xl border border-border p-4 text-sm">New arrangements use Meet Up · Open Meet Up</Link>
          {feedback && <p role="status" className="text-sm">{feedback}</p>}

          {/* Active journeys */}
          {data.mySessions.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Your journeys</h2>
              <ul className="space-y-2">
                {data.mySessions.map((session) => (
                  <li key={session.id} className="rounded-xl border border-border bg-card/40 p-3">
                    <p className="text-sm font-semibold">{session.destinationLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      By {new Date(session.expectedArrivalAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {session.status}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => void act(session, "confirm")}>
                        I've arrived
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void act(session, "cancel")}>
                        Cancel
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Watching */}
          {data.watching.length > 0 ? (
            <section>
              <h2 className="mb-3 text-lg font-semibold">You're watching</h2>
              <ul className="space-y-2">
                {data.watching.map((session) => (
                  <li key={session.id} className="rounded-xl border border-border bg-card/40 p-3">
                    <p className="text-sm font-semibold">{session.travellerName} → {session.destinationLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {new Date(session.expectedArrivalAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {session.status}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Screen>
  );
}
