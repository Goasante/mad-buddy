import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type PasswordStrengthProps = {
  password: string;
};

const REQUIREMENTS: { label: string; test: (password: string) => boolean }[] = [
  { label: "8+ characters", test: (p) => p.length >= 8 },
  { label: "Uppercase", test: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p) => /[a-z]/.test(p) },
  { label: "Number", test: (p) => /\d/.test(p) },
  { label: "Special character", test: (p) => /[^A-Za-z0-9]/.test(p) }
];

// One level per satisfied requirement (1–5).
const LEVELS: { label: string; bar: string; text: string }[] = [
  { label: "Very weak", bar: "bg-red-400", text: "text-red-300" },
  { label: "Weak", bar: "bg-orange-400", text: "text-orange-300" },
  { label: "Good", bar: "bg-amber-400", text: "text-amber-300" },
  { label: "Strong", bar: "bg-lime-400", text: "text-lime-300" },
  { label: "Excellent", bar: "bg-emerald-400", text: "text-emerald-300" }
];

/**
 * Live password strength: a five-segment meter and a per-requirement checklist
 * that update as the user types. Transitions stay under 250ms and are disabled
 * under reduced motion.
 */
export function PasswordStrength({ password }: PasswordStrengthProps) {
  const met = REQUIREMENTS.map((requirement) => requirement.test(password));
  const score = met.filter(Boolean).length; // 0–5
  const level = score > 0 ? LEVELS[score - 1] : null;

  return (
    <div className="mt-2.5 space-y-2.5" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {LEVELS.map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
              index < score ? level?.bar : "bg-white/10"
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs font-medium transition-colors duration-200 motion-reduce:transition-none", level ? level.text : "text-muted-foreground")}>
        {level ? `Password strength: ${level.label}` : "Use 8+ characters with a mix of types."}
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {REQUIREMENTS.map((requirement, index) => (
          <li
            key={requirement.label}
            className={cn(
              "flex items-center gap-1.5 text-[11px] transition-colors duration-200 motion-reduce:transition-none",
              met[index] ? "text-emerald-300" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-colors duration-200 motion-reduce:transition-none",
                met[index] ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300" : "border-white/15"
              )}
              aria-hidden="true"
            >
              {met[index] ? <Check className="h-2.5 w-2.5" /> : null}
            </span>
            {requirement.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
