import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brand = path.join(root, "public/brand");

// Code-drawn artwork keeps the exact brand mark and legible typography.
// A new URL lets social crawlers fetch it independently of the old cached card.
const artwork = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FEFBF3"/>
  <rect x="0" y="0" width="1200" height="10" fill="#E88C2B"/>
  <g font-family="DejaVu Sans, sans-serif">
    <text x="80" y="280" font-size="66" font-weight="700" fill="#4E0401">Meet people.</text>
    <text x="80" y="365" font-size="66" font-weight="700" fill="#4E0401">Make real plans.</text>
    <text x="84" y="426" font-size="26" fill="#705A50">Your exact location stays private.</text>
    <line x1="80" y1="506" x2="1120" y2="506" stroke="#DDD1BE"/>
    <text x="84" y="561" font-size="23" fill="#705A50">Friendship. Discovery. Plans.</text>
    <text x="1116" y="561" text-anchor="end" font-size="25" font-weight="700" fill="#4E0401">mad-buddy.com</text>
  </g>
</svg>`);

const logo = await sharp(path.join(brand, "mad-buddy-logo-light.png"))
  .resize({ width: 310 }).png().toBuffer();
const mark = await sharp(path.join(brand, "mad-buddy-mark-light.png"))
  .resize({ width: 240 }).png().toBuffer();
const output = await sharp(artwork)
  .composite([{ input: logo, left: 80, top: 70 }, { input: mark, left: 868, top: 205 }])
  .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();

await fs.writeFile(path.join(brand, "mad-buddy-social-share-v2.jpg"), output);
// Older share destinations (including event fallback previews) get the new art.
await fs.writeFile(path.join(brand, "mad-buddy-social-share.jpg"), output);
console.log(`Created 1200 × 630 social preview (${output.length} bytes).`);
