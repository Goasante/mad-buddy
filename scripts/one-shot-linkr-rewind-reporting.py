from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing replacement anchor in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "lib/linkr/connection-service.ts",
    '    : { ok: true, message: "Sent to Mad Buddy support for review." };',
    '    : { ok: true, message: "Sent to Mad Buddy support for review. You can track it in Linkr settings." };',
)

replace_once(
    "lib/linkr/collections-service.ts",
    """export type HiddenProfile = {\n  userId: string;\n  displayName: string;\n  photo: string | null;\n  hiddenAt: string;\n};\n""",
    """export type HiddenProfile = {\n  userId: string;\n  displayName: string;\n  photo: string | null;\n  hiddenAt: string;\n};\n\n/** A support request created after the viewer has used their three self-service rewinds. */\nexport type LinkrRewindRequest = {\n  id: string;\n  targetUserId: string;\n  targetDisplayName: string;\n  targetPhoto: string | null;\n  status: string;\n  decision: \"approve\" | \"reject\" | null;\n  createdAt: string;\n  updatedAt: string;\n};\n""",
)

p = Path("lib/linkr/collections-service.ts")
text = p.read_text()
append = r'''

/**
 * The viewer's own Linkr rewind support requests, newest first.
 *
 * This is deliberately a tiny projection. It never exposes internal notes,
 * diagnostics, staff identity, or anything about the other person's Linkr
 * choices. The target id is already part of the viewer's own pass action; it
 * is used only to label which skipped profile the request refers to.
 */
export async function loadLinkrRewindRequests(viewerId: string): Promise<LinkrRewindRequest[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();

  const { data: tickets } = await admin
    .from("support_tickets")
    .select("id, status, created_at, updated_at, diagnostics")
    .eq("user_id", viewerId)
    .eq("diagnostics->>workflow", "linkr_pass_reversal")
    .order("created_at", { ascending: false })
    .limit(8);

  const rows = tickets ?? [];
  if (rows.length === 0) return [];

  const targetByTicket = new Map<string, string>();
  for (const ticket of rows) {
    const diagnostics = ticket.diagnostics;
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) continue;
    const target = (diagnostics as Record<string, unknown>).target_user_id;
    if (typeof target === "string") targetByTicket.set(ticket.id, target);
  }

  const targetIds = [...new Set(targetByTicket.values())];
  const described = await describePeople(admin, targetIds);

  const decisionByTicket = new Map<string, "approve" | "reject">();
  const ticketIds = rows.map((ticket) => ticket.id);
  const { data: events } = await admin
    .from("support_ticket_events")
    .select("ticket_id, note, created_at")
    .in("ticket_id", ticketIds)
    .eq("event_type", "status_changed")
    .order("created_at", { ascending: false });
  for (const event of events ?? []) {
    if (decisionByTicket.has(event.ticket_id)) continue;
    const note = event.note?.toLowerCase() ?? "";
    if (note.includes("linkr rewind approved")) decisionByTicket.set(event.ticket_id, "approve");
    else if (note.includes("linkr rewind rejected")) decisionByTicket.set(event.ticket_id, "reject");
  }

  const requests: LinkrRewindRequest[] = [];
  for (const ticket of rows) {
    const targetUserId = targetByTicket.get(ticket.id);
    if (!targetUserId) continue;
    const person = described.get(targetUserId);
    requests.push({
      id: ticket.id,
      targetUserId,
      targetDisplayName: person?.displayName ?? "Profile unavailable",
      targetPhoto: person?.photo ?? null,
      status: ticket.status,
      decision: decisionByTicket.get(ticket.id) ?? null,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at
    });
  }
  return requests;
}
'''
if "export async function loadLinkrRewindRequests" not in text:
    p.write_text(text.rstrip() + append + "\n")

