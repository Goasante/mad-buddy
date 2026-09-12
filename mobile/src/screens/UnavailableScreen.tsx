import { useLocation, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Screen } from "../components/AppShell";

/**
 * What an unknown route lands on, replacing a silent redirect to Home.
 *
 * The SPA used `<Route path="*" element={<Navigate to="/home" replace />} />`.
 * That is worse than it looks: tapping something the mobile app does not have
 * bounced straight to Home with no explanation, and `replace` discarded the
 * history entry so the back button could not undo it either. It reads as the
 * app being broken rather than the feature being absent.
 *
 * The nav is separately prevented from RENDERING links to unbuilt routes (see
 * isBuiltForMobile), so reaching this screen should be rare -- a stale deep
 * link, a shared URL, a route removed since. Rare is exactly why it must
 * explain itself rather than silently move someone somewhere else.
 *
 * It deliberately does not name a date or promise a feature. It says what
 * happened, notes the web app has it, and offers a way back.
 */
export function UnavailableScreen() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Screen title="Not available yet">
      <div className="rounded-2xl border border-border bg-card/40 p-6 text-center">
        <span
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Compass className="h-6 w-6" />
        </span>

        <h2 className="text-base font-semibold">This part of Mad Buddy isn&apos;t in the app yet</h2>

        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          It&apos;s available on the web app in the meantime. We&apos;re bringing the rest across.
        </p>

        {/* The path is shown quietly: it costs nothing for someone who does not
            care, and it is the single most useful detail when a person reports
            "it just went back to Home". */}
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground/70">
          {location.pathname}
        </p>

        <div className="mt-5 grid gap-2">
          <Button onClick={() => navigate("/home")} className="w-full">
            Go to Home
          </Button>
          {/* Offered second and only when there is somewhere to go back to. */}
          {window.history.length > 1 ? (
            <Button variant="ghost" onClick={() => navigate(-1)} className="w-full">
              Go back
            </Button>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
