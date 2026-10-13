import "server-only";
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { seed } from "./seed";
import { configSchema, type ShopConfig } from "./schema";
export function shopStore() {
  return getStore({ name: "godfred-bookshop-v2", consistency: "strong", fetch: async (url, init) => {
    console.info('[bookshop] storage request', new URL(String(url)).hostname);
    const result = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    console.info('[bookshop] storage response', result.status);
    return result;
  } });
}
export async function configuration() {
  if (process.env.NODE_ENV !== "production" && !process.env.NETLIFY)
    return { config: seed, etag: "seed" };
  const row = await shopStore().getWithMetadata("config", { type: "json" });
  return row
    ? { config: configSchema.parse(row.data), etag: row.etag! }
    : { config: seed, etag: "seed" };
}
export async function saveConfiguration(config: ShopConfig, etag: string) {
  const parsed = configSchema.parse(config);
  const { modified } = await shopStore().setJSON(
    "config",
    parsed,
    etag === "seed" ? { onlyIfNew: true } : { onlyIfMatch: etag }
  );
  if (!modified) throw new Error("CONFLICT");
  await audit("configuration.updated");
  return configuration();
}
export async function audit(action: string, detail?: string) {
  await shopStore().setJSON(
    `audit/${new Date().toISOString()}/${randomUUID()}`,
    { action, detail: detail ?? null, at: new Date().toISOString() },
    { onlyIfNew: true }
  );
}
export async function records<T>(prefix: string, max = 5000) {
  const rows: T[] = [];
  let truncated = false;
  for await (const page of shopStore().list({ prefix, paginate: true })) {
    for (const blob of page.blobs) {
      if (rows.length >= max) {
        truncated = true;
        break;
      }
      const row = await shopStore().get(blob.key, { type: "json" });
      if (row) rows.push(row);
    }
    if (truncated) break;
  }
  return { rows, truncated };
}
