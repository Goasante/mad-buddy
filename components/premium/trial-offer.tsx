"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout, isRequestTimeoutError } from "@/lib/network/resilience";

type TrialState = {
  eligible: boolean;
  plan: "buddy_plus" | "buddy_pro" | null;
  durationDays: number | null;
  message: string;
  activeTrial: { plan: "buddy_plus" | "buddy_pro"; endsAtMs: number } | null;
};

export function TrialOffer() {
  const [state, setState] = useState<TrialState | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchWithTimeout(
      "/api/billing/trials",
      { cache: "no-store", signal: controller.signal },
      12_000,
      "load trial eligibility"
    )
      .then(async (response) => (response.ok ? ((await response.json()) as TrialState) : null))
      .then((value) => setState(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!state || (!state.eligible && !state.activeTrial)) return null;
  const label = (state.activeTrial?.plan ?? state.plan) === "buddy_pro" ? "Buddy Pro" : "Buddy Plus";

  async function startTrial() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetchWithTimeout(
        "/api/billing/trials",
        { method: "POST" },
        15_000,
        "start premium trial"
      );
      const body = (await response.json()) as { error?: string; trial?: { plan: string; endsAt: string } };
      if (!response.ok) {
        setMessage(body.error ?? "The trial could not be started.");
        return;
      }
      setMessage("Your premium trial is active.");
      setState((current) =>
        current
          ? {
              ...current,
              eligible: false,
              activeTrial: {
                plan: body.trial?.plan === "buddy_pro" ? "buddy_pro" : "buddy_plus",
                endsAtMs: Date.parse(body.trial?.endsAt ?? "")
              }
            }
          : current
      );
    } catch (error) {
      setMessage(
        isRequestTimeoutError(error)
          ? "Starting the trial took too long. Check your connection and try again."
          : "The trial could not be started. Try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-left sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          {/* A free trial is time-limited access, so the clock is the literal
              idea -- and it matches how a trial is marked on the billing page,
              rather than being a second vocabulary for one concept. */}
          <Clock3 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold">
            {state.activeTrial ? `${label} trial active` : `Try ${label}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.activeTrial
              ? `Premium access ends ${new Date(state.activeTrial.endsAtMs).toLocaleDateString()}.`
              : `${state.durationDays ?? 0} days of premium access. No paid subscription is created.`}
          </p>
          {message ? <p className="mt-2 text-sm text-foreground" role="status">{message}</p> : null}
        </div>
      </div>
      {!state.activeTrial ? (
        <Button className="mt-4 w-full sm:mt-0 sm:w-auto" onClick={startTrial} disabled={pending}>
          {pending ? "Starting..." : "Start trial"}
        </Button>
      ) : null}
    </section>
  );
}
