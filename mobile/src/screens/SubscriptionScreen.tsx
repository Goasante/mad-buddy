import { Check, Compass, ShieldCheck, Users } from "lucide-react";
import { Screen } from "../components/AppShell";
import { env } from "../lib/env";

const FREE_CORE = [
  "Home, Profile and Muddies",
  "Glow and proximity with your Muddies",
  "Messages and existing conversations",
  "Plans, Plan Chat and Events",
  "Safe Arrival, Notifications, Circles and Groups"
];

export function SubscriptionScreen() {
  const webHost = env.apiBaseUrl.replace(/^https?:\/\//, "");

  return (
    <Screen title="Mad Buddy Access">
      <div className="space-y-5">
        <section className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Mad Buddy Access</p>
              <h2 className="mt-1 text-2xl font-semibold">GHS 5.00 <span className="text-sm font-medium text-muted-foreground">/ month</span></h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                One paid product for expanding your social world through Linkr and UpFor.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <div className="flex gap-3"><Compass className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><p className="text-sm"><span className="font-semibold">Linkr</span> — discover and connect outside your existing circle.</p></div>
            <div className="flex gap-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><p className="text-sm"><span className="font-semibold">UpFor expansion</span> — create, discover and join new social opportunities.</p></div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card/40 p-5">
          <h2 className="text-base font-semibold">The core stays free</h2>
          <ul className="mt-3 space-y-2">
            {FREE_CORE.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card/40 p-5">
          <h2 className="text-base font-semibold">Welcome Access</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your first 14 days start when you add your first Muddy. No card is required and there is no automatic renewal when it ends.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Existing Muddies, connections, conversations and Plans remain available if Access ends.
          </p>
        </section>

        <p className="rounded-xl border border-border bg-card/40 p-4 text-center text-xs leading-6 text-muted-foreground">
          Native in-app purchase is not available in this client yet. Purchase or manage Mad Buddy Access on the web at{" "}
          <span className="text-foreground">{webHost}/settings/access</span>.
        </p>
      </div>
    </Screen>
  );
}
