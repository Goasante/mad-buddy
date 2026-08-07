import { describe, expect, it } from "vitest";
import { loadSafeArrivalJourneys } from "@/lib/safety/safe-arrival-service";

/**
 * Drives the REAL loader against a stubbed Supabase client, so the acceptance
 * scenario is executed rather than asserted about by reading source.
 *
 * Scenario (spec §12):
 *   Traveller A invites B, C and D.
 *   B and C are Muddies with each other. B and D are NOT Muddies.
 *   A must never see more confirmed contacts than have actually accepted.
 *   B may identify C, but D must stay anonymous.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const SESSION = "5e551011-0000-4000-8000-000000000009";

type Ack = "pending" | "watching" | "declined";

/** Stored acknowledgement per contact for one scenario run. */
type Acks = Record<string, Ack>;

/**
 * Minimal chainable stand-in for the Supabase client. Every filter method
 * returns the builder; awaiting it resolves the rows for that table. Only the
 * tables and shapes this loader actually touches are implemented.
 */
function makeAdmin(input: { acks: Acks; friendships: [string, string][]; blocks?: [string, string][] }) {
  const sessionRow = {
    id: SESSION,
    traveller_id: A,
    destination_label: "Osu",
    expected_arrival_at: new Date(Date.now() + 3_600_000).toISOString(),
    grace_period_minutes: 20,
    note: null,
    status: "active",
    started_at: new Date(Date.now() - 600_000).toISOString(),
    confirmed_at: null,
    cancelled_at: null
  };

  const profiles = [
    { user_id: A, full_name: "Traveller A", avatar_url: "a.png" },
    { user_id: B, full_name: "Muddy B", avatar_url: "b.png" },
    { user_id: C, full_name: "Muddy C", avatar_url: "c.png" },
    { user_id: D, full_name: "Muddy D", avatar_url: "d.png" }
  ];

  const contactRows = Object.entries(input.acks).map(([contact_user_id, acknowledgement_status]) => ({
    session_id: SESSION,
    contact_user_id,
    acknowledgement_status
  }));

  return {
    from(table: string) {
      const state: { eqUser?: string } = {};
      const builder = {
        select: () => builder,
        order: () => builder,
        in: () => builder,
        maybeSingle: () => builder,
        limit: () => builder,
        eq: (column: string, value: string) => {
          if (column === "contact_user_id") state.eqUser = value;
          return builder;
        },
        or: () => builder,
        // Active-friend reads filter on ended_at; these fixtures are all
        // active friendships, so the filter is a no-op here.
        is: () => builder,
        then(resolve: (result: { data: unknown }) => unknown) {
          if (table === "safe_arrival_sessions") return resolve({ data: [sessionRow] });
          if (table === "profiles") return resolve({ data: profiles });
          if (table === "friendships") {
            return resolve({
              data: input.friendships.map(([one, two]) => ({
                user_one_id: one,
                user_two_id: two,
                ended_at: null
              }))
            });
          }
          if (table === "blocked_users") {
            return resolve({
              data: (input.blocks ?? []).map(([blocker, blocked]) => ({ blocker_id: blocker, blocked_id: blocked }))
            });
          }
          if (table === "safe_arrival_contacts") {
            // Scoped read ("which journeys am I a contact on?") vs the full roster.
            const rows = state.eqUser
              ? contactRows.filter((row) => row.contact_user_id === state.eqUser)
              : contactRows;
            return resolve({ data: rows });
          }
          return resolve({ data: [] });
        }
      };
      return builder;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A is friends with everyone; B and C are friends; B and D are not. */
const FRIENDSHIPS: [string, string][] = [
  [A, B],
  [A, C],
  [A, D],
  [B, C]
];

describe("acceptance scenario: A invites B, C and D", () => {
  it("reports 0 confirmed and 3 awaiting before anyone answers", async () => {
    const admin = makeAdmin({ acks: { [B]: "pending", [C]: "pending", [D]: "pending" }, friendships: FRIENDSHIPS });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);

    expect(travelling).toHaveLength(1);
    expect(travelling[0].acceptedCount).toBe(0);
    expect(travelling[0].invitedCount).toBe(3);
    // Everyone chosen is still visible to the traveller, just not confirmed.
    expect(travelling[0].contacts).toHaveLength(3);
  });

  it("reports 1 confirmed and 2 awaiting after B accepts", async () => {
    const admin = makeAdmin({ acks: { [B]: "watching", [C]: "pending", [D]: "pending" }, friendships: FRIENDSHIPS });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);

    expect(travelling[0].acceptedCount).toBe(1);
    expect(travelling[0].invitedCount).toBe(2);
  });

  it("reports 2 confirmed and 1 awaiting after C accepts, never 3", async () => {
    const admin = makeAdmin({ acks: { [B]: "watching", [C]: "watching", [D]: "pending" }, friendships: FRIENDSHIPS });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);

    // The reported bug: this state used to claim three people were checking in.
    expect(travelling[0].acceptedCount).toBe(2);
    expect(travelling[0].invitedCount).toBe(1);
    expect(travelling[0].alertableCount).toBe(3);
  });

  it("reports 3 confirmed only once D has actually accepted", async () => {
    const admin = makeAdmin({ acks: { [B]: "watching", [C]: "watching", [D]: "watching" }, friendships: FRIENDSHIPS });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);

    expect(travelling[0].acceptedCount).toBe(3);
    expect(travelling[0].invitedCount).toBe(0);
  });

  it("excludes a declined contact from the count and the visible list", async () => {
    const admin = makeAdmin({ acks: { [B]: "watching", [C]: "declined", [D]: "pending" }, friendships: FRIENDSHIPS });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);

    expect(travelling[0].acceptedCount).toBe(1);
    expect(travelling[0].invitedCount).toBe(1);
    expect(travelling[0].contacts.map((contact) => contact.id)).not.toContain(C);
  });
});

