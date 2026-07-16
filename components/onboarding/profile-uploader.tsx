"use client";

import { UserRound } from "lucide-react";

export type ProfileUploaderProps = {
  displayName: string;
};

export function ProfileUploader({ displayName }: ProfileUploaderProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-white/15 bg-white/[0.04] p-5 text-center">
      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] text-muted-foreground">
        <UserRound className="h-10 w-10" aria-hidden="true" />
      </div>
      <p className="mt-4 text-sm font-semibold">{displayName || "Your profile photo"}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        You can upload or replace your avatar from Profile after setup.
      </p>
    </div>
  );
}
