import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";

import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { listMuddies } from "@/lib/friends/service";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "People Profile Lab",
  robots: { index: false, follow: false }
};

export default async function ProfileLabPeopleIndexPage() {
  const labAccess = await getSafetyAdminContext();
  if (!labAccess.ok) redirect("/friends");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const result = await listMuddies(user.id);

  return (
    <main className="mx-auto w-full max-w-3xl pb-24 pt-2 sm:pb-12">
      <header className="flex items-center gap-3 px-1 pb-4">
        <Link href="/profile-lab" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Back to Profile Lab">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Profile VNext</p>
          <h1 className="text-xl font-semibold tracking-tight">People preview</h1>
        </div>
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <section className="relative overflow-hidden rounded-[2rem] border border-[#E88C2B]/20 bg-[#FEFBF3] p-5 shadow-[0_22px_60px_rgba(78,4,1,0.07)] dark:bg-card sm:p-7">
        <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full bg-[#E88C2B]/12 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[1.2rem] bg-[#4E0401] text-white"><UsersRound className="h-7 w-7" aria-hidden="true" /></span>
          <div>
            <h2 className="text-xl font-semibold">Choose a real Muddy</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">Open the redesigned other-person profile with the same relationship, field-privacy, block, trust and Showcase rules used by the current production profile.</p>
          </div>
        </div>
      </section>

      <section className="mt-5" aria-labelledby="profile-lab-muddies-heading">
        <div className="mb-2 px-1">
          <h2 id="profile-lab-muddies-heading" className="text-base font-semibold">Your Muddies</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{result.muddies.length ? `${result.muddies.length} available to preview.` : "No approved Muddies to preview yet."}</p>
        </div>
        <div className="grid gap-2">
          {result.muddies.map((muddy) => (
            <Link
              key={muddy.id}
              href={`/profile-lab/people/${muddy.username}`}
              className="focus-ring safe-motion group flex min-h-[4.75rem] items-center gap-3 rounded-[1.25rem] border border-border/60 bg-card/75 px-4 py-3 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0"
            >
              <UserAvatar src={muddy.avatarUrl} name={muddy.displayName} size="md" membershipTier={publicMembershipTier(muddy.plan)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{muddy.displayName}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">@{muddy.username}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
