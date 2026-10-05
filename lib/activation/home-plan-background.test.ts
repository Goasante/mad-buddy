import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { homeCardABackground, homeCardBBackground } from "@/lib/visuals/registry";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/* The mobile bottom bar moved to its own module so the Capacitor SPA can
   render the SAME navigation. This assertion COUNTS nav slots, so it reads
   only the file that now owns them -- concatenating would double-count. */
const shell = read("components/app-shell/mobile-nav.tsx");

/* CODE, NOT COMMENTARY. These assertions are about what the components DO, and
   both files explain in prose why the old atlas and the old hardcoded path were
   removed -- so matching raw source would fail on the explanation of the very
   thing being asserted. */
const activation = stripComments(read("components/activation/activation-card.tsx"));
const smartCard = stripComments(read("components/journey/smart-card-v2.tsx"));

describe("quick Home polish follow-up", () => {
  it("moves mobile nav graphics another step down without increasing the bar", () => {
    // Three slots now, not two: the tab renderer gained a disabled branch for
    // destinations that exist on web but not in the native app (Linkr, UpFor).
    // The point of the assertion is unchanged -- every slot uses the SAME
    // spacing, so the bar cannot grow.
    expect(shell.match(/min-w-0 flex-1 pb-0 pt-4/g) ?? []).toHaveLength(3);
    expect(shell).not.toContain('className="min-w-0 flex-1 pb-1 pt-3"');
  });
});

// Each Home card retains its own registered fixed background.
describe("Home card presentation boundaries", () => {
  it("keeps activation and SmartCard backgrounds separate", () => {
    expect(activation).toContain("homeCardABackground()");
    expect(activation).not.toContain("/home/open-your-plan-bg.webp");
    expect(homeCardABackground().path).toBe("/visuals/home-cards/card-a-background.png");
    expect(homeCardABackground.length).toBe(0);
    expect(smartCard).toContain("homeCardBBackground().path");
    expect(homeCardBBackground().path).toBe("/visuals/home-cards/card-b-background.png");
    expect(homeCardBBackground.length).toBe(0);
    expect(smartCard).not.toContain("SmartCardArtwork");
    expect(smartCard).not.toContain("homeCardABackground");
  });

  it("keeps a legibility scrim without user photography or scene motion", () => {
    expect(smartCard).not.toContain("card.media!.url");
    expect(smartCard).not.toContain("backgroundPosition");
    expect(smartCard).not.toContain("EDITORIAL_ATLAS");
    for (const source of [activation, smartCard]) {
      expect(source).not.toMatch(/<video|autoPlay/);
    }
    expect(smartCard).not.toMatch(/animate-\[/);
    expect(smartCard).toContain("bg-[#090908]");
    expect(smartCard).toContain("linear-gradient(");
  });

  it("preserves current card availability, identity, actions and heartbeat", () => {
    expect(smartCard).toContain("availableSmartCard(inputCard, availability)");
    expect(smartCard).toContain("card.person.avatarUrl");
    expect(smartCard).toContain("openDirectConversationAction(intent.targetUserId)");
    expect(smartCard).toContain("conversationHref(result.conversationId)");
    expect(smartCard).toContain("card.acknowledgementKey ?? card.id");
    expect(smartCard).toContain("pending || intentPending || undefined");
    expect(smartCard).toContain('role="progressbar"');
    expect(smartCard).toContain("scheduleUntilBoundary");
    expect(smartCard).toContain("HEARTBEAT_REFRESH_RETRIES");
  });
});
