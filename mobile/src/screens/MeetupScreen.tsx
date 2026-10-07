import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { MeetupPage, type MeetupSaveAction } from "@/components/meetups/meetup-page";
import { meetupSchema, type Meetup } from "@/lib/meetups/rules";
import { meetupDiscoveryHubSchema, type MeetupDiscoveryHub } from "@/lib/meetups/discovery";
import type { MeetupDiscoveryAction } from "@/components/meetups/meet-new-people";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";
import { Spinner } from "../components/Spinner";

const responseSchema = z.object({ meetups: z.array(meetupSchema), muddies: z.array(z.object({ id: z.string().uuid(), name: z.string() })) });
const saveAction: MeetupSaveAction = async (input, create = false) => {
  const result = create ? await api.post<{ ok: boolean; message: string }>("/api/meetups", input)
    : await api.patch<{ ok: boolean; message: string }>("/api/meetups", input);
  return result.ok ? result.data : { ok: false, message: result.error };
};

const discoveryAction: MeetupDiscoveryAction = async (input, create = false) => {
  const result = create
    ? await api.post<{ ok: boolean; message: string; discoveryId?: string }>("/api/meetups/discovery", input)
    : await api.patch<{ ok: boolean; message: string; meetupId?: string; conversationId?: string }>("/api/meetups/discovery", input);
  return result.ok ? result.data : { ok: false, message: result.error };
};

export function MeetupScreen() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [data, setData] = useState<{ meetups: Meetup[]; muddies: { id: string; name: string }[]; discoveryHub: MeetupDiscoveryHub } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [meetupResult, discoveryResult] = await Promise.all([
      api.get<unknown>("/api/meetups"),
      api.get<unknown>("/api/meetups/discovery")
    ]);
    if (!meetupResult.ok) { setError(meetupResult.error); return; }
    if (!discoveryResult.ok) { setError(discoveryResult.error); return; }
    const parsed = responseSchema.safeParse(meetupResult.data);
    const discovery = meetupDiscoveryHubSchema.safeParse(discoveryResult.data);
    if (!parsed.success || !discovery.success) { setError("Could not load your meetups. Try again."); return; }
    setData({ ...parsed.data, discoveryHub: discovery.data });
    setError("");
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  if (!user) return null;
  return <>
    {error && <p role="alert" className="p-4 text-sm">{error}<button className="ml-2 underline" onClick={() => void load()}>Retry</button></p>}
    {!data && !error && <div className="flex justify-center p-10"><Spinner /></div>}
    {data && <MeetupPage
      viewerId={user.id}
      meetups={data.meetups}
      muddies={data.muddies}
      focusedId={params.get("meetup") ?? undefined}
      openNewPeople={params.get("newPeople") === "1"}
      focusedDiscoveryId={params.get("discovery") ?? undefined}
      discoveryHub={data.discoveryHub}
      discoveryAction={discoveryAction}
      saveAction={saveAction}
      reloadAction={load}
      initialNowMs={Date.now()}
    />}
  </>;
}
