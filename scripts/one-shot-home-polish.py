from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} occurrences, found {actual}: {old[:90]!r}")
    target.write_text(text.replace(old, new, count), encoding="utf-8", newline="\n")


# 1) MOBILE NAV: same total padding, all five graphics 4px lower.
replace_exact(
    "components/app-shell/app-shell.tsx",
    'className="min-w-0 flex-1 py-2"',
    'className="min-w-0 flex-1 pb-1 pt-3"',
    count=2,
)

# 2) SMART CARD: deferred = quiet surface. Do not keep painting a dark prism
# over light-theme text when another Home card has priority.
replace_exact(
    "components/journey/smart-card.tsx",
    "const prismAnimated = showPrism && !reducedMotion;",
    "const prismAnimated = showPrism && !deferred && !reducedMotion;",
)
replace_exact(
    "components/journey/smart-card.tsx",
    "{showPrism && !prismAnimated ? (",
    "{showPrism && !deferred && !prismAnimated ? (",
)
replace_exact(
    "components/journey/smart-card.tsx",
    "{showPrism ? (\n        <span\n          aria-hidden=\"true\"\n          className=\"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]\"",
    "{showPrism && !deferred ? (\n        <span\n          aria-hidden=\"true\"\n          className=\"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]\"",
)

replace_exact(
    "lib/smart-card/prism-background.test.ts",
    'expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");',
    'expect(card).toContain("const prismAnimated = showPrism && !deferred && !reducedMotion;");',
)
replace_exact(
    "lib/smart-card/prism-background.test.ts",
    'expect(card).toContain("showPrism && !prismAnimated");',
    'expect(card).toContain("showPrism && !deferred && !prismAnimated");',
)
replace_exact(
    "lib/smart-card/prism-background.test.ts",
    'expect(guard).toContain("showPrism ?");',
    'expect(guard).toContain("showPrism && !deferred ?");',
)
anchor = '''  it("renders only one prism instance", () => {
    expect(card.match(/<PrismBackground/g) ?? []).toHaveLength(1);
  });
'''
insert = anchor + '''
  it("does not paint the dark prism over a deferred light-theme card", () => {
    expect(card).toContain("const prismAnimated = showPrism && !deferred && !reducedMotion;");
    expect(card).toContain("showPrism && !deferred && !prismAnimated");
  });
'''
replace_exact("lib/smart-card/prism-background.test.ts", anchor, insert)

# 3) UPCOMING PLAN: approved image + left-weighted readability scrim.
replace_exact(
    "components/activation/activation-card.tsx",
    "  const Icon = ACTION_ICON[primaryActionFor(state)] ?? copy.icon;\n\n  return (",
    "  const Icon = ACTION_ICON[primaryActionFor(state)] ?? copy.icon;\n  const upcomingPlan = state === \"upcoming_plan\";\n\n  return (",
)
replace_exact(
    "components/activation/activation-card.tsx",
    '''        "relative overflow-hidden rounded-[1.25rem] border border-border/70 bg-card/60 px-5 py-4 sm:px-6 sm:py-5",
        className''',
    '''        "relative isolate overflow-hidden rounded-[1.25rem] border px-5 py-4 sm:px-6 sm:py-5",
        upcomingPlan
          ? "border-white/15 bg-[#160b08] text-white shadow-[0_12px_36px_rgba(78,4,1,0.18)]"
          : "border-border/70 bg-card/60",
        className''',
)
replace_exact(
    "components/activation/activation-card.tsx",
    '''    >
      {/* Glow, at the lowest possible volume.''',
    '''    >
      {upcomingPlan ? (
        <>
          <Image
            src="/home/open-your-plan-bg.webp"
            alt=""
            fill
            priority
            sizes="(max-width: 767px) calc(100vw - 2rem), 720px"
            className="pointer-events-none absolute inset-0 z-0 object-cover object-[66%_center]"
            aria-hidden="true"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(90deg,rgba(18,8,6,0.94)_0%,rgba(18,8,6,0.84)_48%,rgba(18,8,6,0.50)_72%,rgba(18,8,6,0.30)_100%)]"
          />
        </>
      ) : null}

      {/* Glow, at the lowest possible volume.''',
)
old_glow = '''      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-60"
        style={{ background: "var(--glow-gradient)" }}
      />'''
new_glow = '''      {upcomingPlan ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-60"
          style={{ background: "var(--glow-gradient)" }}
        />
      )}'''
replace_exact("components/activation/activation-card.tsx", old_glow, new_glow)
replace_exact(
    "components/activation/activation-card.tsx",
    'className="relative grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary"',
    'className={cn("relative z-[1] grid h-11 w-11 place-items-center rounded-full", upcomingPlan ? "bg-white/12 text-white" : "bg-primary/10 text-primary")}',
)
replace_exact(
    "components/activation/activation-card.tsx",
    'className="relative mt-2.5 text-balance text-xl font-semibold tracking-tight"',
    'className="relative z-[1] mt-2.5 text-balance text-xl font-semibold tracking-tight"',
)
replace_exact(
    "components/activation/activation-card.tsx",
    'className="relative mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground"',
    'className={cn("relative z-[1] mt-1 max-w-prose text-sm leading-relaxed", upcomingPlan ? "text-white/80" : "text-muted-foreground")}',
)
replace_exact(
    "components/activation/activation-card.tsx",
    'className="relative mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2"',
    'className="relative z-[1] mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2"',
)
replace_exact(
    "components/activation/activation-card.tsx",
    'className="relative mt-3 flex items-center gap-3"',
    'className="relative z-[1] mt-3 flex items-center gap-3"',
)

test = ROOT / "lib/activation/home-plan-background.test.ts"
test.write_text('''import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const activation = read("components/activation/activation-card.tsx");
const shell = read("components/app-shell/app-shell.tsx");

describe("quick Home polish", () => {
  it("moves mobile nav graphics down without making the bar taller", () => {
    expect(shell.match(/min-w-0 flex-1 pb-1 pt-3/g) ?? []).toHaveLength(2);
    expect(shell).not.toContain('className="min-w-0 flex-1 py-2"');
  });

  it("uses the approved plan image only for the upcoming-plan state", () => {
    expect(activation).toContain('const upcomingPlan = state === "upcoming_plan";');
    expect(activation).toContain('src="/home/open-your-plan-bg.webp"');
    expect(activation).toContain("linear-gradient(90deg,rgba(18,8,6,0.94)");
    expect(activation).toContain('upcomingPlan ? "text-white/80" : "text-muted-foreground"');
  });
});
''', encoding="utf-8", newline="\n")

print("one-shot Home polish applied")
