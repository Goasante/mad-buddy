import type { ReactNode } from "react";

// Photo-first login layout: the launch-hero photo (three Muddies, glowing
// proximity rings, sunset skyline) fills the top of the screen and fades into
// a bottom-sheet card holding the form. Distinct from SignInCard (used by the
// other auth screens), which is an abstract gradient treatment with no photo.
export function LoginHero({ title, tagline, children }: { title: string; tagline?: ReactNode; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col bg-[#070918] text-white">
      <div
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{ backgroundImage: "url(/brand/launch-hero.jpg)", backgroundPosition: "center 22%" }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,24,0.15)_0%,rgba(7,9,24,0.05)_38%,rgba(7,9,24,0.65)_62%,#070918_82%)]"
        aria-hidden="true"
      />

      {/* Spacer establishing the photo's visible height above the card. */}
      <div className="h-[46vh] min-h-[280px] shrink-0" aria-hidden="true" />

      <section className="relative z-10 mt-auto rounded-t-[2rem] border-t border-white/[0.08] bg-black/55 px-6 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-7 shadow-[0_-20px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:px-7">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {tagline ? <p className="mt-1.5 text-[0.95rem] leading-6 text-white/60">{tagline}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </section>
    </main>
  );
}
