"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { signUpAction, type AuthActionState } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { TurnstileWidget } from "@/components/security/turnstile-widget";

const signupSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  acceptedPolicy: z.boolean().refine(Boolean, "Agree to the Terms and Privacy Policy to continue."),
  policyVersion: z.literal(PRIVACY_POLICY_VERSION)
});

type SignupFormValues = z.infer<typeof signupSchema>;

type SignupFormProps = {
  initialError?: string | null;
};

export function SignupForm({ initialError = null }: SignupFormProps) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const turnstileConfigMissing = process.env.NODE_ENV === "production" && !turnstileSiteKey;
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [actionState, setActionState] = useState<AuthActionState | null>(
    initialError ? { ok: false, message: initialError } : null
  );
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      acceptedPolicy: false,
      policyVersion: PRIVACY_POLICY_VERSION
    }
  });

  function onSubmit(values: SignupFormValues) {
    if (turnstileConfigMissing) {
      setActionState({
        ok: false,
        message: "Account creation is temporarily unavailable while security verification starts. Try again shortly."
      });
      return;
    }

    setActionState(null);
    startTransition(async () => {
      try {
        const result = await withTimeout(signUpAction({ ...values, turnstileToken }), {
          operation: "create account",
          timeoutMs: 20_000
        });
        setActionState(result);
        if (!result.ok) {
          setTurnstileToken(null);
          setTurnstileResetKey((current) => current + 1);
        }
        if (result.ok && result.redirectTo) window.location.assign(result.redirectTo);
      } catch (error) {
        setTurnstileToken(null);
        setTurnstileResetKey((current) => current + 1);
        setActionState({
          ok: false,
          message: isRequestTimeoutError(error)
            ? "Account creation is taking too long. Check your connection and try again."
            : "Mad Buddy could not create your account. Try again."
        });
      }
    });
  }

  const onTurnstileTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  return (
    <form className="space-y-4" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField htmlFor="email" label="Email address" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          {...register("email")}
        />
      </FormField>

      <FormField htmlFor="password" label="Password" hint="At least 8 characters." error={errors.password?.message}>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="pr-11"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
            className="focus-ring absolute right-0.5 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </FormField>

      <input type="hidden" {...register("policyVersion")} />
      <div>
        <label className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
          <input
            type="checkbox"
            className="focus-ring mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
            aria-invalid={Boolean(errors.acceptedPolicy)}
            {...register("acceptedPolicy")}
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-foreground underline underline-offset-2 hover:text-accent">Terms</Link>{" "}
            and acknowledge the{" "}
            <Link href="/privacy" className="focus-ring -mx-1 inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-foreground underline underline-offset-2 hover:text-accent">Privacy Policy</Link>.
          </span>
        </label>
        {errors.acceptedPolicy?.message ? (
          <p className="mt-1.5 text-sm text-red-700 dark:text-red-300" role="alert">
            {errors.acceptedPolicy.message}
          </p>
        ) : null}
      </div>

      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action="signup"
        onTokenChange={onTurnstileTokenChange}
        resetKey={turnstileResetKey}
      />

      {turnstileConfigMissing ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm leading-6 text-amber-900 dark:text-amber-100" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Security verification is starting up. Try again shortly.
        </div>
      ) : null}

      {actionState ? (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-6 ${
            actionState.ok
              ? "border-emerald-600/20 bg-emerald-600/10 text-emerald-900 dark:text-emerald-100"
              : "border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          }`}
          role="status"
        >
          {actionState.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {actionState.message}
        </div>
      ) : null}

      <Button
        type="submit"
        className="w-full"
        disabled={isPending || turnstileConfigMissing || Boolean(turnstileSiteKey && !turnstileToken)}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Creating account..." : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-foreground hover:text-accent">Log in</Link>
      </p>
    </form>
  );
}
