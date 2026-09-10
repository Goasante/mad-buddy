from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


mobile = "lib/messaging/mobile.ts"
replace_once(
    mobile,
    'import { z } from "zod";\n',
    'import { after } from "next/server";\nimport { z } from "zod";\n',
    "mobile after import",
)

old_send_tail = '''  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.conversationId);

  /* Speaking in a chat you hid brings it back for you.
   *
   * The reappearance rule (last_user_message_at > hidden_at) already covers
   * the RECIPIENTS of this message. It does not cover the sender, whose
   * hidden_at is newer than every message that existed when they hid it --
   * without this, you could message someone and still not see the
   * conversation in your own inbox. Scoped to the sender's row only. */
  await admin
    .from("conversation_members")
    .update({ hidden_at: null, updated_at: new Date().toISOString() })
    .eq("conversation_id", parsed.data.conversationId)
    .eq("user_id", userId)
    .not("hidden_at", "is", null);

  /* Mentions are stored only now, against a message that definitely exists,
   * so a failed send can never leave orphan rows. persistMentions re-checks
   * every id against current joined membership and returns the ones it kept,
   * which is exactly the set the notification step marks -- one source of
   * truth for "who was mentioned". */
  const mentionedUserIds = await persistMentions(
    admin,
    parsed.data.conversationId,
    message.id,
    userId,
    parsed.data.mentionUserIds ?? []
  );

  await notifyOtherMembers(
    admin,
    parsed.data.conversationId,
    userId,
    messagePreviewText(messageType, parsed.data.text) ?? "",
    mentionedUserIds
  );

  await recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId);

  return { ok: true, message: "Sent.", messageId: message.id };
}
'''
new_send_tail = '''  /* The message row is durable now. Keep only state that must be coherent before
   * acknowledgement on the critical path, and do those independent writes in
   * parallel. A normal text with no mentions therefore pays one parallel
   * metadata round instead of three serial rounds. */
  const [mentionedUserIds] = await Promise.all([
    persistMentions(
      admin,
      parsed.data.conversationId,
      message.id,
      userId,
      parsed.data.mentionUserIds ?? []
    ),
    admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", parsed.data.conversationId),
    admin
      .from("conversation_members")
      .update({ hidden_at: null, updated_at: new Date().toISOString() })
      .eq("conversation_id", parsed.data.conversationId)
      .eq("user_id", userId)
      .not("hidden_at", "is", null)
  ]);

  /* Notification fan-out and activation bookkeeping are not evidence that
   * the message was accepted -- the INSERT above is. Running them after the
   * response keeps push/analytics failures from holding the sender in a fake
   * "sending" state. Next's after() keeps this work attached to the request
   * lifecycle instead of abandoning an un-awaited promise when a serverless
   * invocation returns. */
  await scheduleAfterMessageAcknowledgement(async () => {
    await Promise.allSettled([
      notifyOtherMembers(
        admin,
        parsed.data.conversationId,
        userId,
        messagePreviewText(messageType, parsed.data.text) ?? "",
        mentionedUserIds
      ),
      recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId)
    ]);
  });

  return { ok: true, message: "Sent.", messageId: message.id };
}

/**
 * Registers post-send work with Next's request lifecycle. Unit/integration
 * harnesses can invoke sendMessage outside a Next request; in that case we
 * await the same work so tests remain deterministic and no behavior is lost.
 */
async function scheduleAfterMessageAcknowledgement(task: () => Promise<void>): Promise<void> {
  try {
    after(async () => {
      try {
        await task();
      } catch {
        console.warn("[messaging] post-send side effect failed");
      }
    });
  } catch {
    try {
      await task();
    } catch {
      console.warn("[messaging] post-send side effect failed");
    }
  }
}
'''
replace_once(mobile, old_send_tail, new_send_tail, "send acknowledgement tail")

