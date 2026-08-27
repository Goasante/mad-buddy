import {
  BookOpen,
  Car,
  Clapperboard,
  Coffee,
  Dumbbell,
  Footprints,
  Gamepad2,
  Hand,
  Moon,
  PartyPopper,
  Sparkles,
  Trophy,
  UtensilsCrossed,
  Wine,
  type LucideIcon
} from "lucide-react";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/** The existing UpFor category art, shared by compact feed cards. */
export const UPFOR_ACTIVITY_ICONS: Record<HangoutActivityType, LucideIcon> = {
  anything: Sparkles,
  food: UtensilsCrossed,
  study: BookOpen,
  sports: Trophy,
  gym: Dumbbell,
  walk: Footprints,
  gaming: Gamepad2,
  chill: Moon,
  coffee: Coffee,
  football: Trophy,
  drinks: Wine,
  movie: Clapperboard,
  drive: Car,
  party: PartyPopper
};

export function UpForActivityIcon({ activity, className }: { activity: HangoutActivityType; className?: string }) {
  const Icon = UPFOR_ACTIVITY_ICONS[activity] ?? Hand;
  return <Icon className={className} aria-hidden="true" />;
}
