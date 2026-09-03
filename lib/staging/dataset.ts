/**
 * The deterministic staging dataset.
 *
 * Everything here is a PURE function of the account count. The same input
 * always produces the same usernames, the same buddy edges, the same message
 * bodies and the same timestamps -- which is what makes the seeder rerunnable
 * and the runtime proofs reproducible.
 *
 * No randomness. `Math.random()` must never appear in this file: a dataset
 * that differs between runs cannot be diffed when a runtime proof fails.
 */

export const STAGING_ACCOUNT_COUNT = 100;

/**
 * `example.com` is reserved by RFC 2606 and can never be delivered to, so a
 * synthetic account can never collide with -- or send mail to -- a real
 * person. The `staging-user-NNN` shape is also the cleanup discriminator:
 * these are the only rows this seeder owns.
 */
export const STAGING_EMAIL_DOMAIN = "staging.example.com";

/** Marks every row this seeder owns, so cleanup can never touch unknown data. */
export const STAGING_MARKER = "mad-buddy-staging-fixture";

/** Fixed clock so timestamps are identical across runs and machines. */
export const DATASET_EPOCH = Date.UTC(2026, 8, 1, 12, 0, 0);

export type StagingAccount = {
  /** 1-based index. `staging-user-001` is index 1. */
  index: number;
  label: string;
  email: string;
  username: string;
  fullName: string;
  bio: string;
  intent: "friends" | "dating" | "networking" | "anything";
  /** ISO date. Every account is comfortably 18+; see ageOnEpoch(). */
  dateOfBirth: string;
  isOnboarded: boolean;
};

const FIRST_NAMES = [
  "Ama", "Kwame", "Akua", "Kofi", "Abena", "Yaw", "Adwoa", "Kojo",
  "Efua", "Kwabena", "Esi", "Fiifi", "Maame", "Nana", "Afia", "Kwaku",
  "Araba", "Ebo", "Aba", "Kwesi"
];

const LAST_NAMES = [
  "Mensah", "Boateng", "Owusu", "Asante", "Appiah", "Darko", "Frimpong",
  "Agyeman", "Osei", "Danquah"
];

const BIO_TEMPLATES = [
  "Weekend hiker and terrible chess player.",
  "Here for good jollof and better conversation.",
  "Runs on coffee and live music.",
  "Board games, bad puns, long walks.",
  "Trying every street food stall in the city.",
  "Film photography and slow mornings.",
  "Five-a-side on Thursdays, always short a player.",
  "Reading more, scrolling less."
];

const INTENTS: StagingAccount["intent"][] = ["friends", "dating", "networking", "anything"];

/** Deterministic, non-cryptographic. Used only to vary fixture content. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pad(index: number): string {
  return String(index).padStart(3, "0");
}

/** Age at DATASET_EPOCH, so the 18+ assertion is stable over time. */
export function ageOnEpoch(dateOfBirth: string): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const epoch = new Date(DATASET_EPOCH);
  let age = epoch.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = epoch.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && epoch.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function buildAccount(index: number): StagingAccount {
  const label = `staging-user-${pad(index)}`;
  const seed = hash(label);

  const firstName = FIRST_NAMES[seed % FIRST_NAMES.length];
  const lastName = LAST_NAMES[(seed >> 3) % LAST_NAMES.length];

  // 21..48 years old at the epoch: always adult, never absurd, and varied
  // enough that age-banded queries are not testing one value.
  const age = 21 + (seed % 28);
  const birthYear = new Date(DATASET_EPOCH).getUTCFullYear() - age;
  const birthMonth = 1 + (seed % 12);
  const birthDay = 1 + (seed % 28);

  return {
    index,
    label,
    email: `${label}@${STAGING_EMAIL_DOMAIN}`,
    // profiles_username_format: ^[a-z0-9_]{3,24}$
    username: `staging_user_${pad(index)}`,
    fullName: `${firstName} ${lastName}`,
    bio: BIO_TEMPLATES[seed % BIO_TEMPLATES.length],
    intent: INTENTS[seed % INTENTS.length],
    dateOfBirth: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
    // A deliberate minority are mid-onboarding so Home's activation states are
    // exercised rather than assumed.
    isOnboarded: index % 17 !== 0
  };
}

export function buildAccounts(count: number = STAGING_ACCOUNT_COUNT): StagingAccount[] {
  return Array.from({ length: count }, (_, i) => buildAccount(i + 1));
}

