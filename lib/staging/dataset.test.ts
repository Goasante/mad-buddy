import { describe, expect, it } from "vitest";

import {
  DATASET_EPOCH,
  STAGING_ACCOUNT_COUNT,
  STAGING_EMAIL_DOMAIN,
  ageOnEpoch,
  buildAccounts,
  buildBuddyEdges,
  buildCohorts,
  buildGroupConversationMessages,
  buildPrimaryConversationMessages,
  buildSecondaryConversationMessages,
  directConversationKey,
  planDataset
} from "./dataset";
import { buildAttachmentPng, buildVoiceWav } from "./fixtures";

describe("synthetic accounts", () => {
  const accounts = buildAccounts();

  it("creates exactly 100 deterministic accounts", () => {
    expect(accounts).toHaveLength(STAGING_ACCOUNT_COUNT);
    expect(accounts[0].label).toBe("staging-user-001");
    expect(accounts[99].label).toBe("staging-user-100");
  });

  it("is byte-for-byte identical across runs", () => {
    // Determinism is what makes the seeder rerunnable and failures diffable.
    expect(buildAccounts()).toEqual(accounts);
  });

  it("only uses reserved synthetic email addresses", () => {
    // RFC 2606 reserved: these can never be delivered to a real person.
    for (const account of accounts) {
      expect(account.email.endsWith(`@${STAGING_EMAIL_DOMAIN}`)).toBe(true);
      expect(account.email).toMatch(/^staging-user-\d{3}@/);
    }
  });

  it("gives every account a unique username and email", () => {
    expect(new Set(accounts.map((a) => a.username)).size).toBe(accounts.length);
    expect(new Set(accounts.map((a) => a.email)).size).toBe(accounts.length);
  });

  it("satisfies the profiles username format constraint", () => {
    // profiles_username_format: ^[a-z0-9_]{3,24}$
    for (const account of accounts) {
      expect(account.username).toMatch(/^[a-z0-9_]{3,24}$/);
    }
  });

  it("makes every synthetic account comfortably 18+", () => {
    // Age enforcement is a real product rule; the fixture must not undermine it.
    for (const account of accounts) {
      expect(ageOnEpoch(account.dateOfBirth)).toBeGreaterThanOrEqual(18);
    }
  });

  it("varies profile content so runtime is not testing 100 identical rows", () => {
    expect(new Set(accounts.map((a) => a.fullName)).size).toBeGreaterThan(20);
    expect(new Set(accounts.map((a) => a.bio)).size).toBeGreaterThan(1);
    expect(new Set(accounts.map((a) => a.intent)).size).toBeGreaterThan(1);
    expect(new Set(accounts.map((a) => a.isOnboarded)).size).toBe(2);
  });
});

