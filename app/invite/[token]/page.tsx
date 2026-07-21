import Link from "next/link";
import { resolveInviteAction } from "@/app/(app)/invite-actions";
import { AcceptInviteButton } from "@/components/discovery/accept-invite-button";
import { InviteGuestActions } from "@/components/discovery/invite-guest-actions";
import { BrandMark } from "@/components/brand/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Public invite landing (spec §25). Shows the inviter's identity and the
 * invite's purpose, and nothing else. No friend lists, no circles, no
 * location. Works logged-out so the recipient can create an account and have
 * the invite still apply.
 */
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
    <main className="mx-auto grid min-h-dvh max-w-[520px] place-items-center px-5 py-10">
      <div className="w-full space-y-6 text-center">
        <BrandMark />

        {!preview ? (
          <div className="rounded-2xl border border-border/70 bg-card/50 p-6">
            <h1 className="text-xl font-semibold">This invite isn&apos;t available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The link may have expired or been revoked. Ask for a fresh one.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/70 bg-card/50 p-6">
            <h1 className="text-xl font-semibold">
              {preview.inviterName} invited you to Mad Buddy
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Mad Buddy helps you know when the friends you already have are around, without ever
              sharing your exact location.
            </p>

            {preview.valid ? (
              <>
                <p className="mt-4 text-xs text-muted-foreground">
                  Connecting sends {preview.inviterName} a request. They still choose to accept.
                </p>
                <div className="mt-5">
                  {user ? (
                    <AcceptInviteButton token={token} inviterName={preview.inviterName} />
                  ) : (
                    <InviteGuestActions token={token} inviterName={preview.inviterName} />
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Expires {new Date(preview.expiresAt).toLocaleDateString()}
                </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                This invite has expired or is no longer available.
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline-offset-2 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
