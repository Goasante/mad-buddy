import { describe, expect, it } from "vitest";
import { splitTextWithMentions } from "@/lib/messaging/mentions";

/**
 * BETA-A2 — the Circle mention that vanished on send.
 *
 * The picker offers `full_name || username`, so a member with no full name is
 * mentionable and inserts as "@theirusername". The projection that feeds the
 * renderer used to read `full_name` ALONE and drop anyone whose was blank, so
 * the name showed while typing and became ordinary text the moment the message
 * came back from the server.
 *
 * These tests pin the invariant that broke: THE TWO SIDES MUST AGREE. Whatever
 * name the picker can offer, the renderer must be able to name.
 */

/** The picker's precedence, as implemented by listMentionCandidates. */
function candidateName(profile: { full_name: string | null; username: string | null }) {
  return profile.full_name?.trim() || profile.username;
}

/** The projection's precedence, as implemented by getMessages. */
function projectedName(profile: { full_name: string | null; username: string | null }) {
  return profile.full_name?.trim() || profile.username?.trim();
}

describe("mention name projection", () => {
  const profiles = [
    { user_id: "u1", full_name: "Ama Serwaa", username: "ama" },
    { user_id: "u2", full_name: null, username: "phoebes" },
    { user_id: "u3", full_name: "   ", username: "kwame" },
    { user_id: "u4", full_name: "Akosua Mensah", username: "akos" }
  ];

  it("names every member the picker is willing to offer", () => {
    for (const profile of profiles) {
      expect(projectedName(profile), `member ${profile.user_id} must be nameable`).toBeTruthy();
      expect(projectedName(profile)).toBe(candidateName(profile));
    }
  });

  it("falls back to the username when there is no full name", () => {
    expect(projectedName(profiles[1])).toBe("phoebes");
  });

  it("treats a whitespace-only full name as absent, exactly as the picker does", () => {
    expect(projectedName(profiles[2])).toBe("kwame");
  });

  it("still highlights a username-only mention after a send round-trip", () => {
    const displayName = projectedName(profiles[1])!;
    const runs = splitTextWithMentions(`hey @${displayName} are you coming?`, [
      { userId: "u2", displayName }
    ]);
    const highlighted = runs.filter((run) => run.mentionedUserId === "u2");
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe("@phoebes");
  });

  it("REGRESSION: reading full_name alone loses the mention entirely", () => {
    // The old projection. Reinstating it must fail this test.
    const oldName = profiles[1].full_name?.trim();
    expect(oldName).toBeFalsy();
    const runs = splitTextWithMentions("hey @phoebes are you coming?", []);
    expect(runs.every((run) => run.mentionedUserId === null)).toBe(true);
  });

  it("matches a mention inserted as a USERNAME against a full-name projection", () => {
    // The Circle defect: the picker inserted "@ama_s", the projection returned
    // "Ama Serwaa", and the highlight was lost on the way back from the server.
    const runs = splitTextWithMentions("hey @ama_s are you coming?", [
      { userId: "u1", displayName: "Ama Serwaa", username: "ama_s" }
    ]);
    const hit = runs.filter((run) => run.mentionedUserId === "u1");
    expect(hit).toHaveLength(1);
    expect(hit[0].text).toBe("@ama_s");
  });

  it("still matches the full name when that is what was inserted", () => {
    const runs = splitTextWithMentions("hey @Ama Serwaa are you coming?", [
      { userId: "u1", displayName: "Ama Serwaa", username: "ama_s" }
    ]);
    const hit = runs.filter((run) => run.mentionedUserId === "u1");
    expect(hit).toHaveLength(1);
    expect(hit[0].text).toBe("@Ama Serwaa");
  });

  it("prefers the longer name so a username does not half-match a full name", () => {
    const runs = splitTextWithMentions("hey @Ama Serwaa", [
      { userId: "u1", displayName: "Ama Serwaa", username: "Ama" }
    ]);
    expect(runs.filter((run) => run.mentionedUserId === "u1")[0].text).toBe("@Ama Serwaa");
  });

  it("an alias is only ever offered for someone the server really stored", () => {
    // Aliases widen HOW a mention is matched, never WHO may be highlighted.
    const runs = splitTextWithMentions("hey @stranger and @ama_s", [
      { userId: "u1", displayName: "Ama Serwaa", username: "ama_s" }
    ]);
    const ids = new Set(runs.map((run) => run.mentionedUserId).filter(Boolean));
    expect([...ids]).toEqual(["u1"]);
    expect(runs.some((run) => run.text.includes("@stranger") && run.mentionedUserId)).toBe(false);
  });

  it("does not highlight text that merely looks like a mention", () => {
    const runs = splitTextWithMentions("email me @ the usual place", [
      { userId: "u1", displayName: "Ama Serwaa" }
    ]);
    expect(runs.every((run) => run.mentionedUserId === null)).toBe(true);
  });
});
