import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Events overlay foreground invariant", () => {
  it("does not mount a Radix overlay when its foreground payload is absent", () => {
    const modal = read("components/ui/modal.tsx");

    expect(modal).toContain("const hasForeground =");
    expect(modal).toContain("const rootOpen = open && hasForeground;");
    expect(modal).toContain("<Dialog.Root open={rootOpen}");
    expect(modal).toContain('useDismissOnBack(variant === "sheet" && rootOpen');
  });

  it("keeps hidden-title Event sheets fixed instead of merging them into off-screen document flow", () => {
    const modal = read("components/ui/modal.tsx");

    expect(modal).toContain('"modal-sheet-panel fixed inset-x-0 bottom-0');
    expect(modal).toContain('hideTitle && "max-w-[36rem]"');
    expect(modal).not.toContain('hideTitle && "relative');
    expect(modal).toContain('data-modal-body="true"');
  });

  it("keeps one Back sentinel for one opening, even while its body rerenders", () => {
    const hook = read("hooks/use-dismiss-on-back.ts");

    expect(hook).toContain("const onDismissRef = useRef(onDismiss);");
    expect(hook).toContain("onDismissRef.current = onDismiss;");
    expect(hook).toContain("const handlePopState = () => onDismissRef.current();");
    expect(hook).toContain("}, [open]);");
    expect(hook).not.toContain("[open, onDismiss]");
  });
});

describe("Create Event narrow-phone geometry", () => {
  it("fixes intrinsic time-control width at the grid tracks instead of clipping it", () => {
    const page = read("components/events/events-page.tsx");
    const when = page.slice(page.indexOf('id="event-date"'), page.indexOf('id="event-venue"'));

    expect(when).toContain("grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(when.match(/min-h-12 min-w-0/g)).toHaveLength(2);
    expect(page).not.toContain("space-y-5 overflow-x-hidden px-1 pb-1");
  });
});
