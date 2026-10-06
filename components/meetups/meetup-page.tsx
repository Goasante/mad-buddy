"use client";

import { Link, useRevalidate } from "@/lib/platform";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, CalendarClock, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ARRIVAL_LABELS, MEETUP_TITLES, canUpdateArrival, isMeetupHintFresh, meetupPhase, type Meetup, type MeetupMode, type MeetupUpdate } from "@/lib/meetups/rules";
import { useFeedRefresh } from "@/hooks/use-feed-refresh";
import { useCountdownResume } from "@/hooks/use-countdown-clock";

export type MeetupSaveAction = (input: unknown, create?: boolean) => Promise<{ ok: boolean; message: string }>;

const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm";
const panelClass = "rounded-2xl border border-border bg-card p-4 space-y-4";
function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function MeetupPage({ viewerId, meetups, muddies, focusedId, saveAction, reloadAction }: {
  viewerId: string; meetups: Meetup[]; muddies: { id: string; name: string }[]; focusedId?: string;
  saveAction: MeetupSaveAction; reloadAction?: () => Promise<void>;
}) {
  const revalidate = useRevalidate();
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(async () => { if (reloadAction) await reloadAction(); else revalidate(); }, [reloadAction, revalidate]);
  useFeedRefresh(refresh);
  const active = meetups.filter((m) => m.status === "active");
  const past = meetups.filter((m) => m.status !== "active");
  const focusedPast = past.find((m) => m.id === focusedId);
  return <main className="mx-auto max-w-xl space-y-5 px-2 py-4 pb-24">
    <header className="space-y-3">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft size={16} /> Home</Link>
      <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Meet Up</h1><p className="text-sm text-muted-foreground">Make it happen, together.</p></div><Button onClick={() => setCreating(!creating)}>{creating ? "Close" : "Arrange"}</Button></div>
      <p className="text-sm text-muted-foreground">An invitation, a time, and your own arrival updates. No exact-location sharing or automatic arrival claims.</p>
    </header>
    {creating && <CreateMeetup muddies={muddies} saveAction={saveAction} onCreated={() => { setCreating(false); void refresh(); }} />}
    {focusedId && !meetups.some((m) => m.id === focusedId) && <p role="status" className={panelClass}>This meetup is no longer available to you.</p>}
    {!active.length && <section className={panelClass}><Users className="text-muted-foreground" /><h2 className="font-semibold">Who are you meeting?</h2><p className="text-sm text-muted-foreground">Invite a Muddy over, ask to go to their place, or agree somewhere to meet.</p><Button onClick={() => setCreating(true)}>Arrange a meetup</Button></section>}
    {active.map((m) => <MeetupCard key={m.id} meetup={m} viewerId={viewerId} focused={m.id === focusedId} saveAction={saveAction} refreshAction={refresh} />)}
    {focusedPast && <MeetupCard meetup={focusedPast} viewerId={viewerId} focused saveAction={saveAction} refreshAction={refresh} />}
    {past.some((m) => m.id !== focusedId) && <details><summary className="cursor-pointer text-sm text-muted-foreground">Past & cancelled ({past.length - (focusedPast ? 1 : 0)})</summary><div className="mt-3 space-y-3">{past.filter((m) => m.id !== focusedId).map((m) => <MeetupCard key={m.id} meetup={m} viewerId={viewerId} focused={false} saveAction={saveAction} refreshAction={refresh} />)}</div></details>}
    <p className="text-center text-sm text-muted-foreground">Looking for your existing plans? <Link href="/plans" className="underline">Your Plans</Link></p>
  </main>;
}