replace_once(
    mobile,
    '  options: { limit?: number; messageId?: string; clientMessageId?: string } = {}\n',
    '  options: { limit?: number; messageId?: string; clientMessageId?: string; before?: { createdAt: string; id: string } } = {}\n',
    "cursor options",
)
replace_once(
    mobile,
    '  if (options.clientMessageId && (options.clientMessageId.length < 1 || options.clientMessageId.length > 64)) return [];\n\n  const admin = createSupabaseAdminClient();\n',
    '  if (options.clientMessageId && (options.clientMessageId.length < 1 || options.clientMessageId.length > 64)) return [];\n  if (options.before && (!uuidSchema.safeParse(options.before.id).success || !Number.isFinite(Date.parse(options.before.createdAt)))) return [];\n\n  const admin = createSupabaseAdminClient();\n',
    "cursor validation",
)
old_query = '''  const { data: messages } = options.messageId
    ? await baseQuery.eq("id", options.messageId).limit(1)
    : options.clientMessageId
      ? await baseQuery
          .eq("sender_id", userId)
          .eq("client_message_id", options.clientMessageId)
          .limit(1)
    : await baseQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageLimit);
'''
new_query = '''  let historyQuery = baseQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageLimit);
  if (options.before) {
    /* Stable keyset pagination. created_at is the primary ordering key and id
     * breaks timestamp ties, so new messages cannot shift the next page. */
    historyQuery = historyQuery.or(
      `created_at.lt.${options.before.createdAt},and(created_at.eq.${options.before.createdAt},id.lt.${options.before.id})`
    );
  }
  const { data: messages } = options.messageId
    ? await baseQuery.eq("id", options.messageId).limit(1)
    : options.clientMessageId
      ? await baseQuery
          .eq("sender_id", userId)
          .eq("client_message_id", options.clientMessageId)
          .limit(1)
      : await historyQuery;
'''
replace_once(mobile, old_query, new_query, "cursor query")

actions = "app/(app)/messaging-actions.ts"
anchor = '''export async function getRecentMessagesAction(conversationId: string): Promise<ChatMessageView[]> {
  const userId = await getMessagingIdentityId();
  if (!userId) return [];

  return listMessages(userId, conversationId, { limit: PROACTIVE_WARM_MESSAGE_LIMIT });
}
'''
older = anchor + '''
const OLDER_MESSAGE_PAGE_SIZE = 40;

/** Keyset-paginated history used only when the reader scrolls upward. */
export async function getOlderMessagesAction(
  conversationId: string,
  before: { createdAt: string; id: string }
): Promise<{ messages: ChatMessageView[]; hasMore: boolean }> {
  const userId = await getMessagingIdentityId();
  if (!userId) return { messages: [], hasMore: false };

  const rows = await listMessages(userId, conversationId, {
    limit: OLDER_MESSAGE_PAGE_SIZE + 1,
    before
  });
  const hasMore = rows.length > OLDER_MESSAGE_PAGE_SIZE;
  return {
    messages: hasMore ? rows.slice(1) : rows,
    hasMore
  };
}
'''
replace_once(actions, anchor, older, "older messages action")

page = "components/messages/messages-page-v4.tsx"
replace_once(
    page,
    '  getMessageableFriendsAction,\n  getMessagesAction,\n',
    '  getMessageableFriendsAction,\n  getMessagesAction,\n  getOlderMessagesAction,\n',
    "older action import",
)
replace_once(
    page,
    'import { selectWarmConversations, shouldRefreshWarmThread } from "@/lib/messaging/thread-warmup";\n',
    'import { PROACTIVE_WARM_MESSAGE_LIMIT, selectWarmConversations, shouldRefreshWarmThread } from "@/lib/messaging/thread-warmup";\n',
    "warm limit import",
)
replace_once(
    page,
    '  const [loadingMessages, setLoadingMessages] = useState(false);\n',
    '  const [loadingMessages, setLoadingMessages] = useState(false);\n  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);\n  const [hasOlderMessages, setHasOlderMessages] = useState(false);\n',
    "pagination state",
)
replace_once(
    page,
    '    setLoadingMessages(!hasCachedThread);\n    setFeedback("");\n',
    '    setLoadingMessages(!hasCachedThread);\n    setLoadingOlderMessages(false);\n    setHasOlderMessages(false);\n    setFeedback("");\n',
    "pagination reset",
)
replace_once(
    page,
    '      const loaded = await withTimeout(getMessagesAction(conversationId), { operation: "load conversation" });\n',
    '      const loaded = await withTimeout(getRecentMessagesAction(conversationId), { operation: "load recent conversation" });\n',
    "bounded initial load",
)
old_reconcile = '''      loadedFromServerRef.current = requestId;
      const patches = realtimePatchesRef.current.get(conversationId);
      const reconciled = loaded.length === 0
        ? loaded
        : mergeThreadPatches(loaded, patches?.values() ?? []);
      realtimePatchesRef.current.delete(conversationId);
'''
new_reconcile = '''      loadedFromServerRef.current = requestId;
      const patches = realtimePatchesRef.current.get(conversationId);
      const reconciled = loaded.length === 0
        ? loaded
        : mergeThreadPatches(loaded, patches?.values() ?? []);
      /* The local/device cache paints first, but the fresh recent tail becomes
         authoritative once it lands. Older history is fetched explicitly on
         upward scroll so hidden/deleted rows from another device cannot live
         forever only because they sat outside the recent window. */
      setHasOlderMessages(loaded.length >= PROACTIVE_WARM_MESSAGE_LIMIT);
      realtimePatchesRef.current.delete(conversationId);
'''
replace_once(page, old_reconcile, new_reconcile, "bounded reconciliation")

