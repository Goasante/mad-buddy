export function getSiteUrl() {
 const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://books.mad-buddy.com";
 try { return new URL(configured); } catch { throw new Error("Invalid bookshop public URL."); }
}
export function absoluteUrl(path = "/") { return new URL(path, getSiteUrl()).toString(); }
