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


# 1) iPhone 12 follow-up: keep total tab padding unchanged, shift graphics
# another 4px downward inside the existing nav bar.
replace_exact(
    "components/app-shell/app-shell.tsx",
    'className="min-w-0 flex-1 pb-1 pt-3"',
    'className="min-w-0 flex-1 pb-0 pt-4"',
    count=2,
)

# 2) Restore the prism on deferred/suggestions cards. The prior follow-up hid
# the canvas to solve light-mode contrast, which removed the identity entirely.
replace_exact(
    "components/journey/smart-card.tsx",
    "const prismAnimated = showPrism && !deferred && !reducedMotion;",
    "const prismAnimated = showPrism && !reducedMotion;",
)
replace_exact(
    "components/journey/smart-card.tsx",
    "{showPrism && !deferred && !prismAnimated ? (",
    "{showPrism && !prismAnimated ? (",
)
replace_exact(
    "components/journey/smart-card.tsx",
    "{showPrism && !deferred ? (\n        <span\n          aria-hidden=\"true\"\n          className=\"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]\"",
    "{showPrism ? (\n        <span\n          aria-hidden=\"true\"\n          className=\"pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]\"",
)

# Light-mode deferred cards still need dark foreground text over the prism.
# Add a warm-paper wash only in light mode; dark mode keeps the existing dark
# readability scrim and the full prism identity.
anchor = '''      {showPrism ? (\n        <span\n          aria-hidden="true"\n          className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(10,4,9,0.72)_0%,rgba(10,4,9,0.40)_50%,rgba(10,4,9,0.05)_82%,rgba(10,4,9,0)_100%)]"\n        />\n      ) : null}\n'''
insert = anchor + '''      {showPrism && deferred ? (\n        <span\n          aria-hidden="true"\n          className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(254,251,243,0.96)_0%,rgba(254,251,243,0.90)_54%,rgba(254,251,243,0.48)_80%,rgba(254,251,243,0.12)_100%)] dark:bg-transparent"\n        />\n      ) : null}\n'''
replace_exact("components/journey/smart-card.tsx", anchor, insert)

# Update the source-contract tests to prove the prism remains present while
# light mode gets its own readability treatment.
replace_exact(
    "lib/smart-card/prism-background.test.ts",
    'expect(card).toContain("const prismAnimated = showPrism && !deferred && !reducedMotion;");',
    'expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");',
    count=2,
)
replace_exact(
    "lib/smart-card/prism-background.test.ts",
    'expect(card).toContain("showPrism && !deferred && !prismAnimated");',
    'expect(card).toContain("showPrism && !prismAnimated");',
    count=2,
)
replace_exact(
    "lib/smart-card/prism-background.test.ts",
    '''  it("does not paint the dark prism over a deferred light-theme card", () => {\n    expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");\n    expect(card).toContain("showPrism && !prismAnimated");\n  });''',
    '''  it("keeps the prism visible while protecting deferred light-theme copy", () => {\n    expect(card).toContain("const prismAnimated = showPrism && !reducedMotion;");\n    expect(card).toContain("showPrism && deferred ?");\n    expect(card).toContain("rgba(254,251,243,0.96)");\n    expect(card).toContain("dark:bg-transparent");\n  });''',
)

# The existing quick test now also checks that the actual committed image is a
# real WebP, so a base64-text/blob mistake cannot ship again.
test = ROOT / "lib/activation/home-plan-background.test.ts"
test.write_text('''import { readFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { describe, expect, it } from "vitest";\n\nconst read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");\nconst activation = read("components/activation/activation-card.tsx");\nconst shell = read("components/app-shell/app-shell.tsx");\nconst planImage = readFileSync(join(process.cwd(), "public/home/open-your-plan-bg.webp"));\n\ndescribe("quick Home polish follow-up", () => {\n  it("moves mobile nav graphics another step down without increasing the bar", () => {\n    expect(shell.match(/min-w-0 flex-1 pb-0 pt-4/g) ?? []).toHaveLength(2);\n    expect(shell).not.toContain('className="min-w-0 flex-1 pb-1 pt-3"');\n  });\n\n  it("keeps the upcoming-plan artwork wired and commits a real WebP", () => {\n    expect(activation).toContain('src="/home/open-your-plan-bg.webp"');\n    expect(planImage.subarray(0, 4).toString("ascii")).toBe("RIFF");\n    expect(planImage.subarray(8, 12).toString("ascii")).toBe("WEBP");\n    expect(planImage.byteLength).toBeGreaterThan(8000);\n  });\n});\n''', encoding="utf-8", newline="\n")

print("one-shot Home polish follow-up applied")
