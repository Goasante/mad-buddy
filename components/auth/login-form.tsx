"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginAction, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/auth/form-field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const loginSchema = z.object({
  email: z.string().email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
  rememberMe: z.boolean()
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<AuthActionState | null>(null);
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [isApplePending, setIsApplePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: true
    }
  });

  function onSubmit(values: LoginFormValues) {
    startTransition(async () => {
      const result = await loginAction(values);
      setActionState(
        result.ok ||
        result.message.includes("Supabase is not configured") ||
        result.message.includes("Too many") ||
        result.message.includes("could not reach the login service")
          ? result
          : { ...result, message: "Email address or password is incorrect." }
      );

      if (result.ok && result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  }

  async function signInWithGoogle() {
    setActionState(null);
    setIsGooglePending(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
        }
      });

      if (error) {
        setActionState({ ok: false, message: "Google sign-in could not start. Please try again." });
        setIsGooglePending(false);
      }
    } catch {
      setActionState({ ok: false, message: "Google sign-in could not start. Please try again." });
      setIsGooglePending(false);
    }
  }

  async function signInWithApple() {
    setActionState(null);
    setIsApplePending(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
        }
      });

      if (error) {
        setActionState({ ok: false, message: "Apple sign-in could not start. Please try again." });
        setIsApplePending(false);
      }
    } catch {
      setActionState({ ok: false, message: "Apple sign-in could not start. Please try again." });
      setIsApplePending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <FormField htmlFor="email" label="Email address" error={errors.email?.message}>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="border-white/10 bg-white/[0.055] pl-10 text-white placeholder:text-white/30 hover:bg-white/[0.075] focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-white/10"
            {...register("email")}
          />
        </div>
      </FormField>
      <FormField
        htmlFor="password"
        label="Password"
        hint={
          <Link href="/forgot-password" className="hover:text-foreground">
            Forgot password?
          </Link>
        }
        error={errors.password?.message}
      >
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="border-white/10 bg-white/[0.055] px-10 text-white hover:bg-white/[0.075] focus-visible:border-white/25 focus-visible:bg-white/[0.08] focus-visible:ring-white/10"
            {...register("password")}
          />
          <button
            type="button"
            className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </FormField>
      <label className="flex items-center gap-2 text-sm text-white/55">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-primary"
          {...register("rememberMe")}
        />
        Remember me on this device
      </label>
      {actionState && !actionState.ok ? (
        <div className="flex gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionState.message}
        </div>
      ) : null}
      <Button
        type="submit"
        className="w-full border-primary shadow-[0_12px_30px_hsl(var(--primary)/0.3)] hover:shadow-[0_16px_36px_hsl(var(--primary)/0.4)]"
        disabled={isPending || isGooglePending || isApplePending}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : null}
        Log in
      </Button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/35">or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full border-white/12 bg-white/[0.045] text-white hover:border-white/20 hover:bg-white/[0.09] hover:text-white"
        onClick={signInWithGoogle}
        disabled={isPending || isGooglePending || isApplePending}
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

      <Button
        type="button"
        variant="outline"
        className="w-full border-white/12 bg-white/[0.045] text-white hover:border-white/20 hover:bg-white/[0.09] hover:text-white"
        onClick={signInWithApple}
        disabled={isPending || isGooglePending || isApplePending}
      >
        {isApplePending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden="true">
            <path d="M16.365 1.43c0 1.14-.415 2.19-1.24 3.02-.87.88-2.15 1.56-3.19 1.48-.14-1.1.42-2.27 1.24-3.08.83-.83 2.24-1.42 3.19-1.42Zm4.19 15.86c-.44 1.03-.65 1.49-1.22 2.39-.79 1.26-1.9 2.83-3.28 2.84-1.22.02-1.54-.79-3.2-.78-1.66.01-2.01.8-3.23.78-1.38-.02-2.44-1.44-3.23-2.7-2.21-3.5-2.44-7.6-1.08-9.79.97-1.55 2.5-2.46 3.94-2.46 1.47 0 2.39.81 3.61.81 1.18 0 1.9-.81 3.61-.81 1.28 0 2.64.7 3.6 1.91-3.17 1.74-2.66 6.25.28 7.81Z" />
          </svg>
        )}
        Continue with Apple
      </Button>

      <p className="text-center text-sm text-white/55">
        New to Mad Buddy?{" "}
        <Link href="/signup" className="font-semibold text-white hover:text-white/75">
          Get started
        </Link>
      </p>
    </form>
  );
}
