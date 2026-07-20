"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  createAdminUserAction,
  type CreateAdminState
} from "@/app/(admin)/admin/admins/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-dropdown";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.enum(["admin", "support", "owner"])
});

type FormValues = z.infer<typeof formSchema>;

const readyState: CreateAdminState = {
  ok: true,
  message: "Ready to create an admin."
};

export function CreateAdminForm({ allowOwner = false }: { allowOwner?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<CreateAdminState>(readyState);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      role: "admin"
    }
  });

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await createAdminUserAction(values);
      setState(result);

      if (result.ok) {
        reset({ email: "", password: "", role: "admin" });
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <FormField htmlFor="new-admin-email" label="Email" error={errors.email?.message}>
        <Input id="new-admin-email" type="email" placeholder="admin@example.com" {...register("email")} />
      </FormField>
      <FormField htmlFor="new-admin-password" label="Temporary password" error={errors.password?.message}>
        <Input id="new-admin-password" type="password" autoComplete="new-password" {...register("password")} />
      </FormField>
      <FormField htmlFor="new-admin-role" label="Role">
        <Controller
          name="role"
          control={control}
          render={({ field }) => (
            <AppSelect
              id="new-admin-role"
              value={field.value}
              options={[
                { value: "admin", label: "Admin" },
                { value: "support", label: "Support" },
                ...(allowOwner ? [{ value: "owner" as const, label: "Owner" }] : [])
              ]}
              error={errors.role?.message}
              onChange={field.onChange}
            />
          )}
        />
      </FormField>
      <div
        className={cn(
          "flex gap-2 rounded-md border p-3 text-sm leading-6",
          state.ok
            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
            : "border-amber-300/20 bg-amber-300/10 text-amber-50"
        )}
        role="status"
      >
        {state.ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        {state.message}
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        )}
        Create admin
      </Button>
    </form>
  );
}
