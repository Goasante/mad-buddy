"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminStatus } from "@/components/admin/admin-ui";
import { createMissingProfileAction } from "@/app/(admin)/admin/users/actions";
import type { OrphanAuthAccount } from "@/lib/admin/orphan-accounts";

export function OrphanAccountRow({ account, canRepair }: { account: OrphanAuthAccount; canRepair: boolean }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const joined = new Date(account.createdAt).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{account.fullName ?? account.email ?? "Unknown account"}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {account.email ?? "no email"} · {account.provider} · joined {joined}
        </p>
        {feedback ? (
          <p className={`mt-1 text-xs ${feedback.ok ? "text-emerald-400" : "text-destructive"}`} role="status">
            {feedback.message}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AdminStatus label="No profile" tone="warning" />
        <Button
          type="button"
          size="sm"
          disabled={!canRepair || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createMissingProfileAction({ userId: account.id });
              setFeedback({ ok: result.ok, message: result.message });
            })
          }
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {pending ? "Creating…" : "Create profile"}
        </Button>
      </div>
    </div>
  );
}
