"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProfileInterestsCard } from "@/components/profile/profile-interests-card";

/**
 * VNext styling wrapper around the existing canonical interests editor.
 * The taxonomy, max-selection rules and mutation stay owned by
 * ProfileInterestsCard / setProfileInterestsAction.
 */
export function ProfileInterestsVNextSection({ interests }: { interests: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <section className="mx-auto -mt-16 w-full max-w-3xl px-0 pb-28 sm:-mt-4 sm:pb-12" aria-labelledby="profile-vnext-interests-heading">
      <div className="rounded-[1.6rem] border border-[#E88C2B]/18 bg-[#FEFBF3] p-4 shadow-sm dark:bg-card sm:p-5">
        <div className="mb-3 px-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#A65A17]">Personality</p>
          <h2 id="profile-vnext-interests-heading" className="mt-1 text-base font-semibold">Interests</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Choose the things you are actually into. The existing Mad Buddy taxonomy and save rules remain authoritative.</p>
        </div>
        <ProfileInterestsCard
          interests={interests}
          open={open}
          onOpenChange={setOpen}
          onSaved={() => router.refresh()}
        />
      </div>
    </section>
  );
}
