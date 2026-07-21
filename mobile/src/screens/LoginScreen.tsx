import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "../lib/supabase";
import { assertEnv } from "../lib/env";
import { SignInCard } from "../components/SignInCard";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
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
    if (signInError) setError("Email address or password is incorrect.");
    // On success the AuthProvider redirects.
  }

  return (
    <SignInCard title="Welcome Muddy">
      <form className="space-y-4" onSubmit={onSubmit}>
        {/* OAuth first: the fastest, most-used path leads. */}
        <Button
          type="button"
          variant="outline"
          className="w-full border-white/12 bg-white/[0.045] text-white hover:border-white/20 hover:bg-white/[0.09] hover:text-white"
          onClick={() => setError("Google sign-in is coming to the app soon — use your email for now.")}
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
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/35">or log in with email</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">Email address</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              className="border-white/10 bg-white/[0.055] pl-10 text-white placeholder:text-white/30 hover:bg-white/[0.075] focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-white/10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Link to="/forgot-password" className="text-xs text-white/45 hover:text-white/70">Forgot password?</Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="border-white/10 bg-white/[0.055] px-10 text-white hover:bg-white/[0.075] focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-white/10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-white/55">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-primary"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          Remember me on this device
        </label>

        {error ? (
          <div className="flex gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        ) : null}

        <Button
          type="submit"
          className="w-full border-primary shadow-[0_12px_30px_hsl(var(--primary)/0.3)] hover:shadow-[0_16px_36px_hsl(var(--primary)/0.4)]"
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Log in
        </Button>

        <p className="text-center text-sm text-white/55">
          New to Mad Buddy?{" "}
          <Link to="/signup" className="font-semibold text-white hover:text-white/75">
            Create account
          </Link>
        </p>
      </form>
    </SignInCard>
  );
}