function CreateMeetup({ muddies, onCreated, saveAction }: { muddies: { id: string; name: string }[]; onCreated: () => void; saveAction: MeetupSaveAction }) {
  const [mode, setMode] = useState<MeetupMode>("come_over");
  const [when, setWhen] = useState("now");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string | null>(null);
  return <form method="post" className={panelClass} onChange={() => { requestKey.current = null; }} onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const localTime = String(data.get("startsAt") ?? "");
    if (when === "later" && (!localTime || !Number.isFinite(new Date(localTime).getTime()))) { setMessage("Choose a date and time."); return; }
    requestKey.current ??= crypto.randomUUID();
    const input = { mode, participantIds: data.getAll("participants"), placeLabel: data.get("place"), note: data.get("note"),
      when, ...(when === "later" ? { startsAt: new Date(localTime).toISOString() } : {}),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, requestKey: requestKey.current };
    startTransition(async () => {
      try { const result = await saveAction(input, true); setMessage(result.message); if (result.ok) onCreated(); }
      catch { setMessage("Could not save. Try again; your invitation won't be duplicated."); }
    });
  }}>
    <h2 className="font-semibold">Arrange a meetup</h2>
    <fieldset disabled={pending} className="space-y-4">
      <label className="block space-y-1 text-sm"><span>Where?</span><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as MeetupMode)}>
        <option value="come_over">At your place · Invite them over</option><option value="coming_to">At their place · Ask to come over</option><option value="meet_somewhere">Meet somewhere</option>
      </select></label>
      <fieldset><legend className="mb-2 text-sm">{mode === "coming_to" ? "Choose one Muddy" : "Invite Muddies"}</legend>
        {!muddies.length && <p className="text-sm text-muted-foreground">Add a Muddy before arranging a meetup.</p>}
        <div className="max-h-44 overflow-y-auto space-y-2">{muddies.map((m) => <label key={`${mode}-${m.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"><input name="participants" type={mode === "coming_to" ? "radio" : "checkbox"} value={m.id} />{m.name}</label>)}</div>
      </fieldset>
      <label className="block space-y-1 text-sm"><span>Agreed place</span><input name="place" required maxLength={120} placeholder={mode === "meet_somewhere" ? "e.g. Café entrance" : "e.g. My place · ring the doorbell"} className={inputClass} /></label>
      <p className="text-xs text-muted-foreground">Only invited participants see this. Use a familiar label; an exact address is optional.</p>
      <label className="block space-y-1 text-sm"><span>When?</span><select value={when} onChange={(e) => setWhen(e.target.value)} className={inputClass}><option value="now">Now</option><option value="later">Later · choose date and time</option></select></label>
      {when === "later" && <label className="block space-y-1 text-sm"><span>Date & time (your timezone)</span><input name="startsAt" type="datetime-local" required className={inputClass} /></label>}
      <label className="block space-y-1 text-sm"><span>Note (optional)</span><textarea name="note" maxLength={200} className={inputClass} /></label>
      <Button type="submit" disabled={!muddies.length}>{pending ? "Sending…" : "Send invitation"}</Button>
    </fieldset>
    {!!message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

function MeetupCard({ meetup: m, viewerId, focused, saveAction, refreshAction }: { meetup: Meetup; viewerId: string; focused: boolean; saveAction: MeetupSaveAction; refreshAction: () => Promise<void> }) {
  const card = useRef<HTMLElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [delay, setDelay] = useState(15);
  const [now, setNow] = useState<number | null>(null);
  useCountdownResume(setNow, 30_000);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = window.setTimeout(tick, 0);
    return () => { window.clearTimeout(initial); };
  }, []);
  useEffect(() => { if (focused) card.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focused]);
  const mine = m.members.find((p) => p.userId === viewerId);
  const creator = m.creatorId === viewerId;
  const open = m.status === "active";
  const ready = now !== null && canUpdateArrival(m, viewerId, now);
  function update(command: Record<string, unknown>) {
    const signature = JSON.stringify({ ...command, revision: m.revision });
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    const input = { ...command, id: m.id, revision: m.revision, requestKey: retry.current.key } as MeetupUpdate;
    startTransition(async () => {
      try { const result = await saveAction(input); setMessage(result.message); if (result.ok) { retry.current = null; await refreshAction(); } }
      catch { setMessage("Could not save your update. Try again."); }
    });
  }
  function changeTime(action: "suggest" | "reschedule", iso?: string) {
    const time = iso ? new Date(iso) : new Date(date);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now()) { setMessage("Choose a future date and time."); return; }
    update({ action, startsAt: time.toISOString() });
  }
  const confirmed = m.members.filter((p) => p.metAt).length;
  return <article ref={card} className={`${panelClass} ${focused ? "ring-2 ring-primary" : ""}`}>
    <div className="flex justify-between gap-2"><h2 className="font-semibold">{MEETUP_TITLES[m.mode]}</h2><span className="text-xs text-muted-foreground">{open ? `Your response: ${mine?.response ?? "invited"}` : m.status}</span></div>
    <div className="space-y-1 text-sm"><p className="flex gap-2"><MapPin size={16} className="shrink-0" />{m.placeLabel}</p><p className="flex gap-2"><CalendarClock size={16} className="shrink-0" />{timeLabel(m.startsAt, m.timezone)} · {m.timezone}</p>{m.note && <p>{m.note}</p>}</div>
    <ul className="space-y-2 text-sm">{m.members.map((p) => <li key={p.key} className="flex justify-between gap-3"><span>{p.userId === viewerId ? "You" : p.name}{p.userId === m.hostId ? " · Host" : ""}{p.nearby && p.observedAt && now !== null && isMeetupHintFresh(p.observedAt, now) && <span className="block text-xs text-primary">Nearby · not arrival confirmation</span>}</span><span className="text-right text-muted-foreground">{p.metAt ? "Confirmed meeting" : p.response !== "accepted" ? p.response : `${ARRIVAL_LABELS[p.arrival]}${p.delayMinutes ? ` · ${p.delayMinutes} min` : ""}`}</span></li>)}</ul>
    {confirmed > 0 && <p className="text-sm">{confirmed} {confirmed === 1 ? "person has" : "people have"} confirmed meeting. Each person confirms for themselves.</p>}
    {open && <fieldset disabled={pending} className="space-y-3">
      {mine?.response === "accepted" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={mine.proximityEnabled} onChange={(e) => update({ action: "proximity", enabled: e.target.checked })} className="mt-1" /><span>Allow a Nearby hint for this meetup<span className="block text-xs text-muted-foreground">Only with Muddies who also opt in. No coordinates or distances. Ghost Mode and Privacy Zones still apply. Updates require fresh readings while using the app; this cannot prove arrival at the agreed place.</span></span></label>}
      {!creator && <div className="flex flex-wrap gap-2">{mine?.response !== "accepted" && <Button onClick={() => update({ action: "respond", response: "accepted" })}>Accept</Button>}{mine?.response !== "declined" && <Button variant="outline" onClick={() => update({ action: "respond", response: "declined" })}>{mine?.response === "accepted" ? "Can't make it" : "Decline"}</Button>}</div>}
      {ready && <><div className="flex flex-wrap gap-2">{(["on_my_way", "here", "left"] as const).map((arrival) => <Button key={arrival} variant="outline" onClick={() => update({ action: "arrival", arrival })}>{ARRIVAL_LABELS[arrival]}</Button>)}</div>
        <div className="flex items-center gap-2"><label className="text-sm">Late by <input type="number" min={1} max={120} value={delay} onChange={(e) => setDelay(Number(e.target.value))} className="w-16 rounded border bg-background px-2 py-1" /> min</label><Button variant="outline" onClick={() => update({ action: "arrival", arrival: "late", delayMinutes: delay })}>Send update</Button></div>
        {!mine?.metAt && <Button onClick={() => update({ action: "met" })}>We met · confirm for me</Button>}
      </>}
      {!ready && <p className="text-xs text-muted-foreground">Arrival updates open two hours before the time, once you and another participant have accepted (including the host).</p>}
      {now !== null && meetupPhase(m, now) === "unconfirmed" && !mine?.metAt && <p className="text-sm">Did you meet? Confirm if you did, or choose another time. An unconfirmed meetup doesn&apos;t mean it failed.</p>}
      <details><summary className="cursor-pointer text-sm">{creator ? "Reschedule or end" : "Suggest another time"}</summary><div className="mt-3 space-y-3">
        <label className="block space-y-1 text-sm"><span>New date & time (your timezone)</span><input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} /></label>
        <Button variant="outline" onClick={() => changeTime(creator ? "reschedule" : "suggest")}>{creator ? "Reschedule & ask everyone again" : "Suggest time"}</Button>
        {creator && m.members.filter((p) => p.suggestedStartAt).map((p) => <div key={p.key} className="text-sm"><p>{p.name} suggests {timeLabel(p.suggestedStartAt!, m.timezone)}</p><Button variant="outline" onClick={() => changeTime("reschedule", p.suggestedStartAt!)}>Use this time & ask again</Button></div>)}
        {(creator || m.hostId === viewerId) && <Button variant="outline" onClick={() => { if (window.confirm("Cancel this meetup for everyone?")) update({ action: "cancel" }); }}>Cancel meetup</Button>}
        {creator && <Button variant="outline" onClick={() => { if (window.confirm("End this meetup? This won't confirm anyone's arrival.")) update({ action: "end" }); }}>End meetup</Button>}
      </div></details>
    </fieldset>}
    {!!message && <p role="status" className="text-sm">{message}</p>}
  </article>;
}
