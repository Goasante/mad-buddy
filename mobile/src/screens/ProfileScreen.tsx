import { useCallback, useEffect, useState } from "react";
import { Pencil, Check, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

type Profile = {
  full_name: string | null;
  username: string | null;
  bio: string | null;
  mood_status: string | null;
  avatar_url: string | null;
  visibility_status: string | null;
};

const visibilityLabel: Record<string, string> = {
  visible: "Visible to approved friends",
  ghost: "Ghost mode (hidden)",
  app_open_only: "Visible only while app is open"
};

export function ProfileScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [muddyCount, setMuddyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data }, muddies] = await Promise.all([
      supabase.from("profiles").select("full_name, username, bio, mood_status, avatar_url, visibility_status").eq("user_id", user.id).maybeSingle(),
      api.get<{ muddies: unknown[] }>("/api/friends")
    ]);
    setProfile((data as Profile) ?? null);
    if (muddies.ok) setMuddyCount(muddies.data.muddies.length);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen title="Profile">
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </Screen>
    );
  }

  if (editing) {
    return (
      <Screen title="Edit profile">
        <EditProfile profile={profile} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Profile"
      action={
        <Button size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit profile
        </Button>
      }
    >
      <p className="-mt-3 mb-5 text-sm text-muted-foreground">How approved friends see you.</p>

      {/* Profile card */}
      <div className="rounded-2xl border border-border bg-card/40 p-6 text-center">
        <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-secondary text-3xl font-semibold">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (profile?.full_name ?? "?").slice(0, 1).toUpperCase()
          )}
        </div>
        <h2 className="mt-4 text-xl font-semibold">{profile?.full_name ?? "Your name"}</h2>
        <p className="text-sm text-muted-foreground">@{profile?.username ?? "username"}</p>
        <div className="mt-5 flex items-center justify-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <Users className="h-4 w-4" aria-hidden="true" />
          <span className="font-semibold text-foreground">{muddyCount}</span> Muddies
        </div>
      </div>

      {/* Profile details */}
      <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5">
        <h3 className="text-base font-semibold">Profile details</h3>
        <p className="mt-1 text-sm text-muted-foreground">Information visible to approved friends.</p>
        <dl className="mt-4 divide-y divide-border">
          <Detail label="Display name" value={profile?.full_name || "—"} />
          <Detail label="Username" value={profile?.username ? `@${profile.username}` : "—"} />
          <Detail label="Mood" value={profile?.mood_status || "Add a mood"} muted={!profile?.mood_status} />
          <Detail label="Bio" value={profile?.bio || "Add a short bio"} muted={!profile?.bio} />
          <Detail label="Visibility" value={visibilityLabel[profile?.visibility_status ?? "visible"] ?? "Visible to approved friends"} />
        </dl>
      </section>
    </Screen>
  );
}

function Detail({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${muted ? "text-muted-foreground" : ""}`}>{value}</dd>
    </div>
  );
}

function EditProfile({ profile, onCancel, onSaved }: { profile: Profile | null; onCancel: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [mood, setMood] = useState(profile?.mood_status ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/profile", {
      fullName: fullName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim() || undefined,
      moodStatus: mood.trim() || undefined
    });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(result.error);
  }

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="space-y-4">
        <Field label="Display name" id="fullName">
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Username" id="username" hint="Lowercase, numbers, underscores">
          <Input id="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Bio" id="bio">
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label="Mood" id="mood">
          <Input id="mood" placeholder="open, busy, chill…" value={mood} onChange={(e) => setMood(e.target.value)} />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={save} disabled={busy}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
