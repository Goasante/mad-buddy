import { useCallback, useEffect, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
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
};

export function ProfileScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    // Own profile is readable under RLS.
    const { data } = await supabase
      .from("profiles")
      .select("full_name, username, bio, mood_status, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle();
    setProfile((data as Profile) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      title="Profile"
      action={
        !loading && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : editing ? (
        <EditProfile
          profile={profile}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      ) : (
        <div className="glass-panel rounded-2xl p-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-2xl font-semibold">
            {(profile?.full_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <h2 className="mt-4 text-xl font-semibold">{profile?.full_name ?? "Your name"}</h2>
          <p className="text-sm text-muted-foreground">@{profile?.username ?? "username"}</p>
          {profile?.mood_status ? (
            <span className="mt-3 inline-block rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground">
              {profile.mood_status}
            </span>
          ) : null}
          {profile?.bio ? <p className="mt-4 text-sm leading-6 text-foreground/90">{profile.bio}</p> : null}
        </div>
      )}
    </Screen>
  );
}

function EditProfile({
  profile,
  onCancel,
  onSaved
}: {
  profile: Profile | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
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
    <div className="glass-panel space-y-4 rounded-2xl p-5">
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
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  hint,
  children
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
