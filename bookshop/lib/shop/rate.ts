import "server-only";
import { createHmac } from "node:crypto";
import { shopStore } from "./store";
import { signingKey } from "./auth";
export async function allow(
  request: Request,
  action: string,
  limit: number,
  seconds: number
) {
  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  const hash = createHmac("sha256", signingKey()).update(ip).digest("hex");
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const key = `rate/${action}/${hash}/${bucket}`;
  for (let n = 0; n < 5; n++) {
    const store = shopStore();
    const old = await store.getWithMetadata(key, { type: "json" });
    const count = Number(old?.data?.count ?? 0);
    if (count >= limit) return false;
    const result = await store.setJSON(
      key,
      { count: count + 1, expires: (bucket + 1) * seconds * 1000 },
      old ? { onlyIfMatch: old.etag! } : { onlyIfNew: true }
    );
    if (result.modified) return true;
  }
  return false;
}
