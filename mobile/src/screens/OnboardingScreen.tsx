import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "../lib/api";

type StepId = "profile" | "privacy" | "friend";
type GlowAudience = "hidden" | "close_friends" | "all_muddies";

// Mirrors the web onboarding-flow: three focused steps with a slim stepper.
const steps: { id: StepId; title: string; description: string }[] = [
  { id: "profile", title: "Build your profile", description: "Add the basics friends will recognise." },
  { id: "privacy", title: "Privacy setup", description: "You start hidden — choose who can see you." },
  { id: "friend", title: "Add your first Muddy", description: "Optional — start with someone you trust." }
];

const moods = ["open", "busy", "chill", "studying", "down"];

const audienceOptions: { value: GlowAudience; label: string; description: string }[] = [
  { value: "hidden", label: "Stay hidden", description: "You start invisible. Turn your glow on when you're ready." },
  { value: "close_friends", label: "Close friends", description: "Only your close friends can see your glow." },
  { value: "all_muddies", label: "All Muddies", description: "Every Muddy can see your glow once you're active." }
];

export function OnboardingScreen() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [mood, setMood] = useState("open");
  const [audience, setAudience] = useState<GlowAudience>("hidden");
  const [firstFriend, setFirstFriend] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const activeStep = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  function goNext() {
    setFeedback("");
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }
  function goBack() {
    setFeedback("");
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  async function finish() {
    if (displayName.trim().length < 2) {
      setFeedback("Add a display name (2+ characters).");
      setStepIndex(0);
      return;
    }
    if (username.trim().length < 3) {
      setFeedback("Pick a username (3+ characters).");
      setStepIndex(0);
      return;
    }
    setBusy(true);
    setFeedback("");
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
      return setFeedback(privacy.error);
    }
    const complete = await api.post<{ ok: boolean; message: string }>("/api/onboarding/complete", {
      fullName: displayName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim() || undefined,
      moodStatus: mood,
      notifications: "smart",
      firstFriend: firstFriend.trim().toLowerCase() || undefined
    });
    setBusy(false);
    if (!complete.ok) return setFeedback(complete.error);
    navigate("/home");
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between">
          <Link to="/home" className="focus-ring rounded-lg text-lg font-semibold">
            Mad Buddy
          </Link>
          <Badge variant="green">Onboarding</Badge>
        </header>

        {/* Slim stepper */}
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {stepIndex + 1} of {steps.length}</span>
            <span aria-hidden="true">{Math.round(progress)}%</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {steps.map((step, index) => (
              <span
                key={step.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  index <= stepIndex ? "bg-accent" : "bg-white/10"
                )}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="mt-6 glass-panel rounded-2xl p-5 sm:p-6">
          <h1 className="text-2xl font-semibold tracking-tight">{activeStep.title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{activeStep.description}</p>
          {feedback ? (
            <p className="mt-2 text-sm text-accent" role="status">
              {busy ? "Saving…" : feedback}
            </p>
          ) : null}

          <div className="mt-6">
            {activeStep.id === "profile" ? (
              <div className="space-y-5">
                <div className="flex justify-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-2xl font-semibold">
                    {(displayName || "?").slice(0, 1).toUpperCase()}
                  </div>
                </div>
                <Field label="Display name" id="displayName">
                  <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </Field>
                <Field label="Username" id="username" hint="Lowercase, numbers, underscores">
                  <Input id="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
                </Field>
                <Field label="Bio" id="bio">
                  <Textarea id="bio" placeholder="Say something friendly." value={bio} onChange={(e) => setBio(e.target.value)} />
                </Field>
                <div className="space-y-2.5">
                  <p className="text-sm font-medium">Mood status</p>
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
              </div>
            ) : null}

            {activeStep.id === "privacy" ? (
              <div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Nothing is shared until you turn your glow on, and location is only requested after you choose an audience.
                </p>
                <div className="mt-5 space-y-3">
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
                </div>
              </div>
            ) : null}

            {activeStep.id === "friend" ? (
              <div className="space-y-4">
                <Field label="Muddy username" id="firstFriend">
                  <Input id="firstFriend" placeholder="muddy_username" autoCapitalize="none" value={firstFriend} onChange={(e) => setFirstFriend(e.target.value)} />
                </Field>
                <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-6 text-muted-foreground">
                  If the username exists, we'll send them a request when you finish. You can skip this and add Muddies anytime.
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={goBack} disabled={stepIndex === 0 || busy}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            {isLast ? (
              <Button type="button" onClick={finish} disabled={busy}>
                {busy ? "Saving…" : "Finish setup"}
                <Check className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
