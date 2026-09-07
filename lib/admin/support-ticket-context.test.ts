import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isTicketCategory, routingInputFor } from "@/lib/admin/support-ticket-context";

/**
 * The privacy boundary on ticket routing.
 *
 * A support conversation contains whatever the user typed. Handing it to the
 * prioritiser would be the most useful signal available and the wrong thing to
 * do, so these cases assert the narrowness rather than the behaviour.
 */

describe("only allowlisted ticket metadata reaches routing", () => {
  it("accepts the real category enum and rejects anything else", () => {
    for (const value of ["muddies", "billing", "privacy", "account_deletion", "other"]) {
      expect(isTicketCategory(value)).toBe(true);
    }
    for (const value of ["", "made_up", null, undefined, 7, {}]) {
      expect(isTicketCategory(value)).toBe(false);
    }
  });

  it("never carries free text into the prioritiser", () => {
    const input = routingInputFor({ ticketId: "t-1", category: "muddies" });

    expect(input.category).toBe("muddies");
    /* affectedFeature stays null: the only text that could fill it today is
       the ticket description, which must not reach routing. */
    expect(input.affectedFeature).toBeNull();
  });

  it("degrades safely when there is no ticket", () => {
    expect(routingInputFor(null)).toEqual({ category: null, affectedFeature: null });
  });

  it("the context type has no field that could hold ticket text", () => {
    const source = readFileSync("lib/admin/support-ticket-context.ts", "utf8");
    const block = source.slice(
      source.indexOf("export type SupportTicketContext"),
      source.indexOf("export function routingInputFor")
    );
    /* Field NAMES only. The prose above the type mentions `description`
       precisely to explain why it is absent, and matching on the whole block
       would fail on its own documentation. */
    const fields = [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1].toLowerCase());
    expect(fields).toEqual(["ticketid", "category"]);
    for (const forbidden of ["subject", "description", "body", "message", "notes"]) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it("the Repair Centre page never selects ticket text", () => {
    /* The guard that actually matters: a future edit adding `description` to
       the select would leak it into Admin without changing any type. */
    const page = readFileSync("app/(admin)/admin/repairs/page.tsx", "utf8");
    const select = page.slice(page.indexOf('from("support_tickets")'), page.indexOf('from("support_tickets")') + 200);
    expect(select).toContain('select("id, category")');
    expect(select).not.toContain("description");
    expect(select).not.toContain("subject");
  });
});