/* ------------------------------------------------------------------ *
 * Buddy graph
 * ------------------------------------------------------------------ */

export type BuddyEdge = { a: number; b: number };

/**
 * A deterministic ring-plus-chord graph.
 *
 * Neither extreme is useful: 100 isolated users make every social surface
 * render zero-state, and a fully connected graph (4950 edges) is unlike any
 * real account and makes N+1 regressions invisible. A ring guarantees nobody
 * is isolated; the chords give each person ~6 Muddies with some clustering.
 *
 * Edges are emitted with a < b to match the `friendships_ordered` constraint
 * (user_one_id < user_two_id), which is also the natural key for idempotency.
 */
export function buildBuddyEdges(count: number = STAGING_ACCOUNT_COUNT): BuddyEdge[] {
  const seen = new Set<string>();
  const edges: BuddyEdge[] = [];

  const add = (x: number, y: number) => {
    if (x === y || x < 1 || y < 1 || x > count || y > count) return;
    const a = Math.min(x, y);
    const b = Math.max(x, y);
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b });
  };

  // The R1-R8 pair and its neighbours come first so they exist even in a
  // reduced-count run used by tests.
  add(1, 2);
  add(1, 3);
  add(1, 4);
  add(1, 5);

  for (let i = 1; i <= count; i += 1) {
    add(i, (i % count) + 1);          // ring: nobody is isolated
    add(i, ((i + 1) % count) + 1);    // short chord: local clusters
    add(i, ((i + 6) % count) + 1);    // long chord: cross-cluster reach
  }

  return edges;
}

/* ------------------------------------------------------------------ *
 * Cohorts
 * ------------------------------------------------------------------ */

export const COHORT_SIZES = [10, 25, 50, 75, 100] as const;
export type CohortName = "cohort10" | "cohort25" | "cohort50" | "cohort75" | "cohort100";

/**
 * Nested prefixes: cohort10 ⊂ cohort25 ⊂ ... ⊂ cohort100. One account set is
 * seeded once; a ramp step is a prefix of it, never a fresh batch.
 */
export function buildCohorts(): Record<CohortName, number[]> {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  return {
    cohort10: range(10),
    cohort25: range(25),
    cohort50: range(50),
    cohort75: range(75),
    cohort100: range(100)
  };
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

/** Canonical direct key: the two ids sorted and colon-joined (matches SQL). */
export function directConversationKey(userIdA: string, userIdB: string): string {
  return userIdA < userIdB ? `${userIdA}:${userIdB}` : `${userIdB}:${userIdA}`;
}

export type PlannedMessage = {
  /** Natural key for idempotency -- also the app's real dedupe column. */
  clientMessageId: string;
  senderIndex: number;
  body: string;
  createdAt: string;
  /** Index into the same array; resolved to a real id at insert time. */
  replyToOffset?: number;
};

const MESSAGE_OPENERS = [
  "did you end up going on Saturday?",
  "that place was packed, we waited 40 minutes",
  "sending the photos now",
  "are we still on for Thursday?",
  "I completely forgot to reply to this, sorry",
  "who else is coming?",
  "found a better spot, sending the link",
  "running about ten minutes late",
  "that was genuinely the best meal I've had this year",
  "let me check and get back to you"
];

const MESSAGE_TAILS = [
  "",
  " Let me know either way.",
  " No rush at all.",
  " I'll sort it out.",
  " Same as last time?",
  " Honestly still thinking about it."
];

/**
 * The R1 long-scroll history.
 *
 * Timestamps walk BACKWARD from the epoch in uneven steps that cross day
 * boundaries, because R1 needs real date separators and a genuinely long
 * scroll -- not 400 rows sharing one timestamp. Order is strictly ascending
 * in the returned array.
 */
export function buildPrimaryConversationMessages(count = 420): PlannedMessage[] {
  const messages: PlannedMessage[] = [];
  let cursor = DATASET_EPOCH - count * 47 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const seed = hash(`primary:${i}`);

    // Alternating but not perfectly: real threads have consecutive runs.
    const senderIndex = seed % 3 === 0 ? 2 : i % 2 === 0 ? 1 : 2;

    const opener = MESSAGE_OPENERS[seed % MESSAGE_OPENERS.length];
    const tail = MESSAGE_TAILS[(seed >> 4) % MESSAGE_TAILS.length];
    // Every ~9th message is long, so bubble height varies for scroll testing.
    const body =
      i % 9 === 0
        ? `${opener}${tail} ${"Adding a longer paragraph here so the thread contains tall bubbles as well as short ones, which is what makes a long scroll behave like a real conversation.".slice(0, 120)}`
        : `${opener}${tail}`;

    // Uneven gaps: minutes within a burst, many hours between bursts.
    const gapMinutes = seed % 11 === 0 ? 60 * (4 + (seed % 9)) : 2 + (seed % 25);
    cursor += gapMinutes * 60 * 1000;

    messages.push({
      clientMessageId: `${STAGING_MARKER}:primary:${String(i).padStart(4, "0")}`,
      senderIndex,
      body,
      createdAt: new Date(cursor).toISOString(),
      // Occasional reply chains, always pointing backward.
      ...(i > 12 && i % 23 === 0 ? { replyToOffset: i - 7 } : {})
    });
  }

  return messages;
}

