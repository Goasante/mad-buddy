import { useCallback, useEffect, useState } from "react";
import { Plus, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  role: string | null;
  lastMessagePreview: string | null;
};

type GroupsData = {
  groups: GroupSummary[];
  discoverableGroups: GroupSummary[];
  invitations: (GroupSummary & { invitedByName: string })[];
};

export function GroupsScreen() {
  const [data, setData] = useState<GroupsData>({ groups: [], discoverableGroups: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState("");

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

  async function join(group: GroupSummary) {
    const result = await api.post<{ ok: boolean; message: string }>(`/api/groups/${group.id}/join`, {});
    setFeedback(result.ok ? `Joined ${group.name}.` : result.error);
    if (result.ok) void load();
  }

  return (
    <Screen
      title="Groups"
      action={
        <Button size="sm" onClick={() => setCreating((value) => !value)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New
        </Button>
      }
    >
      {creating ? (
        <CreateGroup
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}

      {feedback ? <p className="mb-3 text-sm text-primary">{feedback}</p> : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-6">
          <GroupList title="Your groups" groups={data.groups} emptyText="You're not in any groups yet." />

          {data.discoverableGroups.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Discover</h2>
              <ul className="space-y-2">
                {data.discoverableGroups.map((group) => (
                  <li key={group.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
                    <GroupIcon />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{group.name}</p>
                      <p className="text-xs text-muted-foreground">{group.memberCount} members</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void join(group)}>
                      Join
                    </Button>
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

function GroupList({ title, groups, emptyText }: { title: string; groups: GroupSummary[]; emptyText: string }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <li key={group.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
              <GroupIcon />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{group.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {group.lastMessagePreview ?? `${group.memberCount} members`}
                </p>
              </div>
              {group.role === "owner" ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  Owner
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
      <Users2 className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

function CreateGroup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discoverable, setDiscoverable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (name.trim().length < 2) return setError("Give your group a name.");
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/groups", {
      name: name.trim(),
      description: description.trim() || undefined,
      discoverable
    });
    setBusy(false);
    if (result.ok) onCreated();
    else setError(result.error);
  }

  return (
    <section className="glass-panel mb-4 space-y-3 rounded-2xl p-4">
      <Input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={discoverable}
          onChange={(e) => setDiscoverable(e.target.checked)}
          className="h-4 w-4 accent-[hsl(var(--primary))]"
        />
        Let my Muddies discover and join this group
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create group"}
      </Button>
    </section>
  );
}
