import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/glow/confidence-badge";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";

export type FriendGlowCardProps = {
  friend: {
    friendId: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
    proximityLevel: ProximityLevel;
    glowStrength: number;
    statusText: string;
    lastActiveEstimate: string;
    isPremiumThemeUnlocked: boolean;
    confidence: ConfidenceLevel;
  };
  onViewProfile: (friendId: string) => void;
  reducedMotion?: boolean;
};

export function FriendGlowCard({
  friend,
  onViewProfile,
  reducedMotion = false
}: FriendGlowCardProps) {
  return (
    <Card
      className={cn(
        "overflow-visible p-4 shadow-[0_16px_40px_hsl(var(--shadow)/0.14)]",
        cardTone(friend.proximityLevel)
      )}
    >
      <div className="flex items-start gap-5">
        <GlowAvatar
          name={friend.displayName}
          src={friend.avatarUrl}
          proximityLevel={friend.proximityLevel}
          glowStrength={friend.glowStrength}
          confidence={friend.confidence}
          size="lg"
          reducedMotion={reducedMotion}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{friend.displayName}</h3>
            <ProximityBadge proximityLevel={friend.proximityLevel} />
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">@{friend.username}</p>
          <p className="mt-2 text-sm leading-6">{friend.statusText}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {friend.proximityLevel !== "hidden" ? (
              <ConfidenceBadge confidence={friend.confidence} />
            ) : null}
            <span className="text-xs text-muted-foreground">{friend.lastActiveEstimate}</span>
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-4 w-full"
        onClick={() => onViewProfile(friend.friendId)}
      >
        View profile
      </Button>
    </Card>
  );
}

function cardTone(proximityLevel: ProximityLevel) {
  if (proximityLevel === "very_close") {
    return "border-orange-400/45 bg-orange-400/10 shadow-[0_18px_48px_rgba(249,115,22,0.22)]";
  }

  if (proximityLevel === "nearby") {
    return "border-orange-400/25 bg-orange-400/10";
  }

  if (proximityLevel === "around") {
    return "border-orange-400/15 bg-orange-400/[0.035]";
  }

  return "opacity-85";
}
