import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { SettingsPageContent } from "@/components/settings/settings-page";
import { isBuiltForMobile } from "@/lib/platform";
import type { VisibilityStatus } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { deleteAccount } from "../lib/api";
import { mobileSettingsClient } from "../lib/settings-client";
import { Spinner } from "../components/Spinner";

/**
 * Settings on Android.
 *
 * This was a 280-line hand-written screen offering about 10 rows where the web
 * app offers 24 — no Appearance, Language & Region, Glow & Visibility, Data &
 * Storage, Focus & balance, Messaging privacy, Badges or Sessions. It now
 * renders the SAME component the web app does.
 *
 * Three things stay native:
 *
 *  - the transport, which uses a Bearer token against the API origin rather
 *    than a Server Action with a session cookie;
 *  - `isBuiltForMobile`, because 17 of the 24 destinations do not exist here:
 *    settings-related web features with no native screen (including About), and the
 *    pre-existing /hangout-mode, /badges and /safety-center. Without it each
 *    rendered as a tappable row that reached the SPA catch-all;
 *  - Sign out and account deletion, in the footer. Both stores require in-app
 *    deletion, and the native flow signs out afterwards so this device's push
 *    token is unregistered rather than left pointing at a deleted user.
 */
export function SettingsScreen() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [initial, setInitial] = useState<{ visibility: VisibilityStatus; nearbyAlerts: boolean } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.all([
      supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("notification_preferences").eq("user_id", user.id).maybeSingle()
    ]).then(([profile, preferences]) => {
      if (!active) return;
      const raw = (preferences.data?.notification_preferences ?? {}) as Record<string, unknown>;
      setInitial({
        visibility: (profile.data?.visibility_status ?? "visible") as VisibilityStatus,
        // Matches lib/settings/service.ts: on unless explicitly disabled.
        nearbyAlerts: raw.nearbyAlerts !== false
      });
    });
    return () => {
      active = false;
    };
  }, [user]);

  // Waiting avoids rendering the toggles in a default position and then
  // visibly correcting them a moment later.
  if (!initial) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6">
      <SettingsPageContent
        client={mobileSettingsClient}
        initialVisibilityStatus={initial.visibility}
        initialNearbyAlerts={initial.nearbyAlerts}
        isDestinationAvailable={isBuiltForMobile}
        /* No `header`: the shared AppHeader in this app's shell already carries
           one, and the web PageHeader would drag next/navigation in. */
        footer={
          <NativeAccountActions
            email={user?.email ?? null}
            onSignOut={() => void signOut()}
            onDeleted={async () => {
              // The account is gone, so the local session is meaningless.
              // Signing out clears it and unregisters this device's push token
              // rather than leaving a token pointed at a deleted user.
              await signOut();
              navigate("/login", { replace: true });
            }}
          />
        }
      />
    </div>
  );
}

/**
 * Sign out and account deletion.
 *
 * Web has neither here: it signs out from the account menu and deletes through
 * a modal that imports a Server Action. This is the native equivalent, moved
 * verbatim from the screen it replaces.
 */
function NativeAccountActions({
  email,
  onSignOut,
  onDeleted
}: {
  email: string | null;
  onSignOut: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setError("");
    const result = await deleteAccount();
    if (result.ok) {
      await onDeleted();
      return;
    }
    setDeleting(false);
    /* Shows the server's own message: it distinguishes "nothing was deleted"
       from "your data is gone but the sign-in remains", and those are very
       different things to tell someone. */
    setError(result.error);
  }

  return (
    <>
      <Button variant="outline" className="mt-6 w-full" onClick={onSignOut}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </Button>

      <p className="mt-4 text-center text-xs text-muted-foreground">Signed in as {email}</p>

      {/* ACCOUNT DELETION.
          Required in-app by both stores for apps that create accounts. Placed
          last and styled quietly: reachable without hunting, never a tap away
          by accident. */}
      <h2 className="mb-2 mt-6 px-1 text-sm font-semibold text-muted-foreground">Delete account</h2>
      <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-card/40">
        <div className="p-4">
          <p className="text-xs leading-5 text-muted-foreground">
            Deleting removes your profile, Muddies, plans, messages and location history. This cannot
            be undone.
          </p>

          {step === "idle" ? (
            <button
              type="button"
              onClick={() => setStep("confirm")}
              className="focus-ring mt-3 h-11 w-full rounded-xl border border-destructive/40 text-sm font-semibold text-destructive"
            >
              Delete my account
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              {/* Second step, deliberately. A single destructive tap on a phone
                  is too easy to hit by accident. */}
              <p className="text-xs font-semibold text-foreground">Delete your account permanently?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setStep("idle")}
                  className="focus-ring h-11 flex-1 rounded-xl border border-border text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="focus-ring h-11 flex-1 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            </div>
          )}

          {error ? (
            <p role="alert" className="mt-3 text-xs leading-5 text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
