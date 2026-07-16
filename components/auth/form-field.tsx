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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {children}
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
