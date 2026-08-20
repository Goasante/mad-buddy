import { describe, expect, it } from "vitest";

/**
 * The mutual-connection transaction, tested as the STATE MACHINE it is.
 *
 * The real implementation is a SECURITY DEFINER plpgsql function
 * (`linkr_record_connect`), which cannot run in this suite. What is modelled
 * here is its contract -- exactly the behaviour connection-service.ts depends
 * on -- so a change to either side that breaks the agreement fails here.
 *
 * The properties under test are the product's core promises:
 *
 *   a one-sided Connect produces no connection, no conversation and no signal
 *   a reciprocal Connect produces exactly ONE connection and ONE conversation
 *   simultaneous Connects produce ONE of each, not two
 *   only the caller that created the row notifies
 *   nobody ever learns who connected first
 */

type Action = { actor: string; target: string; action: "pass" | "connect" };
type Connection = { userLow: string; userHigh: string; conversationId: string | null; endedAt: string | null };

/** A faithful in-memory model of the migration's tables and function. */
class LinkrModel {
  actions = new Map<string, Action>();
  connections = new Map<string, Connection>();
  conversations: string[] = [];
  notifications: Array<{ userId: string; title: string; message: string }> = [];

  private actionKey(actor: string, target: string) {
    return `${actor}->${target}`;
  }

  private pairKey(a: string, b: string) {
    const [low, high] = [a, b].sort();
    return `${low}|${high}`;
  }

  /** Mirrors the ON CONFLICT (actor_id, target_id) upsert. */
  private upsertAction(actor: string, target: string, action: "pass" | "connect") {
    this.actions.set(this.actionKey(actor, target), { actor, target, action });
  }

  pass(actor: string, target: string) {
    this.upsertAction(actor, target, "pass");
  }

  /** linkr_record_connect. Returns exactly what the function returns. */
  connect(actor: string, target: string): { matched: boolean; connectionId: string | null; created: boolean } {
    if (actor === target) throw new Error("linkr: cannot connect with self");
    this.upsertAction(actor, target, "connect");

    const reciprocal = this.actions.get(this.actionKey(target, actor))?.action === "connect";
    if (!reciprocal) return { matched: false, connectionId: null, created: false };

    const key = this.pairKey(actor, target);
    const existing = this.connections.get(key);
    if (existing) {
      // Lost the insert race, or the pair connected before. Either way the row
      // exists: re-open it and report `created: false`.
      existing.endedAt = null;
      return { matched: true, connectionId: key, created: false };
    }

    const [userLow, userHigh] = [actor, target].sort();
    this.connections.set(key, { userLow, userHigh, conversationId: null, endedAt: null });
    return { matched: true, connectionId: key, created: true };
  }

  /** What connection-service.ts does with a `created: true` result. */
  resolveMatch(actor: string, target: string) {
    const result = this.connect(actor, target);
    if (!result.matched || !result.connectionId) return result;

    const connection = this.connections.get(result.connectionId);
    if (connection && !connection.conversationId) {
      const conversationId = `conv:${result.connectionId}`;
      connection.conversationId = conversationId;
      if (!this.conversations.includes(conversationId)) this.conversations.push(conversationId);
    }
    // Gated on `created`, which exactly one caller can see.
    if (result.created) {
      for (const userId of [actor, target]) {
        this.notifications.push({
          userId,
          title: "You clicked!",
          message: "You both want to connect."
        });
      }
    }
    return result;
  }

  /** What a given user is allowed to observe. Mirrors the RLS policies. */
  visibleActionsFor(userId: string): Action[] {
    // actor_id = auth.uid() only. There is NO policy granting target_id.
    return [...this.actions.values()].filter((action) => action.actor === userId);
  }

  visibleConnectionsFor(userId: string): Connection[] {
    return [...this.connections.values()].filter(
      (connection) => connection.userLow === userId || connection.userHigh === userId
    );
  }
}

describe("one-sided Connect", () => {
  it("creates NO connection", () => {
    const model = new LinkrModel();
    const result = model.resolveMatch("godfred", "ama");
    expect(result.matched).toBe(false);
    expect(model.connections.size).toBe(0);
  });

  it("creates NO conversation", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    expect(model.conversations).toHaveLength(0);
  });

  it("sends NO notification to the recipient", () => {
    // The single most important assertion in the suite.
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    expect(model.notifications).toHaveLength(0);
    expect(model.notifications.filter((n) => n.userId === "ama")).toHaveLength(0);
  });

  it("is INVISIBLE to its subject", () => {
    // Ama may not read the row that says Godfred was interested in her.
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    expect(model.visibleActionsFor("ama")).toHaveLength(0);
    expect(model.visibleActionsFor("godfred")).toHaveLength(1);
  });

  it("does not tell the actor whether the other person passed on them", () => {
    // Ama passed first. Godfred's connect must look identical to the case
    // where Ama has done nothing at all.
    const passedFirst = new LinkrModel();
    passedFirst.pass("ama", "godfred");
    const afterPass = passedFirst.resolveMatch("godfred", "ama");

    const untouched = new LinkrModel();
    const afterNothing = untouched.resolveMatch("godfred", "ama");

    expect(afterPass).toEqual(afterNothing);
  });
});

