import { Eye, Ghost, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import type { MoodStatus } from "@/components/onboarding/mood-status-selector";

export type VisibilityPreference = "friends" | "app_open" | "ghost";

export type VisibilityPreviewCardProps = {
  displayName: string;
  username: string;
  moodStatus: MoodStatus;
  visibility: VisibilityPreference;
};

const moodLabels: Record<MoodStatus, string> = {
  open: "Open to plans",
  busy: "Busy right now",
  exploring: "Exploring nearby",
  quiet: "Quiet mode"
};

export function VisibilityPreviewCard({
  displayName,
  username,
  moodStatus,
  visibility
}: VisibilityPreviewCardProps) {
  const isGhost = visibility === "ghost";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <GlowAvatar
          name={displayName || "New Buddy"}
          src={null}
          proximityLevel={isGhost ? "hidden" : "nearby"}
          glowStrength={isGhost ? 0 : 72}
          confidence={isGhost ? "low" : "high"}
          size="lg"
          reducedMotion
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold">{displayName || "New Buddy"}</h3>
            <Badge variant={isGhost ? "blue" : "green"}>{isGhost ? "Hidden" : "Nearby"}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            @{username || "username"}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {isGhost
              ? "Friends will not see your glow while Ghost Mode is on."
              : moodLabels[moodStatus]}
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-2 text-sm text-muted-foreground">
        <PreviewRow icon={ShieldCheck} text="Your exact location is never shared." />
        <PreviewRow icon={Eye} text="Friends only see your glow level." />
        <PreviewRow icon={Ghost} text="You can turn visibility off anytime." />
      </div>
    </Card>
  );
}

type PreviewRowProps = {
  icon: typeof ShieldCheck;
  text: string;
};

function PreviewRow({ icon: Icon, text }: PreviewRowProps) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
