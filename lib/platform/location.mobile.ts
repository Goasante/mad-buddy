"use client";

import { postCurrentLocation } from "../../mobile/src/lib/api";

export type LocationSyncResult = { ok: boolean; message?: string };

export async function syncCurrentLocation(): Promise<LocationSyncResult> {
  const result = await postCurrentLocation();
  return result.ok ? { ok: true } : { ok: false, message: result.error };
}
