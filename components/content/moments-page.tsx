"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  Clock,
  Crown,
  Eye,
  Flag,
  Globe2,
  ImageOff,
  ImagePlus,
  LockKeyhole,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Users,
  Video,
  X
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  createMomentAction,
  deleteMomentAction,
  getMomentFeedAction,
  getOpenMomentFeedAction,
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
import { validateImageSelection, validateVideoSelection } from "@/lib/media/validation";
import type { VisibleMoment } from "@/lib/content/service";
import type { MomentAudienceType, MomentContentType, ReactionType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type MomentAudienceOption = { id: string; name: string };

const reactions: Array<{ id: ReactionType; emoji: string; label: string }> = [
  { id: "heart", emoji: "❤️", label: "Heart" },
  { id: "laugh", emoji: "😂", label: "Laugh" },
  { id: "wave", emoji: "👋", label: "Wave" },
  { id: "fire", emoji: "🔥", label: "Fire" },
  { id: "clap", emoji: "👏", label: "Clap" }
];

const privateAudienceOptions: Array<{ id: MomentAudienceType; label: string }> = [
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

const openMomentFacts = [
  {
    icon: Eye,
    title: "Community visibility",
    description: "Anyone signed in to Mad Buddy can view Open Moments."
  },
  {
    icon: Crown,
    title: "Buddy Pro publishing",
    description: "Only Buddy Pro members can share to the Open feed."
  },
  {
    icon: Timer,
    title: "Temporary by design",
    description: "Choose 1, 3, 6, or 24 hours. Every Moment expires."
  }
] as const;

export function MomentsPage({
  initialMoments = [],
  initialOpenMoments = [],
  circles = [],
  openMomentsEnabled = false,
  canPublishOpenMoments = false
}: {
  initialMoments?: VisibleMoment[];
  initialOpenMoments?: VisibleMoment[];
  circles?: MomentAudienceOption[];
  openMomentsEnabled?: boolean;
  canPublishOpenMoments?: boolean;
}) {
  const router = useRouter();
  const [moments, setMoments] = useState(initialMoments);
  const [openMoments, setOpenMoments] = useState(initialOpenMoments);
  const [activeFeed, setActiveFeed] = useState<"muddies" | "open">("muddies");
  const [createOpen, setCreateOpen] = useState(false);
  const [composerAudience, setComposerAudience] = useState<MomentAudienceType>("close_friends");
  const [reportFor, setReportFor] = useState<VisibleMoment | null>(null);
  const [feedback, setFeedback] = useState("");
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(() => new Set());
  const mediaRetryIds = useRef(new Set<string>());
  const [isPending, startTransition] = useTransition();
  const visibleMoments = activeFeed === "open" ? openMoments : moments;

  function openComposer() {
    setComposerAudience(activeFeed === "open" ? "public" : "close_friends");
    setCreateOpen(true);
  }

  function updateMomentInFeeds(
    updater: (entry: VisibleMoment) => VisibleMoment
  ) {
    setMoments((current) => current.map(updater));
    setOpenMoments((current) => current.map(updater));
  }

  function removeMomentFromFeeds(momentId: string) {
    setMoments((current) => current.filter((entry) => entry.id !== momentId));
    setOpenMoments((current) => current.filter((entry) => entry.id !== momentId));
  }

  function retryMomentMedia(moment: VisibleMoment) {
    if (mediaRetryIds.current.has(moment.id)) {
      setFailedMediaIds((current) => new Set(current).add(moment.id));
      return;
    }

    mediaRetryIds.current.add(moment.id);
    startTransition(async () => {
      const refreshed =
        moment.audienceLabel === "public" || activeFeed === "open"
          ? await getOpenMomentFeedAction()
          : await getMomentFeedAction();
      const replacement = refreshed.find((entry) => entry.id === moment.id);
      if (replacement?.mediaUrl && replacement.mediaUrl !== moment.mediaUrl) {
        updateMomentInFeeds((entry) => (entry.id === replacement.id ? replacement : entry));
        return;
      }
      setFailedMediaIds((current) => new Set(current).add(moment.id));
    });
  }

  function react(moment: VisibleMoment, reaction: ReactionType) {
    const isSame = moment.myReaction === reaction;
    // Count delta: +1 when going from no reaction to one, -1 when toggling the
    // same one off, 0 when switching type (still one reaction from this user).
    const delta = (isSame ? 0 : 1) - (moment.myReaction ? 1 : 0);
    updateMomentInFeeds((entry) =>
        entry.id === moment.id
          ? { ...entry, myReaction: isSame ? null : reaction, reactionCount: Math.max(0, entry.reactionCount + delta) }
          : entry
    );
    startTransition(async () => {
      const result = isSame
        ? await removeMomentReactionAction(moment.id)
        : await reactToMomentAction(moment.id, reaction);
      if (!result.ok) {
        setFeedback(result.message);
        // Restore the canonical pre-click state on failure.
        updateMomentInFeeds((entry) =>
            entry.id === moment.id
              ? { ...entry, myReaction: moment.myReaction, reactionCount: moment.reactionCount }
              : entry
        );
      }
    });
  }

  function remove(moment: VisibleMoment) {
    startTransition(async () => {
      const result = await deleteMomentAction(moment.id);
      setFeedback(result.message);
      if (result.ok) {
        removeMomentFromFeeds(moment.id);
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6 py-5 sm:py-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Share what matters now</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[2rem]">Moments</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
            Share temporary photos, short videos, and updates privately, or discover the wider Mad Buddy community.
          </p>
        </div>
        <Button type="button" size="sm" className="shrink-0" onClick={openComposer}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Share</span>
        </Button>
      </header>

      {openMomentsEnabled ? (
        <div className="flex flex-col gap-3 border-y border-border/65 py-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-fit rounded-full border border-border/75 bg-secondary/45 p-1" role="tablist" aria-label="Moment feeds">
            <button
              type="button"
              role="tab"
              aria-selected={activeFeed === "muddies"}
              onClick={() => setActiveFeed("muddies")}
              className={cn(
                "focus-ring safe-motion inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                activeFeed === "muddies" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              My Muddies
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFeed === "open"}
              onClick={() => setActiveFeed("open")}
              className={cn(
                "focus-ring safe-motion inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                activeFeed === "open" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              Open
            </button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {activeFeed === "open"
              ? "Visible across Mad Buddy. Buddy Pro is required to publish."
              : "Visible only to the audience you choose."}
          </p>
        </div>
      ) : null}

      {feedback ? (
        <div className="rounded-[1rem] border border-orange-400/20 bg-orange-400/10 p-3 text-sm text-orange-800 dark:text-orange-50" role="status">
          {feedback}
        </div>
      ) : null}

      {visibleMoments.length === 0 ? (
        activeFeed === "open" ? (
          <section className="grid overflow-hidden rounded-[1.5rem] border border-border/70 bg-card/50 dark:border-white/10 dark:bg-white/[0.025] lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
            <div className="relative flex min-h-[300px] flex-col justify-center overflow-hidden p-6 sm:p-9">
              <div
                className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
                aria-hidden="true"
              />
              <div className="relative">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <Globe2 className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Open Moments</p>
                <h2 className="mt-2 max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
                  The community feed is ready for its first Moment.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Share a thought, photo, or short video beyond your Muddy circle. Open Moments are temporary, reportable,
                  and never include your device location.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {canPublishOpenMoments ? (
                    <Button type="button" onClick={openComposer}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Share publicly
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href="/plans">
                        <Crown className="h-4 w-4" aria-hidden="true" />
                        Unlock with Buddy Pro
                      </Link>
                    </Button>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                    Up to 24 hours
                  </span>
                </div>
              </div>
            </div>

            <aside className="border-t border-border/65 bg-secondary/25 p-5 dark:border-white/10 lg:border-l lg:border-t-0 lg:p-6">
              <h3 className="text-sm font-semibold">How Open works</h3>
              <div className="mt-4 space-y-4">
                {openMomentFacts.map((fact) => {
                  const Icon = fact.icon;
                  return (
                    <div key={fact.title} className="flex gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-background/80 text-primary">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{fact.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{fact.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          </section>
        ) : (
          <EmptyState
            icon={Sparkles}
            className="!min-h-[190px] !shadow-none p-5"
            title="No Moments right now"
            description="Moments from your Muddies appear here until they expire."
            action={
              <Button type="button" onClick={openComposer}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Share a Moment
              </Button>
            }
          />
        )
      ) : (
        <section
          className={cn(
            "mx-auto w-full max-w-[760px] space-y-4",
            activeFeed === "open" &&
              "max-h-[calc(100dvh-11rem)] max-w-[680px] snap-y snap-mandatory overflow-y-auto overscroll-contain pr-1"
          )}
          aria-label={activeFeed === "open" ? "Open Moments" : "Shared Moments"}
        >
          {visibleMoments.map((moment) => (
            <article
              key={moment.id}
              className={cn(
                "overflow-hidden rounded-[1.35rem] border border-border/75 bg-card/65 shadow-[0_18px_50px_hsl(var(--shadow)/0.10)] dark:border-white/10 dark:bg-white/[0.035]",
                activeFeed === "open" &&
                  "flex min-h-[min(720px,calc(100dvh-12rem))] snap-start snap-always flex-col"
              )}
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
                <p
                  className={cn(
                    "whitespace-pre-wrap px-4 pb-4 text-[0.95rem] leading-6 text-foreground sm:px-5",
                    activeFeed === "open" &&
                      "flex flex-1 items-center px-6 py-10 text-xl font-medium leading-8 sm:px-10 sm:text-2xl"
                  )}
                >
                  {moment.textContent}
                </p>
              ) : null}

              {moment.mediaUrl && !failedMediaIds.has(moment.id) ? (
                moment.contentType === "video" ? (
                  <video
                    key={moment.mediaUrl}
                    src={moment.mediaUrl}
                    aria-label={moment.caption ?? `Video Moment from ${moment.authorName}`}
                    className={cn(
                      "block max-h-[560px] min-h-[240px] w-full bg-black object-contain sm:min-h-[320px]",
                      activeFeed === "open" && "max-h-none min-h-[50dvh] flex-1"
                    )}
                    controls
                    controlsList="nodownload"
                    playsInline
                    preload="metadata"
                    onError={() => retryMomentMedia(moment)}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={moment.mediaUrl}
                    src={moment.mediaUrl}
                    alt={moment.caption ?? `Moment from ${moment.authorName}`}
                    className={cn(
                      "block max-h-[560px] min-h-[220px] w-full bg-secondary/40 object-cover object-center sm:min-h-[300px]",
                      activeFeed === "open" && "max-h-none min-h-[50dvh] flex-1"
                    )}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onError={() => retryMomentMedia(moment)}
                  />
                )
              ) : moment.contentType === "photo" || moment.contentType === "video" ? (
                <div className="grid min-h-56 place-items-center bg-secondary/35 px-6 text-center">
                  <div>
                    {moment.contentType === "video" ? (
                      <Video className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <ImageOff className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
                    )}
                    <p className="mt-2 text-sm font-medium">
                      {moment.contentType === "video" ? "Video unavailable" : "Photo unavailable"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This {moment.contentType === "video" ? "video" : "photo"} could not be loaded.
                    </p>
                  </div>
                </div>
              ) : null}

              {moment.caption ? (
                <p className="px-4 pt-3 text-sm leading-6 text-muted-foreground sm:px-5">{moment.caption}</p>
              ) : null}

              <footer
                className={cn(
                  "mt-3 flex items-center gap-2 border-t border-border/60 px-3 py-2.5 dark:border-white/10 sm:px-4",
                  activeFeed === "open" && "mt-auto"
                )}
              >
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
                  {moment.reactionCount > 0 ? (
                    <span
                      className="ml-1.5 text-xs font-medium tabular-nums text-muted-foreground"
                      aria-label={`${moment.reactionCount} ${moment.reactionCount === 1 ? "reaction" : "reactions"}`}
                    >
                      {moment.reactionCount}
                    </span>
                  ) : null}
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {moment.isAuthor && moment.audienceLabel
                    ? audienceSummaryLabel(moment.audienceLabel as MomentAudienceType, [])
                    : activeFeed === "open"
                      ? "Open Moment"
                      : "Shared privately"}
                </span>
              </footer>
            </article>
          ))}
        </section>
      )}

      <div className="mx-auto flex w-full max-w-[760px] items-start gap-2.5 rounded-xl bg-secondary/45 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          Moments disappear after the time you choose. Screenshots are still possible, so share thoughtfully.
        </p>
      </div>

      <CreateMomentModal
        key={`${composerAudience}-${createOpen ? "open" : "closed"}`}
        open={createOpen}
        defaultAudience={composerAudience}
        circles={circles}
        pending={isPending}
        openMomentsEnabled={openMomentsEnabled}
        canPublishOpenMoments={canPublishOpenMoments}
        onOpenChange={setCreateOpen}
        onCreated={(message) => {
          setFeedback(message);
          setCreateOpen(false);
          startTransition(async () => {
            const [privateFeed, openFeed] = await Promise.all([
              getMomentFeedAction(),
              openMomentsEnabled ? getOpenMomentFeedAction() : Promise.resolve([])
            ]);
            setMoments(privateFeed);
            setOpenMoments(openFeed);
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
            removeMomentFromFeeds(reportedId);
          }
          if (ok) router.refresh();
        }}
      />
    </div>
  );
}

function CreateMomentModal({
  open,
  defaultAudience,
  circles,
  pending,
  openMomentsEnabled,
  canPublishOpenMoments,
  onOpenChange,
  onCreated
}: {
  open: boolean;
  defaultAudience: MomentAudienceType;
  circles: MomentAudienceOption[];
  pending: boolean;
  openMomentsEnabled: boolean;
  canPublishOpenMoments: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<MomentAudienceType>(defaultAudience);
  const [circleId, setCircleId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryPresetId>("6h");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<Extract<MomentContentType, "photo" | "video"> | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [publicAudienceConfirmed, setPublicAudienceConfirmed] = useState(false);
  const [error, setError] = useState(
    defaultAudience === "public" && !canPublishOpenMoments
      ? "Publishing Open Moments is included with Buddy Pro."
      : ""
  );
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
  const audienceOptions = openMomentsEnabled
    ? [...privateAudienceOptions, { id: "public" as const, label: "Public" }]
    : privateAudienceOptions;
  const canShare =
    (mediaId !== null || text.trim().length > 0) &&
    (audience !== "selected_circles" || circleId !== null) &&
    (audience !== "public" || (canPublishOpenMoments && publicAudienceConfirmed && !risk.warn));

  function reset() {
    setText("");
    setCaption("");
    setAudience("close_friends");
    setCircleId(null);
    setExpiry("6h");
    setMediaId(null);
    setMediaType(null);
    setMediaPreview(null);
    setPublicAudienceConfirmed(false);
    setError("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function upload(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const selectedAsVideo =
      file.type.startsWith("video/") ||
      extension === "mp4" ||
      extension === "m4v" ||
      extension === "webm" ||
      extension === "mov";
    const selectionError = selectedAsVideo
      ? validateVideoSelection(file)
      : validateImageSelection(file, "moment");
    if (selectionError) {
      setError(selectionError);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setMediaType(selectedAsVideo ? "video" : "photo");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setMediaPreview(reader.result);
    };
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.set("media", file);
    startUpload(async () => {
      const result = await uploadMomentMediaAction(formData);
      if (result.ok && result.mediaId && result.mediaType) {
        setMediaId(result.mediaId);
        setMediaType(result.mediaType);
        setError("");
      } else {
        setMediaType(null);
        setMediaPreview(null);
        setError(result.message);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function share() {
    startSubmit(async () => {
      const result = await createMomentAction({
        contentType: mediaId && mediaType ? mediaType : "text",
        textContent: text.trim() || undefined,
        mediaId: mediaId ?? undefined,
        caption: caption.trim() || undefined,
        audienceType: audience,
        targetIds: audience === "selected_circles" && circleId ? [circleId] : undefined,
        publicAudienceConfirmed: audience === "public" ? publicAudienceConfirmed : undefined,
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
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={audience === "public" ? "Share to Open Moments" : "Share a Moment"}
      description={
        audience === "public"
          ? "Post a temporary update to the Mad Buddy community."
          : "Choose who sees it and when it disappears."
      }
    >
      <div className="max-h-[68dvh] space-y-4 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-border/75 bg-secondary/20 p-3">
          <Textarea
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            placeholder="Share what is happening..."
            aria-label="Moment text"
            className="min-h-24 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <span>Text, one photo, or one short video</span>
            <span className="tabular-nums">{text.length}/500</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/75">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov,.m4v"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
          {mediaPreview ? (
            <div className="relative">
              {mediaType === "video" ? (
                <video
                  src={mediaPreview}
                  aria-label="Selected video preview"
                  className="max-h-72 w-full bg-black object-contain"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaPreview}
                  alt="Selected Moment preview"
                  className="max-h-64 w-full bg-black/5 object-contain"
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setMediaId(null);
                  setMediaType(null);
                  setMediaPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="focus-ring absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow-lg"
                aria-label="Remove selected photo"
                title="Remove selected photo"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="focus-ring absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-full bg-black/65 px-3 py-2 text-xs font-medium text-white shadow-lg"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Replace
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className="focus-ring flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/45"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                {isUploading ? (
                  <Sparkles className="h-5 w-5 animate-pulse" aria-hidden="true" />
                ) : (
                  <ImagePlus className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {isUploading ? "Preparing media..." : "Add a photo or video"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Photos up to 3 MB. MP4, WebM, or MOV videos up to 5 MB.
                </span>
              </span>
              <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
        </div>

        {mediaId ? (
          <div>
            <Textarea
              value={caption}
              maxLength={200}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Add a caption (optional)"
              aria-label="Caption"
              className="min-h-20 resize-none"
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{caption.length}/200</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border/75 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-muted-foreground">
              {audience === "public" ? (
                <Globe2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Users className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Audience</p>
              <p className="text-[11px] text-muted-foreground">Choose private sharing or the Open community.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {audienceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setAudience(option.id);
                  setError(
                    option.id === "public" && !canPublishOpenMoments
                      ? "Publishing Open Moments is included with Buddy Pro."
                      : ""
                  );
                  if (option.id !== "public") setPublicAudienceConfirmed(false);
                }}
                aria-pressed={audience === option.id}
                aria-label={
                  option.id === "public" && !canPublishOpenMoments
                    ? "Public, Buddy Pro required"
                    : option.label
                }
                className={cn(
                  "focus-ring safe-motion inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                  audience === option.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary",
                  option.id === "public" && !canPublishOpenMoments && "border-dashed"
                )}
              >
                {option.id === "public" ? (
                  canPublishOpenMoments ? (
                    <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                  )
                ) : null}
                {option.label}
                {option.id === "public" && !canPublishOpenMoments ? " · Pro" : null}
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
          {audience === "public" && !canPublishOpenMoments ? (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">Open publishing is a Buddy Pro feature</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    Everyone can explore Open Moments. Buddy Pro members can publish to the community.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <Link href="/plans">See Buddy Pro</Link>
              </Button>
            </div>
          ) : audience === "public" ? (
            <div className="mt-3 rounded-xl border border-orange-400/30 bg-orange-400/10 p-3">
              <div className="flex items-start gap-2">
                <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground">This is an Open Moment</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Anyone signed in to Mad Buddy may see it. Never include an exact location or private information.
                  </p>
                </div>
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-foreground">
                <input
                  type="checkbox"
                  checked={publicAudienceConfirmed}
                  onChange={(event) => setPublicAudienceConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                I understand anyone on Mad Buddy may see this Moment.
              </label>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/75 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Timer className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Lifetime</p>
              <p className="text-[11px] text-muted-foreground">The Moment is hidden automatically when this time ends.</p>
            </div>
          </div>
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
        <div className="grid gap-2 rounded-2xl bg-secondary/35 p-3 text-xs text-muted-foreground sm:grid-cols-3">
          <div className="rounded-xl bg-background/60 p-3">
            <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="mt-2 font-medium text-foreground">Audience</p>
            <p className="mt-0.5 leading-5">{audienceSummaryLabel(audience, audienceNames)}</p>
          </div>
          <div className="rounded-xl bg-background/60 p-3">
            <Timer className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="mt-2 font-medium text-foreground">Expires</p>
            <p className="mt-0.5 leading-5">{expiresLabel}</p>
          </div>
          <div className="rounded-xl bg-background/60 p-3">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="mt-2 font-medium text-foreground">App location</p>
            <p className="mt-0.5 leading-5">Not attached</p>
          </div>
        </div>

        {risk.warn ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
              {audience === "public"
                ? "Remove exact location details before sharing this Open Moment."
                : LOCATION_WARNING_MESSAGE}
            </p>
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