replace_once(
    "app/(app)/linkr-actions.ts",
    'import { loadClickedPeople, loadHiddenProfiles, loadPendingClicks } from "@/lib/linkr/collections-service";',
    'import { loadClickedPeople, loadHiddenProfiles, loadLinkrRewindRequests, loadPendingClicks } from "@/lib/linkr/collections-service";',
)
replace_once(
    "app/(app)/linkr-actions.ts",
    """export async function loadHiddenProfilesAction() {\n  const userId = await getAuthedUserId();\n  return userId ? loadHiddenProfiles(userId) : [];\n}\n""",
    """export async function loadHiddenProfilesAction() {\n  const userId = await getAuthedUserId();\n  return userId ? loadHiddenProfiles(userId) : [];\n}\n\n/** The signed-in user's own Linkr rewind support requests. */\nexport async function loadLinkrRewindRequestsAction() {\n  const userId = await getAuthedUserId();\n  return userId ? loadLinkrRewindRequests(userId) : [];\n}\n""",
)

replace_once(
    "components/linkr/linkr-settings.tsx",
    'import { useState } from "react";',
    'import { useEffect, useState } from "react";',
)
replace_once(
    "components/linkr/linkr-settings.tsx",
    'import { ArrowLeft, ChevronRight, RotateCcw } from "lucide-react";\n',
    'import { ArrowLeft, ChevronRight, RotateCcw } from "lucide-react";\nimport { loadLinkrRewindRequestsAction } from "@/app/(app)/linkr-actions";\n',
)
replace_once(
    "components/linkr/linkr-settings.tsx",
    'import type { HiddenProfile } from "@/lib/linkr/collections-service";',
    'import type { HiddenProfile, LinkrRewindRequest } from "@/lib/linkr/collections-service";',
)
replace_once(
    "components/linkr/linkr-settings.tsx",
    """  const [restoringId, setRestoringId] = useState<string | null>(null);\n  const [hiddenStatus, setHiddenStatus] = useState<string | null>(null);\n  const distanceLabel =\n""",
    """  const [restoringId, setRestoringId] = useState<string | null>(null);\n  const [hiddenStatus, setHiddenStatus] = useState<string | null>(null);\n  const [rewindRequests, setRewindRequests] = useState<LinkrRewindRequest[]>([]);\n  const [rewindRequestsLoading, setRewindRequestsLoading] = useState(true);\n\n  useEffect(() => {\n    let active = true;\n    setRewindRequestsLoading(true);\n    void loadLinkrRewindRequestsAction()\n      .then((requests) => {\n        if (active) setRewindRequests(requests);\n      })\n      .finally(() => {\n        if (active) setRewindRequestsLoading(false);\n      });\n    return () => {\n      active = false;\n    };\n  }, []);\n\n  const distanceLabel =\n""",
)
replace_once(
    "components/linkr/linkr-settings.tsx",
    """        {hiddenStatus ? <p className=\"linkr-settings__note\" role=\"status\">{hiddenStatus}</p> : null}\n\n        <h2 className=\"linkr-settings__group\">Preferences</h2>\n""",
    """        {hiddenStatus ? <p className=\"linkr-settings__note\" role=\"status\">{hiddenStatus}</p> : null}\n\n        <h2 className=\"linkr-settings__group\">Rewind requests</h2>\n        <p className=\"linkr-settings__note\">\n          Requests you sent after using your three self-service rewinds. Admin decisions stay visible here.\n        </p>\n        {rewindRequestsLoading ? (\n          <p className=\"linkr-collection__empty\">Loading rewind requests…</p>\n        ) : rewindRequests.length === 0 ? (\n          <p className=\"linkr-collection__empty\">No rewind requests.</p>\n        ) : (\n          <ul className=\"linkr-collection\">\n            {rewindRequests.map((request) => (\n              <li key={request.id}>\n                <div className=\"linkr-collection__row linkr-collection__row--static\">\n                  <HiddenFace photo={request.targetPhoto} name={request.targetDisplayName} />\n                  <span className=\"linkr-collection__text\">\n                    <strong>{request.targetDisplayName}</strong>\n                    <small>{rewindRequestLabel(request)}</small>\n                    <small>Requested {new Date(request.createdAt).toLocaleDateString()}</small>\n                  </span>\n                </div>\n              </li>\n            ))}\n          </ul>\n        )}\n\n        <h2 className=\"linkr-settings__group\">Preferences</h2>\n""",
)
p = Path("components/linkr/linkr-settings.tsx")
text = p.read_text()
marker = "\nfunction SettingSwitch({\n"
helper = '''
function rewindRequestLabel(request: LinkrRewindRequest): string {
  if (request.decision === "approve") return "Approved — this profile can appear in Linkr again.";
  if (request.decision === "reject") return "Reviewed — the pass stays until its normal expiry.";
  if (["open", "waiting_on_internal_team", "escalated"].includes(request.status)) return "In review";
  if (["resolved", "closed"].includes(request.status)) return "Reviewed";
  return "Sent to Mad Buddy support";
}

'''
if "function rewindRequestLabel" not in text:
    if marker not in text:
        raise SystemExit("missing Linkr settings helper anchor")
    p.write_text(text.replace(marker, "\n" + helper + "function SettingSwitch({\n", 1))

