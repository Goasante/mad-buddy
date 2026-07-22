import { useCallback, useEffect, useState } from "react";
import { Heart, Send, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Screen } from "../components/AppShell";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";

type Moment = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  contentType: "text" | "photo";
  textContent: string | null;
  caption: string | null;
  mediaUrl: string | null;
  createdAt: string;
  myReaction: string | null;
  reactionCount: number;
  isAuthor: boolean;
  audienceLabel: string | null;
};

type Audience = "all_muddies" | "nearby_muddies";

export function MomentsScreen() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<Audience>("all_muddies");
  const [posting, setPosting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const result = await api.get<{ moments: Moment[] }>("/api/moments");
    setLoading(false);
    if (result.ok) setMoments(result.data.moments);
    else setFeedback(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function share() {
    if (text.trim().length === 0) return;
    setPosting(true);
    setFeedback("");
    const result = await api.post<{ ok: boolean; message: string; locationWarning?: string }>("/api/moments", {
      textContent: text.trim(),
      audienceType: audience
    });
    setPosting(false);
    if (result.ok) {
      setText("");
      setComposing(false);
      setFeedback(result.data.locationWarning ?? "Shared!");
      await load();
    } else {
      setFeedback(result.error);
    }
  }

  async function toggleReaction(moment: Moment) {
    const liked = Boolean(moment.myReaction);
    // Optimistic update.
    setMoments((current) =>
      current.map((item) =>
        item.id === moment.id
          ? {
              ...item,
              myReaction: liked ? null : "heart",
              reactionCount: item.reactionCount + (liked ? -1 : 1)
            }
          : item
      )
    );
    if (liked) await api.del(`/api/moments/${moment.id}/react`);
    else await api.post(`/api/moments/${moment.id}/react`, { reaction: "heart" });
  }

  return (
    <Screen
      title="Moments"
      action={
        <Button size="sm" onClick={() => setComposing((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Share a Moment
        </Button>
      }
    >
      {composing ? (
      <section className="glass-panel mb-5 rounded-2xl p-4">
        <Textarea
          placeholder="Share a moment… (disappears in 24h)"
          maxLength={500}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mt-3 flex items-center gap-2">
          {(["all_muddies", "nearby_muddies"] as Audience[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setAudience(option)}
              className={cn(
                "focus-ring rounded-full border px-3 py-1.5 text-xs",
                audience === option ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              )}
            >
              {option === "all_muddies" ? "All Muddies" : "Nearby"}
            </button>
          ))}
          <Button className="ml-auto" size="sm" onClick={share} disabled={posting || !text.trim()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {posting ? "Sharing…" : "Share"}
          </Button>
        </div>
        {feedback ? <p className="mt-2 text-xs text-primary">{feedback}</p> : null}
      </section>
      ) : feedback ? (
        <p className="mb-4 text-sm text-primary">{feedback}</p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : moments.length === 0 ? (
        <p className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
          No moments yet. Share the first one!
        </p>
      ) : (
        <ul className="space-y-3">
          {moments.map((moment) => (
            <li key={moment.id} className="glass-panel rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                  {moment.authorName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{moment.isAuthor ? "You" : moment.authorName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(moment.createdAt)}
                    {moment.audienceLabel ? ` · ${moment.audienceLabel}` : ""}
                  </p>
                </div>
              </div>

              {moment.mediaUrl ? (
                <img
                  src={moment.mediaUrl}
                  alt={moment.caption ?? "Moment"}
                  className="mt-3 max-h-80 w-full rounded-xl object-cover"
                />
              ) : null}
              {moment.textContent ? <p className="mt-3 text-sm leading-6">{moment.textContent}</p> : null}
              {moment.caption ? <p className="mt-2 text-sm text-muted-foreground">{moment.caption}</p> : null}

              <button
                type="button"
                onClick={() => void toggleReaction(moment)}
                className="focus-ring mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <Heart
                  className={cn("h-4 w-4", moment.myReaction ? "fill-primary text-primary" : "")}
                  aria-hidden="true"
                />
                {moment.reactionCount > 0 ? moment.reactionCount : "Like"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
