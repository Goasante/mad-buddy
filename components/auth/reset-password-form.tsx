"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetPasswordAction, type AuthActionState } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirmPassword: z.string().min(8, "Confirm your new password.")
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match.",
    path: ["confirmPassword"]
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<AuthActionState | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" }
  });

  function onSubmit(values: ResetPasswordFormValues) {
    startTransition(async () => {
      const result = await resetPasswordAction(values);
      setActionState(result);
      if (result.ok && result.redirectTo) router.push(result.redirectTo as Route);
    });
  }

  return (
    <form className="space-y-4" method="post" onSubmit={handleSubmit(onSubmit)}>
      <FormField htmlFor="password" label="New password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </FormField>
      <FormField htmlFor="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <Input id="confirmPassword" type="password" autoComplete="new-password" {...register("confirmPassword")} />
      </FormField>
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
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {isPending ? "Updating..." : "Update password"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already updated?{" "}
        <Link href="/login" className="font-semibold text-foreground hover:text-accent">Back to login</Link>
      </p>
    </form>
  );
}
