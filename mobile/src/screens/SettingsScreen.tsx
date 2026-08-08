import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  Ghost,
  LifeBuoy,
  LogOut,
  MapPinOff,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api, deleteAccount } from "../lib/api";

type Visibility = "visible" | "ghost" | "app_open_only";

export function SettingsScreen() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [visibility, setVisibility] = useState<Visibility>("visible");
  const [nearbyAlerts, setNearbyAlerts] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    const result = await deleteAccount();
    if (result.ok) {
      // The account is gone, so the local session is now meaningless. Signing
      // out clears it and unregisters this device's push token rather than
      // leaving a token pointed at a deleted user.
      await signOut();
      navigate("/login", { replace: true });
      return;
    }
    setDeleting(false);
    // Shows the server's own message: it distinguishes "nothing was deleted"
    // from "your data is gone but the sign-in remains", and those are very
    // different things to tell someone.
    setDeleteError(result.error);
  }

  useEffect(() => {
    if (!user) return;
    void Promise.all([
      supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("notification_preferences").eq("user_id", user.id).maybeSingle()
    ]).then(([profile, prefs]) => {
      const v = (profile.data as { visibility_status?: Visibility } | null)?.visibility_status;
      if (v) setVisibility(v);
      const raw = (prefs.data?.notification_preferences ?? {}) as Record<string, unknown>;
      setNearbyAlerts(raw.nearbyAlerts !== false);
    });
  }, [user]);

  async function saveVisibility(next: Visibility) {
    const previous = visibility;
    setVisibility(next);
    setBusy(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/visibility", next);
    setBusy(false);
    if (!result.ok) {
      setVisibility(previous);
      setFeedback(result.error);
    }
  }

  async function toggleNearby() {
    const next = !nearbyAlerts;
    setNearbyAlerts(next);
    setBusy(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/settings/notifications", { nearbyAlerts: next });
    setBusy(false);
    if (!result.ok) {
      setNearbyAlerts(!next);
      setFeedback(result.error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and app preferences.</p>
      </header>

      {feedback ? <p className="mb-4 text-sm text-destructive">{feedback}</p> : null}

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Row icon={UserRound} title="Profile" description="Manage how approved friends see you." onClick={() => navigate("/profile")} />
        <Row icon={Trophy} title="Buddy Score" description="View your private trust progress." onClick={() => navigate("/buddy-score")} />
      </Card>

      <SectionTitle>Privacy &amp; safety</SectionTitle>
      <Card>
        <ToggleRow
          icon={Ghost}
          title="Ghost Mode"
          description="Pause your visibility until you turn it back on."
          checked={visibility === "ghost"}
          disabled={busy}
          onChange={(on) => void saveVisibility(on ? "ghost" : "visible")}
        />
        <ToggleRow
          icon={MapPinOff}
          title="Only while app is open"
          description="Update your nearby status only while Mad Buddy is open."
          checked={visibility === "app_open_only"}
          disabled={busy}
          onChange={(on) => void saveVisibility(on ? "app_open_only" : "visible")}
        />
        <Row icon={ShieldCheck} title="Safe Arrival" description="Ask trusted Muddies to check you got there." onClick={() => navigate("/safety")} />
        <Row icon={Sparkles} title="Blocked users" description="Review or unblock people." onClick={() => navigate("/muddies")} />
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <ToggleRow
          icon={Bell}
          title="Nearby alerts"
          description="Get notified when approved friends are nearby."
          checked={nearbyAlerts}
          disabled={busy}
          onChange={() => void toggleNearby()}
        />
        <Row
          icon={Bell}
          title="Notification preferences"
          description="Categories, quiet hours, and how you're reached."
          onClick={() => navigate("/settings/notifications")}
        />
      </Card>

      <SectionTitle>Billing</SectionTitle>
      <Card>
        <Row icon={CircleDollarSign} title="Plan and billing" description="View your plan, invoices, and subscription options." onClick={() => navigate("/subscription")} />
      </Card>

      <SectionTitle>Support &amp; feedback</SectionTitle>
      <Card>
        <Row icon={LifeBuoy} title="Help &amp; Support" description="Browse help topics or contact us." onClick={() => navigate("/help")} />
      </Card>

      <Button variant="outline" className="mt-6 w-full" onClick={() => void signOut()}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </Button>

      <p className="mt-4 text-center text-xs text-muted-foreground">Signed in as {user?.email}</p>

      {/* ACCOUNT DELETION.
          Required in-app by both stores for apps that create accounts, and it
          was previously unavailable in the native build entirely. Placed last
          and styled quietly: reachable without hunting, never a tap away by
          accident. */}
      <SectionTitle>Delete account</SectionTitle>
      <Card>
        <div className="p-4">
          <p className="text-xs leading-5 text-muted-foreground">
            Deleting removes your profile, Muddies, plans, messages and location
            history. This cannot be undone.
          </p>

          {deleteStep === "idle" ? (
            <button
              type="button"
              onClick={() => setDeleteStep("confirm")}
              className="focus-ring mt-3 h-11 w-full rounded-xl border border-destructive/40 text-sm font-semibold text-destructive"
            >
              Delete my account
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              {/* Second step, deliberately. A single destructive tap on a phone
                  is too easy to hit by accident. */}
              <p className="text-xs font-semibold text-foreground">
                Delete your account permanently?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteStep("idle")}
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

          {deleteError ? (
            <p role="alert" className="mt-3 text-xs leading-5 text-destructive">
              {deleteError}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-6 px-1 text-sm font-semibold text-muted-foreground">{children}</h2>;
}

function Card({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-card/40">{children}</div>;
}

function Row({ icon: Icon, title, description, onClick }: { icon: LucideIcon; title: ReactNode; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring flex w-full items-center gap-3 p-4 text-left active:bg-secondary">
      <Icon className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onChange
}: {
  icon: LucideIcon;
  title: ReactNode;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof title === "string" ? title : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-secondary")}
      >
        <span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </div>
  );
}
