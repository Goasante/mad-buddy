import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("mobile form controls stay inside their cards", () => {
  it("lets the three Profile birth-privacy selects shrink to their grid columns", () => {
    const source = read("components/profile/profile-page.tsx");
    const start = source.indexOf('grid grid-cols-3 gap-2 rounded-xl');
    const block = source.slice(start, source.indexOf(") : null}", start));
    expect(block.match(/triggerClassName=\"!w-full !min-w-0 px-2\"/g)).toHaveLength(3);
  });

  it("keeps the onboarding date control shrinkable on WebKit", () => {
    const source = read("components/onboarding/onboarding-flow.tsx");
    const start = source.indexOf('id=\"dateOfBirth\"');
    const block = source.slice(start, source.indexOf("/>", start));
    expect(block).toContain("[min-inline-size:0]");
    expect(block).toContain("[-webkit-min-logical-width:0]");
    expect(block).toContain("[&::-webkit-date-and-time-value]:min-w-0");
    expect(source.slice(Math.max(0, start - 200), start)).toContain("overflow-hidden rounded-md");
  });

  it("allows shared form labels and hints to wrap instead of forcing horizontal overflow", () => {
    const source = read("components/auth/form-field.tsx");
    expect(source).toContain('className=\"min-w-0 space-y-2\"');
    expect(source).toContain("flex min-w-0 flex-wrap items-start justify-between");
    expect(source).toContain("min-w-0 max-w-full text-right");
  });
});
