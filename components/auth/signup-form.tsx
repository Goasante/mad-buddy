"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { signUpAction, type AuthActionState } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { startOAuth } from "@/lib/auth/oauth";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [actionState, setActionState] = useState<AuthActionState | null>(
    initialError ? { ok: false, message: initialError } : null
  );
  const {
    register,
    handleSubmit,
    control,
    setError,
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

  const acceptedPolicy = useWatch({ control, name: "acceptedPolicy" });
  const busy = isPending || isGooglePending;

  function onSubmit(values: SignupFormValues) {
    setActionState(null);
    startTransition(async () => {
      const result = await signUpAction(values);
      setActionState(result);
      if (result.ok && result.redirectTo) router.push(result.redirectTo);
    });
  }

  async function signUpWithGoogle() {
    setActionState(null);
    if (!acceptedPolicy) {
      setError("acceptedPolicy", { message: "Agree to the Terms and Privacy Policy to continue." });
      return;
    }

    setIsGooglePending(true);
    try {
      await startOAuth("google", "/onboarding");
    } catch {
      setActionState({ ok: false, message: "Google sign-up could not start. Try again." });
      setIsGooglePending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Button type="button" variant="outline" className="w-full" onClick={signUpWithGoogle} disabled={busy}>
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
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

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
            className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
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
            <Link href="/terms" className="font-semibold text-foreground underline underline-offset-2 hover:text-accent">
              Terms
            </Link>{" "}
            and acknowledge the{" "}
            <Link href="/privacy" className="font-semibold text-foreground underline underline-offset-2 hover:text-accent">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptedPolicy?.message ? (
          <p className="mt-1.5 text-sm text-red-300" role="alert">
            {errors.acceptedPolicy.message}
          </p>
        ) : null}
      </div>

      {actionState ? (
        <div
          className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
            actionState.ok
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
              : "border-amber-300/20 bg-amber-300/10 text-amber-50"
          }`}
          role="status"
        >
          {actionState.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {actionState.message}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Creating account..." : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-foreground hover:text-accent">
          Log in
        </Link>
      </p>
    </form>
  );
}
