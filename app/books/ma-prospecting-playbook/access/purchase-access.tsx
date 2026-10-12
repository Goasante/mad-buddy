"use client";
import { useEffect, useState, type FormEvent } from "react";
import styles from "../book.module.css";

export function BookAccess({ initialToken, reference }: { initialToken: string; reference: string }) {
  const [token,setToken] = useState(initialToken); const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState(""); const [error,setError] = useState("");
  useEffect(()=> {
    // Remove the bearer link/reference from the address bar before navigating away.
    if (window.location.search) window.history.replaceState({},"",window.location.pathname);
  },[]);
  async function verify() {
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/books/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reference})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setToken(data.token);setMessage("Payment verified. Your personal copy is ready.");
    }catch(failure){setError(failure instanceof Error?failure.message:"Please try again.");}finally{setBusy(false);}
  }
  async function download() {
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/books/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
      if(!response.ok){const data=await response.json();throw new Error(data.error);}
      const url=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=url;link.download="The-MA-Prospecting-Playbook.pdf";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
      setMessage("Your download is ready. If your browser opened a preview, use its Save or Share option to keep the PDF.");
    }catch(failure){setError(failure instanceof Error?failure.message:"Download unavailable.");}finally{setBusy(false);}
  }
  async function recover(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const email=String(new FormData(event.currentTarget).get("email")??"");setBusy(true);setError("");setMessage("");
    try {const response=await fetch("/api/books/recover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});const data=await response.json();if(!response.ok)throw new Error(data.error);setMessage(data.message);}
    catch(failure){setError(failure instanceof Error?failure.message:"Please try again.");}finally{setBusy(false);}
  }
  return <div className={styles.accessPanel}>
    {token?<button className={styles.primary} disabled={busy} onClick={download}>{busy?"Preparing your copy…":"Download your personal PDF"}</button>:reference?<button className={styles.primary} disabled={busy} onClick={verify}>{busy?"Checking payment…":"Verify payment and unlock my book"}</button>:null}
    <div role="status" aria-live="polite">{message&&<p>{message}</p>}</div>{error&&<p role="alert" className={styles.error}>{error}</p>}
    <h2>Need a fresh link?</h2><form onSubmit={recover} className={styles.checkout}><label htmlFor="recovery-email">Email used at checkout</label><input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy}/><button className={styles.secondary} disabled={busy} type="submit">Send a fresh access link</button></form>
  </div>;
}
