import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const feed = read("components/conference/conference-page.tsx");
const detail = read("components/conference/conference-topic-page.tsx");
const server = read("lib/conference/server.ts");

describe("Conference owner vote visibility", () => {
  it("shows Hype and Pass counts on the owner's Topic without self-vote controls", () => {
    expect(feed).toContain('aria-label="Your Topic vote counts"');
    expect(feed).toContain("Hype {topic.hypeCount}");
    expect(feed).toContain("Pass {topic.passCount}");
    expect(detail).toContain('aria-label="Your Topic vote counts"');
    expect(detail).toContain("Hype {liveTopic.hypeCount}");
    expect(detail).toContain("Pass {liveTopic.passCount}");
  });

  it("shows Hype and Pass counts on the owner's Voice without self-voting", () => {
    expect(detail).toContain('aria-label="Your Voice vote counts"');
    expect(detail).toContain("Hype {reply.hypeCount}");
    expect(detail).toContain("Pass {reply.passCount}");
    expect(server).toContain("target.authorUserId === userId");
  });
});