describe("acceptance scenario: contact identity privacy", () => {
  it("lets B identify C but never D", async () => {
    const admin = makeAdmin({
      acks: { [B]: "watching", [C]: "watching", [D]: "watching" },
      friendships: FRIENDSHIPS
    });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);

    expect(checkingOn).toHaveLength(1);
    const contacts = checkingOn[0].contacts;

    // B sees themselves.
    const me = contacts.find((contact) => contact.isSelf);
    expect(me?.id).toBe(B);

    // C is B's Muddy, so C is identifiable.
    const c = contacts.find((contact) => contact.id === C);
    expect(c?.name).toBe("Muddy C");

    // D is NOT B's Muddy. No id, name or avatar may be present anywhere in the
    // payload, so there is nothing for the client to hide or reveal.
    expect(contacts.some((contact) => contact.id === D)).toBe(false);
    const serialized = JSON.stringify(checkingOn[0]);
    expect(serialized).not.toContain(D);
    expect(serialized).not.toContain("Muddy D");
    expect(serialized).not.toContain("d.png");

    // D still exists as an anonymous row, so the count stays honest.
    const anonymous = contacts.filter((contact) => contact.name === null);
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0].id).toBeNull();
    expect(anonymous[0].avatarUrl).toBeNull();
    expect(checkingOn[0].acceptedCount).toBe(3);
  });

  it("keeps D anonymous to B even while D is only invited", async () => {
    const admin = makeAdmin({
      acks: { [B]: "watching", [C]: "watching", [D]: "pending" },
      friendships: FRIENDSHIPS
    });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);
    expect(JSON.stringify(checkingOn[0])).not.toContain("Muddy D");
    expect(checkingOn[0].acceptedCount).toBe(2);
    expect(checkingOn[0].invitedCount).toBe(1);
  });

  it("gives the traveller every contact's identity, since they chose them", async () => {
    const admin = makeAdmin({
      acks: { [B]: "watching", [C]: "pending", [D]: "pending" },
      friendships: FRIENDSHIPS
    });
    const { travelling } = await loadSafeArrivalJourneys(admin, A);
    const names = travelling[0].contacts.map((contact) => contact.name);
    expect(names).toContain("Muddy B");
    expect(names).toContain("Muddy C");
    expect(names).toContain("Muddy D");
    expect(names).not.toContain(null);
  });

  it("anonymises a contact who blocked the viewer, even if a friendship row exists", async () => {
    // Blocked in either direction is not a Muddy for identity purposes.
    const admin = makeAdmin({
      acks: { [B]: "watching", [C]: "watching" },
      friendships: FRIENDSHIPS,
      blocks: [[C, B]]
    });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);
    expect(JSON.stringify(checkingOn[0])).not.toContain("Muddy C");
    expect(checkingOn[0].acceptedCount).toBe(2);
  });

  it("never lets an anonymous row carry a user id as its React key", async () => {
    const admin = makeAdmin({
      acks: { [B]: "watching", [D]: "watching" },
      friendships: FRIENDSHIPS
    });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);
    for (const contact of checkingOn[0].contacts) {
      if (contact.name === null) {
        expect(contact.key).toMatch(/^anon-\d+$/);
        expect(contact.key).not.toContain(D);
      }
    }
  });

  it("marks the viewer's own acknowledgement with the product vocabulary", async () => {
    const admin = makeAdmin({ acks: { [B]: "pending", [C]: "watching" }, friendships: FRIENDSHIPS });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);
    expect(checkingOn[0].myAcknowledgement).toBe("invited");

    const accepted = makeAdmin({ acks: { [B]: "watching", [C]: "watching" }, friendships: FRIENDSHIPS });
    const result = await loadSafeArrivalJourneys(accepted, B);
    expect(result.checkingOn[0].myAcknowledgement).toBe("accepted");
  });

  it("identifies the traveller to their contacts", async () => {
    const admin = makeAdmin({ acks: { [B]: "watching" }, friendships: FRIENDSHIPS });
    const { checkingOn } = await loadSafeArrivalJourneys(admin, B);
    // The traveller chose them, so the traveller is never anonymous.
    expect(checkingOn[0].travellerName).toBe("Traveller A");
    expect(checkingOn[0].isTraveller).toBe(false);
  });
});
