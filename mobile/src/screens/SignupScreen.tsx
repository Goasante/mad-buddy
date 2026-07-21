import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { assertEnv } from "../lib/env";

export function SignupScreen() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const envError = assertEnv();
    if (envError) return setError(envError);
    if (!accepted) return setError("Please accept the privacy policy to continue.");

    setBusy(true);
    setError("");

    // 1) Create the confirmed account server-side (public endpoint).
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

    // 2) Establish the mobile session ourselves.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    setBusy(false);

    if (signInError) {
      // Account exists but session couldn't start — they can still log in.
      return navigate("/login");
    }

    navigate("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">A few basics and you're in.</p>
      </div>

      <form onSubmit={onSubmit} className="glass-panel space-y-4 rounded-2xl p-5">
        <Field label="Display name" id="fullName">
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Username" id="username" hint="Lowercase, numbers, underscores">
          <Input
            id="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="Email" id="email">
          <Input id="email" type="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" id="password" hint="At least 8 characters">
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>

        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span>I agree to the Privacy Policy and Terms.</span>
        </label>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
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
