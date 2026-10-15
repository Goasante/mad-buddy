"use client";
import { useState } from "react";

export default function StudentPreviewUpload() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <form onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("Checking and uploading the approved edition…");
    try {
      const response = await fetch("/api/admin/student-preview", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(`Private preview ready. ${result.files} approved files uploaded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload unavailable."); }
    finally { setBusy(false); }
  }}>
    <label>Approved buyer-package files<input type="file" name="files" multiple required disabled={busy} /></label>
    <p className="fine">Choose all files inside the extracted buyer ZIP, including its subfolders. Only the exact approved Student Edition 1.0.0 files are accepted. Internal reports and marketing assets are excluded.</p>
    <button className="button gold" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload private preview"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
