import { notFound } from "next/navigation";
import { SmartCardReview } from "@/components/journey/smart-card-review";

export const dynamic = "force-dynamic";

export default function SmartCardReviewPage() {
  if (process.env.VERCEL_ENV !== "preview") notFound();
  return <SmartCardReview />;
}
