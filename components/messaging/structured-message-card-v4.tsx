"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Copy, Loader2, MapPin, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { getStructuredMessagePayloadAction } from "@/app/(app)/messaging-structured-share-actions";
import type { StructuredMessagePayload } from "@/lib/messaging/structured-share-v4-types";
import { cn } from "@/lib/utils";

function formatDate(value: string | null) {
  if (!value) return "Time not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not set";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function StructuredMessageCardV4({
  conversationId,
  messageId,
  messageType,
  mine
}: {
  conversationId: string;
  messageId: string;
  messageType: string;
  mine: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<StructuredMessagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let disposed = false;
    void getStructuredMessagePayloadAction({ conversationId, messageId })
      .then((value) => {
        if (!disposed) setPayload(value);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [conversationId, messageId]);

  if (loading) {
    return <div className="grid min-h-20 min-w-[220px] place-items-center"><Loader2 className="h-4 w-4 animate-spin opacity-70 motion-reduce:animate-none" /></div>;
  }
  if (!payload) {
    return <div className="min-w-[210px] py-2 text-xs opacity-65">This shared item is no longer available.</div>;
  }

  const cardClass = cn(
    "mb-1 min-w-[220px] max-w-[300px] rounded-[18px] border p-3 text-left",
    mine ? "border-white/12 bg-white/8 text-[#FEFBF3]" : "border-black/[0.055] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.045]"
  );

  if (payload.kind === "contact") {
    const copyText = [payload.displayName, payload.organization].filter(Boolean).join(" · ");
    return (
      <div className={cardClass}>
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", mine ? "bg-white/12" : "bg-[#E88C2B]/10 text-[#E88C2B]")}><UserRound className="h-4.5 w-4.5" /></span>
          <div className="min-w-0 flex-1"><span className="text-[9px] font-extrabold uppercase tracking-[.12em] opacity-60">Contact</span><strong className="block truncate text-sm">{payload.displayName}</strong>{payload.organization ? <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] opacity-65"><Building2 className="h-3 w-3" />{payload.organization}</span> : null}</div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full opacity-65 transition active:scale-90" aria-label="Copy contact details"><Copy className="h-3.5 w-3.5" /></button>
        </div>
        {copied ? <span className="mt-2 block text-[10px] font-semibold opacity-65">Copied</span> : null}
      </div>
    );
  }

  if (payload.kind === "place") {
    const copyText = [payload.placeName, payload.areaLabel, payload.addressLabel].filter(Boolean).join(" · ");
    return (
      <div className={cardClass}>
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", mine ? "bg-white/12" : "bg-[#E88C2B]/10 text-[#E88C2B]")}><MapPin className="h-4.5 w-4.5" /></span>
          <div className="min-w-0 flex-1"><span className="text-[9px] font-extrabold uppercase tracking-[.12em] opacity-60">{payload.placeKind === "area" ? "Area" : "Place"}</span><strong className="block truncate text-sm">{payload.placeName}</strong>{payload.areaLabel ? <span className="mt-0.5 block truncate text-[11px] opacity-65">{payload.areaLabel}</span> : null}{payload.addressLabel ? <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed opacity-65">{payload.addressLabel}</span> : null}</div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-full opacity-65 transition active:scale-90" aria-label="Copy place details"><Copy className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-2 rounded-xl px-2 py-1.5 text-[10px] opacity-55">Shared as a label — not live location.</div>
        {copied ? <span className="mt-1 block text-[10px] font-semibold opacity-65">Copied</span> : null}
      </div>
    );
  }

  const href = payload.refKind === "plan" ? "/plans" : `/events?event=${payload.refId}`;
  return (
    <button type="button" onClick={() => router.push(href as Route)} className={cn(cardClass, "focus-ring block w-full transition active:scale-[.99]")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", mine ? "bg-white/12" : "bg-[#E88C2B]/10 text-[#E88C2B]")}><CalendarDays className="h-4.5 w-4.5" /></span>
        <span className="min-w-0 flex-1"><span className="text-[9px] font-extrabold uppercase tracking-[.12em] opacity-60">{payload.refKind === "plan" ? "Plan" : "Event"}</span><strong className="block truncate text-sm">{payload.title}</strong><span className="mt-0.5 block truncate text-[11px] opacity-65">{formatDate(payload.startsAt)}</span>{payload.locationLabel ? <span className="mt-1 flex items-center gap-1 truncate text-[11px] opacity-65"><MapPin className="h-3 w-3" />{payload.locationLabel}</span> : null}</span>
      </div>
      <span className="mt-2 block text-[10px] font-bold text-[#E88C2B]">Open {payload.refKind === "plan" ? "Plan" : "Event"}</span>
    </button>
  );
}
