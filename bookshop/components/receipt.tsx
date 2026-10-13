"use client";
import { useEffect, useState } from "react";
export default function Receipt({
  reference,
  token: initialToken,
}: {
  reference?: string;
  token?: string;
}) {
  const [email, setEmail] = useState(""),
    [orderRef, setOrderRef] = useState(reference || "");
  const [token, setToken] = useState(initialToken),
    [message, setMessage] = useState(
      initialToken
        ? "Your receipt link is ready."
        : reference
        ? "Checking payment…"
        : "Use the link in your receipt or return after checkout."
    ),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialToken) return;
    if (!reference) return;
    let active = true;
    fetch("/api/shop/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active) {
          setToken(d.token);
          setMessage(
            d.paid
              ? d.kind === "support"
                ? "Thank you. Your contribution has been verified. A receipt will arrive by email."
                : "Payment verified. Your personal copy is ready."
              : "Payment is not confirmed yet. Refresh shortly; do not pay again."
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [reference, initialToken]);
  async function download() {
    setBusy(true);
    try {
      const r = await fetch("/api/shop/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const u = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = u;
      a.download = "your-personal-book.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      setMessage("Your download is ready.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p role="status">{message}</p>
      {token && (
        <button className="button gold" disabled={busy} onClick={download}>
          Download your personal copy
        </button>
      )}
      <details>
        <summary>Need a fresh access link?</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await fetch("/api/shop/recover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reference: orderRef, email }),
              });
              const d = await r.json();
              setMessage(d.message || d.error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Purchase email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Order reference
            <input
              required
              maxLength={50}
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
            />
          </label>
          <button className="button outline" disabled={busy}>
            Email a fresh link
          </button>
        </form>
      </details>
      <p className="fine">
        For payment or access problems, email godfred@mad-buddy.com with your
        reference. Never send card details.
      </p>
    </>
  );
}