replace_once(
    "app/(admin)/admin/support/linkr-reversal-actions.ts",
    """    await admin.from(\"support_ticket_events\").insert({\n      ticket_id: ticket.id,\n      actor_id: context.userId,\n      event_type: \"status_changed\",\n      from_value: ticket.status,\n      to_value: \"resolved\",\n      note: approved ? \"Linkr rewind approved\" : \"Linkr rewind rejected\"\n    });\n\n    await deliverNotification(admin, {\n""",
    """    await admin.from(\"support_ticket_events\").insert({\n      ticket_id: ticket.id,\n      actor_id: context.userId,\n      event_type: \"status_changed\",\n      from_value: ticket.status,\n      to_value: \"resolved\",\n      note: approved ? \"Linkr rewind approved\" : \"Linkr rewind rejected\"\n    });\n\n    const publicMessage = approved\n      ? activePassId\n        ? \"Your Linkr rewind was approved. That profile can appear in Linkr again. No connection was created automatically.\"\n        : \"Your Linkr rewind was approved. The pass had already expired or been cleared, so no additional change was needed.\"\n      : \"Your Linkr rewind request was reviewed and was not approved. The pass stays in place until its normal expiry.\";\n    await admin.from(\"support_ticket_messages\").insert({\n      ticket_id: ticket.id,\n      sender_type: \"agent\",\n      sender_id: context.userId,\n      message: publicMessage\n    });\n\n    await deliverNotification(admin, {\n""",
)
replace_once(
    "app/(admin)/admin/support/linkr-reversal-actions.ts",
    """    revalidatePath(\"/admin/support\");\n    revalidatePath(`/admin/support/${ticket.id}`);\n""",
    """    revalidatePath(\"/admin/support\");\n    revalidatePath(\"/admin/linkr-requests\");\n    revalidatePath(`/admin/support/${ticket.id}`);\n""",
)

replace_once(
    "components/admin/admin-shell.tsx",
    "  PowerOff,\n  ShieldAlert,",
    "  PowerOff,\n  RotateCcw,\n  ShieldAlert,",
)
replace_once(
    "components/admin/admin-shell.tsx",
    '  | "/admin/support"\n  | "/admin/communications"',
    '  | "/admin/support"\n  | "/admin/linkr-requests"\n  | "/admin/communications"',
)
replace_once(
    "components/admin/admin-shell.tsx",
    '      { href: "/admin/support", label: "Support", icon: Headphones, permission: "admin.support.manage" },\n      { href: "/admin/communications",',
    '      { href: "/admin/support", label: "Support", icon: Headphones, permission: "admin.support.manage" },\n      { href: "/admin/linkr-requests", label: "Linkr requests", icon: RotateCcw, permission: "admin.support.manage" },\n      { href: "/admin/communications",',
)

