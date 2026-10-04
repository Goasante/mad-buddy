import { notFound } from "next/navigation";
import { FeatureLockReview } from "@/components/features/feature-lock-review";

export const dynamic = "force-dynamic";

/** Isolated visual fixture: no accounts, credentials, queries or private data. */
export default function FeatureLockReviewPage() {
  if (process.env.VERCEL_ENV !== "preview") notFound();
  return <FeatureLockReview />;
}
