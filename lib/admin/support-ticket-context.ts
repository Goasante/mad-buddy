import type { SupportDoctorPriorityInput } from "@/lib/admin/support-doctor-priority";

/**
 * SAFE ROUTING CONTEXT FROM A SUPPORT TICKET.
 *
 * Account Doctor orders its checks by what the ticket is about. The temptation
 * is to hand it the ticket text, which would be both the most useful signal and
 * the wrong thing to do: a support conversation contains whatever the user
 * typed -- names, addresses, what they said to somebody -- and none of it
 * belongs in a routing decision or in anything derived from one.
 *
 * So the contract is deliberately narrow:
 *
 *   - the ticket ID travels in the URL;
 *   - the SERVER loads the ticket and takes only `category`, which is a fixed
 *     enum the product controls;
 *   - `subject` and `description` are never read for routing.
 *
 * Passing the category in the query string instead would be simpler and wrong:
 * anything in a URL is caller-supplied, and an operator (or anything that can
 * craft a link) could steer the Doctor's ordering to an area the ticket is not
 * about. Resolving it server-side from the id makes the ticket the authority.
 */

/** The category values `support_tickets.category` is constrained to. */
const TICKET_CATEGORIES = [
  "getting_started",
  "muddies",
  "visibility",
  "location",
  "plans",
  "billing",
  "privacy",
  "security",
  "communities",
  "reporting",
  "account_deletion",
  "other"
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export function isTicketCategory(value: unknown): value is TicketCategory {
  return typeof value === "string" && (TICKET_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Everything Account Doctor is allowed to learn from a ticket.
 *
 * There is no `subject`, no `description`, no message content, and no room to
 * add one without changing this type -- which is the point.
 */
export type SupportTicketContext = {
  ticketId: string;
  category: TicketCategory | null;
};

/**
 * Turns the allowlisted context into routing input.
 *
 * `affectedFeature` is deliberately left null. The product has no structured
 * affected-feature field on a ticket today, and the only text that could fill
 * it is the description -- exactly what must not reach the prioritiser. When a
 * controlled field exists, it goes here and nowhere else.
 */
export function routingInputFor(context: SupportTicketContext | null): SupportDoctorPriorityInput {
  return { category: context?.category ?? null, affectedFeature: null };
}