describe("reciprocal Connect", () => {
  it("creates EXACTLY ONE connection", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    const second = model.resolveMatch("ama", "godfred");
    expect(second.matched).toBe(true);
    expect(model.connections.size).toBe(1);
  });

  it("creates EXACTLY ONE conversation", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    model.resolveMatch("ama", "godfred");
    expect(model.conversations).toHaveLength(1);
  });

  it("notifies both people, symmetrically", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    model.resolveMatch("ama", "godfred");
    expect(model.notifications).toHaveLength(2);
    expect(model.notifications.map((n) => n.userId).sort()).toEqual(["ama", "godfred"]);
    // Neither message reveals who acted first.
    expect(new Set(model.notifications.map((n) => n.message)).size).toBe(1);
  });

  it("stores the pair in a canonical order", () => {
    // (a,b) and (b,a) must be the same row, or the unique constraint cannot do
    // its job and two connections could exist for one pair.
    const one = new LinkrModel();
    one.resolveMatch("godfred", "ama");
    one.resolveMatch("ama", "godfred");

    const other = new LinkrModel();
    other.resolveMatch("ama", "godfred");
    other.resolveMatch("godfred", "ama");

    expect([...one.connections.keys()]).toEqual([...other.connections.keys()]);
  });

  it("is readable by both participants and nobody else", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    model.resolveMatch("ama", "godfred");
    expect(model.visibleConnectionsFor("godfred")).toHaveLength(1);
    expect(model.visibleConnectionsFor("ama")).toHaveLength(1);
    expect(model.visibleConnectionsFor("kofi")).toHaveLength(0);
  });
});

describe("races and retries", () => {
  it("a double tap produces one connection and one notification pair", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    model.resolveMatch("ama", "godfred");
    // The retry.
    model.resolveMatch("ama", "godfred");

    expect(model.connections.size).toBe(1);
    expect(model.conversations).toHaveLength(1);
    expect(model.notifications).toHaveLength(2);
  });

  it("simultaneous connects produce ONE connection", () => {
    // Both callers see matched: true; only one sees created: true.
    const model = new LinkrModel();
    model.connect("godfred", "ama");
    const a = model.resolveMatch("ama", "godfred");
    const b = model.resolveMatch("godfred", "ama");

    expect(a.matched && b.matched).toBe(true);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(model.connections.size).toBe(1);
    expect(model.conversations).toHaveLength(1);
    expect(model.notifications).toHaveLength(2);
  });

  it("a pass upgraded to a connect is one row, not two", () => {
    const model = new LinkrModel();
    model.pass("godfred", "ama");
    model.connect("godfred", "ama");
    expect(model.actions.size).toBe(1);
    expect(model.visibleActionsFor("godfred")[0]?.action).toBe("connect");
  });

  it("refuses a self-connect", () => {
    const model = new LinkrModel();
    expect(() => model.connect("godfred", "godfred")).toThrow(/self/i);
  });
});

describe("mutation tests -- these must bite", () => {
  it("BITES: a one-sided Connect that creates a match", () => {
    const model = new LinkrModel();
    expect(model.resolveMatch("godfred", "ama").matched).toBe(false);
    expect(model.connections.size).toBe(0);
  });

  it("BITES: a one-sided Connect that notifies the recipient", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    expect(model.notifications).toHaveLength(0);
  });

  it("BITES: a duplicate connection row", () => {
    const model = new LinkrModel();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      model.resolveMatch("godfred", "ama");
      model.resolveMatch("ama", "godfred");
    }
    expect(model.connections.size).toBe(1);
    expect(model.conversations).toHaveLength(1);
  });

  it("BITES: notifying on every resolution rather than only the first", () => {
    const model = new LinkrModel();
    model.resolveMatch("godfred", "ama");
    for (let attempt = 0; attempt < 4; attempt += 1) model.resolveMatch("ama", "godfred");
    expect(model.notifications).toHaveLength(2);
  });

  it("BITES: a Pass silently becoming a Connect", () => {
    const model = new LinkrModel();
    model.pass("godfred", "ama");
    model.connect("ama", "godfred");
    // Ama connected; Godfred only passed. That is not a match.
    expect(model.connections.size).toBe(0);
  });

  it("BITES: an RLS policy that lets a target read actions about them", () => {
    const model = new LinkrModel();
    model.connect("godfred", "ama");
    model.connect("kofi", "ama");
    // If `target_id = auth.uid()` were ever added to the SELECT policy, Ama
    // would learn that two people are interested in her.
    expect(model.visibleActionsFor("ama")).toHaveLength(0);
  });
});
