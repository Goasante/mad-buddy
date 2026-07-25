export const VAPID_ENV_NAMES = [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT"
] as const;

export type VapidConfiguration =
  | { ok: true; publicKey: string; privateKey: string; subject: string }
  | { ok: false; missing: string[]; mismatch: boolean };

export function readVapidConfiguration(
  env: Record<string, string | undefined>
): VapidConfiguration {
  const browserPublicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const serverPublicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  const missing = [
    !browserPublicKey && "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    !serverPublicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT"
  ].filter((value): value is string => Boolean(value));
  const mismatch = Boolean(browserPublicKey && serverPublicKey && browserPublicKey !== serverPublicKey);

  if (missing.length > 0 || mismatch) return { ok: false, missing, mismatch };
  if (!/^(?:mailto:|https:\/\/)/i.test(subject)) {
    return { ok: false, missing: ["VAPID_SUBJECT (mailto: or https: URL)"], mismatch: false };
  }
  return { ok: true, publicKey: serverPublicKey, privateKey, subject };
}
