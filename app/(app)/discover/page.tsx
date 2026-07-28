import {
  discoverSocializePeopleAction,
  getCurrentSocializeAction
} from "@/app/(app)/socialize-actions";
import { SocializePage } from "@/components/socialize/socialize-page";
import { isSocializeEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const admin = createSupabaseAdminClient();
  if (!(await isSocializeEnabled(admin))) redirect("/dashboard");

  const user = await getCurrentUser();
  const [profileResult, session] = await Promise.all([
    user
      ? admin.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getCurrentSocializeAction()
  ]);
  const people = session ? await discoverSocializePeopleAction() : [];

  return (
    <SocializePage
      initialSession={session}
      initialPeople={people}
      myAvatarUrl={profileResult.data?.avatar_url ?? null}
      myName={profileResult.data?.full_name?.trim() ?? ""}
    />
  );
}
