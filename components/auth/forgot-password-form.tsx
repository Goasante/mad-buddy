"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { forgotPasswordAction, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/auth/form-field";
import { TurnstileWidget } from "@/components/security/turnstile-widget";

const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address.")
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const [isPending, startTransition] = useTransition();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [actionState, setActionState] = useState<AuthActionState | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" }
  });

  function onSubmit(values: ForgotPasswordFormValues) {
    startTransition(async () => {
      const result = await forgotPasswordAction({ ...values, turnstileToken });
      setActionState(result);
      if (!result.ok) {
        setTurnstileToken(null);
        setTurnstileResetKey((current) => current + 1);
      }
    });
  }

  const onTurnstileTokenChange = useCallback((token: string | null) => {
    setTurnstileToken(token);
  }, []);

  return (
    <form className="space-y-4" method="post" onSubmit={handleSubmit(onSubmit)}>
      <FormField htmlFor="email" label="Email address" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...register("email")} />
      </FormField>
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        action="password_recovery"
        onTokenChange={onTurnstileTokenChange}
        resetKey={turnstileResetKey}
      />
      {actionState ? (
        <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm leading-6 ${actionState.ok ? "border-emerald-600/20 bg-emerald-600/10 text-emerald-900 dark:text-emerald-100" : "border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-100"}`} role="status">
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
        disabled={isPending || Boolean(turnstileSiteKey && !turnstileToken)}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Sending..." : "Send reset link"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-foreground hover:text-accent">Back to login</Link>
      </p>
    </form>
  );
}
