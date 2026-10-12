import type { Metadata } from "next";
import Link from "next/link";
import { MA_BOOK } from "@/lib/books/product";
import { BookAccess } from "./purchase-access";
import styles from "../book.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Access your book", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function AccessPage({ searchParams }: { searchParams: Promise<{ token?: string; reference?: string; trxref?: string }> }) {
  const query = await searchParams;
  const token = typeof query.token === "string" && query.token.length <= 1024 ? query.token : "";
  const ref = query.reference ?? query.trxref ?? "";
  const reference = typeof ref === "string" && /^MAB-[a-f0-9-]{36}$/.test(ref) ? ref : "";
  return <div className={styles.book}><main className={`${styles.narrow} ${styles.access}`}><p className={styles.eyebrow}>{MA_BOOK.title}</p><h1>Your personal copy.</h1><p>Download your book after payment is verified, or request a fresh link using your purchase email.</p><BookAccess initialToken={token} reference={reference}/><p><Link href={MA_BOOK.path}>← Back to the book</Link></p><p className={styles.note}>Purchase support: <a href="mailto:godfred@mad-buddy.com">godfred@mad-buddy.com</a></p></main></div>;
}
