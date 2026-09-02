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

/**
 * In-memory stores that hold user-scoped data and must die with the session.
 *
 * sessionStorage is not the only place user data lives any more: the Messaging
 * thread cache keeps projected messages in module memory, which survives a
 * component unmount by design and would otherwise survive a logout too. Rather
 * than let each such store bolt its own listener onto the auth lifecycle --
 * which is how one of them eventually gets forgotten -- they register here and
 * are torn down by the same call that already clears browser storage.
 */
const userScopedMemoryStores = new Set<() => void>();

export function registerUserScopedMemoryStore(clear: () => void) {
  userScopedMemoryStores.add(clear);
  return () => userScopedMemoryStores.delete(clear);
}

export function clearUserScopedBrowserState() {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith("mad-buddy:")) sessionStorage.removeItem(key);
  }
  for (const clear of userScopedMemoryStores) {
    try {
      clear();
    } catch {
      // One store failing must never prevent the others from being cleared.
    }
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
