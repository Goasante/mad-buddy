import { useCallback, useEffect, useState } from "react";
import { Pencil, Check, X, Award, CalendarCheck2, Images, ShieldCheck, Users, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { BirthdayAccent } from "@/components/profile/birthday-accent";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";
import type { JourneyData } from "@/lib/journey/journey";

type BirthVisibility = "only_me" | "approved_muddies";
type BirthSettings = {
  dateOfBirth: string;
  birthdayVisibility: BirthVisibility;
  ageVisibility: BirthVisibility;
  zodiacVisibility: BirthVisibility;
  birthdayToday: boolean;
  birthdayTomorrow: boolean;
  age: number | null;
  zodiacSign: string | null;
  birthdayCountdownDays: number | null;
};

const DEFAULT_BIRTH_SETTINGS: BirthSettings = {
  dateOfBirth: "",
  birthdayVisibility: "only_me",
  ageVisibility: "only_me",
  zodiacVisibility: "only_me",
  birthdayToday: false,
  birthdayTomorrow: false,
  age: null,
  zodiacSign: null,
  birthdayCountdownDays: null
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [birthSettings, setBirthSettings] = useState<BirthSettings>(DEFAULT_BIRTH_SETTINGS);
  const [plan, setPlan] = useState<SubscriptionPlan>("free");
  const [identity, setIdentity] = useState<ProfileIdentitySummary | null>(null);
  const [journey, setJourney] = useState<JourneyData | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data }, privateProfile] = await Promise.all([
      supabase.from("profiles").select("full_name, username, bio, mood_status, avatar_url, visibility_status").eq("user_id", user.id).maybeSingle(),
      api.get<{ birth: BirthSettings; plan: SubscriptionPlan; identity: ProfileIdentitySummary; journey: JourneyData }>("/api/profile")
    ]);
    setProfile((data as Profile) ?? null);
    if (privateProfile.ok) {
      setBirthSettings(privateProfile.data.birth);
      setPlan(privateProfile.data.plan);
      setIdentity(privateProfile.data.identity);
      setJourney(privateProfile.data.journey);
    }
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
        <div className="mt-4 flex items-center justify-center gap-2">
          <h2 className="text-xl font-semibold">{profile?.full_name ?? "Your name"}</h2>
          <PremiumPlanBadge plan={plan} />
        </div>
        <p className="text-sm text-muted-foreground">@{profile?.username ?? "username"}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-border pt-4">
          <Button size="sm" variant="outline" onClick={() => navigate("/subscription")}>Membership</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/buddy-score")}>My Progress</Button>
        </div>
      </div>

      {journey ? (
        <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Journey</p>
              <p className="mt-1 font-semibold">{journey.currentStep?.title ?? "Journey complete"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{journey.completedCount} of {journey.totalCount} steps complete</p>
            </div>
            <span className="rounded-full bg-secondary/50 px-3 py-1 text-sm font-semibold">{journey.completedCount}/{journey.totalCount}</span>
          </div>
          <button type="button" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary" onClick={() => navigate("/buddy-score")}>View My Progress <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </section>
      ) : null}

      {identity?.buddyScore || identity?.achievements ? (
        <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5">
          <h3 className="text-base font-semibold">Progress</h3>
          {identity.buddyScore ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-secondary/30 p-3">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{identity.buddyScore.levelLabel}</p>
                {identity.buddyScore.total !== null ? <p className="text-xs text-muted-foreground">{identity.buddyScore.total} Buddy Score</p> : null}
              </div>
            </div>
          ) : null}
          {identity.achievements ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {identity.achievements.featured.map((achievement) => (
                  <span key={achievement.code} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs">
                    <Award className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{achievement.name}
                  </span>
                ))}
                {identity.achievements.unlockedCount === 0 ? <p className="text-sm text-muted-foreground">No achievements yet.</p> : null}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{identity.achievements.unlockedCount} unlocked</p>
            </>
          ) : null}
          {identity.buddyScore?.recentActivity?.length ? (
            <div className="mt-4 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">Recent score activity</p><button type="button" className="text-xs font-semibold text-primary" onClick={() => navigate("/buddy-score")}>View progress</button></div>
              <div className="mt-2 divide-y divide-border/70">
                {identity.buddyScore.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                    <span className="min-w-0 truncate">{activity.label}</span>
                    <span className={activity.points >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{activity.points > 0 ? "+" : ""}{activity.points}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {identity?.activity ? (
        <section className="mt-6">
          <h3 className="text-base font-semibold">Activity</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ActivityStat icon={Users} label="Muddies" value={identity.activity.muddyCount} />
            <ActivityStat icon={Images} label="Moments" value={identity.activity.momentCount} />
            <ActivityStat icon={CalendarCheck2} label="Plans completed" value={identity.activity.completedPlanCount} />
            <ActivityStat icon={ShieldCheck} label="Safe Arrivals" value={identity.activity.completedSafeArrivalCount} />
          </div>
        </section>
      ) : null}

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
          {birthSettings.age !== null ? <Detail label="Age" value={String(birthSettings.age)} /> : null}
          {birthSettings.zodiacSign ? <Detail label="Zodiac" value={birthSettings.zodiacSign} /> : null}
          {birthSettings.birthdayToday ? <Detail label="Birthday" value="Birthday today" /> : null}
          {birthSettings.birthdayTomorrow ? <Detail label="Birthday" value="Tomorrow" /> : null}
          {!birthSettings.birthdayToday && !birthSettings.birthdayTomorrow && birthSettings.birthdayCountdownDays !== null ? (
            <Detail label="Birthday" value={birthSettings.birthdayCountdownDays === 1 ? "Tomorrow" : `In ${birthSettings.birthdayCountdownDays} days`} />
          ) : null}
        </dl>
      </section>
    </Screen>
  );
}

function ActivityStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
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
    if (
      birthSettings.dateOfBirth &&
      dateOfBirth !== birthSettings.dateOfBirth &&
      !window.confirm(
        "Change your date of birth? This can affect your age, zodiac, birthday status, and reward eligibility."
      )
    ) {
      return;
    }
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
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Age, zodiac, and birthday status are calculated automatically. You choose what Muddies can see.
          </p>
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