describe("buddy graph", () => {
  const edges = buildBuddyEdges();

  it("always orders each pair a < b to match friendships_ordered", () => {
    for (const edge of edges) {
      expect(edge.a).toBeLessThan(edge.b);
    }
  });

  it("emits no duplicate pairs", () => {
    const keys = edges.map((e) => `${e.a}:${e.b}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("connects the R1-R8 pair", () => {
    expect(edges).toContainEqual({ a: 1, b: 2 });
  });

  it("leaves nobody isolated", () => {
    // 100 isolated users would make every social surface render zero-state.
    const degree = new Map<number, number>();
    for (const edge of edges) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
    for (let i = 1; i <= STAGING_ACCOUNT_COUNT; i += 1) {
      expect(degree.get(i) ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it("is not a fully connected graph", () => {
    // A complete graph is unlike any real account and hides N+1 regressions.
    const complete = (STAGING_ACCOUNT_COUNT * (STAGING_ACCOUNT_COUNT - 1)) / 2;
    expect(edges.length).toBeLessThan(complete / 5);
  });

  it("is deterministic", () => {
    expect(buildBuddyEdges()).toEqual(edges);
  });
});

describe("cohorts", () => {
  const cohorts = buildCohorts();

  it("nests strictly: 10 ⊂ 25 ⊂ 50 ⊂ 75 ⊂ 100", () => {
    const ordered = [
      cohorts.cohort10,
      cohorts.cohort25,
      cohorts.cohort50,
      cohorts.cohort75,
      cohorts.cohort100
    ];

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const smaller = ordered[i];
      const larger = new Set(ordered[i + 1]);
      expect(smaller.length).toBeLessThan(larger.size);
      for (const member of smaller) {
        expect(larger.has(member)).toBe(true);
      }
    }
  });

  it("draws every ramp step from the same 100 accounts", () => {
    // A ramp step is a prefix, never a fresh batch of users.
    for (const member of cohorts.cohort100) {
      expect(member).toBeGreaterThanOrEqual(1);
      expect(member).toBeLessThanOrEqual(STAGING_ACCOUNT_COUNT);
    }
    expect(cohorts.cohort100).toHaveLength(STAGING_ACCOUNT_COUNT);
  });
});

describe("conversation fixtures", () => {
  const primary = buildPrimaryConversationMessages();

  it("seeds a long-scroll history in the 350-500 range", () => {
    expect(primary.length).toBeGreaterThanOrEqual(350);
    expect(primary.length).toBeLessThanOrEqual(500);
  });

  it("gives every message a distinct ascending timestamp", () => {
    // All-identical timestamps would defeat R1 and break canonical ordering.
    for (let i = 1; i < primary.length; i += 1) {
      const previous = Date.parse(primary[i - 1].createdAt);
      const current = Date.parse(primary[i].createdAt);
      expect(current).toBeGreaterThan(previous);
    }
  });

  it("spans multiple days so date separators are exercised", () => {
    const days = new Set(primary.map((m) => m.createdAt.slice(0, 10)));
    expect(days.size).toBeGreaterThan(3);
  });

  it("varies sender and message length", () => {
    expect(new Set(primary.map((m) => m.senderIndex))).toEqual(new Set([1, 2]));
    const lengths = new Set(primary.map((m) => m.body.length));
    expect(lengths.size).toBeGreaterThan(5);
  });

  it("only ever replies to an earlier message", () => {
    for (const [index, message] of primary.entries()) {
      if (message.replyToOffset !== undefined) {
        expect(message.replyToOffset).toBeLessThan(index);
        expect(message.replyToOffset).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every message a unique client_message_id for idempotency", () => {
    // client_message_id is the app's real dedupe column, so a rerun updates
    // rather than duplicating.
    const all = [
      ...primary,
      ...buildSecondaryConversationMessages(),
      ...buildGroupConversationMessages()
    ];
    const ids = all.map((m) => m.clientMessageId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", () => {
    expect(buildPrimaryConversationMessages()).toEqual(primary);
  });

  it("ends no later than the dataset epoch", () => {
    const last = Date.parse(primary[primary.length - 1].createdAt);
    expect(last).toBeLessThanOrEqual(DATASET_EPOCH);
  });
});

describe("directConversationKey", () => {
  it("sorts the pair so both orderings collapse to one key", () => {
    // Must match the SQL: least(a,b) || ':' || greatest(a,b).
    expect(directConversationKey("aaa", "bbb")).toBe("aaa:bbb");
    expect(directConversationKey("bbb", "aaa")).toBe("aaa:bbb");
  });
});

describe("binary fixtures", () => {
  it("generates a valid PNG signature and IEND terminator", () => {
    const png = buildAttachmentPng();
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(png.subarray(-8, -4))).toBe("IEND");
    expect(png.byteLength).toBeGreaterThan(100);
  });

  it("generates a valid RIFF/WAVE header of the declared length", () => {
    const wav = buildVoiceWav();
    const text = new TextDecoder().decode(wav.subarray(0, 12));
    expect(text.startsWith("RIFF")).toBe(true);
    expect(text.endsWith("WAVE")).toBe(true);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it("produces identical bytes on every run", () => {
    expect(Array.from(buildAttachmentPng())).toEqual(Array.from(buildAttachmentPng()));
    expect(Array.from(buildVoiceWav())).toEqual(Array.from(buildVoiceWav()));
  });
});

describe("planDataset", () => {
  it("reports counts without any credentials or I/O", () => {
    const plan = planDataset();
    expect(plan.accounts).toBe(100);
    expect(plan.directConversations).toBe(2);
    expect(plan.groupConversations).toBe(1);
    expect(plan.attachmentFixtures).toBe(1);
    expect(plan.voiceFixtures).toBe(1);
    expect(plan.buddyEdges).toBeGreaterThan(100);
  });

  it("contains nothing secret", () => {
    const serialised = JSON.stringify(planDataset());
    expect(serialised).not.toMatch(/password|service_role|secret|key/i);
  });
});