scroll_anchor = '''  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    nearBottomRef.current = true;
    setUnseenIncoming(0);
  }
'''
pagination_fn = '''  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    const first = messages[0];
    if (!conversationId || !first || loadingOlderMessages || !hasOlderMessages) return;

    const node = threadRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    setLoadingOlderMessages(true);
    try {
      const page = await getOlderMessagesAction(conversationId, {
        createdAt: first.createdAt,
        id: first.id
      });
      if (!mountedRef.current || selectedIdRef.current !== conversationId) return;
      setHasOlderMessages(page.hasMore);
      if (page.messages.length === 0) return;
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        const older = page.messages.filter((message) => !known.has(message.id));
        const next = [...older, ...current];
        writeThreadMessages(viewerIdRef.current, conversationId, next);
        return next;
      });
      requestAnimationFrame(() => {
        if (!node || selectedIdRef.current !== conversationId) return;
        node.scrollTop = previousTop + (node.scrollHeight - previousHeight);
      });
    } catch {
      // Progressive history failure must not obscure or block the chat.
    } finally {
      if (mountedRef.current && selectedIdRef.current === conversationId) {
        setLoadingOlderMessages(false);
      }
    }
  }, [hasOlderMessages, loadingOlderMessages, messages]);

''' + scroll_anchor
replace_once(page, scroll_anchor, pagination_fn, "older message loader")
replace_once(
    page,
    '''                  nearBottomRef.current = near;
                  if (near && unseenIncoming > 0) setUnseenIncoming(0);
''',
    '''                  nearBottomRef.current = near;
                  if (node.scrollTop < 80 && hasOlderMessages && !loadingOlderMessages) {
                    void loadOlderMessages();
                  }
                  if (near && unseenIncoming > 0) setUnseenIncoming(0);
''',
    "scroll pagination trigger",
)
replace_once(
    page,
    '''              >
                {loadingMessages && messages.length === 0 ?''',
    '''              >
                {loadingOlderMessages ? <div className="flex justify-center py-2" role="status" aria-label="Loading earlier messages"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : null}
                {loadingMessages && messages.length === 0 ?''',
    "older loading affordance",
)
replace_once(
    page,
    '''    if (outcome === "pending") scheduleSendConfirmation(conversationId, clientMessageId);
    else cancelSendConfirmation(clientMessageId);
''',
    '''    if (outcome === "pending" || outcome === "sent") scheduleSendConfirmation(conversationId, clientMessageId);
    else cancelSendConfirmation(clientMessageId);
''',
    "single message send reconciliation",
)
replace_once(
    page,
    '''      updateOptimistic(conversationId, (current) => markRetrying(current, clientMessageId));
      void refreshMessages(conversationId, false);
      void syncConversations();
''',
    '''      updateOptimistic(conversationId, (current) => markRetrying(current, clientMessageId));
      scheduleSendConfirmation(conversationId, clientMessageId);
      void syncConversations();
''',
    "retry lightweight reconciliation",
)
replace_once(
    page,
    '''                onSent={() => { void refreshMessages(selected.id, false); void syncConversations(); scrollToBottom(); }}
''',
    '''                onSent={() => { void syncConversations(); scrollToBottom(); }}
''',
    "send no full thread refetch",
)
replace_once(
    page,
    'className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto max-w-md rounded-2xl border border-primary/20 bg-background/95 px-4 py-3 text-sm text-foreground shadow-[0_12px_34px_rgba(78,4,1,.18)] backdrop-blur-xl animate-in fade-in slide-in-from-top-2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2"',
    'className="fixed inset-x-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+var(--mobile-header-height,3.5rem))] z-40 mx-auto max-w-md rounded-2xl border border-primary/20 bg-background/95 px-4 py-3 text-sm text-foreground shadow-[0_12px_34px_rgba(78,4,1,.18)] backdrop-blur-xl animate-in fade-in slide-in-from-top-2 md:inset-x-auto md:left-1/2 md:top-4 md:-translate-x-1/2"',
    "feedback below header",
)

