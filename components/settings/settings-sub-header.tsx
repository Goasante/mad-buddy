import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function SettingsSubHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="border-b border-border/70 pb-4">
      <Link
        href="/settings"
        className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Settings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}
