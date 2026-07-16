import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type AuthLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden border-r border-border px-8 py-10 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="text-lg font-semibold">
          Mad Buddy
        </Link>
        <div className="max-w-md">
          <Badge variant="green">Private by design</Badge>
          <h1 className="mt-5 text-4xl font-semibold leading-tight">
            Your friends can glow without giving away where they are.
          </h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Exact locations, maps, distance, and GPS accuracy never belong in the
            social feed. Mad Buddy only uses safe proximity signals.
          </p>
        </div>
        <div className="grid gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
            Friends only see glow levels.
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
            Weak signals never create a strong glow.
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-block text-lg font-semibold lg:hidden">
            Mad Buddy
          </Link>
          <div className="glass-panel rounded-lg p-6">
            <div>
              <h1 className="text-2xl font-semibold">{title}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <div className="mt-6">{children}</div>
          </div>
          <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
        </div>
      </section>
    </main>
  );
}
