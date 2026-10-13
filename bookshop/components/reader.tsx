"use client";
import { useRef, useState } from "react";
import type { Book, ShopConfig } from "@/lib/shop/schema";
const ghs = (minor: number) => "GH₵" + (minor / 100).toFixed(2);
export function BookActions({
  book,
  settings,
  supportOnly = false,
}: {
  book: Book;
  settings: ShopConfig["settings"];
  supportOnly?: boolean;
}) {
  const [measure, setMeasure] = useState(false);
  const [showSupport, setShowSupport] = useState(
    supportOnly || book.mode === "paid"
  );
  const [usd, setUsd] = useState("5");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const downloadDialog = useRef<HTMLDialogElement>(null);
  const supportForm = useRef<HTMLFormElement>(null);
  function openDownload() {
    setMessage("");
    downloadDialog.current?.showModal();
  }
  function openSupport() {
    downloadDialog.current?.close();
    setShowSupport(true);
    requestAnimationFrame(() => {
      supportForm.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  async function download() {
    setBusy(true);
    setMessage("Preparing your copy…");
    try {
      const r = await fetch("/api/shop/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId: book.id, measure }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = book.slug + ".pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDownloaded(true);
      downloadDialog.current?.close();
      setMessage(
        "Your copy is ready. If your browser opened the PDF, use its save or share option to keep it."
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const amount =
    book.mode === "paid" && !supportOnly
      ? book.priceMinor
      : Math.round(Number(usd) * settings.ghsPerUsd * 100);
  async function checkout(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("Opening secure checkout…");
    try {
      const purchase = book.mode === "paid" && !supportOnly;
      const r = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          email,
          kind: purchase ? "purchase" : "support",
          ...(!purchase ? { usd: Number(usd), rate: settings.ghsPerUsd } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      window.location.assign(d.url);
    } catch (e) {
      setBusy(false);
      setMessage(e instanceof Error ? e.message : "Please try again.");
    }
  }
  return (
    <div className="reader-actions">
      {!supportOnly && book.mode !== "paid" && (
        <div className="action-row">
          <button className="button gold" onClick={openDownload} disabled={busy}>
            Download free
          </button>
          {book.mode === "support" && (
            <button
              className="button outline"
              onClick={() => setShowSupport(!showSupport)}
            >
              Support the next book
            </button>
          )}
        </div>
      )}
      {!supportOnly && book.mode !== "paid" && (
        <dialog
          ref={downloadDialog}
          className="download-dialog"
          aria-labelledby={"download-title-" + book.id}
          aria-describedby={"download-copy-" + book.id}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const rect = event.currentTarget.getBoundingClientRect();
              if (event.clientX < rect.left || event.clientX > rect.right ||
                  event.clientY < rect.top || event.clientY > rect.bottom) {
                event.currentTarget.close();
              }
            }
          }}
        >
          <button className="dialog-close" type="button" aria-label="Close download pop-up"
            onClick={() => downloadDialog.current?.close()}>Close</button>
          <p className="eyebrow">Your complimentary copy</p>
          <h2 id={"download-title-" + book.id}>Your next acquisition starts here.</h2>
          <p id={"download-copy-" + book.id}>Download your free copy below. If it earns a place in your deal toolkit, help fund the next edition. No term sheet required.</p>
          <div className="action-row">
            <button className="button gold" type="button" onClick={download} disabled={busy} autoFocus>
              {busy ? "Preparing your copy…" : "Download now"}
            </button>
            <button className="button outline" type="button" onClick={openSupport} disabled={busy}>
              Support the next edition
            </button>
          </div>
          <p className="fine">Your download is free. Contributions are entirely optional.</p>
          <p className="dialog-status" role="status" aria-live="polite">{message}</p>
        </dialog>
      )}
      {downloaded && (
        <div className="reader-note">
          <strong>Thank you for reading.</strong>
          <p>
            If you find the guide useful, even a small contribution helps bring
            the next practical book to life.
          </p>
          <button className="text-link" onClick={openSupport}>
            Support the next book
          </button>
        </div>
      )}
      {showSupport && (
        <form ref={supportForm} className="support-form" onSubmit={checkout}>
          <h3>
            {book.mode === "paid" && !supportOnly
              ? "Get your personal copy"
              : "Support the next book"}
          </h3>
          {(book.mode !== "paid" || supportOnly) && (
            <>
              <p>
                This book is yours to read for free. If it helps you make your
                next move, consider supporting the next one.
              </p>
              <div className="presets">
                {settings.presets.map((n) => (
                  <button
                    aria-pressed={Number(usd) === n}
                    type="button"
                    key={n}
                    onClick={() => setUsd(String(n))}
                  >
                    US${n}
                  </button>
                ))}
              </div>
              <label>
                Custom amount (USD)
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="0.01"
                  value={usd}
                  onChange={(e) => setUsd(e.target.value)}
                  required
                />
              </label>
              <small>
                Displayed conversion: US$1 = GH₵{settings.ghsPerUsd.toFixed(2)}{" "}
                · Set {settings.rateDate}. Dollar equivalents are approximate;
                your bank’s rate and fees may differ.
              </small>
            </>
          )}
          <p className="charge">
            You’ll be charged{" "}
            <strong>{Number.isFinite(amount) ? ghs(amount) : "—"}</strong>
          </p>
          <label>
            Receipt email
            <input
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <p className="fine">
            By continuing, you agree to the <a href="/terms">bookshop terms</a>{" "}
            and acknowledge its <a href="/privacy">privacy notice</a>.
          </p>
          <button
            className="button gold"
            disabled={
              busy || !settings.paymentsEnabled || !Number.isFinite(amount)
            }
          >
            {settings.paymentsEnabled
              ? (book.mode === "paid" && !supportOnly
                  ? "Buy for "
                  : "Contribute ") + ghs(amount)
              : "Contributions opening soon"}
          </button>
          {!supportOnly && book.mode !== "paid" && (
            <button
              className="text-link"
              type="button"
              disabled={busy}
              onClick={download}
            >
              Skip and download free
            </button>
          )}
        </form>
      )}
      {!supportOnly && (
        <label className="fine">
          <input
            type="checkbox"
            checked={measure}
            onChange={(e) => setMeasure(e.target.checked)}
          />{" "}
          Optional: remember this browser for anonymous download counts.
        </label>
      )}
      <p role="status" aria-live="polite" className="status">
        {message}
      </p>
      {!supportOnly && (
        <small>
          Personal and internal professional use. Share the book-page link;
          resale and redistribution require permission.
        </small>
      )}
    </div>
  );
}
