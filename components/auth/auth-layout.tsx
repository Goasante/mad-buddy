import Link from "next/link";
import type { ReactNode } from "react";
import { Eye, MapPinOff, ShieldCheck, ToggleRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/brand/brand-mark";

export type AuthLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

const trustBullets = [
  { icon: MapPinOff, text: "Your exact location is never shared" },
  { icon: ShieldCheck, text: "Only approved Muddies can see you're nearby" },
  { icon: Eye, text: "You control who can see you" },
  { icon: ToggleRight, text: "Turn your visibility on or off anytime" }
];

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* Left panel (≈40%): privacy-first brand story with a soft glow. */}
      <section className="relative hidden overflow-hidden border-r border-border/60 bg-[#0b0b0d] px-8 py-10 lg:flex lg:flex-col lg:justify-between xl:px-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(249,115,22,0.16),transparent_46%),radial-gradient(circle_at_78%_82%,rgba(234,88,12,0.12),transparent_46%)]"
          aria-hidden="true"
        />
        <Link href="/" className="focus-ring relative flex w-fit items-center gap-3 rounded-lg font-semibold text-white">
          <BrandMark className="h-9 w-9" priority />
          <span>Mad Buddy</span>
        </Link>

        <div className="relative max-w-md">
          <Badge variant="green">Private by Design</Badge>
          <h1 className="mt-5 text-[2rem] font-semibold leading-[1.12] tracking-tight text-white xl:text-[2.6rem]">
            Know when your friends are near — without giving away where you are.
          </h1>
          <p className="mt-4 text-sm leading-7 text-white/60">
            Approved friends simply glow when they’re nearby. No maps, no pins, no history — just soft
            proximity signals you control.
          </p>
          <ul className="mt-7 space-y-3">
            {trustBullets.map((bullet) => (
              <li key={bullet.text} className="flex items-center gap-3 text-sm text-white/80">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/12 text-emerald-300">
                  <bullet.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {bullet.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">Trusted by people who value their privacy.</p>
      </section>

      {/* Right panel (≈60%): the form. */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-lg">
          <Link href="/" className="mb-8 inline-flex items-center gap-2.5 text-lg font-semibold lg:hidden">
            <BrandMark className="h-8 w-8" priority />
            Mad Buddy
          </Link>
          <div className="glass-panel rounded-2xl p-6 sm:p-7">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
