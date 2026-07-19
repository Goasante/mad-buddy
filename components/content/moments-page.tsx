"use client";

import { useRouter } from "next/navigation";
import { Camera, Clock, Flag, Plus, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  createMomentAction,
  deleteMomentAction,
  reactToMomentAction,
  removeMomentReactionAction,
  reportContentAction,
  uploadMomentMediaAction
} from "@/app/(app)/moments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { audienceSummaryLabel, EXPIRY_PRESETS, type ExpiryPresetId } from "@/lib/content/moments";
import { detectLocationRisk, LOCATION_WARNING_MESSAGE, REPORT_CATEGORIES } from "@/lib/content/safety";
import { validateImageSelection } from "@/lib/media/validation";
import type { VisibleMoment } from "@/lib/content/service";
import type { MomentAudienceType, ReactionType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type MomentAudienceOption = { id: string; name: string };

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

function expiryLabel(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60000))}m left`;
}

export function MomentsPage({
  initialMoments = [],
  circles = []
}: {
  initialMoments?: VisibleMoment[];
  circles?: MomentAudienceOption[];
}) {
  const router = useRouter();
  const [moments, setMoments] = useState(initialMoments);
  const [createOpen, setCreateOpen] = useState(false);
  const [reportFor, setReportFor] = useState<VisibleMoment | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  function react(moment: VisibleMoment, reaction: ReactionType) {
    const isSame = moment.myReaction === reaction;
    setMoments((current) =>
      current.map((entry) =>
        entry.id === moment.id ? { ...entry, myReaction: isSame ? null : reaction } : entry
      )
    );
    startTransition(async () => {
      const result = isSame
        ? await removeMomentReactionAction(moment.id)
        : await reactToMomentAction(moment.id, reaction);
      if (!result.ok) {
        setFeedback(result.message);
        router.refresh();
      }
    });
  }

  function remove(moment: VisibleMoment) {
    startTransition(async () => {
      const result = await deleteMomentAction(moment.id);
      setFeedback(result.message);
      if (result.ok) {
        setMoments((current) => current.filter((entry) => entry.id !== moment.id));
      }
    });
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Moments</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Share with the people who matter, for a limited time. Everything expires.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Share
        </Button>
      </header>

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      {moments.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          className="!min-h-0 !shadow-none p-5"
          title="No Moments right now"
          description="Moments from your Muddies show up here, and disappear when they expire."
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Share a Moment
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {moments.map((moment) => (
            <Card key={moment.id} className="p-4">
              <div className="flex items-start gap-3">
                <GlowAvatar name={moment.authorName} src={moment.authorAvatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{moment.authorName}</span>
                    {moment.isAuthor && moment.audienceLabel ? (
                      <Badge variant="orange">
                        {audienceSummaryLabel(moment.audienceLabel as MomentAudienceType, [])}
                      </Badge>
                    ) : null}
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {expiryLabel(moment.expiresAt)}
                    </span>
                  </div>

                  {moment.textContent ? (
                    <p className="mt-2 text-sm leading-6">{moment.textContent}</p>
                  ) : null}

                  {moment.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={moment.mediaUrl}
                      alt={moment.caption ?? `Moment from ${moment.authorName}`}
                      className="mt-2 max-h-[420px] w-full rounded-xl object-cover"
                      draggable={false}
                    />
                  ) : null}
                  {moment.caption ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">{moment.caption}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    {reactions.map((reaction) => (
                      <button
                        key={reaction.id}
                        type="button"
                        aria-label={reaction.label}
                        aria-pressed={moment.myReaction === reaction.id}
                        onClick={() => react(moment, reaction.id)}
                        disabled={isPending}
                        className={cn(
                          "focus-ring safe-motion rounded-full border px-2 py-1 text-sm",
                          moment.myReaction === reaction.id
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-secondary"
                        )}
                      >
                        {reaction.emoji}
                      </button>
                    ))}
                    <span className="ml-auto flex gap-1">
                      {moment.isAuthor ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => remove(moment)} disabled={isPending}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setReportFor(moment)}>
                          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                          Report
                        </Button>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Anyone who can see a Moment can screenshot it. Share accordingly.
      </p>

      <CreateMomentModal
        open={createOpen}
        circles={circles}
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreated={(message) => {
          setFeedback(message);
          setCreateOpen(false);
          router.refresh();
        }}
      />

      <ReportModal
        moment={reportFor}
        onOpenChange={(open) => {
          if (!open) setReportFor(null);
        }}
        onReported={(message) => {
          setFeedback(message);
          setReportFor(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function CreateMomentModal({
  open,
  circles,
  pending,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  circles: MomentAudienceOption[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<MomentAudienceType>("close_friends");
  const [circleId, setCircleId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryPresetId>("6h");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isUploading, startUpload] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Live, non-blocking location warning (spec §7, §55).
  const risk = detectLocationRisk(`${text} ${caption}`);
  const preset = EXPIRY_PRESETS.find((option) => option.id === expiry);
  const expiryMs = preset?.ms ?? 0;
  // Relative rather than an absolute clock time: keeps render pure (no Date.now()
  // during render) and says the same thing without a hydration mismatch.
  const expiresLabel = preset ? `in ${preset.label}` : "";

  const audienceNames = audience === "selected_circles" ? circles.filter((c) => c.id === circleId).map((c) => c.name) : [];
  const canShare =
    (mediaId !== null || text.trim().length > 0) &&
    (audience !== "selected_circles" || circleId !== null);

  function reset() {
    setText("");
    setCaption("");
    setAudience("close_friends");
    setCircleId(null);
    setExpiry("6h");
    setMediaId(null);
    setMediaName(null);
    setError("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function upload(file: File) {
    const selectionError = validateImageSelection(file, "moment");
    if (selectionError) {
      setError(selectionError);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.set("media", file);
    startUpload(async () => {
      const result = await uploadMomentMediaAction(formData);
      if (result.ok && result.mediaId) {
        setMediaId(result.mediaId);
        setMediaName(file.name);
        setError("");
      } else {
        setError(result.message);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function share() {
    startSubmit(async () => {
      const result = await createMomentAction({
        contentType: mediaId ? "photo" : "text",
        textContent: text.trim() || undefined,
        mediaId: mediaId ?? undefined,
        caption: caption.trim() || undefined,
        audienceType: audience,
        targetIds: audience === "selected_circles" && circleId ? [circleId] : undefined,
        expiresAt: new Date(Date.now() + expiryMs).toISOString()
      });
      if (result.ok) {
        onCreated(result.locationWarning ? `${result.message} ${result.locationWarning}` : result.message);
        reset();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title="Share a Moment" description="It disappears when it expires.">
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        <Textarea
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          placeholder="What's happening?"
          aria-label="Moment text"
        />

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={isUploading}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            {isUploading ? "Uploading…" : mediaName ? "Change photo" : "Add photo"}
          </Button>
          {mediaName ? <span className="ml-2 text-xs text-muted-foreground">{mediaName}</span> : null}
        </div>

        {mediaId ? (
          <Textarea
            value={caption}
            maxLength={200}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Add a caption (optional)"
            aria-label="Caption"
          />
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Who can see this?</p>
          <div className="flex flex-wrap gap-2">
            {audienceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAudience(option.id)}
                aria-pressed={audience === option.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  audience === option.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
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
                      circleId === circle.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-secondary"
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
          <p className="mb-2 text-sm font-medium text-foreground">Disappears after</p>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setExpiry(preset.id)}
                aria-pressed={expiry === preset.id}
                className={cn(
                  "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                  expiry === preset.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Privacy summary, updates live as settings change (spec §7). */}
        <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs leading-6 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Visible to:</span>{" "}
            {audienceSummaryLabel(audience, audienceNames)}
          </p>
          <p>
            <span className="font-medium text-foreground">Expires:</span> {expiresLabel}
          </p>
          <p>
            <span className="font-medium text-foreground">Exact location:</span> Not shared
          </p>
        </div>

        {risk.warn ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">{LOCATION_WARNING_MESSAGE}</p>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="mt-5 flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" onClick={share} disabled={!canShare || pending || isSubmitting || isUploading}>
          Share Moment
        </Button>
      </div>
    </Modal>
  );
}

function ReportModal({
  moment,
  onOpenChange,
  onReported
}: {
  moment: VisibleMoment | null;
  onOpenChange: (open: boolean) => void;
  onReported: (message: string) => void;
}) {
  const [category, setCategory] = useState<string>("harassment");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!moment) return;
    startTransition(async () => {
      const result = await reportContentAction({
        contentType: "moment",
        contentId: moment.id,
        category,
        details: details.trim() || undefined,
        alsoHide: true,
        alsoBlock
      });
      onReported(result.message);
      setCategory("harassment");
      setDetails("");
      setAlsoBlock(false);
    });
  }

  return (
    <Modal
      open={Boolean(moment)}
      onOpenChange={onOpenChange}
      title="Report this Moment"
      description="We'll hide it from you straight away. Your report stays private."
    >
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-2">
          {REPORT_CATEGORIES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCategory(option.id)}
              aria-pressed={category === option.id}
              className={cn(
                "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                category === option.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Textarea
          value={details}
          maxLength={1000}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Anything else we should know? (optional)"
          aria-label="Report details"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(event) => setAlsoBlock(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Also block {moment?.authorName}
        </label>
      </div>
      <div className="mt-5 flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={submit} disabled={isPending}>
          Report
        </Button>
      </div>
    </Modal>
  );
}
