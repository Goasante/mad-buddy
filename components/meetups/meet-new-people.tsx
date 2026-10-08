"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  Clock3,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Link, PLATFORM_KIND, syncCurrentLocation } from "@/lib/platform";
import { resolveUpForActivityArtwork } from "@/lib/visuals/upfor-art";
import { conversationHref } from "@/lib/messaging/open-conversation";
import { isFutureMeetupTime } from "@/lib/meetups/scheduling";
import {
  MEETUP_DISCOVERY_CATEGORY_OPTIONS,
  discoveryCategoryLabel,
  discoveryTimeLeft,
  type MeetupDiscoveryCategory,
  type MeetupDiscoveryHub,
  type MeetupDiscoveryItem
} from "@/lib/meetups/discovery";

export type MeetupDiscoveryAction = (
  input: unknown,
  create?: boolean
) => Promise<{
  ok: boolean;
  message: string;
  discoveryId?: string;
  meetupId?: string;
  conversationId?: string;
}>;

const inputClass =
  "box-border w-full min-w-0 max-w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

function discoveryProfileHref(username: string): ReturnType<typeof conversationHref> {
  return `/friends/${username}` as ReturnType<typeof conversationHref>;
}

function localDateTimeValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function DiscoveryArtwork({ category }: { category: MeetupDiscoveryCategory }) {
  const art = resolveUpForActivityArtwork(category);
  if (!art) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary to-background">
        <span className="text-4xl" aria-hidden="true">
          {MEETUP_DISCOVERY_CATEGORY_OPTIONS.find((item) => item.id === category)?.emoji ?? "✨"}
        </span>
      </div>
    );
  }
  return (
    <div
      className="h-full w-full bg-cover bg-center"
      style={{ backgroundImage: `url("${art.asset.path}")`, backgroundPosition: art.objectPosition }}
      aria-hidden="true"
    />
  );
}

function ListingCard({
  item,
  nowMs,
  pending,
  onInterest,
  onWithdraw,
  onOpen
}: {
  item: MeetupDiscoveryItem;
  nowMs: number;
  pending: boolean;
  onInterest: () => void;
  onWithdraw: () => void;
  onOpen: () => void;
}) {
  const remaining = Math.max(0, item.interestLimit - item.interestCount);
  const expired = item.status !== "active" || Date.parse(item.listingExpiresAt) <= nowMs || Date.parse(item.startsAt) <= nowMs;
  const declined = item.myInterestStatus === "declined";
  return (
    <article className="overflow-hidden rounded-[26px] border border-border/80 bg-card shadow-[0_10px_30px_hsl(var(--shadow)/0.08)]">
      <button type="button" onClick={onOpen} aria-label={`View ${item.title}`} className="focus-ring block w-full text-left">
        <div className="relative h-32 overflow-hidden">
          <DiscoveryArtwork category={item.category} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3 text-white">
            <div className="min-w-0">
              <p className="break-words text-lg font-semibold leading-snug">{item.title}</p>
              <p className="text-xs text-white/85">{discoveryCategoryLabel(item.category)} · Nearby</p>
            </div>
            <span className="shrink-0 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
              {item.style === "group" ? "Group" : "1-to-1"}
            </span>
          </div>
        </div>
      </button>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2.5">
          <UserAvatar src={item.creatorAvatarUrl} name={item.creatorName} size="xs" decorative />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.creatorName}</p>
            <p className="text-xs text-muted-foreground">
              {new Intl.DateTimeFormat("en", {
                timeZone: item.timezone,
                dateStyle: "medium",
                timeStyle: "short"
              }).format(new Date(item.startsAt))}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-primary">{discoveryTimeLeft(item.listingExpiresAt, nowMs)}</span>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{item.interestCount} interested</span>
          <span>{remaining > 0 ? `${remaining} response slots` : "Responses full"}</span>
        </div>

        {item.myInterestStatus === "accepted" && item.meetupId ? (
          <Link href={`/meet-up?meetup=${item.meetupId}`} className="focus-ring inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
            Open Meetup
          </Link>
        ) : item.myInterestStatus === "pending" ? (
          <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={onWithdraw}>
            Withdraw interest
          </Button>
        ) : (
          <Button type="button" className="w-full" disabled={pending || expired || declined || remaining === 0} onClick={onInterest}>
            {declined ? "Not selected" : expired ? "Listing closed" : remaining === 0 ? "Responses full" : "Interested"}
          </Button>
        )}
      </div>
    </article>
  );
}

