"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginAction, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/auth/form-field";
import { startOAuth } from "@/lib/auth/oauth";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { POST_LOGIN_ROUTE } from "@/lib/routes";

const loginSchema = z.object({
  email: z.string().email("Enter your email address."),
  password: z.string().min(1, "Enter your password.")
});

type LoginFormValues = z.infer<typeof loginSchema>;

type LoginFormProps = {
  initialError?: string | null;
  nextDestination?: string;
};

export function LoginForm({ initialError = null, nextDestination = POST_LOGIN_ROUTE }: LoginFormProps) {
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<AuthActionState | null>(
    initialError ? { ok: false, message: initialError } : null
  );
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  function onSubmit(values: LoginFormValues) {
    startTransition(async () => {
      try {
        const result = await withTimeout(loginAction({ ...values, next: nextDestination }), {
          operation: "log in",
          timeoutMs: 20_000
        });
        setActionState(
          result.ok ||
          result.message.includes("Supabase is not configured") ||
          result.message.includes("Too many") ||
          result.message.includes("could not reach the login service") ||
          result.message.includes("Confirm your email first") ||
          result.message.includes("already exists")
            ? result
            : { ...result, message: "Email address or password is incorrect." }
        );

        if (result.ok && result.redirectTo) window.location.assign(result.redirectTo);
      } catch (error) {
        setActionState({
          ok: false,
          message: isRequestTimeoutError(error)
            ? "Login is taking too long. Check your connection and try again."
            : "Mad Buddy could not reach the login service. Try again."
        });
      }
    });
  }

  async function signInWithGoogle() {
    setActionState(null);
    setIsGooglePending(true);

    try {
      await startOAuth("google", nextDestination);
    } catch {
      setActionState({ ok: false, message: "Google sign-in could not start. Please try again." });
      setIsGooglePending(false);
    }
  }

  return (
    <form className="space-y-4" method="post" onSubmit={handleSubmit(onSubmit)}>
      <Button
        type="button"
        variant="outline"
        className="w-full border-[#4E0401]/12 bg-white/45 text-[#4E0401] hover:bg-white/80 dark:border-white/12 dark:bg-white/[0.035] dark:text-[#FFF8F1] dark:hover:bg-white/[0.07]"
        onClick={signInWithGoogle}
        disabled={isPending || isGooglePending}
      >
        {isGooglePending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.4Z" />
            <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.4-4H3.3v2.6A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.6 14a6 6 0 0 1 0-4V7.4H3.3a10 10 0 0 0 0 9.2L6.6 14Z" />
            <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.3 7.4L6.6 10A5.8 5.8 0 0 1 12 5.9Z" />
          </svg>
        )}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[#4E0401]/10 dark:bg-white/10" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4E0401]/40 dark:text-[#FFF8F1]/40">
          or use email
        </span>
        <span className="h-px flex-1 bg-[#4E0401]/10 dark:bg-white/10" />
      </div>

      <FormField htmlFor="email" label="Email address" error={errors.email?.message}>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" className="pl-10" {...register("email")} />
        </div>
      </FormField>

      <FormField
        htmlFor="password"
        label="Password"
        hint={
          <Link href="/forgot-password" className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-foreground hover:text-accent">
            Forgot password?
          </Link>
        }
        error={errors.password?.message}
      >
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="px-10" {...register("password")} />
          <button
            type="button"
            className="focus-ring absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </FormField>

      {actionState && !actionState.ok ? (
        <div className="flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm leading-6 text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionState.message}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending || isGooglePending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Logging in..." : "Log in"}
      </Button>
    </form>
  );
}
