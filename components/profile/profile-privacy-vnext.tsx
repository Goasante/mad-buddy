import Link from "next/link";
import {
  Ban,
  CakeSlice,
  CheckCheck,
  ChevronRight,
  ContactRound,
  Download,
  Eye,
  Images,
  KeyRound,
  LockKeyhole,
  MessageCircleMore,
  Radar,
  ShieldCheck,
  Sparkles,
  UserRoundCog
} from "lucide-react";

import { Card } from "@/components/ui/card";
import type { CommunicationPreferences } from "@/lib/messaging/service";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

type BirthVisibility = "only_me" | "approved_muddies";

type ProfilePrivacyVNextProps = {
  visibilityStatus: VisibilityStatus;
  birthdayVisibility: BirthVisibility;
  ageVisibility: BirthVisibility;
  zodiacVisibility: BirthVisibility;
  communication: CommunicationPreferences;
};

const glowLabels: Record<VisibilityStatus, string> = {
  visible: "Muddies",
  ghost: "Hidden",
  app_open_only: "While active"
};

const messagePermissionLabels: Record<CommunicationPreferences["messagePermission"], string> = {
  all_muddies: "All Muddies",
  close_friends: "Close friends",
  selected_circles: "Selected circles",
  nobody: "Nobody"
};

const notificationPreviewLabels: Record<CommunicationPreferences["notificationPreview"], string> = {
  sender_and_message: "Sender + message",
  sender_only: "Sender only",
  generic: "Generic",
  none: "Hidden"
};

function audience(value: BirthVisibility) {
  return value === "approved_muddies" ? "Muddies" : "Only me";
}

