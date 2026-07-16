import { cn } from "@/lib/utils";

export type PasswordStrengthProps = {
  password: string;
};

type Strength = {
  label: string;
  value: number;
  className: string;
};

function getPasswordStrength(password: string): Strength {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ];
  const score = checks.filter(Boolean).length;

  if (!password) {
    return { label: "Not started", value: 0, className: "bg-white/10" };
  }

  if (score <= 2) {
    return { label: "Weak", value: 33, className: "bg-red-300" };
  }

  if (score <= 4) {
    return { label: "Good", value: 66, className: "bg-amber-300" };
  }

  return { label: "Strong", value: 100, className: "bg-emerald-300" };
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const strength = getPasswordStrength(password);

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-all motion-reduce:transition-none", strength.className)}
          style={{ width: `${strength.value}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">Password strength: {strength.label}</p>
    </div>
  );
}
