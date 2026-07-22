import { HelpCenterPage } from "@/components/help/help-center-page";
import { getMySupportThreadsAction } from "@/app/(app)/help-actions";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const threads = await getMySupportThreadsAction();
  return <HelpCenterPage initialThreads={threads} />;
}
