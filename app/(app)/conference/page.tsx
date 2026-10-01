import { redirect } from "next/navigation";
import { ConferencePage } from "@/components/conference/conference-page";
import { loadConferenceFeed } from "@/lib/conference/server";
import { getCurrentIdentity } from "@/lib/supabase/auth";
import type { ConferenceSort } from "@/lib/conference/types";

export const dynamic = "force-dynamic";

export default async function ConferenceRoute({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const [identity, params] = await Promise.all([getCurrentIdentity(), searchParams]);
  if (!identity) redirect("/login?next=/conference");

  const sort: ConferenceSort = params.sort === "hot" ? "hot" : "fresh";
  const feed = await loadConferenceFeed(identity.id, sort);
  return <ConferencePage feed={feed} sort={sort} />;
}
