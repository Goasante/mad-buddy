import { notFound } from "next/navigation";
import { UpForVisualHarness } from "@/components/hangout/upfor-visual-harness";

export const dynamic = "force-static";

export default function UpForCardsVisualReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UpForVisualHarness />;
}