composer = "components/messaging/message-composer-v3.tsx"
replace_once(
    composer,
    '''          if (!result.ok) {
            onOptimisticSettled?.(send.clientMessageId, "failed");
            onFeedback(result.message);
            // A later photo failing must not undo the ones already sent.
''',
    '''          if (!result.ok) {
            onOptimisticSettled?.(send.clientMessageId, "failed");
            // The failed optimistic bubble owns this error and exposes Retry.
            // Do not duplicate it as a global chat banner.
            // A later photo failing must not undo the ones already sent.
''',
    "text send scoped failure",
)
replace_once(
    composer,
    '''            onOptimisticSettled?.(send.clientMessageId, "failed");
            if (send.attachment) unsent.push(send.attachment);
            onFeedback("The message could not be sent. Try again.");
''',
    '''            onOptimisticSettled?.(send.clientMessageId, "failed");
            if (send.attachment) unsent.push(send.attachment);
''',
    "text network scoped failure",
)
replace_once(
    composer,
    '''        if (!result.ok) {
          onOptimisticSettled?.(clientMessageId, "failed");
          onFeedback(result.message);
          return;
''',
    '''        if (!result.ok) {
          onOptimisticSettled?.(clientMessageId, "failed");
          return;
''',
    "voice scoped failure",
)

test_path = Path("lib/messaging/messaging-architecture-closeout.test.ts")
test_path.write_text('''import fs from "node:fs";\nimport path from "node:path";\nimport { describe, expect, it } from "vitest";\n\nconst root = process.cwd();\nconst read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");\n\ndescribe("messaging architecture closeout", () => {\n  it("moves notification and activation fan-out after durable acknowledgement", () => {\n    const mobile = read("lib/messaging/mobile.ts");\n    expect(mobile).toContain('import { after } from "next/server"');\n    expect(mobile).toContain("scheduleAfterMessageAcknowledgement");\n    expect(mobile).toContain("Promise.allSettled([\\n      notifyOtherMembers(");\n  });\n\n  it("uses keyset history pagination and a bounded initial conversation load", () => {\n    const mobile = read("lib/messaging/mobile.ts");\n    const actions = read("app/(app)/messaging-actions.ts");\n    const page = read("components/messages/messages-page-v4.tsx");\n    expect(mobile).toContain("before?: { createdAt: string; id: string }");\n    expect(mobile).toContain("created_at.lt.${options.before.createdAt}");\n    expect(actions).toContain("getOlderMessagesAction");\n    expect(page).toContain('getRecentMessagesAction(conversationId), { operation: "load recent conversation" }');\n    expect(page).toContain("loadOlderMessages");\n  });\n\n  it("does not refetch the full thread as the normal successful-send acknowledgement", () => {\n    const page = read("components/messages/messages-page-v4.tsx");\n    expect(page).toContain('onSent={() => { void syncConversations(); scrollToBottom(); }}');\n    expect(page).toContain('outcome === "pending" || outcome === "sent"');\n  });\n\n  it("keeps ordinary send failures on the affected optimistic bubble", () => {\n    const composer = read("components/messaging/message-composer-v3.tsx");\n    const sendText = composer.slice(composer.indexOf("function sendText()"), composer.indexOf("const sendVoice"));\n    expect(sendText).not.toContain("onFeedback(result.message)");\n    expect(sendText).not.toContain('onFeedback("The message could not be sent. Try again.")');\n  });\n});\n''')
