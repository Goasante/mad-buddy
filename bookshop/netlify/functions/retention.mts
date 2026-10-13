import { getStore } from "@netlify/blobs";
export const config = { schedule: "0 2 * * *" };
export default async function () {
  const store = getStore({
    name: "godfred-bookshop-v2",
    consistency: "strong",
  });
  const now = Date.now();
  let removed = 0;
  for (const prefix of ["rate/", "downloads/"]) {
    for await (const page of store.list({ prefix, paginate: true })) {
      for (const entry of page.blobs) {
        const row = await store.get(entry.key, { type: "json" });
        const expired =
          prefix === "rate/"
            ? Number(row?.expires) < now
            : Date.parse(row?.at || "") < now - 365 * 86400000;
        if (expired) {
          await store.delete(entry.key);
          removed++;
        }
        if (removed >= 10000) return new Response("Retention batch completed.");
      }
    }
  }
  return new Response("Retention completed.");
}
