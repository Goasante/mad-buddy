import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getReadinessReport } from "@/lib/health/readiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AdminSystemPage() {
  const admin = createSupabaseAdminClient();
  const [readiness, rateLimitsResult] = await Promise.all([
    getReadinessReport(),
    admin
      .from("rate_limits")
      .select("action, count, window_end, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20)
  ]);

  return (
    <div className="space-y-6">
      <section>
        <Badge variant={readiness.ok ? "green" : "warning"}>
          <Activity className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          System
        </Badge>
        <h1 className="mt-4 text-3xl font-semibold">Backend health</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Environment checks and rate-limit activity without IP hashes, raw user identifiers, or location payloads.
        </p>
      </section>

      <section className="grid gap-3">
        {readiness.checks.map((check) => (
          <Card key={check.name} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{check.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{check.message}</p>
              </div>
              <Badge variant={check.ok ? "green" : "warning"}>{check.ok ? "OK" : "Action"}</Badge>
            </div>
          </Card>
        ))}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Recent rate-limit windows</h2>
        {(rateLimitsResult.data ?? []).map((item) => (
          <Card key={`${item.action}-${item.window_end}-${item.count}`} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{item.action}</p>
                <p className="mt-1 text-xs text-muted-foreground">Resets {formatDate(item.window_end)}</p>
              </div>
              <Badge variant={item.count > 10 ? "warning" : "blue"}>{item.count}</Badge>
            </div>
          </Card>
        ))}
        {(rateLimitsResult.data ?? []).length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No rate-limit windows yet.</Card>
        ) : null}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
