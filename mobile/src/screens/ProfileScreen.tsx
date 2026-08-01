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
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { dateKeyInTimeZone, deriveBirthProfile } from "@/lib/profile/birth-date";
import { BirthdayAccent } from "@/components/profile/birthday-accent";

type BirthVisibility = "only_me" | "approved_muddies";
type BirthSettings = {
  dateOfBirth: string;
  birthdayVisibility: BirthVisibility;
  ageVisibility: BirthVisibility;
  zodiacVisibility: BirthVisibility;
  birthdayToday: boolean;
};

const DEFAULT_BIRTH_SETTINGS: BirthSettings = {
  dateOfBirth: "",
  birthdayVisibility: "only_me",
  ageVisibility: "only_me",
  zodiacVisibility: "only_me",
  birthdayToday: false
};

const BIRTH_VISIBILITY_OPTIONS: AppSelectOption<BirthVisibility>[] = [
  { value: "only_me", label: "Only me" },
  { value: "approved_muddies", label: "Muddies" }
];

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
  const [birthSettings, setBirthSettings] = useState<BirthSettings>(DEFAULT_BIRTH_SETTINGS);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data }, muddies, privateProfile] = await Promise.all([
      supabase.from("profiles").select("full_name, username, bio, mood_status, avatar_url, visibility_status").eq("user_id", user.id).maybeSingle(),
      api.get<{ muddies: unknown[] }>("/api/friends"),
      api.get<{ birth: BirthSettings }>("/api/profile")
    ]);
    setProfile((data as Profile) ?? null);
    if (muddies.ok) setMuddyCount(muddies.data.muddies.length);
    if (privateProfile.ok) setBirthSettings(privateProfile.data.birth);
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
        <EditProfile profile={profile} birthSettings={birthSettings} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} />
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
        <BirthdayAccent active={birthSettings.birthdayToday} className="mx-auto">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-secondary text-3xl font-semibold">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              (profile?.full_name ?? "?").slice(0, 1).toUpperCase()
            )}
          </div>
        </BirthdayAccent>
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
          {birthSettings.dateOfBirth ? (() => {
            const birth = deriveBirthProfile(birthSettings.dateOfBirth, dateKeyInTimeZone(new Date()));
            return (
              <>
                <Detail label="Age" value={String(birth.age)} />
                <Detail label="Zodiac" value={birth.zodiacSign} />
                {birthSettings.birthdayToday ? <Detail label="Birthday" value="Birthday today" /> : null}
              </>
            );
          })() : null}
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

function EditProfile({ profile, birthSettings, onCancel, onSaved }: { profile: Profile | null; birthSettings: BirthSettings; onCancel: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [mood, setMood] = useState(profile?.mood_status ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(birthSettings.dateOfBirth);
  const [birthdayVisibility, setBirthdayVisibility] = useState<BirthVisibility>(birthSettings.birthdayVisibility);
  const [ageVisibility, setAgeVisibility] = useState<BirthVisibility>(birthSettings.ageVisibility);
  const [zodiacVisibility, setZodiacVisibility] = useState<BirthVisibility>(birthSettings.zodiacVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>("/api/profile", {
      fullName: fullName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim() || undefined,
      moodStatus: mood.trim() || undefined,
      dateOfBirth,
      birthdayVisibility,
      ageVisibility,
      zodiacVisibility
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
        <Field label="Date of birth" id="dateOfBirth" hint="Your full date stays private">
          <Input id="dateOfBirth" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} />
        </Field>
        {dateOfBirth ? (
          <div className="grid gap-3 rounded-xl border border-border bg-secondary/20 p-3">
            <AppSelect label="Show birthday" size="compact" value={birthdayVisibility} options={BIRTH_VISIBILITY_OPTIONS} onChange={setBirthdayVisibility} />
            <AppSelect label="Show age" size="compact" value={ageVisibility} options={BIRTH_VISIBILITY_OPTIONS} onChange={setAgeVisibility} />
            <AppSelect label="Show zodiac" size="compact" value={zodiacVisibility} options={BIRTH_VISIBILITY_OPTIONS} onChange={setZodiacVisibility} />
          </div>
        ) : null}
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
