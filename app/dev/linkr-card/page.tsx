import { notFound } from "next/navigation";
import { LinkrCardVisualHarness } from "@/components/linkr/linkr-card-visual-harness";

export const dynamic = "force-static";

export default function LinkrCardVisualReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LinkrCardVisualHarness />;
}
