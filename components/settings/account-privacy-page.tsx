import Link from "next/link";
import { ChevronRight, Eye, MessageCircle, ShieldCheck, UserRoundX } from "lucide-react";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

const privacyRows = [
  {
    href: "/settings/glow-visibility",
    title: "Glow visibility",
    description: "Choose when approved friends can see that you're nearby.",
    icon: Eye
  },
  {
    href: "/settings/communication",
    title: "Messaging privacy",
    description: "Control who can message you, add you to groups, and see chat activity.",
    icon: MessageCircle
  },
  {
    href: "/settings/privacy-setup",
    title: "Privacy setup",
    description: "Review your discoverability and privacy choices.",
    icon: ShieldCheck
  },
  {
    href: "/friends?tab=blocked",
    title: "Blocked users",
    description: "Review and manage people you have blocked.",
    icon: UserRoundX
  }
] as const;

export function AccountPrivacyPage() {
  return (
    <div className="mr-auto max-w-[680px] space-y-6 pt-6">
      <SettingsSubHeader title="Account privacy" description="Manage the privacy controls that Mad Buddy currently enforces." />
      <nav className="divide-y divide-border/70 border-y border-border/70" aria-label="Privacy settings">
        {privacyRows.map((row) => (
          <Link
            key={row.href}
            href={row.href}
            className="focus-ring safe-motion flex min-h-[4.5rem] items-center gap-3 px-2 py-3 hover:bg-secondary/40"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <row.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{row.title}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{row.description}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
