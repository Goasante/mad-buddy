export const SESSION_REVISION_KEY = "mad-buddy:session-revision";
const SESSION_CHANNEL = "mad-buddy:session";
let sessionContextId: string | null = null;

function contextId() {
  if (!sessionContextId) {
    sessionContextId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
  }
  return sessionContextId;
}

export function clearUserScopedBrowserState() {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith("mad-buddy:")) sessionStorage.removeItem(key);
  }
}

export function announceSessionEnded() {
  clearUserScopedBrowserState();
  const revision = String(Date.now());
  localStorage.setItem(SESSION_REVISION_KEY, revision);
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.postMessage({ type: "session-ended", source: contextId() });
    channel.close();
  } catch {
    // The storage event remains the compatibility fallback.
  }
}

export function subscribeToSessionEnd(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SESSION_REVISION_KEY) callback();
  };
  window.addEventListener("storage", handleStorage);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.addEventListener("message", (event) => {
      const message = event.data as { type?: string; source?: string } | null;
      if (message?.type === "session-ended" && message.source !== contextId()) callback();
    });
  } catch {
    // BroadcastChannel is optional; storage events still work.
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}
