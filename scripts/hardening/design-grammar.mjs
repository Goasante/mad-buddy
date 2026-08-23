/**
 * Mission 2 God Mode, Axes 2/4/5 — shared component, typography and icon
 * grammar, measured from source.
 *
 * The question is NOT "is there a design system" but "does one UI job have one
 * answer". Repetition only matters where the implementations DIVERGE, so this
 * counts implementations per job and reports the spread rather than the total.
 *
 * Source-level by design: the ICON library, the type scale and the shared
 * primitives are decided in code, and a screenshot cannot tell you that two
 * visually similar buttons came from two different components.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "C:/mb-god";
const DIRS = ["components", "app"];

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
}
const files = [];
for (const d of DIRS) walk(join(ROOT, d), files);
const sources = files.map((f) => ({
  path: relative(ROOT, f).split("\\").join("/"),
  text: readFileSync(f, "utf8")
}));
console.log(`scanned ${sources.length} .tsx files\n`);
if (sources.length < 50) throw new Error("scan found too few files to be meaningful");

const countFiles = (re) => sources.filter((s) => re.test(s.text)).map((s) => s.path);

// --- ICON LIBRARY -----------------------------------------------------------
console.log("=".repeat(88));
console.log("ICON LANGUAGE");
console.log("=".repeat(88));
const lucide = countFiles(/from "lucide-react"/);
const otherIconLibs = countFiles(/from "(react-icons|@heroicons|@radix-ui\/react-icons|feather|phosphor)/);
console.log(`  lucide-react            : ${lucide.length} files`);
console.log(`  any OTHER icon library  : ${otherIconLibs.length} files ${otherIconLibs.slice(0, 4).join(", ")}`);
// Inline SVG paths are the other way an icon language fragments.
const inlineSvg = sources.filter((s) => (s.text.match(/<svg[\s>]/g) || []).length > 0);
console.log(`  files with inline <svg> : ${inlineSvg.length}  ${inlineSvg.slice(0, 6).map((s) => s.path).join(", ")}`);

// Icon SIZES actually used on lucide components.
const sizes = {};
for (const s of sources) {
  for (const m of s.text.matchAll(/className="[^"]*\bh-(\d+(?:\.\d+)?)\s+w-\1\b[^"]*"\s*(?:aria-hidden|\/>)/g)) {
    sizes[m[1]] = (sizes[m[1]] ?? 0) + 1;
  }
}
console.log(`  square icon sizes used  : ${Object.entries(sizes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `h-${k}(${v})`).join(" ")}`);

// --- SHARED PRIMITIVES ------------------------------------------------------
console.log(`\n${"=".repeat(88)}`);
console.log("COMPONENT GRAMMAR — one UI job, how many implementations?");
console.log("=".repeat(88));
const JOBS = [
  ["Button (shared)",      /from "@\/components\/ui\/button"/,            /<button\s/],
  ["Modal/Dialog (shared)",/from "@\/components\/ui\/modal"/,             /<Dialog\.Root|from "@radix-ui\/react-dialog"/],
  ["Menu (shared)",        /from "@\/components\/ui\/app-dropdown"/,      /from "@radix-ui\/react-dropdown-menu"/],
  ["EmptyState (shared)",  /from "@\/components\/ui\/empty-state"|EmptyState/, null],
  ["Avatar (shared)",      /UserAvatar|GlowAvatar|ProximityGlowAvatar/,   /<img[^>]*rounded-full/],
  ["Switch (shared)",      /from "@\/components\/ui\/app-switch"/,        /type="checkbox"/]
];
for (const [job, shared, raw] of JOBS) {
  const s = countFiles(shared);
  const r = raw ? countFiles(raw).filter((p) => !p.startsWith("components/ui/")) : [];
  console.log(`  ${job.padEnd(24)} shared in ${String(s.length).padStart(3)} files` +
    (raw ? `   |  raw/ad-hoc in ${String(r.length).padStart(3)}${r.length ? `: ${r.slice(0, 3).join(", ")}` : ""}` : ""));
}

// --- TYPOGRAPHY -------------------------------------------------------------
console.log(`\n${"=".repeat(88)}`);
console.log("TYPOGRAPHY — the sizes actually in use");
console.log("=".repeat(88));
const textSizes = {};
for (const s of sources) {
  for (const m of s.text.matchAll(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|\[[0-9.]+rem\])\b/g)) {
    textSizes[m[1]] = (textSizes[m[1]] ?? 0) + 1;
  }
}
const named = Object.entries(textSizes).filter(([k]) => !k.startsWith("["));
const arbitrary = Object.entries(textSizes).filter(([k]) => k.startsWith("["));
console.log(`  scale steps  : ${named.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(" ")}`);
console.log(`  ARBITRARY    : ${arbitrary.length} distinct — ${arbitrary.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v})`).join(" ")}`);

const weights = {};
for (const s of sources) {
  for (const m of s.text.matchAll(/\bfont-(thin|light|normal|medium|semibold|bold|extrabold|black)\b/g)) {
    weights[m[1]] = (weights[m[1]] ?? 0) + 1;
  }
}
console.log(`  weights      : ${Object.entries(weights).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(" ")}`);
