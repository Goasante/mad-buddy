import { NextResponse, after } from "next/server";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { sendMessage, sendMessageSchema, type MessagingResult } from "@/lib/messaging/mobile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const COMMIT_PROBE_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

type ObservedSend =
  | { kind: "result"; result: MessagingResult }
  | { kind: "error"; error: unknown };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function findCommittedSend(
  userId: string,
  input: { conversationId: string; clientMessageId: string; mediaId?: string }
): Promise<MessagingResult | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("messages")
    .select("id, conversation_id, media_id")
    .eq("sender_id", userId)
    .eq("client_message_id", input.clientMessageId)
    .maybeSingle();

  if (!data) return null;
  if (data.conversation_id !== input.conversationId) return null;
  if (data.media_id !== (input.mediaId ?? null)) return null;
  return { ok: true, message: "Sent.", messageId: data.id };
}

function keepPostCommitWorkAlive(send: Promise<MessagingResult>) {
  after(async () => {
    try {
      await send;
    } catch (error) {
      // The canonical row was already proven durable before the response was
      // returned. Notification/progression follow-up must never retroactively
      // turn that committed message into a user-facing send failure.
      console.error("[messaging] post-commit send follow-up failed", {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

// Send a message. Shared with sendMessageAction; idempotent on clientMessageId.
export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) {
    return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  }

  const input = await request.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    const result = await sendMessage(auth.user.id, input);
    return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
  }

  /*
   * The message INSERT is the acknowledgement boundary.
   *
   * sendMessage() deliberately performs useful follow-up after that insert:
   * conversation projection updates, mention persistence, recipient
   * notification work and activation bookkeeping. None of those is allowed to
   * make the sender stare at "Sending…" once the canonical row is already in
   * Postgres. Race the full service result against a few tiny, sender-scoped
   * idempotency probes. If the service finishes first, return it normally. If
   * the durable row wins, return success immediately and keep the remaining
   * work alive with Next after().
   */
  const sendPromise = sendMessage(auth.user.id, parsed.data);
  const observed: Promise<ObservedSend> = sendPromise.then(
    (result) => ({ kind: "result" as const, result }),
    (error) => ({ kind: "error" as const, error })
  );

  for (const delayMs of COMMIT_PROBE_DELAYS_MS) {
    const race = await Promise.race([
      observed,
      sleep(delayMs).then(() => ({ kind: "probe" as const }))
    ]);

    if (race.kind === "result") {
      return withCors(
        NextResponse.json(race.result, { status: race.result.ok ? 200 : 400 }),
        request
      );
    }

    if (race.kind === "error") {
      const committed = await findCommittedSend(auth.user.id, parsed.data);
      if (committed) {
        return withCors(NextResponse.json(committed, { status: 200 }), request);
      }
      throw race.error;
    }

    const committed = await findCommittedSend(auth.user.id, parsed.data);
    if (committed) {
      keepPostCommitWorkAlive(sendPromise);
      return withCors(NextResponse.json(committed, { status: 200 }), request);
    }
  }

  const final = await observed;
  if (final.kind === "result") {
    return withCors(
      NextResponse.json(final.result, { status: final.result.ok ? 200 : 400 }),
      request
    );
  }

  const committed = await findCommittedSend(auth.user.id, parsed.data);
  if (committed) return withCors(NextResponse.json(committed, { status: 200 }), request);
  throw final.error;
}
