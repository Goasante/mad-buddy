import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

function read(path: string): string {
  return stripComments(readFileSync(join(process.cwd(), path), "utf8"));
}

describe("ranked Event cover initial-signing recovery", () => {
  it("preserves canonical cover presence separately from signed URL success", () => {
    const projection = read("lib/events/ranked-events.ts");
    expect(projection).toContain("hasCover: Boolean(event.cover_media_id)");
    expect(projection).toContain("hasCover: event.hasCover");
  });

  it("tells every ranked artwork surface whether a cover is expected", () => {
    for (const path of [
      "components/events/ranked-events-accordion.tsx",
      "components/events/top-events-list.tsx"
    ]) {
      expect(read(path), path).toContain("coverExpected={event.hasCover}");
    }
  });

  it("renews a missing initial credential only when canonical cover truth says one exists", () => {
    const artwork = read("components/events/event-artwork.tsx");
    expect(artwork).toContain("coverExpected = false");
    expect(artwork).toContain("if (!coverExpected || activeCoverUrl || inFlightRefreshRef.current) return;");
    expect(artwork).toContain("renewCover()");
  });

  it("does not turn legacy no-cover Events into one request per card", () => {
    const artwork = read("components/events/event-artwork.tsx");
    const gate = artwork.indexOf("if (!coverExpected || activeCoverUrl || inFlightRefreshRef.current) return;");
    const refresh = artwork.indexOf("renewCover()", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(gate);
  });
});
