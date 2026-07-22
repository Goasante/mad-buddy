"use server";

import { z } from "zod";
import { deliverNotification } from "@/lib/notifications/server";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

export type HelpActionState = { ok: boolean; message: string };

export type SupportThreadMessage = {
  id: string;
  senderType: "user" | "agent" | "system";
  message: string;
  createdAt: string;
};

export type SupportThread = {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportThreadMessage[];
};

const supportRequestSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(3).max(2000)
});

export async function submitSupportRequestAction(input: unknown): Promise<HelpActionState> {
  const parsed = supportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check your name, email address, and message." };

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { ok: false, message: "Log in before contacting support." };

  const limit = await consumeRateLimit({ action: "support.request", userId: user.id });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const subject = `Help request from ${parsed.data.fullName}`.slice(0, 160);
  const { error } = await supabase.from("support_tickets").insert({
    user_id: user.id,
    category: "other",
    subject,
    description: parsed.data.message,
    diagnostics: { route: "/help" },
    priority: "normal",
    status: "new"
  });
  return error
    ? { ok: false, message: "Couldn't send your message. Try again." }
    : { ok: true, message: "Thanks, your message was sent." };
}

/**
 * The signed-in user's own support conversations (their tickets + the public
 * back-and-forth). Never exposes internal notes (a separate table) or
 * diagnostics. The original request body is shown as the first user message.
 */
export async function getMySupportThreadsAction(): Promise<SupportThread[]> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return [];
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createSupabaseAdminClient();
  const { data: tickets } = await admin
    .from("support_tickets")
    .select("id, subject, status, description, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (!tickets || tickets.length === 0) return [];

  const ticketIds = tickets.map((ticket) => ticket.id);
  const { data: messages } = await admin
    .from("support_ticket_messages")
    .select("id, ticket_id, sender_type, message, created_at")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true });

  const messagesByTicket = new Map<string, SupportThreadMessage[]>();
  for (const row of messages ?? []) {
    if (!messagesByTicket.has(row.ticket_id)) messagesByTicket.set(row.ticket_id, []);
    messagesByTicket.get(row.ticket_id)!.push({
      id: row.id,
      senderType: row.sender_type,
      message: row.message,
      createdAt: row.created_at
    });
  }

  return tickets.map((ticket) => ({
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    // Prepend the original request so the thread reads top-to-bottom.
    messages: [
      { id: `${ticket.id}-original`, senderType: "user" as const, message: ticket.description, createdAt: ticket.created_at },
      ...(messagesByTicket.get(ticket.id) ?? [])
    ]
  }));
}

const replySchema = z.object({
  ticketId: z.string().uuid(),
  message: z.string().trim().min(2).max(2000)
});

/** Add a user reply to one of their own support tickets and nudge the agent. */
export async function replyToSupportThreadAction(input: unknown): Promise<HelpActionState> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a reply (2–2000 characters)." };

  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return { ok: false, message: "Support is unavailable right now." };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Log in before replying." };

  const limit = await consumeRateLimit({ action: "support.request", userId: user.id });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();
  // The ticket must belong to this user (never trust the client id).
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, user_id, status, assigned_to, subject")
    .eq("id", parsed.data.ticketId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!ticket) return { ok: false, message: "That request is unavailable." };

  const { error } = await admin.from("support_ticket_messages").insert({
    ticket_id: ticket.id,
    sender_type: "user",
    sender_id: user.id,
    message: parsed.data.message
  });
  if (error) return { ok: false, message: "Couldn't send your reply. Try again." };

  // A user reply needs an agent's attention again — reopen unless it's new/open.
  if (ticket.status !== "new" && ticket.status !== "open") {
    await admin.from("support_tickets").update({ status: "open" }).eq("id", ticket.id);
  }

  // Notify the assigned agent (if any) that the user replied.
  if (ticket.assigned_to) {
    await deliverNotification(admin, {
      userId: ticket.assigned_to,
      senderId: user.id,
      type: `support_user_reply:${ticket.id}`,
      priority: "high",
      title: "A user replied to a support issue",
      message: parsed.data.message.length > 140 ? `${parsed.data.message.slice(0, 137)}…` : parsed.data.message
    });
  }

  return { ok: true, message: "Reply sent." };
}
