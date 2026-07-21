import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { assertEnv } from "../lib/env";
import { BrandMark } from "../components/BrandMark";

export function SignupScreen() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const envError = assertEnv();
    if (envError) return setError(envError);
    if (password !== confirmPassword) return setError("Those passwords don't match.");
    if (!accepted) return setError("You must agree before creating an account.");

    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string }>(
      "/api/auth/signup",
      {
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        password,
        acceptedPolicy: true,
        policyVersion: PRIVACY_POLICY_VERSION
      },
      { auth: false }
    );
    if (!result.ok) {
      setBusy(false);
      return setError(result.error);
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    navigate(signInError ? "/login" : "/onboarding");
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-lg px-5 py-10 sm:px-8">
        <Link to="/login" className="mb-8 inline-flex items-center gap-2.5 text-lg font-semibold">
          <BrandMark className="h-8 w-8" />
          Mad Buddy
        </Link>

        <div className="glass-panel rounded-2xl p-6 sm:p-7">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Set up the basics — you'll choose your privacy settings next.
            </p>
          </div>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setError("Google sign-up is coming to the app soon — use your email for now.")}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.4Z" />
                <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.4-4H3.3v2.6A10 10 0 0 0 12 22Z" />
                <path fill="#FBBC05" d="M6.6 14a6 6 0 0 1 0-4V7.4H3.3a10 10 0 0 0 0 9.2L6.6 14Z" />
                <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.3 7.4L6.6 10A5.8 5.8 0 0 1 12 5.9Z" />
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">or sign up with email</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" id="fullName">
                <Input id="fullName" autoComplete="name" placeholder="Godfred Ofosu Asante" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </Field>
              <Field label="Username" id="username" hint="Lowercase, numbers, underscores">
                <Input id="username" autoComplete="username" autoCapitalize="none" placeholder="godfred" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </Field>
            </div>

            <Field label="Email" id="email">
              <Input id="email" type="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Password" id="password">
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-10" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <PasswordToggle shown={showPassword} onClick={() => setShowPassword((v) => !v)} />
                </div>
              </Field>
              <Field label="Confirm password" id="confirmPassword">
                <div className="relative">
                  <Input id="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password" className="pr-10" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                  <PasswordToggle shown={showConfirm} onClick={() => setShowConfirm((v) => !v)} />
                </div>
              </Field>
            </div>

            <div className="flex gap-2.5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              <div className="text-xs leading-6 text-emerald-50/90">
                <p className="font-semibold text-emerald-50">Privacy comes first.</p>
                <p className="mt-0.5">
                  Your exact location is never shared. Only approved Muddies can see when you're nearby — no maps, no pins, no history.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
              <input
                type="checkbox"
                className="focus-ring mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                I agree to the <span className="font-semibold text-foreground underline decoration-border underline-offset-2">Terms</span> and acknowledge the{" "}
                <span className="font-semibold text-foreground underline decoration-border underline-offset-2">Privacy Policy</span>.
              </span>
            </label>

            {error ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-50" role="status">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full shadow-[0_12px_30px_hsl(var(--primary)/0.28)] transition-shadow hover:shadow-[0_16px_38px_hsl(var(--primary)/0.4)]"
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {busy ? "Creating your account…" : "Create account"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-foreground hover:text-accent">
                Log in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

function PasswordToggle({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label={shown ? "Hide password" : "Show password"}
    >
      {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
    </button>
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
