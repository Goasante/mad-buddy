import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

const graceOptions = [15, 30, 60];

export function SafetyScreen() {
  const [data, setData] = useState<Data>({ mySessions: [], watching: [], contacts: [] });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [destination, setDestination] = useState("");
  const [eta, setEta] = useState("");
  const [grace, setGrace] = useState(30);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    const result = await api.get<Data>("/api/safe-arrival");
    setLoading(false);
    if (result.ok) setData(result.data);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleContact(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((c) => c !== id) : [...current, id]));
  }

  async function start() {
    if (destination.trim().length < 2) return setFeedback("Where are you heading?");
    if (!eta) return setFeedback("Set your expected arrival time.");
    if (selected.length === 0) return setFeedback("Pick at least one trusted contact.");
    setStarting(true);
    setFeedback("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/safe-arrival", {
      destinationLabel: destination.trim(),
      expectedArrivalAt: new Date(eta).toISOString(),
      gracePeriodMinutes: grace,
      contactIds: selected
    });
    setStarting(false);
    if (result.ok) {
      setDestination("");
      setEta("");
      setSelected([]);
      await load();
    } else {
      setFeedback(result.error);
    }
  }

  async function act(session: Session, action: "confirm" | "cancel") {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/safe-arrival/${session.id}`, { action });
    setFeedback(result.ok ? result.data.message : result.error);
    if (result.ok) void load();
  }

  return (
    <Screen title="Safe Arrival">
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Start a journey */}
          <section className="glass-panel rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold">Start a journey</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your trusted contacts get alerted if you don't confirm arrival in time.
            </p>

            <div className="mt-4 space-y-3">
              <Input placeholder="Where are you going?" value={destination} onChange={(e) => setDestination(e.target.value)} />
              <div className="space-y-1.5">
                <label htmlFor="eta" className="text-xs font-medium text-muted-foreground">Expected arrival</label>
                <Input id="eta" type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Grace period</p>
                <div className="flex gap-2">
                  {graceOptions.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setGrace(minutes)}
                      className={cn(
                        "focus-ring rounded-full border px-3 py-1.5 text-sm",
                        grace === minutes ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {minutes}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Trusted contacts</p>
                {data.contacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Add some Muddies first — they can be your contacts.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.contacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => toggleContact(contact.id)}
                        className={cn(
                          "focus-ring flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm",
                          selected.includes(contact.id) ? "border-primary bg-primary/10" : "border-border"
                        )}
                      >
                        <span>
                          {contact.name}
                          {contact.isCloseFriend ? (
                            <span className="ml-2 text-[10px] text-primary">Close friend</span>
                          ) : null}
                        </span>
                        {selected.includes(contact.id) ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {feedback ? <p className="text-sm text-primary">{feedback}</p> : null}
              <Button className="w-full" onClick={start} disabled={starting}>
                {starting ? "Starting…" : "Start Safe Arrival"}
              </Button>
            </div>
          </section>

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
