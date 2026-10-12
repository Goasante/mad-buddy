"use client";
import { useState, type FormEvent } from "react";
import { MA_BOOK } from "@/lib/books/product";
import styles from "./book.module.css";

export function BookCheckout({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !enabled) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/books/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: MA_BOOK.id, email }) });
      const data = await response.json();
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error ?? "Checkout could not be opened.");
      const url = new URL(data.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") throw new Error("Checkout could not be opened.");
      window.location.assign(url.toString());
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); setBusy(false); }
  }
  return <form onSubmit={checkout} className={styles.checkout}>
    <label htmlFor="book-email">Email for your personal copy</label>
    <input id="book-email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@company.com" disabled={busy || !enabled} />
    <button className={styles.primary} disabled={!enabled || busy} type="submit">{busy ? "Opening secure checkout…" : enabled ? "Buy the book · GH₵200" : "Purchases open soon"}</button>
    <p className={styles.note}>One-time payment through Paystack. No Mad Buddy account needed. Your email is used for delivery and purchase support.</p>
    <p className={styles.note}>Your personal-use PDF includes your purchase email and order reference. Please do not redistribute it.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
