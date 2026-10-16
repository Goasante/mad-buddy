"use client";
import { useState } from "react";

export default function ThesisPreviewUpload() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <form onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Checking and uploading the v0.3 candidate…");
    try {
      const response = await fetch("/api/admin/thesis-preview", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(`Private preview ready. ${result.files} candidate files uploaded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload unavailable."); }
    finally { setBusy(false); }
  }}>
    <label>Candidate customer-package files<input type="file" name="files" multiple required disabled={busy} /></label>
    <p className="fine">Choose all files inside the extracted buyer ZIP, including its subfolders. Only the exact Thesis Architect v0.3 candidate files are accepted. Internal reports and marketing assets are excluded.</p>
    <button className="button gold" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload private preview"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
