"use client";

import { useRouter } from "next/navigation";
import { Camera, Clock, Flag, ImageOff, Plus, ShieldAlert, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  createMomentAction,
  deleteMomentAction,
  getMomentFeedAction,
  reactToMomentAction,
  removeMomentReactionAction,
  reportContentAction,
  uploadMomentMediaAction
} from "@/app/(app)/moments-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
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
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(() => new Set());
  const mediaRetryIds = useRef(new Set<string>());
  const [isPending, startTransition] = useTransition();

  function retryMomentMedia(moment: VisibleMoment) {
    if (mediaRetryIds.current.has(moment.id)) {
      setFailedMediaIds((current) => new Set(current).add(moment.id));
      return;
    }

    mediaRetryIds.current.add(moment.id);
    startTransition(async () => {
      const refreshed = await getMomentFeedAction();
      const replacement = refreshed.find((entry) => entry.id === moment.id);
      if (replacement?.mediaUrl && replacement.mediaUrl !== moment.mediaUrl) {
        setMoments((current) =>
          current.map((entry) => (entry.id === replacement.id ? replacement : entry))
        );
        return;
      }
      setFailedMediaIds((current) => new Set(current).add(moment.id));
    });
  }

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
        setMoments((current) =>
          current.map((entry) =>
            entry.id === moment.id ? { ...entry, myReaction: moment.myReaction } : entry
          )
        );
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
    <div className="mx-auto w-full max-w-[760px] space-y-7 py-5 sm:py-7">
      <header className="flex items-start justify-between gap-4 border-b border-border/70 pb-5 dark:border-white/10">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[2rem]">Moments</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
            Temporary updates shared with the people you choose.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Share Moment</span>
          <span className="sm:hidden">Share</span>
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
        <section className="space-y-4" aria-label="Shared Moments">
          {moments.map((moment) => (
            <article
              key={moment.id}
              className="overflow-hidden rounded-[1.35rem] border border-border/75 bg-card/65 shadow-[0_18px_50px_hsl(var(--shadow)/0.10)] dark:border-white/10 dark:bg-white/[0.035]"
            >
              <header className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <UserAvatar name={moment.authorName} src={moment.authorAvatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{moment.authorName}</p>
                    {moment.isAuthor && moment.audienceLabel ? (
                      <Badge variant="orange" className="hidden shrink-0 sm:inline-flex">
                        {audienceSummaryLabel(moment.audienceLabel as MomentAudienceType, [])}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    Disappears in {expiryLabel(moment.expiresAt).replace(" left", "")}
                  </p>
                </div>
                {moment.isAuthor ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete Moment"
                    title="Delete Moment"
                    onClick={() => remove(moment)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground"
                    aria-label="Report Moment"
                    title="Report Moment"
                    onClick={() => setReportFor(moment)}
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </header>

              {moment.textContent ? (
                <p className="whitespace-pre-wrap px-4 pb-4 text-[0.95rem] leading-6 text-foreground sm:px-5">
                  {moment.textContent}
                </p>
              ) : null}

              {moment.mediaUrl && !failedMediaIds.has(moment.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={moment.mediaUrl}
                  src={moment.mediaUrl}
                  alt={moment.caption ?? `Moment from ${moment.authorName}`}
                  className="block max-h-[560px] min-h-[220px] w-full bg-secondary/40 object-cover object-center sm:min-h-[300px]"
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  onError={() => retryMomentMedia(moment)}
                />
              ) : moment.contentType === "photo" ? (
                <div className="grid min-h-56 place-items-center bg-secondary/35 px-6 text-center">
                  <div>
                    <ImageOff className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium">Photo unavailable</p>
                    <p className="mt-1 text-xs text-muted-foreground">This photo could not be loaded.</p>
                  </div>
                </div>
              ) : null}

              {moment.caption ? (
                <p className="px-4 pt-3 text-sm leading-6 text-muted-foreground sm:px-5">{moment.caption}</p>
              ) : null}

              <footer className="mt-3 flex items-center gap-2 border-t border-border/60 px-3 py-2.5 dark:border-white/10 sm:px-4">
                <div className="flex min-w-0 flex-1 items-center gap-0.5" aria-label="React to this Moment">
                    {reactions.map((reaction) => (
                      <button
                        key={reaction.id}
                        type="button"
                        aria-label={reaction.label}
                        aria-pressed={moment.myReaction === reaction.id}
                        onClick={() => react(moment, reaction.id)}
                        disabled={isPending}
                        className={cn(
                          "focus-ring safe-motion grid h-9 w-9 place-items-center rounded-full border text-base transition-colors",
                          moment.myReaction === reaction.id
                            ? "border-primary bg-primary/10"
                            : "border-transparent hover:bg-secondary"
                        )}
                      >
                        {reaction.emoji}
                      </button>
                    ))}
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {moment.isAuthor && moment.audienceLabel
                    ? audienceSummaryLabel(moment.audienceLabel as MomentAudienceType, [])
                    : "Shared privately"}
                </span>
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
        pending={isPending}
        onOpenChange={setCreateOpen}
        onCreated={(message) => {
          setFeedback(message);
          setCreateOpen(false);
          startTransition(async () => {
            setMoments(await getMomentFeedAction());
            router.refresh();
          });
        }}
      />

      <ReportModal
        moment={reportFor}
        onOpenChange={(open) => {
          if (!open) setReportFor(null);
        }}
        onReported={(message, ok) => {
          const reportedId = reportFor?.id;
          setFeedback(message);
          if (ok) setReportFor(null);
          if (ok && reportedId) {
            setMoments((current) => current.filter((entry) => entry.id !== reportedId));
          }
          if (ok) router.refresh();
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
  onReported: (message: string, ok: boolean) => void;
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
      onReported(result.message, result.ok);
      if (result.ok) {
        setCategory("harassment");
        setDetails("");
        setAlsoBlock(false);
      }
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
