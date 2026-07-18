import Link from "next/link";
import { MapPinOff } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16 text-foreground">
      <section className="glass-panel w-full max-w-md rounded-[1.35rem] p-8 text-center">
        <BrandMark className="mx-auto h-14 w-14" priority />
        <p className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
          <MapPinOff className="h-4 w-4" aria-hidden="true" />
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page isn&apos;t glowing.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Even we don&apos;t know
          where it is, and we don&apos;t track locations.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Open the app</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