export function buildSecondaryConversationMessages(count = 24): PlannedMessage[] {
  const messages: PlannedMessage[] = [];
  let cursor = DATASET_EPOCH - count * 31 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const seed = hash(`secondary:${i}`);
    cursor += (5 + (seed % 40)) * 60 * 1000;
    messages.push({
      clientMessageId: `${STAGING_MARKER}:secondary:${String(i).padStart(4, "0")}`,
      senderIndex: i % 2 === 0 ? 1 : 3,
      body: MESSAGE_OPENERS[seed % MESSAGE_OPENERS.length],
      createdAt: new Date(cursor).toISOString()
    });
  }

  return messages;
}

/** Group thread for viewer-role, permissions and mention testing. */
export const GROUP_MEMBER_INDEXES = [1, 2, 3, 4, 5];

export function buildGroupConversationMessages(count = 40): PlannedMessage[] {
  const messages: PlannedMessage[] = [];
  let cursor = DATASET_EPOCH - count * 53 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const seed = hash(`group:${i}`);
    cursor += (3 + (seed % 50)) * 60 * 1000;
    messages.push({
      clientMessageId: `${STAGING_MARKER}:group:${String(i).padStart(4, "0")}`,
      senderIndex: GROUP_MEMBER_INDEXES[seed % GROUP_MEMBER_INDEXES.length],
      body: MESSAGE_OPENERS[seed % MESSAGE_OPENERS.length],
      createdAt: new Date(cursor).toISOString(),
      ...(i > 6 && i % 11 === 0 ? { replyToOffset: i - 4 } : {})
    });
  }

  return messages;
}

/* ------------------------------------------------------------------ *
 * Plan of record
 * ------------------------------------------------------------------ */

export type DatasetPlan = {
  accounts: number;
  buddyEdges: number;
  directConversations: number;
  primaryMessages: number;
  secondaryMessages: number;
  groupConversations: number;
  groupMessages: number;
  attachmentFixtures: number;
  voiceFixtures: number;
  linkrProfiles: number;
  upforSessions: number;
  plans: number;
  events: number;
  groups: number;
  notifications: number;
  cohorts: Record<CohortName, number>;
};

/**
 * Counts only. This is what a dry run prints -- it must never contain
 * credentials, and it is cheap enough to compute without any I/O.
 */
export function planDataset(count: number = STAGING_ACCOUNT_COUNT): DatasetPlan {
  const cohorts = buildCohorts();
  return {
    accounts: count,
    buddyEdges: buildBuddyEdges(count).length,
    directConversations: 2,
    primaryMessages: buildPrimaryConversationMessages().length,
    secondaryMessages: buildSecondaryConversationMessages().length,
    groupConversations: 1,
    groupMessages: buildGroupConversationMessages().length,
    attachmentFixtures: 1,
    voiceFixtures: 1,
    // Linkr is opt-in; a realistic subset rather than everyone.
    linkrProfiles: Math.floor(count * 0.6),
    upforSessions: 12,
    plans: 8,
    events: 6,
    groups: 5,
    notifications: count * 3,
    cohorts: {
      cohort10: cohorts.cohort10.length,
      cohort25: cohorts.cohort25.length,
      cohort50: cohorts.cohort50.length,
      cohort75: cohorts.cohort75.length,
      cohort100: cohorts.cohort100.length
    }
  };
}
