import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Award, BadgeCheck, ChevronLeft, MessageCircle, UserPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";
import { UserAvatar } from "@/components/ui/user-avatar";
import { BirthdayAccent } from "@/components/profile/birthday-accent";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";

type PublicProfile = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  moodStatus: string | null;
  isMuddy: boolean;
  isSelf: boolean;
  age: number | null;
  zodiacSign: string | null;
  birthdayToday: boolean;
  birthdayTomorrow: boolean;
  birthdayCountdownDays: number | null;
  plan: SubscriptionPlan;
  identity: ProfileIdentitySummary;
};

export function UserProfileScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await api.get<{ profile: PublicProfile }>(`/api/users/${id}`);
      setLoading(false);
      if (result.ok) setProfile(result.data.profile);
      else setFeedback(result.error);
    })();
  }, [id]);

  async function message() {
    const result = await api.post<{ ok: boolean; conversationId?: string; message: string }>("/api/messages/open", {
      recipientId: id
    });
    if (result.ok && result.data.conversationId) {
      navigate(`/messages/${result.data.conversationId}`, { state: { title: profile?.displayName } });
    } else {
      setFeedback(result.ok ? result.data.message : result.error);
    }
  }

  async function addMuddy() {
    setRequested(true);
    const result = await api.post<{ ok: boolean; message: string }>("/api/friends/request", { targetUserId: id });
    setFeedback(result.ok ? "Request sent." : result.error);
    if (!result.ok) setRequested(false);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card/80 px-3 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate(-1)} className="focus-ring rounded-lg p-1" aria-label="Back">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">Profile</h1>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !profile ? (
          <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            {feedback || "This profile isn't available."}
          </p>
        ) : (
          <div className="glass-panel rounded-2xl p-6 text-center">
            <BirthdayAccent active={profile.birthdayToday} className="mx-auto">
              <UserAvatar src={profile.avatarUrl} name={profile.displayName} size="xl" />
            </BirthdayAccent>
            <div className="mt-4 flex items-center justify-center gap-2">
              <h2 className="text-xl font-semibold">{profile.displayName}</h2>
              <PremiumPlanBadge plan={profile.plan} />
            </div>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            {profile.isMuddy ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Muddy
              </span>
            ) : null}
            {profile.moodStatus ? (
              <span className="mt-3 inline-block rounded-full border border-border px-3 py-1 text-xs capitalize text-muted-foreground">
                {profile.moodStatus}
              </span>
            ) : null}
            {profile.bio ? <p className="mt-4 text-sm leading-6">{profile.bio}</p> : null}
            {profile.age !== null || profile.zodiacSign || profile.birthdayToday || profile.birthdayCountdownDays !== null ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                {profile.age !== null ? <span className="rounded-full border border-border px-3 py-1">Age {profile.age}</span> : null}
                {profile.zodiacSign ? <span className="rounded-full border border-border px-3 py-1">{profile.zodiacSign}</span> : null}
                {profile.birthdayToday ? <span className="rounded-full border border-border px-3 py-1">Birthday today</span> : null}
                {profile.birthdayTomorrow ? <span className="rounded-full border border-border px-3 py-1">Birthday tomorrow</span> : null}
                {!profile.birthdayToday && !profile.birthdayTomorrow && profile.birthdayCountdownDays !== null ? (
                  <span className="rounded-full border border-border px-3 py-1">
                    {profile.birthdayCountdownDays === 1 ? "Birthday tomorrow" : `Birthday in ${profile.birthdayCountdownDays} days`}
                  </span>
                ) : null}
              </div>
            ) : null}

            {profile.identity.buddyScore || profile.identity.achievements ? (
              <div className="mt-5 border-t border-border pt-4 text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Progress</p>
                {profile.identity.buddyScore ? (
                  <p className="mt-2 inline-flex items-center gap-2 font-semibold">
                    <BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                    {profile.identity.buddyScore.levelLabel}
                  </p>
                ) : null}
                {profile.identity.achievements ? (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {profile.identity.achievements.featured.map((achievement) => (
                        <span key={achievement.code} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                          <Award className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{achievement.name}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{profile.identity.achievements.unlockedCount} unlocked</p>
                  </>
                ) : null}
              </div>
            ) : null}

            {!profile.isSelf ? (
              <div className="mt-6 flex gap-2">
                {profile.isMuddy ? (
                  <Button className="flex-1" onClick={() => void message()}>
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    Message
                  </Button>
                ) : (
                  <Button className="flex-1" onClick={() => void addMuddy()} disabled={requested}>
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    {requested ? "Request sent" : "Add Muddy"}
                  </Button>
                )}
              </div>
            ) : null}

            {feedback && profile ? <p className="mt-3 text-sm text-primary">{feedback}</p> : null}
          </div>
        )}
      </main>
    </div>
  );
}
