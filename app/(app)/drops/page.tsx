import { getDropContextsAction, getMyDropsAction } from "@/app/(app)/drops-actions";
import { DropsPageContent } from "@/components/drops/drops-page";

export const dynamic = "force-dynamic";

export default async function DropsPage() {
  const [drops, contexts] = await Promise.all([getMyDropsAction(), getDropContextsAction()]);
  return <DropsPageContent initialDrops={drops} contexts={contexts} />;
}
