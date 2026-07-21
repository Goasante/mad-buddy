"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { signUpAction, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/auth/form-field";
import { PasswordStrength } from "@/components/auth/password-strength";
import { startOAuth } from "@/lib/auth/oauth";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";

const signupSchema = z
  .object({
    fullName: z.string().min(2, "Enter your full name."),
    username: z
      .string()
      .min(3, "Username must be at least 3 characters.")
      .max(24, "Username must be 24 characters or less.")
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only."),
    email: z.string().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Confirm your password."),
    acceptedPolicy: z.boolean().refine(Boolean, "You must agree before creating an account."),
    policyVersion: z.literal(PRIVACY_POLICY_VERSION)
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"]
  });

type SignupFormValues = z.infer<typeof signupSchema>;

const reservedUsernames = new Set(["admin", "support", "madbuddy", "billing"]);

type SignupFormProps = {
  initialError?: string | null;
};

export function SignupForm({ initialError = null }: SignupFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<AuthActionState | null>(
    initialError ? { ok: false, message: initialError } : null
  );
  const [isGooglePending, setIsGooglePending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors }
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptedPolicy: false,
      policyVersion: PRIVACY_POLICY_VERSION
    }
  });

  const username = useWatch({ control, name: "username" });
  const password = useWatch({ control, name: "password" });
  const acceptedPolicy = useWatch({ control, name: "acceptedPolicy" });
  const usernameState = useMemo(() => {
    if (!username || username.length < 3) {
      return "At least 3 characters";
    }

    if (reservedUsernames.has(username.toLowerCase())) {
      return "Username is reserved";
    }

    if (!/^[a-z0-9_]+$/.test(username)) {
      return "Checking paused";
    }

    return "Looks available";
  }, [username]);

  function onSubmit(values: SignupFormValues) {
    startTransition(async () => {
      const result = await signUpAction(values);
      setActionState(result);

      if (result.ok && result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  }

  async function signUpWithGoogle() {
    setActionState(null);

    if (!acceptedPolicy) {
      setError("acceptedPolicy", { message: "You must agree before creating an account." });
      return;
    }

    setIsGooglePending(true);

    try {
      await startOAuth("google", "/onboarding");
    } catch {
      setActionState({ ok: false, message: "Google sign-up could not start. Please try again." });
      setIsGooglePending(false);
    }
  }

  const busy = isPending || isGooglePending;

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      {/* OAuth first — the fastest path leads. */}
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
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">or sign up with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Row 1: name + username */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="fullName" label="Full name" error={errors.fullName?.message}>
          <Input id="fullName" autoComplete="name" placeholder="Godfred Ofosu Asante" {...register("fullName")} />
        </FormField>
        <FormField htmlFor="username" label="Username" hint={usernameState} error={errors.username?.message}>
          <Input id="username" autoComplete="username" placeholder="godfred" {...register("username")} />
        </FormField>
      </div>

      {/* Row 2: email */}
      <FormField htmlFor="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...register("email")} />
      </FormField>

      {/* Row 3: password + confirm */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField htmlFor="password" label="Password" error={errors.password?.message}>
          <div className="relative">
            <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-10" {...register("password")} />
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
        <FormField htmlFor="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
          <div className="relative">
            <Input id="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password" className="pr-10" {...register("confirmPassword")} />
            <button
              type="button"
              onClick={() => setShowConfirm((current) => !current)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
              title={showConfirm ? "Hide password" : "Show password"}
              className="focus-ring absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </FormField>
      </div>

      <PasswordStrength password={password} />

      {/* Privacy card */}
      <div className="flex gap-2.5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
        <div className="text-xs leading-6 text-emerald-50/90">
          <p className="font-semibold text-emerald-50">Privacy comes first.</p>
          <p className="mt-0.5">
            Your exact location is never shared. Only approved Muddies can see when you’re nearby — no maps,
            no pins, no history.
          </p>
        </div>
      </div>

      <input type="hidden" {...register("policyVersion")} />

      {/* Terms */}
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
            <Link href="/terms" className="focus-ring rounded font-semibold text-foreground underline decoration-border underline-offset-2 hover:text-accent hover:decoration-accent">
              Terms
            </Link>{" "}
            and acknowledge the{" "}
            <Link href="/privacy" className="focus-ring rounded font-semibold text-foreground underline decoration-border underline-offset-2 hover:text-accent hover:decoration-accent">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptedPolicy?.message ? (
          <p className="mt-1.5 text-sm text-red-300" role="alert">{errors.acceptedPolicy.message}</p>
        ) : null}
      </div>

      {actionState ? (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${actionState.ok ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50" : "border-amber-300/20 bg-amber-300/10 text-amber-50"}`} role="status">
          {actionState.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {actionState.message}
        </div>
      ) : null}

      <Button
        type="submit"
        className="w-full shadow-[0_12px_30px_hsl(var(--primary)/0.28)] transition-shadow hover:shadow-[0_16px_38px_hsl(var(--primary)/0.4)]"
        disabled={busy}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Creating your account…" : "Create account"}
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
