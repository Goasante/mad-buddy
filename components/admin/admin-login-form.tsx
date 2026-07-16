"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { adminLoginAction, type AuthActionState } from "@/app/(auth)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const adminLoginSchema = z.object({
  email: z.string().email("Enter a valid admin email address."),
  password: z.string().min(1, "Enter your password."),
  rememberMe: z.boolean()
});

type AdminLoginFormValues = z.infer<typeof adminLoginSchema>;

export function AdminLoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<AuthActionState | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<AdminLoginFormValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: true
    }
  });

  function onSubmit(values: AdminLoginFormValues) {
    startTransition(async () => {
      const result = await adminLoginAction(values);
      setActionState(result);

      if (result.ok && result.redirectTo) {
        router.push(result.redirectTo);
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <FormField htmlFor="admin-email" label="Admin email" error={errors.email?.message}>
        <Input
          id="admin-email"
          type="email"
          autoComplete="email"
          placeholder="admin@example.com"
          {...register("email")}
        />
      </FormField>
      <FormField
        htmlFor="admin-password"
        label="Password"
        hint={
          <Link href="/forgot-password" className="hover:text-foreground">
            Reset
          </Link>
        }
        error={errors.password?.message}
      >
        <Input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-white/15 bg-white/[0.06] accent-primary"
          {...register("rememberMe")}
        />
        Keep this admin session active
      </label>
      {actionState && !actionState.ok ? (
        <div className="flex gap-2 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionState.message}
        </div>
      ) : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        )}
        Enter admin
      </Button>
      <Button type="button" variant="ghost" className="w-full" asChild>
        <Link href="/login">User login</Link>
      </Button>
    </form>
  );
}
