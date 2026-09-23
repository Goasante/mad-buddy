import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

export type MobileGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  role: string | null;
  lastMessagePreview: string | null;
};

type GroupsData = {
  groups: MobileGroupSummary[];
  invitations: (MobileGroupSummary & { invitedByName: string })[];
};

export function GroupsScreen() {
  const navigate = useNavigate();
  return (
    <Screen title="Groups">
      <GroupsManagerContent
        onOpenGroup={(group) => navigate(`/messages/${group.id}`, { state: { title: group.name } })}
      />
    </Screen>
  );
}

export function GroupsManagerContent({
  onOpenGroup
}: {
  onOpenGroup: (group: MobileGroupSummary) => void;
}) {
  const [data, setData] = useState<GroupsData>({ groups: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"mine" | "requests">("mine");
  const [feedback, setFeedback] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await api.get<GroupsData>("/api/groups");
    setLoading(false);
    if (result.ok) setData(result.data);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(group: GroupsData["invitations"][number], accept: boolean) {
    if (respondingId) return;
    setRespondingId(group.id);
    setFeedback("");
    const result = await api.post<{ ok: boolean; message: string; groupId?: string }>(
      `/api/groups/${group.id}/invitation`,
      { accept }
    );
    setRespondingId(null);
    if (!result.ok) {
      setFeedback(result.error);
      return;
    }
    setFeedback(result.data.message);
    if (accept && result.data.groupId) {
      onOpenGroup(group);
      return;
    }
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Private Group conversations live inside Messages.</p>
        <Button size="sm" onClick={() => setCreating((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      </div>

      {creating ? (
        <CreateGroup
          onCreated={(group) => {
            setCreating(false);
            onOpenGroup(group);
          }}
        />
      ) : null}

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Groups tabs">
        <div className="flex min-w-max gap-1">
          {([{ id: "mine", label: "My Groups" }, { id: "requests", label: "Invitations" }] as const).map((groupTab) => (
            <button
              key={groupTab.id}
              type="button"
              onClick={() => setTab(groupTab.id)}
              className={`focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium ${
                tab === groupTab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              }`}
            >
              {groupTab.label}
              {groupTab.id === "requests" && data.invitations.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {data.invitations.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {feedback ? <p className="text-sm text-primary" role="status">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : tab === "mine" ? (
        <GroupList groups={data.groups} onOpen={onOpenGroup} />
      ) : data.invitations.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">No Group invitations.</p>
      ) : (
        <ul className="space-y-2">
          {data.invitations.map((group) => (
            <li key={group.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
              <GroupIcon />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{group.name}</p>
                <p className="truncate text-xs text-muted-foreground">Invited by {group.invitedByName}</p>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={respondingId !== null}
                  onClick={() => void respond(group, false)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  disabled={respondingId !== null}
                  onClick={() => void respond(group, true)}
                >
                  Join
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupList({
  groups,
  onOpen
}: {
  groups: MobileGroupSummary[];
  onOpen: (group: MobileGroupSummary) => void;
}) {
  if (groups.length === 0) {
    return <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">You’re not in any Groups yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {groups.map((group) => (
        <li key={group.id}>
          <button
            type="button"
            onClick={() => onOpen(group)}
            className="focus-ring flex w-full items-center gap-3 rounded-xl border border-border bg-card/40 p-3 text-left active:bg-secondary"
          >
            <GroupIcon />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{group.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {group.lastMessagePreview ?? `${group.memberCount} members`}
              </p>
            </div>
            {group.role === "owner" ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Owner</span>
            ) : null}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function GroupIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
      <Users2 className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

function CreateGroup({
  onCreated
}: {
  onCreated: (group: MobileGroupSummary) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Give your Group a name.");
      return;
    }

    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string; groupId?: string }>("/api/groups", {
      name: trimmedName,
      description: description.trim() || undefined
    });
    setBusy(false);

    if (!result.ok || !result.data.groupId) {
      setError(result.ok ? result.data.message : result.error);
      return;
    }

    onCreated({
      id: result.data.groupId,
      name: trimmedName,
      description: description.trim() || null,
      memberCount: 1,
      role: "owner",
      lastMessagePreview: null
    });
  }

  return (
    <section className="glass-panel space-y-3 rounded-2xl p-4">
      <Input placeholder="Group name" value={name} onChange={(event) => setName(event.target.value)} />
      <Textarea placeholder="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} />
      <p className="text-xs text-muted-foreground">Groups are private and invitation-only.</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create Group"}
      </Button>
    </section>
  );
}
