import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "../lib/supabase";
import { assertEnv } from "../lib/env";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const envError = assertEnv();
    if (envError) return setError(envError);

    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);

    if (signInError) {
      setError("Those details didn't match. Check your email and password.");
    }
    // On success the AuthProvider redirects via RedirectIfAuthed.
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Mad Buddy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Welcome back — sign in to see who's around.</p>
      </div>

      <form onSubmit={onSubmit} className="glass-panel space-y-4 rounded-2xl p-5">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <Input
            id="email"
            type="email"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/signup" className="font-semibold text-primary">
          Create an account
        </Link>
      </p>
    </main>
  );
}