export function ProfilePrivacyVNext({
  visibilityStatus,
  birthdayVisibility,
  ageVisibility,
  zodiacVisibility,
  communication
}: ProfilePrivacyVNextProps) {
  return (
    <main className="mx-auto w-full max-w-3xl pb-24 pt-2 sm:pb-12">
      <header className="flex items-center gap-3 px-1 pb-4">
        <Link href="/profile-lab" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Back to Profile Lab">
          <ChevronRight className="h-5 w-5 rotate-180" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Profile VNext</p>
          <h1 className="text-xl font-semibold tracking-tight">Privacy</h1>
        </div>
        <Link href="/settings/privacy" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Open current privacy settings">
          <UserRoundCog className="h-5 w-5" aria-hidden="true" />
        </Link>
      </header>

      <section className="relative overflow-hidden rounded-[2rem] border border-emerald-600/15 bg-[#FEFBF3] p-5 shadow-[0_22px_60px_rgba(78,4,1,0.07)] dark:bg-card sm:p-7">
        <div className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-8 top-2 h-32 w-32 rounded-full bg-[#E88C2B]/12 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[1.2rem] bg-emerald-600 text-white shadow-lg shadow-emerald-900/10">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">Your profile visibility</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">See the important privacy decisions in one place. The real controls still live in the settings surfaces that enforce them.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusChip icon={Radar} label={`Glow: ${glowLabels[visibilityStatus]}`} />
              <StatusChip icon={MessageCircleMore} label={`Messages: ${messagePermissionLabels[communication.messagePermission]}`} />
              <StatusChip icon={Eye} label={`Active: ${communication.presenceEnabled ? "On" : "Off"}`} />
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5">
        <PrivacySection title="Profile visibility" description="What someone can learn from your identity before they ever message you.">
          <PrivacySettingRow icon={Radar} title="Glow discoverability" value={glowLabels[visibilityStatus]} detail="Mad Buddy uses broad nearby ranges, never an exact public distance." href="/settings/glow-visibility" />
          <PrivacySettingRow icon={Images} title="Showcase photos" value="Per photo" detail="Each extra photo can be Everyone, Muddies, or Only me." href="/profile?section=identity" />
          <PrivacySettingRow icon={CakeSlice} title="Birthday" value={audience(birthdayVisibility)} detail="Your full date of birth remains private." href="/profile?section=identity" />
          <PrivacySettingRow icon={Sparkles} title="Age" value={audience(ageVisibility)} detail="Age is derived from your private date of birth." href="/profile?section=identity" />
          <PrivacySettingRow icon={Sparkles} title="Zodiac" value={audience(zodiacVisibility)} detail="Zodiac is derived automatically and can stay private." href="/profile?section=identity" />
        </PrivacySection>

        <PrivacySection title="Messaging privacy" description="The WhatsApp-like communication controls already enforced by Chats.">
          <PrivacySettingRow icon={MessageCircleMore} title="Who can message me" value={messagePermissionLabels[communication.messagePermission]} detail="Relationship and block rules are rechecked by the messaging backend." href="/settings/communication" />
          <PrivacySettingRow icon={Eye} title="Active status" value={communication.presenceEnabled ? "On" : "Off"} detail="Controls whether others can see your messaging presence." href="/settings/communication" />
          <PrivacySettingRow icon={Sparkles} title="Typing indicators" value={communication.typingIndicatorEnabled ? "On" : "Off"} detail="Controls whether people can see when you are typing." href="/settings/communication" />
          <PrivacySettingRow icon={CheckCheck} title="Read receipts" value={communication.readReceiptsEnabled ? "On" : "Off"} detail="When disabled, the reciprocal read-receipt rule still applies." href="/settings/communication" />
          <PrivacySettingRow icon={LockKeyhole} title="Notification preview" value={notificationPreviewLabels[communication.notificationPreview]} detail="Choose how much chat content can appear outside the app." href="/settings/communication" />
        </PrivacySection>

        <section aria-labelledby="privacy-safety-tools-heading">
          <div className="mb-2 px-1">
            <h2 id="privacy-safety-tools-heading" className="text-base font-semibold">Privacy & safety tools</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Everything important remains reachable without turning Profile into a settings dump.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/friends?tab=blocked" className="focus-ring safe-motion rounded-[1.3rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400"><Ban className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 text-sm font-semibold">Blocked people</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Manage people you have blocked.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">Open <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </Link>

            <Link href="/settings/contact-discovery" className="focus-ring safe-motion rounded-[1.3rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#E88C2B]/12 text-[#A65A17]"><ContactRound className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 text-sm font-semibold">Contact discovery</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Control how people can find you.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">Open <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </Link>

            <Link href="/settings/sessions" className="focus-ring safe-motion rounded-[1.3rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 text-sm font-semibold">Login & sessions</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Review account access and active sessions.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">Open <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </Link>

            <Link href="/account" className="focus-ring safe-motion rounded-[1.3rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-foreground"><Download className="h-5 w-5" aria-hidden="true" /></span>
              <p className="mt-3 text-sm font-semibold">Data & account</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Manage your data and account controls.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">Open <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-[1.7rem] border border-[#E88C2B]/22 bg-[#E88C2B]/[0.065] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#E88C2B]/15 text-[#A65A17]"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Your safety. Your control.</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Profile privacy, messaging privacy and proximity privacy are separate on purpose. One setting should never silently weaken another.</p>
              <Link href="/settings/privacy" className="focus-ring mt-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#E88C2B]/25 bg-background/70 px-4 text-sm font-semibold text-[#8F4C13] hover:bg-background">
                Open privacy settings <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PrivacySection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Card className="overflow-hidden border-border/60 bg-card/75 p-0 shadow-sm">{children}</Card>
    </section>
  );
}

function StatusChip({ icon: Icon, label }: { icon: typeof Eye; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/75 px-3 py-1.5 text-xs font-semibold">
      <Icon className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> {label}
    </span>
  );
}

function PrivacySettingRow({
  icon: Icon,
  title,
  value,
  detail,
  href
}: {
  icon: typeof Eye;
  title: string;
  value: string;
  detail: string;
  href: "/settings/glow-visibility" | "/profile?section=identity" | "/settings/communication";
}) {
  return (
    <Link href={href} className="focus-ring safe-motion flex min-h-[4.5rem] items-start gap-3 border-b border-border/55 px-4 py-4 last:border-0 hover:bg-secondary/30">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{title}</span>
          <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold">{value}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
