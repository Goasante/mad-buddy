import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../lib/api";

type GlowAudience = "hidden" | "close_friends" | "all_muddies";

const audienceOptions: { value: GlowAudience; label: string; description: string }[] = [
  { value: "hidden", label: "Stay hidden", description: "You start invisible. Turn your glow on whenever you're ready." },
  { value: "close_friends", label: "Close friends", description: "Only your close friends can see your glow." },
  { value: "all_muddies", label: "All Muddies", description: "Every Muddy can see your glow once you're active." }
];

const moods = ["open", "busy", "chill", "studying", "down"];

export function OnboardingScreen() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [mood, setMood] = useState("open");
  const [audience, setAudience] = useState<GlowAudience>("hidden");
  const [firstFriend, setFirstFriend] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (fullName.trim().length < 2) return setError("Add a display name (2+ characters).");
    if (username.trim().length < 3) return setError("Pick a username (3+ characters).");

    setBusy(true);
    setError("");

    // 1) Privacy setup (glow audience). Hidden = Ghost Mode until opt-in.
    const privacy = await api.post<{ ok: boolean; message: string }>("/api/onboarding/privacy", {
      glowAudience: audience,
      glowDuration: "until_off",
      wavesFrom: "all_muddies",
      pingsFrom: "all_muddies",
      onlineStatusVisible: true,
      contactMatchingEnabled: false
    });
    if (!privacy.ok) {
      setBusy(false);
      return setError(privacy.error);
    }

    // 2) Profile + preferences + optional first Muddy.
    const complete = await api.post<{ ok: boolean; message: string }>("/api/onboarding/complete", {
      fullName: fullName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim() || undefined,
      moodStatus: mood,
      notifications: "smart",
      firstFriend: firstFriend.trim().toLowerCase() || undefined
    });
    setBusy(false);

    if (!complete.ok) return setError(complete.error);
    navigate("/home");
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your profile</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">You start hidden — you choose who sees you.</p>

      <div className="mt-6 space-y-5">
        <section className="glass-panel space-y-4 rounded-2xl p-5">
          <Field label="Display name" id="fullName">
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Username" id="username" hint="Lowercase, numbers, underscores">
            <Input id="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Bio" id="bio">
            <Textarea id="bio" placeholder="Say something friendly." value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">Mood</p>
            <div className="flex flex-wrap gap-2">
              {moods.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMood(option)}
                  className={cn(
                    "focus-ring rounded-full border px-3 py-1.5 text-sm capitalize",
                    mood === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel space-y-3 rounded-2xl p-5">
          <p className="text-sm font-medium">Who can see your glow?</p>
          {audienceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAudience(option.value)}
              className={cn(
                "focus-ring w-full rounded-xl border p-3 text-left",
                audience === option.value ? "border-primary bg-primary/10" : "border-border"
              )}
            >
              <p className="text-sm font-semibold">{option.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
            </button>
          ))}
        </section>

        <section className="glass-panel space-y-3 rounded-2xl p-5">
          <Field label="Add your first Muddy (optional)" id="firstFriend" hint="We'll send a request when you finish.">
            <Input id="firstFriend" autoCapitalize="none" placeholder="muddy_username" value={firstFriend} onChange={(e) => setFirstFriend(e.target.value)} />
          </Field>
        </section>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <Button className="w-full" onClick={finish} disabled={busy}>
          {busy ? "Saving…" : "Finish setup"}
        </Button>
      </div>
    </main>
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
