import Link from "next/link";
import { FailurePage } from "@/components/front-door/failure-page";

export default function NotFound() {
  return (
    <FailurePage
      eyebrow="404"
      title="This page isn't here."
      description="The link may be old, mistyped, or no longer available. Mad Buddy's proximity experience is designed not to expose another person's exact location, but this page simply could not be found."
    >
      <Link href="/" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white dark:bg-[#E88C2B] dark:text-[#2A120A]">
        Go home
      </Link>
      <Link href="/support" className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border border-[#4E0401]/15 px-5 text-sm font-semibold text-[#4E0401] dark:border-white/15 dark:text-[#FFF8F1]">
        Get support
      </Link>
    </FailurePage>
  );
}
