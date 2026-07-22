import { useCallback, useEffect, useState } from "react";
import { Clock, Flag, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { EXPIRY_PRESETS, audienceSummaryLabel, type ExpiryPresetId } from "@/lib/content/moments";
import type { MomentAudienceType, ReactionType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { Spinner } from "../components/Spinner";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";

type Moment = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  contentType: "text" | "photo";
  textContent: string | null;
  caption: string | null;
  mediaUrl: string | null;
  expiresAt: string;
  createdAt: string;
  myReaction: ReactionType | null;
  reactionCount: number;
  isAuthor: boolean;
  audienceLabel: string | null;
};

type Circle = { id: string; name: string };

const reactions: Array<{ id: ReactionType; emoji: string; label: string }> = [
  { id: "heart", emoji: "❤️", label: "Heart" },
  { id: "laugh", emoji: "😂", label: "Laugh" },
  { id: "wave", emoji: "👋", label: "Wave" },
  { id: "fire", emoji: "🔥", label: "Fire" },
  { id: "clap", emoji: "👏", label: "Clap" }
];

const audienceOptions: Array<{ id: MomentAudienceType; label: string }> = [
  { id: "close_friends", label: "Close Friends" },
  { id: "selected_circles", label: "A circle" },
  { id: "nearby_muddies", label: "Muddies nearby" }
];

function expiresInLabel(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}

export function MomentsScreen() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const [feed, network] = await Promise.all([
      api.get<{ moments: Moment[] }>("/api/moments"),
      api.get<{ circles: Circle[] }>("/api/friends")
    ]);
    setLoading(false);
    if (feed.ok) setMoments(feed.data.moments);
    else setFeedback(feed.error);
    if (network.ok) setCircles(network.data.circles ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function react(moment: Moment, reaction: ReactionType) {
    const isSame = moment.myReaction === reaction;
    const delta = (isSame ? 0 : 1) - (moment.myReaction ? 1 : 0);
    // Optimistic.
    setMoments((current) =>
      current.map((m) =>
        m.id === moment.id
          ? { ...m, myReaction: isSame ? null : reaction, reactionCount: Math.max(0, m.reactionCount + delta) }
          : m
      )
    );
    const result = isSame
      ? await api.del(`/api/moments/${moment.id}/react`)
      : await api.post(`/api/moments/${moment.id}/react`, { reaction });
    if (!result.ok) {
      // Restore.
      setMoments((current) =>
        current.map((m) =>
          m.id === moment.id ? { ...m, myReaction: moment.myReaction, reactionCount: moment.reactionCount } : m
        )
      );
    }
  }

  async function remove(moment: Moment) {
    const previous = moments;
    setMoments((current) => current.filter((m) => m.id !== moment.id));
    const result = await api.del("/api/moments", { id: moment.id });
    if (!result.ok) {
      setMoments(previous);
      setFeedback(result.error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 pt-6">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Moments</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Temporary updates shared with the people you choose.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Share
        </Button>
      </header>

      {feedback ? (
        <div className="rounded-2xl border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-100" role="status">
          {feedback}
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : moments.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/40 px-6 py-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
            <Sparkles className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">No Moments right now</h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">
            Moments from your Muddies show up here, and disappear when they expire.
          </p>
          <Button type="button" className="mt-5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Share a Moment
          </Button>
        </div>
      ) : (
        <section className="space-y-4" aria-label="Shared Moments">
          {moments.map((moment) => (
            <article key={moment.id} className="overflow-hidden rounded-2xl border border-white/10 bg-card/65">
              <header className="flex items-center gap-3 px-4 py-3.5">
                <UserAvatar name={moment.authorName} src={moment.authorAvatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{moment.isAuthor ? "You" : moment.authorName}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    Disappears in {expiresInLabel(moment.expiresAt)}
                  </p>
                </div>
                {moment.isAuthor ? (
                  <button
                    type="button"
                    onClick={() => void remove(moment)}
                    aria-label="Delete Moment"
                    className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Report Moment"
                    className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground"
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </header>

              {moment.textContent ? (
                <p className="whitespace-pre-wrap px-4 pb-4 text-[0.95rem] leading-6">{moment.textContent}</p>
              ) : null}
              {moment.mediaUrl ? (
                <img src={moment.mediaUrl} alt={moment.caption ?? "Moment"} className="block max-h-[480px] w-full bg-secondary/40 object-cover" loading="lazy" />
              ) : null}
              {moment.caption ? <p className="px-4 pt-3 text-sm text-muted-foreground">{moment.caption}</p> : null}

              <footer className="mt-3 flex items-center gap-0.5 border-t border-white/10 px-3 py-2.5">
                {reactions.map((reaction) => (
                  <button
                    key={reaction.id}
                    type="button"
                    aria-label={reaction.label}
                    aria-pressed={moment.myReaction === reaction.id}
                    onClick={() => void react(moment, reaction.id)}
                    className={cn(
                      "focus-ring safe-motion grid h-9 w-9 place-items-center rounded-full border text-base",
                      moment.myReaction === reaction.id ? "border-primary bg-primary/10" : "border-transparent active:bg-secondary"
                    )}
                  >
                    {reaction.emoji}
                  </button>
                ))}
                {moment.reactionCount > 0 ? (
                  <span className="ml-1.5 text-xs font-medium tabular-nums text-muted-foreground">{moment.reactionCount}</span>
                ) : null}
              </footer>
            </article>
          ))}
        </section>
      )}

      <div className="flex items-start gap-2.5 rounded-xl bg-secondary/45 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>Moments expire, but viewers can still take screenshots. Share thoughtfully.</p>
      </div>

      <CreateMomentModal
        open={createOpen}
        circles={circles}
        onOpenChange={setCreateOpen}
        onCreated={(message) => {
          setFeedback(message);
          setCreateOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function CreateMomentModal({
  open,
  circles,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  circles: Circle[];
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<MomentAudienceType>("close_friends");
  const [circleId, setCircleId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryPresetId>("6h");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preset = EXPIRY_PRESETS.find((option) => option.id === expiry);
  const audienceNames = audience === "selected_circles" ? circles.filter((c) => c.id === circleId).map((c) => c.name) : [];
  const canShare = text.trim().length > 0 && (audience !== "selected_circles" || circleId !== null);

  function reset() {
    setText("");
    setAudience("close_friends");
    setCircleId(null);
    setExpiry("6h");
    setError("");
  }

  async function share() {
    if (!preset) return;
    setBusy(true);
    setError("");
    const result = await api.post<{ ok: boolean; message: string; locationWarning?: string }>("/api/moments", {
      textContent: text.trim(),
      audienceType: audience,
      targetIds: audience === "selected_circles" && circleId ? [circleId] : undefined,
      expiresAt: new Date(Date.now() + preset.ms).toISOString()
    });
    setBusy(false);
    if (result.ok) {
      onCreated(result.data.locationWarning ? `Shared. ${result.data.locationWarning}` : "Moment shared.");
      reset();
    } else {
      setError(result.error);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title="Share a Moment"
      description="It disappears when it expires."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={share} disabled={!canShare || busy}>
            {busy ? "Sharing…" : "Share Moment"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          placeholder="What's happening?"
          aria-label="Moment text"
        />

        <div>
          <p className="mb-2 text-sm font-medium">Who can see this?</p>
          <div className="flex flex-wrap gap-2">
            {audienceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAudience(option.id)}
                aria-pressed={audience === option.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  audience === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {audience === "selected_circles" ? (
            circles.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Create a circle first to share with one.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {circles.map((circle) => (
                  <button
                    key={circle.id}
                    type="button"
                    onClick={() => setCircleId(circle.id)}
                    aria-pressed={circleId === circle.id}
                    className={cn(
                      "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                      circleId === circle.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    )}
                  >
                    {circle.name}
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Disappears after</p>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setExpiry(option.id)}
                aria-pressed={expiry === option.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  expiry === option.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs leading-6 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Visible to:</span> {audienceSummaryLabel(audience, audienceNames)}
          </p>
          <p>
            <span className="font-medium text-foreground">Expires:</span> in {preset?.label}
          </p>
          <p>
            <span className="font-medium text-foreground">Exact location:</span> Not shared
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Modal>
  );
}
