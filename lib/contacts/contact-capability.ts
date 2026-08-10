/**
 * What contact access this device actually offers.
 *
 * ONE place that knows. Components ask this layer what is possible and render
 * accordingly; nothing else in the app touches `navigator.contacts`, so there
 * is no scattered capability-sniffing to keep in sync and no component quietly
 * assuming a picker that is not there.
 *
 * THE HONEST PART: the web Contact Picker API is Chromium-on-Android only. It
 * does not exist in iOS Safari -- including installed PWAs, which use the same
 * engine -- nor in desktop Safari or Firefox. That is a platform fact, not a
 * permission the user can grant, so the UI must not offer a button that cannot
 * work or tell somebody to enable something their browser does not have.
 *
 * READY FOR NATIVE: `native` is in the union already. When the Capacitor build
 * ships with a real contacts plugin it registers itself here, and every caller
 * keeps working unchanged -- the UI branches on capability, never on platform.
 */

export type ContactCapability =
  /** Web Contact Picker present and usable. */
  | "picker"
  /** A native bridge is providing contacts. Not wired yet; see below. */
  | "native"
  /** The platform has no contact access at all. iOS Safari and PWAs land here. */
  | "unsupported"
  /** Server render, before anything can be detected. */
  | "unknown";

/**
 * A native contacts bridge, if one has registered.
 *
 * The native app sets this at startup. Kept as a registration hook rather than
 * an import so the web bundle never pulls in native-only code, and so this
 * module has no dependency on the Capacitor layer existing.
 */
type NativeContactBridge = {
  requestContacts: () => Promise<string[]>;
};

let nativeBridge: NativeContactBridge | null = null;

/**
 * Registers (or clears, with null) the native bridge.
 *
 * Clearing is explicit rather than implied by passing undefined, so a caller
 * cannot disable native contacts by accident -- and so tests can put the
 * module back to its web-only state deterministically.
 */
export function registerNativeContactBridge(bridge: NativeContactBridge | null): void {
  nativeBridge = bridge;
}

type ContactsManagerLike = {
  select: (properties: string[], options?: { multiple?: boolean }) => Promise<Array<{ tel?: string[] }>>;
  getProperties: () => Promise<string[]>;
};

function contactsManager(): ContactsManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as Navigator & { contacts?: ContactsManagerLike }).contacts;
  // `select` is the part that matters; some engines expose a stub object.
  return candidate && typeof candidate.select === "function" ? candidate : null;
}

/**
 * What this device can do.
 *
 * Pure detection -- it triggers no permission prompt and shows no UI. Safe to
 * call during render, which is the point: the explanation screen needs to know
 * what to offer before the user has agreed to anything.
 */
export function detectContactCapability(): ContactCapability {
  if (typeof window === "undefined") return "unknown";
  if (nativeBridge) return "native";
  if (contactsManager()) return "picker";
  return "unsupported";
}

export type ContactSelection =
  | { ok: true; phoneNumbers: string[] }
  /** The person closed the picker. Not an error, and not worth a message. */
  | { ok: false; reason: "cancelled" }
  /** The platform cannot do this at all. */
  | { ok: false; reason: "unsupported" }
  /** Permission refused, or the picker failed. */
  | { ok: false; reason: "denied" };

/**
 * Opens the contact picker and returns phone numbers only.
 *
 * MUST BE CALLED FROM A USER GESTURE. Browsers require it, and so does the
 * product: the permission prompt appears here, and it appears only because
 * somebody tapped "Find my Muddies" on the explanation screen first.
 *
 * REQUESTS ONE PROPERTY. `tel` and nothing else -- no names, no emails, no
 * addresses, no avatars. Matching needs numbers, so asking for anything more
 * would be collecting data the feature has no use for, and every extra field
 * is one the user has to trust us with.
 *
 * The numbers are returned raw. Normalisation is the server's job; a client
 * that normalised first would be deciding what matches.
 */
export async function selectContacts(): Promise<ContactSelection> {
  const capability = detectContactCapability();

  if (capability === "native" && nativeBridge) {
    try {
      return { ok: true, phoneNumbers: await nativeBridge.requestContacts() };
    } catch {
      return { ok: false, reason: "denied" };
    }
  }

  const manager = contactsManager();
  if (!manager) return { ok: false, reason: "unsupported" };

  try {
    // Confirms `tel` is actually offered before asking for it: a browser that
    // exposes the API without phone support would otherwise throw.
    const available = await manager.getProperties();
    if (!available.includes("tel")) return { ok: false, reason: "unsupported" };

    const selected = await manager.select(["tel"], { multiple: true });

    // An empty array means the picker was dismissed. Cancelling is a normal
    // choice, so it must not read as a failure or trigger a retry prompt.
    if (!selected.length) return { ok: false, reason: "cancelled" };

    const phoneNumbers: string[] = [];
    for (const contact of selected) {
      for (const tel of contact.tel ?? []) {
        if (typeof tel === "string" && tel.trim()) phoneNumbers.push(tel.trim());
      }
    }

    // Selected contacts, but none had a number saved -- a real case for
    // email-only entries, and not a permission problem.
    if (!phoneNumbers.length) return { ok: false, reason: "cancelled" };

    return { ok: true, phoneNumbers };
  } catch {
    // The spec throws on denial and on a hostile frame alike. Either way the
    // honest report is that access was not granted; the caller must NOT
    // reopen the picker automatically in response.
    return { ok: false, reason: "denied" };
  }
}