export function MeetNewPeople({
  hub,
  nowMs,
  focusedId,
  onBack,
  action,
  onRefresh
}: {
  hub: MeetupDiscoveryHub;
  nowMs: number;
  focusedId?: string;
  onBack: () => void;
  action: MeetupDiscoveryAction;
  onRefresh: () => Promise<void>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MeetupDiscoveryItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusedId ?? null);
  const [localUpdates, setLocalUpdates] = useState<Record<string, Partial<MeetupDiscoveryItem>>>({});
  const [previousHub, setPreviousHub] = useState(hub);
  // Optimistic confirmations last only until the server sends a fresh hub.
  if (previousHub !== hub) {
    setPreviousHub(hub);
    setLocalUpdates({});
  }
  const nearby = hub.nearby.map((item) => ({ ...item, ...localUpdates[item.id] }));
  const selected = nearby.find((item) => item.id === selectedId) ?? null;
  const [message, setMessage] = useState("");
  const locationSynced = useRef(false);
  const inFlight = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<MeetupDiscoveryCategory>("coffee");
  const [style, setStyle] = useState<"one_to_one" | "group">("one_to_one");
  const [startsAt, setStartsAt] = useState(() => localDateTimeValue(new Date(Date.now() + 2 * 60 * 60_000)));
  const [duration, setDuration] = useState<0 | 30 | 60 | 120 | 240>(0);

  const canCreate = hub.activeSlots < hub.maxActiveSlots;
  const wordCount = title.trim() ? title.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (locationSynced.current) return;
    locationSynced.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const location = await syncCurrentLocation();
        if (cancelled) return;
        if (!location.ok) {
          setMessage(location.message ?? "Turn on location to see people nearby.");
          return;
        }
        await onRefresh();
      } catch {
        if (!cancelled) setMessage("Could not refresh nearby listings. Try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [onRefresh]);
  const mine = [...hub.mine].sort((a, b) => Number(b.id === focusedId) - Number(a.id === focusedId));
  const openListings = mine.filter((item) => item.status === "active" && Date.parse(item.listingExpiresAt) > nowMs && Date.parse(item.startsAt) > nowMs);
  const closedListings = mine.filter((item) => !openListings.some((open) => open.id === item.id));
  const inbox = mine.filter((item) => Date.parse(item.startsAt) > nowMs && item.interestedPeople.some((person) => person.status === "pending"));


  async function refreshAfterSave(successMessage: string) {
    try {
      await onRefresh();
    } catch {
      setMessage(`${successMessage} The list could not refresh; reopen it to see the latest.`);
    }
  }

  function run(input: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await action(input, false);
        setMessage(result.message);
        if (result.ok) {
          if (input && typeof input === "object" && "action" in input && "id" in input && typeof input.id === "string") {
            const item = nearby.find((value) => value.id === input.id);
            if (item && (input.action === "interest" || input.action === "withdraw")) {
              const interested = input.action === "interest";
              setLocalUpdates((current) => ({
                ...current,
                [item.id]: {
                  myInterestStatus: interested ? "pending" : "withdrawn",
                  interestCount: Math.max(0, Math.min(item.interestLimit, item.interestCount + (interested ? 1 : -1)))
                }
              }));
            }
          }
          await refreshAfterSave(result.message);
        }
      } catch {
        setMessage("Could not update this listing. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  function refreshNearby() {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const location = await syncCurrentLocation();
        if (!location.ok) {
          setMessage(location.message ?? "Turn on location to see people nearby.");
          return;
        }
        await onRefresh();
        setMessage("");
      } catch {
        setMessage("Could not refresh nearby listings. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  function create() {
    if (inFlight.current || title.trim().length < 2 || wordCount > 5 || (!editing && !canCreate)) return;
    const date = new Date(startsAt);
    if (!isFutureMeetupTime(startsAt)) {
      setMessage("Choose a time at least one minute from now. Later today is fine.");
      return;
    }
    const details = {
      title: title.trim(), category, style, startsAt: date.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", durationMinutes: duration
    };
    const signature = JSON.stringify({ ...details, editingId: editing?.id });
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    const requestKey = request.current.key;
    inFlight.current = true;
    startTransition(async () => {
      try {
        if (!editing) {
          const location = await syncCurrentLocation();
          if (!location.ok) {
            setMessage(location.message ?? "Turn on Glow so this listing can be shown nearby.");
            return;
          }
        }
        const result = editing
          ? await action({ action: "edit", id: editing.id, title: details.title, category, startsAt: details.startsAt, timezone: details.timezone, requestKey }, false)
          : await action({ ...details, requestKey }, true);
        setMessage(result.message);
        if (result.ok) {
          request.current = null;
          setCreateOpen(false);
          setEditing(null);
          setTitle("");
          await refreshAfterSave(result.message);
        }
      } catch {
        setMessage(editing ? "Could not save the changes. Try again." : "Could not publish. Try again; your listing will not be duplicated.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-xl px-3 pb-24 pt-2 sm:px-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={`focus-ring -ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium ${PLATFORM_KIND === "web" ? "hidden md:inline-flex" : ""}`}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Meetups
        </button>
        <span className="ml-auto rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold">
          {hub.activeSlots} of {hub.maxActiveSlots} open listings
        </span>
      </div>

      <div className="mb-5 rounded-2xl border border-border/80 bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Nearby discovery</p>
            <h1 className={`mt-1 text-2xl font-bold tracking-tight ${PLATFORM_KIND === "web" ? "hidden md:block" : ""}`}>Meet New People</h1>
            <p className="mt-2 max-w-md text-sm leading-5 text-muted-foreground">
              Find people nearby who share your interests. Agree on a place after you match; live locations stay private.
            </p>
          </div>
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <UserRound className="h-6 w-6" aria-hidden="true" />
          </div>
        </div>
        <Button className="mt-4 w-full" disabled={!canCreate || pending} onClick={() => {
          setMessage(""); setEditing(null); setTitle("");
          setStartsAt(localDateTimeValue(new Date(Date.now() + 2 * 60 * 60_000)));
          setCreateOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Start a listing
        </Button>
        {!canCreate ? (
          <p className="mt-2 text-xs text-muted-foreground">You have {hub.maxActiveSlots} open listings. Close one to create another.</p>
        ) : null}
      </div>

      {message ? <p role="status" className="mb-4 rounded-xl bg-secondary px-3 py-2 text-sm">{message}</p> : null}

      {inbox.length > 0 ? (
        <section className="mb-6 space-y-3" aria-labelledby="interest-inbox-heading">
          <h2 id="interest-inbox-heading" className="text-sm font-semibold">Interest inbox</h2>
          <p className="text-xs leading-5 text-muted-foreground">Existing requests stay here when a listing closes. You can decide before its meetup time.</p>
          {inbox.map((item) => (
            <article key={item.id} className={`rounded-2xl border border-border bg-card p-4 ${item.id === focusedId ? "ring-2 ring-primary" : ""}`}>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { timeZone: item.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt))}</p>
              <div className="mt-3 space-y-2">
                {item.interestedPeople.filter((person) => person.status === "pending").map((person) => (
                  <div key={person.userId} className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/60 p-2.5">
                    <Link href={discoveryProfileHref(person.username)} className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg">
                      <UserAvatar src={person.avatarUrl} name={person.name} size="xs" decorative />
                      <span className="truncate text-sm font-medium">{person.name}</span>
                    </Link>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ action: "decide", id: item.id, userId: person.userId, response: "declined" })}>Pass</Button>
                    <Button size="sm" disabled={pending || item.attendeeCount >= item.maxAttendees || (item.meetupStatus != null && item.meetupStatus !== "active")} onClick={() => run({ action: "decide", id: item.id, userId: person.userId, response: "accepted" })}>Accept</Button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {[
        { title: "Your listings", items: openListings },
        { title: "Closed listings", items: closedListings }
      ].filter((section) => section.items.length > 0).map((section) => (
        <section key={section.title} className="mb-6 space-y-3" aria-label={section.title}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <span className="text-xs text-muted-foreground">{section.items.length}</span>
          </div>
          {section.items.map((item) => (
            <article key={item.id} className={`rounded-[24px] border border-border bg-card p-4 ${item.id === focusedId ? "ring-2 ring-primary" : ""}`}>
              <div className="flex gap-3">
                <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl"><DiscoveryArtwork category={item.category} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{section.title === "Your listings" ? discoveryTimeLeft(item.listingExpiresAt, nowMs) : Date.parse(item.startsAt) <= nowMs ? "Meetup time passed" : item.status === "matched" ? "Matched · listing closed" : "Listing closed"}{item.attendeeCount > 0 ? ` · ${item.attendeeCount} going` : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat("en", { timeZone: item.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt))}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {section.title === "Your listings" ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => {
                    setEditing(item); setTitle(item.title); setCategory(item.category);
                    setStyle(item.style); setDuration(item.listingDurationMinutes as 0 | 30 | 60 | 120 | 240);
                    setStartsAt(localDateTimeValue(new Date(item.startsAt))); setMessage(""); setCreateOpen(true);
                  }}><Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Edit</Button>
                ) : null}
                {item.meetupId ? <Link href={`/meet-up?meetup=${item.meetupId}`} className="focus-ring inline-flex min-h-10 items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Open Meetup</Link> : null}
                {item.conversationId ? <Link href={conversationHref(item.conversationId)} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Chat</Link> : null}
                {section.title === "Closed listings" && item.renewable ? (
                  <Button size="sm" variant="outline" disabled={pending || !canCreate} onClick={() => run({ action: "refresh", id: item.id })}><RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Renew</Button>
                ) : null}
                {section.title === "Your listings" ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run({ action: "close", id: item.id })}>Close listing</Button>
                ) : <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
                  if (window.confirm("Delete this listing and clear any unanswered requests? Its arranged Meetup and chat will stay.")) run({ action: "delete", id: item.id });
                }}><Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Delete</Button>}
              </div>
              {section.title === "Closed listings" && Date.parse(item.startsAt) > nowMs && item.refreshCount >= 2 ? <p className="mt-2 text-xs text-muted-foreground">Renewed twice. Start a new listing if you want to invite more people.</p> : null}
              {section.title === "Closed listings" && item.renewable && !canCreate ? <p className="mt-2 text-xs text-muted-foreground">Close an open listing to free a slot before renewing.</p> : null}
            </article>
          ))}
        </section>
      ))}

      {hub.requests.length > 0 ? (
        <section className="mb-6 space-y-3" aria-label="My interest requests">
          <h2 className="text-sm font-semibold">My interest requests</h2>
          {hub.requests.map((item) => (
            <article key={item.id} className={`rounded-2xl border border-border bg-card p-4 ${item.id === focusedId ? "ring-2 ring-primary" : ""}`}>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.myInterestStatus === "accepted" ? "Accepted" : item.myInterestStatus === "declined" ? "Not selected" : item.myInterestStatus === "withdrawn" ? "Withdrawn" : Date.parse(item.startsAt) <= nowMs ? "Meetup time passed" : "Awaiting the creator’s response"}</p>
              {item.myInterestStatus === "pending" && Date.parse(item.startsAt) > nowMs && Date.parse(item.listingExpiresAt) <= nowMs ? <p className="mt-1 text-xs text-muted-foreground">The listing closed. Your request can still be reviewed before the meetup starts.</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {item.myInterestStatus === "pending" ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ action: "withdraw", id: item.id })}>Withdraw interest</Button> : null}
                {item.myInterestStatus === "accepted" && item.meetupId ? <Link href={`/meet-up?meetup=${item.meetupId}`} className="focus-ring inline-flex min-h-10 items-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Open Meetup</Link> : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="nearby-discovery-heading">
        <div className="flex items-center justify-between">
          <h2 id="nearby-discovery-heading" className="text-sm font-semibold">Nearby</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{nearby.length} open</span>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={refreshNearby} aria-label="Refresh nearby listings">
              <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </div>
        {nearby.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-border p-6 text-center">
            <Users className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Nothing nearby right now</p>
            <p className="mt-1 text-xs text-muted-foreground">Start something and give nearby people a reason to join.</p>
          </div>
        ) : nearby.map((item) => (
          <ListingCard
            key={item.id}
            item={item}
            nowMs={nowMs}
            pending={pending}
            onOpen={() => setSelectedId(item.id)}
            onInterest={() => run({ action: "interest", id: item.id })}
            onWithdraw={() => run({ action: "withdraw", id: item.id })}
          />
        ))}
      </section>

      <Modal
        open={createOpen}
        onOpenChange={(open) => { if (!pending) setCreateOpen(open); }}
        variant="sheet"
        title={editing ? "Edit your listing" : "Start a listing"}
        description={editing ? "Update the title, interest or meetup time. Changes also update the linked Meetup and chat." : "Short, clear and easy to scan."}
        footer={<Button type="button" onClick={create} disabled={pending || title.trim().length < 2 || wordCount > 5 || (!editing && !canCreate)}>{pending ? "Saving…" : editing ? "Save changes" : "Publish nearby"}</Button>}
      >
        <div className="space-y-5">
          {message ? <p role="status" className="rounded-xl bg-secondary px-3 py-2 text-sm">{message}</p> : null}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Short title</span>
            <input className={inputClass} value={title} maxLength={40} onChange={(event) => setTitle(event.target.value)} placeholder="Coffee and conversation" />
            <span className={`text-xs ${wordCount > 5 ? "text-destructive" : "text-muted-foreground"}`}>{wordCount}/5 words</span>
          </label>

          <fieldset disabled={Boolean(editing) || pending}>
            <p className="mb-2 text-sm font-medium">Who are you hoping to meet?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setStyle("one_to_one")} aria-pressed={style === "one_to_one"} className={`rounded-2xl border p-3 text-left text-sm ${style === "one_to_one" ? "border-primary bg-primary/8" : "border-border"}`}>
                <UserRound className="mb-2 h-5 w-5" aria-hidden="true" />
                <span className="font-semibold">One person</span>
                <span className="mt-1 block text-xs text-muted-foreground">A simple 1-to-1 meetup</span>
              </button>
              <button type="button" onClick={() => setStyle("group")} aria-pressed={style === "group"} className={`rounded-2xl border p-3 text-left text-sm ${style === "group" ? "border-primary bg-primary/8" : "border-border"}`}>
                <Users className="mb-2 h-5 w-5" aria-hidden="true" />
                <span className="font-semibold">Small group</span>
                <span className="mt-1 block text-xs text-muted-foreground">Up to six people total</span>
              </button>
            </div>
            {editing ? <p className="mt-2 text-xs text-muted-foreground">The group size stays the same after publishing.</p> : null}
          </fieldset>

          <div>
            <p className="mb-2 text-sm font-medium">Interest</p>
            <div className="flex flex-wrap gap-2">
              {MEETUP_DISCOVERY_CATEGORY_OPTIONS.map((option) => (
                <button key={option.id} type="button" onClick={() => setCategory(option.id)} aria-pressed={category === option.id} className={`rounded-full border px-3 py-2 text-xs font-medium ${category === option.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                  {option.emoji} {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block min-w-0 space-y-1.5 overflow-hidden">
            <span className="text-sm font-medium">When are you hoping to meet?</span>
            <input className={inputClass} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            <span className="block text-xs text-muted-foreground">Today is fine — choose a time at least one minute from now.</span>
            {editing?.meetupId ? <span className="block text-xs text-muted-foreground">Changing the time asks accepted people to confirm again.</span> : null}
          </label>

          <fieldset disabled={Boolean(editing) || pending}>
            <p className="mb-2 text-sm font-medium">Keep this listing open for</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {([0,30,60,120,240] as const).map((minutes) => (
                <button key={minutes} type="button" onClick={() => setDuration(minutes)} aria-pressed={duration === minutes} className={`rounded-xl border px-2 py-2 text-xs font-semibold ${duration === minutes ? "border-primary bg-primary/8 text-primary" : "border-border"}`}>
                  {minutes === 0 ? "Until meetup starts" : minutes < 60 ? "30m" : `${minutes / 60}h`}
                </button>
              ))}
            </div>
            {editing ? <p className="mt-2 text-xs text-muted-foreground">Editing does not extend the listing. Renew a closed listing to reopen it.</p> : null}
          </fieldset>

          <div className="rounded-2xl bg-secondary/70 p-3 text-xs leading-5 text-muted-foreground">
            <Clock3 className="mr-1 inline h-4 w-4" aria-hidden="true" />
            Up to six people can express interest at once. Closing the listing stops new requests; existing requests stay in your inbox until the meetup starts. When someone is accepted, Mad Buddy creates the scheduled Meetup and private chat.
          </div>
        </div>
      </Modal>

      <Modal
        open={selected !== null}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        variant="sheet"
        title={selected?.title ?? "Meetup"}
        description={selected ? `${discoveryCategoryLabel(selected.category)} · Nearby` : undefined}
      >
        {selected ? (
          <div className="space-y-4">
            {message ? <p role="status" className="rounded-xl bg-secondary px-3 py-2 text-sm">{message}</p> : null}
            <div className="h-44 overflow-hidden rounded-2xl"><DiscoveryArtwork category={selected.category} /></div>
            <div className="flex items-center gap-3">
              <UserAvatar src={selected.creatorAvatarUrl} name={selected.creatorName} size="sm" decorative />
              <div>
                <p className="font-semibold">{selected.creatorName}</p>
                <p className="text-xs text-muted-foreground">{selected.style === "group" ? "Small group meetup" : "One-to-one meetup"}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-secondary/60 p-3 text-sm">
              {new Intl.DateTimeFormat("en", { timeZone: selected.timezone, dateStyle: "full", timeStyle: "short" }).format(new Date(selected.startsAt))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              The exact meetup point is agreed only after people match. Your live location is never shown on this discovery card.
            </p>
            {selected.myInterestStatus === "accepted" && selected.meetupId ? (
              <Link href={`/meet-up?meetup=${selected.meetupId}`} className="focus-ring inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Open Meetup</Link>
            ) : selected.myInterestStatus === "pending" ? (
              <Button variant="outline" className="w-full" disabled={pending} onClick={() => run({ action: "withdraw", id: selected.id })}>Withdraw interest</Button>
            ) : (
              <Button className="w-full" disabled={pending || selected.status !== "active" || Date.parse(selected.listingExpiresAt) <= nowMs || selected.interestCount >= selected.interestLimit} onClick={() => run({ action: "interest", id: selected.id })}>Interested</Button>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function MeetNewPeopleSafety({
  open,
  onOpenChange,
  onContinue
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Meeting someone new"
      description="A quick safety reminder before you browse."
      footer={<Button type="button" onClick={onContinue}>I understand · continue</Button>}
    >
      <div className="space-y-3">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="text-sm leading-6">
          People in this section may be strangers. Meet in a public place when possible and trust your judgement.
        </p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Don’t share your home address or sensitive personal details too early.</li>
          <li>• Tell someone you trust where you’re going.</li>
          <li>• Use block or report if anything feels wrong.</li>
          <li>• Mad Buddy helps you coordinate; it cannot guarantee another person’s behaviour.</li>
        </ul>
      </div>
    </Modal>
  );
}
