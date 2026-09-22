import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export type FormFieldProps = {
  htmlFor: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
};

export function FormField({ htmlFor, label, error, hint, children }: FormFieldProps) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <div className="min-w-0 max-w-full text-right text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {children}
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
