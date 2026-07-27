import {
  discoverSocializePeopleAction,
  getCurrentSocializeAction
} from "@/app/(app)/socialize-actions";
import { SocializePage } from "@/components/socialize/socialize-page";
import { isSocializeEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  if (!(await isSocializeEnabled(createSupabaseAdminClient()))) redirect("/dashboard");
  const session = await getCurrentSocializeAction();
  const people = session ? await discoverSocializePeopleAction() : [];
  return <SocializePage initialSession={session} initialPeople={people} />;
}
