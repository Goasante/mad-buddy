import { useNavigate } from "react-router-dom";
import {
  User,
  Settings as SettingsIcon,
  MessageCircle,
  Camera,
  CalendarHeart,
  Users2,
  Compass,
  ShieldCheck,
  ChevronRight,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Screen } from "../components/AppShell";

type Entry = { label: string; description: string; icon: LucideIcon; to?: string; soon?: boolean };

const sections: { title: string; items: Entry[] }[] = [
  {
    title: "You",
    items: [
      { label: "Profile", description: "Your name, username, bio", icon: User, to: "/profile" },
      { label: "Settings", description: "Visibility, notifications, account", icon: SettingsIcon, to: "/settings" }
    ]
  },
  {
    title: "More features",
    items: [
      { label: "Messages", description: "Chat with your Muddies", icon: MessageCircle, to: "/messages" },
      { label: "Moments", description: "Share what you're up to", icon: Camera, to: "/moments" },
      { label: "Events", description: "Plan bigger get-togethers", icon: CalendarHeart, soon: true },
      { label: "Groups", description: "Your circles and crews", icon: Users2, soon: true },
      { label: "Socialize", description: "Discover people nearby", icon: Compass, to: "/socialize" },
      { label: "Safety", description: "Safe arrival and check-ins", icon: ShieldCheck, soon: true }
    ]
  }
];

export function MoreScreen() {
  const navigate = useNavigate();

  return (
    <Screen title="More">
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h2>
            <ul className="overflow-hidden rounded-2xl border border-border">
              {section.items.map((item, index) => (
                <li key={item.label}>
                  <button
                    type="button"
                    disabled={item.soon}
                    onClick={() => item.to && navigate(item.to)}
                    className={cn(
                      "flex w-full items-center gap-3 bg-card/40 px-4 py-3 text-left",
                      index > 0 && "border-t border-border",
                      item.soon ? "opacity-60" : "focus-ring active:bg-secondary"
                    )}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary">
                      <item.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                    </span>
                    {item.soon ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                        Soon
                      </span>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}