admin_page = Path("app/(admin)/admin/linkr-requests/page.tsx")
admin_page.parent.mkdir(parents=True, exist_ok=True)
admin_page.write_text('''import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { RotateCcw } from "lucide-react";

import { AdminEmptyState, AdminPageHeader, AdminQueryError, AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { IssueStatusBadge } from "@/components/admin/support/issue-badges";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getAdminAccess } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSafetyAdminContext } from "@/lib/safety/admin";

function diagnosticsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export default async function AdminLinkrRequestsPage() {
  const admin = createSupabaseAdminClient();
  const context = await getSafetyAdminContext();
  if (!context.ok) redirect("/admin/login");
  const access = await getAdminAccess(admin, context);
  if (!access.permissions.has("admin.support.manage")) redirect("/admin");

  const result = await admin
    .from("support_tickets")
    .select("id, user_id, subject, status, created_at, updated_at, diagnostics")
    .eq("diagnostics->>workflow", "linkr_pass_reversal")
    .order("created_at", { ascending: false })
    .limit(100);
  const tickets = result.data ?? [];
  const pendingCount = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length;

  const relatedIds = new Set<string>();
  for (const ticket of tickets) {
    if (ticket.user_id) relatedIds.add(ticket.user_id);
    const target = diagnosticsObject(ticket.diagnostics).target_user_id;
    if (typeof target === "string") relatedIds.add(target);
  }

  const profileById = new Map<string, { full_name: string; username: string; avatar_url: string | null }>();
  if (relatedIds.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", [...relatedIds]);
    for (const profile of profiles ?? []) profileById.set(profile.user_id, profile);
  }
  const nameFor = (id: string | null) => {
    if (!id) return "Account unavailable";
    const profile = profileById.get(id);
    return profile?.full_name?.trim() || profile?.username || "Account unavailable";
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Linkr requests"
        description="Review rewind requests that users send after using their three self-service Linkr reverses."
        meta={<AdminStatus label={`${pendingCount} pending`} tone={pendingCount > 0 ? "warning" : "success"} />}
      />

      {result.error ? <AdminQueryError message="Linkr requests could not be loaded. Try again shortly." /> : null}

      {!result.error && tickets.length === 0 ? (
        <AdminEmptyState
          icon={RotateCcw}
          title="No Linkr rewind requests"
          description="Requests sent from Linkr will appear here automatically."
        />
      ) : null}

      {tickets.length > 0 ? (
        <div className="grid gap-3">
          {tickets.map((ticket) => {
            const diagnostics = diagnosticsObject(ticket.diagnostics);
            const targetId = typeof diagnostics.target_user_id === "string" ? diagnostics.target_user_id : null;
            const requester = ticket.user_id ? profileById.get(ticket.user_id) : null;
            const isPending = !["resolved", "closed"].includes(ticket.status);
            return (
              <Card key={ticket.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{ticket.subject || "Linkr rewind request"}</p>
                      <IssueStatusBadge status={ticket.status} />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <UserAvatar src={requester?.avatar_url ?? null} name={nameFor(ticket.user_id)} size="xs" />
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{nameFor(ticket.user_id)}</span>
                        {targetId ? <> wants to rewind a pass on <span className="font-medium text-foreground">{nameFor(targetId)}</span></> : null}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Requested {formatAdminDate(ticket.created_at)} · Updated {formatAdminDate(ticket.updated_at)}
                    </p>
                  </div>
                  <Link
                    href={`/admin/support/${ticket.id}` as Route}
                    className="focus-ring inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-border/70 px-4 text-sm font-semibold hover:bg-secondary/40"
                  >
                    {isPending ? "Review request" : "View review"}
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
''')

Path("lib/linkr/rewind-reporting.test.ts").write_text('''import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Linkr rewind request reporting", () => {
  it("keeps a persistent user-facing request history inside Linkr", () => {
    const service = read("lib/linkr/collections-service.ts");
    const actions = read("app/(app)/linkr-actions.ts");
    const settings = read("components/linkr/linkr-settings.tsx");
    expect(service).toContain('diagnostics->>workflow", "linkr_pass_reversal"');
    expect(service).toContain("loadLinkrRewindRequests");
    expect(actions).toContain("loadLinkrRewindRequestsAction");
    expect(settings).toContain("Rewind requests");
    expect(settings).toContain("Admin decisions stay visible here");
  });

  it("gives admins an obvious dedicated Linkr request queue", () => {
    const shell = read("components/admin/admin-shell.tsx");
    const page = read("app/(admin)/admin/linkr-requests/page.tsx");
    expect(shell).toContain('href: "/admin/linkr-requests"');
    expect(shell).toContain('label: "Linkr requests"');
    expect(page).toContain('diagnostics->>workflow", "linkr_pass_reversal"');
    expect(page).toContain("Review request");
  });

  it("writes the review outcome into the existing support conversation", () => {
    const review = read("app/(admin)/admin/support/linkr-reversal-actions.ts");
    expect(review).toContain('.from("support_ticket_messages")');
    expect(review).toContain('sender_type: "agent"');
    expect(review).toContain("Your Linkr rewind was approved");
    expect(review).toContain("was not approved");
  });
});
''')
