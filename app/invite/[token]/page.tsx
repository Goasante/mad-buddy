import Link from "next/link";
import { resolveInviteAction } from "@/app/(app)/invite-actions";
import { AcceptInviteButton } from "@/components/discovery/accept-invite-button";
import { InviteGuestActions } from "@/components/discovery/invite-guest-actions";
import { PublicPageShell } from "@/components/front-door/public-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InviteLandingPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await resolveInviteAction(token);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <PublicPageShell>
      <div className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-3xl items-center px-4 py-14 sm:px-6 sm:py-20">
        <section className="w-full">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A45A18]">Invitation</p>
          {!preview ? (
            <>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">This invite isn't available.</h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-[#4E0401]/62 dark:text-[#FFF8F1]/62">
                The link may have expired or been revoked. Ask the person who invited you for a fresh link.
              </p>
              <Link href="/" className="focus-ring mt-7 inline-flex min-h-11 items-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
                Learn about Mad Buddy
              </Link>
            </>
          ) : (
            <>
              <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-[#4E0401] sm:text-5xl dark:text-[#FFF8F1]">
                {preview.inviterName} invited you to Mad Buddy.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-[#4E0401]/65 dark:text-[#FFF8F1]/65">
                Mad Buddy helps friends notice when they are roughly nearby without showing each other exact GPS coordinates, a live map position, or exact numerical distance.
              </p>

              {preview.valid ? (
                <div className="mt-8 max-w-md border-t border-[#4E0401]/10 pt-7 dark:border-white/10">
                  <p className="mb-5 text-sm leading-7 text-[#4E0401]/58 dark:text-[#FFF8F1]/58">
                    Connecting sends {preview.inviterName} a request. They still choose whether to accept, and the invite context stays attached while you complete account access.
                  </p>
                  {user ? (
                    <AcceptInviteButton token={token} inviterName={preview.inviterName} />
                  ) : (
                    <InviteGuestActions token={token} inviterName={preview.inviterName} />
                  )}
                  <p className="mt-4 text-xs text-[#4E0401]/45 dark:text-[#FFF8F1]/45">
                    Invite expires {new Date(preview.expiresAt).toLocaleDateString()}.
                  </p>
                </div>
              ) : (
                <p className="mt-7 max-w-xl border-t border-[#4E0401]/10 pt-6 text-sm leading-7 text-[#4E0401]/58 dark:border-white/10 dark:text-[#FFF8F1]/58">
                  This invite has expired or is no longer available. Ask for a new invite before continuing.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </PublicPageShell>
  );
}
