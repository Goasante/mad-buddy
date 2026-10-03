"use client";
import Link from "next/link";
export default function BlogError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-6 py-24"><h1 className="text-3xl font-semibold">The journal couldn’t load.</h1><p className="my-5">Your account and the rest of Mad Buddy are unaffected. Try the journal again.</p><button onClick={reset} className="focus-ring mr-5 rounded-full border px-5 py-3">Try again</button><Link href="/about" className="focus-ring underline">About Mad Buddy</Link></main>;
}
