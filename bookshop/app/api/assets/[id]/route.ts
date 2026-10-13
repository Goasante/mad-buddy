import { shopStore } from "@/lib/shop/store";
export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response(null, { status: 404 });
  try {
    const entry = await shopStore().getWithMetadata("assets/" + id, {
      type: "arrayBuffer",
    });
    if (!entry) return new Response(null, { status: 404 });
    return new Response(entry.data, {
      headers: {
        "Content-Type": String(entry.metadata.type),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
