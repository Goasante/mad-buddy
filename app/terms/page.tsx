import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Mad Buddy terms of service.",
  robots: { index: false, follow: false }
};

export default function TermsPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16 text-foreground">
      <section className="glass-panel w-full max-w-xl rounded-[1.35rem] p-6 text-center sm:p-8">
        <BrandMark className="mx-auto h-16 w-16" priority />
        <h1 className="mt-4 text-3xl font-semibold">Terms of Service</h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          The approved Terms of Service copy is being prepared and must be completed before public launch.
        </p>
        {/* TODO(legal): Replace this placeholder with approved Terms copy before production launch. */}
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="font-semibold hover:text-accent">Home</Link>
          <Link href="/privacy" className="font-semibold hover:text-accent">Privacy Policy</Link>
        </div>
      </section>
    </main>
  );
}
