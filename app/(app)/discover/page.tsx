import {
  discoverSocializePeopleAction,
  getCurrentSocializeAction
} from "@/app/(app)/socialize-actions";
import { SocializePage } from "@/components/socialize/socialize-page";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await getCurrentSocializeAction();
  const people = session ? await discoverSocializePeopleAction() : [];
  return <SocializePage initialSession={session} initialPeople={people} />;
}
