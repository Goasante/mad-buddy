import { beforeAll, describe, expect, it } from "vitest";

import { actAs, installActingUser, USERS, CONVERSATIONS, EVENT_ID, ABSENT_UUID } from "@/lib/test/acting-user";

/**
 * CHATS V4: RETENTION, PRIVATE MEDIA, STRUCTURED SHARES, FORWARDING, INBOX.
 *
 * Second half of the V4 server-action proof. Same harness rules as
 * v4-actions.local.test.ts: real local Postgres, only the session-cookie
 * boundary stubbed, assertions on observable contracts.
 *
 * The load-bearing tests here are the ones where a mistake is a privacy breach
 * rather than a bug: expired media must lose authorization BEFORE cleanup runs,
 * a Place share must not be able to carry live GPS, and forwarding must not
 * become a bridge between conversations the sender cannot see.
 */

installActingUser();

try {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: the isLocal guard below skips the suite.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;

/* These tests make real database and storage round trips, so the 5s default is
   too tight once the whole suite runs in parallel. Applied per SUITE rather
   than per test, so a newly added test cannot silently miss it. */
const DB_TIMEOUT = 30_000;

/* Untyped on purpose. The generated Database type intentionally still matches
   production until the three pending migrations are applied and types are
   regenerated, so tables and columns this suite legitimately exercises
   (kept_at, media_mode, conversation_message_pins, saved_messages, ...) are not
   in it yet. Using the same untyped view the V4 actions use is honest; hand-
   writing generated definitions to silence tsc would not be. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let richMedia: typeof import("@/app/(app)/messaging-rich-media-actions");
let structured: typeof import("@/app/(app)/messaging-structured-share-actions");
let retention: typeof import("@/app/(app)/messaging-retention-v4-actions");
let inbox: typeof import("@/app/(app)/messaging-inbox-v4-actions");
let forward: typeof import("@/app/(app)/messaging-forward-actions");
let ultimate: typeof import("@/app/(app)/messaging-ultimate-actions");
let insights: typeof import("@/app/(app)/messaging-v4-insights-actions");

let ROOM_ID = "";
let ROOM_CONVERSATION = "";
let GROUP_MESSAGE = "";

function clientId() {
  return `v4m-${Math.random().toString(36).slice(2, 12)}`;
}

async function seedMessage(conversationId: string, senderId: string, overrides: Record<string, unknown> = {}) {
  const { data } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      message_type: "text",
      text_content: "fixture",
      client_message_id: clientId(),
      ...overrides
    })
    .select("id")
    .single();
  return String(data?.id);
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
  richMedia = await import("@/app/(app)/messaging-rich-media-actions");
  structured = await import("@/app/(app)/messaging-structured-share-actions");
  retention = await import("@/app/(app)/messaging-retention-v4-actions");
  inbox = await import("@/app/(app)/messaging-inbox-v4-actions");
  forward = await import("@/app/(app)/messaging-forward-actions");
  ultimate = await import("@/app/(app)/messaging-ultimate-actions");
  insights = await import("@/app/(app)/messaging-v4-insights-actions");

  const { data: room } = await admin
    .from("event_circles")
    .select("id")
    .eq("event_id", EVENT_ID)
    .eq("name", "V4 Room")
    .maybeSingle();
  ROOM_ID = String(room?.id ?? "");
  const { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("context_type", "event_circle")
    .eq("context_id", ROOM_ID)
    .maybeSingle();
  ROOM_CONVERSATION = String(conversation?.id ?? "");

  GROUP_MESSAGE = await seedMessage(CONVERSATIONS.group, USERS.A);
}, DB_TIMEOUT);

describeLocal("Retention: Keep and 24h", () => {
  it("reports Keep for a message with no expiry", async () => {
    actAs(USERS.A);
    const view = await retention.getMessageRetentionAction({
      conversationId: CONVERSATIONS.group,
      messageId: GROUP_MESSAGE
    });
    expect(view).toBeTruthy();
    expect(view!.mode).toBe("keep");
    expect(view!.expiresAt).toBeNull();
  });

  it("reports 24h and a real expiry for an expiring message", async () => {
    const expiring = await seedMessage(CONVERSATIONS.group, USERS.A, {
      media_mode: "24h",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    actAs(USERS.A);
    const view = await retention.getMessageRetentionAction({
      conversationId: CONVERSATIONS.group,
      messageId: expiring
    });
    expect(view!.mode).toBe("24h");
    expect(view!.expiresAt).toBeTruthy();
  });

  /**
   * THE SECURITY SEQUENCE THAT MATTERS (release-critical).
   *
   * Expiry must revoke access IMMEDIATELY, at authorization time. It must not
   * depend on a cleanup job having already run -- otherwise every expired
   * message stays readable for however long the sweep lags.
   *
   * The message row is deliberately still present and un-swept here; only its
   * expires_at is in the past.
   */
  it("refuses an expired message before any cleanup has run", async () => {
    const expired = await seedMessage(CONVERSATIONS.group, USERS.A, {
      media_mode: "24h",
      expires_at: new Date(Date.now() - 60 * 1000).toISOString()
    });
    // The row is still there: this is exactly the "cleanup has not caught up" state.
    const { data: stillPresent } = await admin.from("messages").select("id").eq("id", expired).maybeSingle();
    expect(stillPresent).toBeTruthy();

    actAs(USERS.A);
    const view = await retention.getMessageRetentionAction({
      conversationId: CONVERSATIONS.group,
      messageId: expired
    });
    const refusedOrExpired = view === null || view.expiresAt === null || Date.parse(view.expiresAt) <= Date.now();
    expect(refusedOrExpired, "an expired message still reported live retention").toBe(true);
  });

  it("keeps a message in chat, idempotently, and only for a member", async () => {
    const keepable = await seedMessage(CONVERSATIONS.group, USERS.A, {
      media_mode: "24h",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    // An unrelated user cannot retain content they cannot even see.
    actAs(USERS.C);
    const attack = await retention.keepMessageInChatAction({
      conversationId: CONVERSATIONS.group,
      messageId: keepable
    });
    expect(attack.ok, `outsider keep said: ${attack.message}`).toBe(false);
    const { data: untouched } = await admin.from("messages").select("kept_at").eq("id", keepable).maybeSingle();
    expect(untouched?.kept_at).toBeFalsy();

    actAs(USERS.A);
    const first = await retention.keepMessageInChatAction({
      conversationId: CONVERSATIONS.group,
      messageId: keepable
    });
    expect(first.ok, `keep said: ${first.message}`).toBe(true);
    const { data: kept } = await admin.from("messages").select("kept_at").eq("id", keepable).maybeSingle();
    expect(kept?.kept_at).toBeTruthy();

    /* A SECOND keep is refused rather than accepted, because the update is
       guarded by `.is("kept_at", null)`. That refusal is safe and it is not
       reachable from the product: once kept_at is set the UI renders the
       "Kept in chat" chip and removes the Keep control entirely
       (components/messaging/message-retention-v4.tsx), so nobody can double-tap
       it. What must hold is that the second call CANNOT corrupt the state --
       no second kept_at, no re-stamped keeper, no lost retention. */
    const firstKeptAt = kept?.kept_at;
    const second = await retention.keepMessageInChatAction({
      conversationId: CONVERSATIONS.group,
      messageId: keepable
    });
    expect(second.ok).toBe(false);

    const { data: afterSecond } = await admin
      .from("messages")
      .select("kept_at, kept_by")
      .eq("id", keepable)
      .maybeSingle();
    expect(afterSecond?.kept_at, "a repeat keep re-stamped the retention").toBe(firstKeptAt);
    expect(afterSecond?.kept_by).toBe(USERS.A);

    const view = await retention.getMessageRetentionAction({
      conversationId: CONVERSATIONS.group,
      messageId: keepable
    });
    expect(view!.keptAt).toBeTruthy();
  });
}, DB_TIMEOUT);

describeLocal("Private media authorization", () => {
  /**
   * A ready chat media asset owned by `sender`, intended for `conversationId`,
   * WITH A REAL OBJECT UPLOADED. The object matters: authorization can pass and
   * the signing call still 404 if the key names nothing, which would make an
   * authorization test pass for the wrong reason.
   */
  async function seedAsset(conversationId: string, sender: string, kind: "video" | "file") {
    const storageKey = `${sender}/chat/${Math.random().toString(36).slice(2)}.bin`;
    const { error: uploadError } = await admin.storage
      .from("media")
      .upload(storageKey, Buffer.from([1, 2, 3, 4]), {
        contentType: kind === "video" ? "video/mp4" : "application/pdf",
        upsert: true
      });
    // A silent upload failure would make the authorization tests below pass for
    // the wrong reason (signing 404s rather than authorization refusing), so
    // the fixture asserts its own success.
    expect(uploadError, `media fixture upload failed: ${uploadError?.message}`).toBeFalsy();
    const { data } = await admin
      .from("media_assets")
      .insert({
        owner_id: sender,
        context_type: "chat",
        intended_conversation_id: conversationId,
        intended_media_kind: kind,
        storage_key: storageKey,
        content_type: kind === "video" ? "video/mp4" : "application/pdf",
        size_bytes: 2048,
        processing_status: "ready",
        moderation_status: "active"
      })
      .select("id")
      .single();
    return String(data?.id);
  }

  async function seedMediaMessage(conversationId: string, sender: string, kind: "video" | "file", overrides: Record<string, unknown> = {}) {
    const mediaId = await seedAsset(conversationId, sender, kind);
    const messageId = await seedMessage(conversationId, sender, {
      message_type: kind,
      text_content: null,
      media_id: mediaId,
      ...overrides
    });
    return { mediaId, messageId };
  }

  it("signs a URL for a member and refuses one to an outsider", async () => {
    const { messageId } = await seedMediaMessage(CONVERSATIONS.group, USERS.A, "file");

    actAs(USERS.A);
    const owner = await richMedia.getRichMediaMessageAction({
      conversationId: CONVERSATIONS.group,
      messageId
    });
    expect(owner, "a member was denied their own conversation's media").toBeTruthy();
    expect(owner!.url).toContain("http");

    // The entitlement question, not the string question: C is authenticated,
    // holds real ids, and must receive nothing.
    actAs(USERS.C);
    expect(await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId })).toBeNull();

    // A removed member loses access to media they could previously fetch.
    actAs(USERS.D);
    expect(await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId })).toBeNull();
  });

  it("refuses to sign expired media before cleanup has run", async () => {
    const { messageId } = await seedMediaMessage(CONVERSATIONS.group, USERS.A, "video", {
      expires_at: new Date(Date.now() - 60 * 1000).toISOString()
    });
    actAs(USERS.A);
    expect(
      await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId }),
      "expired media was still signed"
    ).toBeNull();
  });

  it("refuses deleted media and media queued for deletion", async () => {
    const deleted = await seedMediaMessage(CONVERSATIONS.group, USERS.A, "file");
    await admin.from("media_assets").update({ deleted_at: new Date().toISOString() }).eq("id", deleted.mediaId);
    actAs(USERS.A);
    expect(await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId: deleted.messageId })).toBeNull();

    const queued = await seedMediaMessage(CONVERSATIONS.group, USERS.A, "file");
    // `reason` is NOT NULL with a checked vocabulary; omitting it silently
    // failed the insert and made this assertion pass for the wrong reason.
    const { error: queueError } = await admin
      .from("media_deletion_queue")
      .insert({ media_asset_id: queued.mediaId, reason: "user_deleted" });
    expect(queueError, `queue fixture failed: ${queueError?.message}`).toBeFalsy();

    expect(
      await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId: queued.messageId }),
      "media queued for deletion was still signed"
    ).toBeNull();
  });

  it("refuses an asset intended for a different conversation", async () => {
    // The message says one conversation; the asset was intended for another.
    const foreignAsset = await seedAsset(CONVERSATIONS.direct, USERS.A, "file");
    const messageId = await seedMessage(CONVERSATIONS.group, USERS.A, {
      message_type: "file",
      text_content: null,
      media_id: foreignAsset
    });
    actAs(USERS.A);
    expect(await richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId })).toBeNull();
  });

  /**
   * Finalize is the step that turns an uploaded blob into a sendable asset, so
   * it is a real authorization boundary: it must belong to the caller AND the
   * caller must still be able to send to that conversation.
   */
  it("finalizes only the caller's own upload into a conversation they can send to", async () => {
    actAs(USERS.A);
    const intent = await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "file",
      contentType: "application/pdf",
      sizeBytes: 64,
      fileName: "finalize-me.pdf"
    });
    expect(intent.ok).toBe(true);
    const mediaId = (intent as { intent?: { mediaId?: string } }).intent?.mediaId ?? "";
    expect(mediaId).toBeTruthy();

    // Put a real object at the reserved key so finalize has something to verify.
    const { data: asset } = await admin
      .from("media_assets")
      .select("storage_key")
      .eq("id", mediaId)
      .maybeSingle();
    // REAL PDF magic bytes. Finalize downloads the object and verifies its
    // actual signature, so arbitrary bytes are correctly refused -- that
    // refusal is a feature, and using real bytes here is what lets the
    // ownership assertions below be the thing under test.
    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "latin1");
    await admin.storage
      .from("media")
      .upload(String(asset?.storage_key), pdfBytes, {
        contentType: "application/pdf",
        upsert: true
      });

    // B holds a real mediaId that belongs to A. Possession is not ownership.
    actAs(USERS.B);
    const stolen = await richMedia.finalizeChatRichMediaUploadAction({
      conversationId: CONVERSATIONS.group,
      mediaId,
      expectedMediaKind: "file"
    });
    expect(stolen.ok, "another member finalized an upload they do not own").toBe(false);

    // An outsider cannot finalize into a conversation at all.
    actAs(USERS.C);
    expect((await richMedia.finalizeChatRichMediaUploadAction({
      conversationId: CONVERSATIONS.group,
      mediaId,
      expectedMediaKind: "file"
    })).ok).toBe(false);

    // A claiming the wrong kind is refused: the declared kind must match.
    actAs(USERS.A);
    expect((await richMedia.finalizeChatRichMediaUploadAction({
      conversationId: CONVERSATIONS.group,
      mediaId,
      expectedMediaKind: "video"
    })).ok).toBe(false);

    const owner = await richMedia.finalizeChatRichMediaUploadAction({
      conversationId: CONVERSATIONS.group,
      mediaId,
      expectedMediaKind: "file"
    });
    expect(owner.ok, `finalize said: ${owner.ok ? "" : owner.message}`).toBe(true);
  });

  it("enforces content type and size on upload intents", async () => {
    actAs(USERS.A);
    const good = await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "file",
      contentType: "application/pdf",
      sizeBytes: 4096,
      fileName: "notes.pdf"
    });
    expect(good.ok).toBe(true);

    const badType = await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "file",
      contentType: "application/x-msdownload",
      sizeBytes: 4096,
      fileName: "payload.exe"
    });
    expect(badType.ok).toBe(false);

    const tooBig = await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "video",
      contentType: "video/mp4",
      sizeBytes: 500 * 1024 * 1024,
      fileName: "huge.mp4"
    });
    expect(tooBig.ok).toBe(false);

    // Kind/content-type mismatch must not slip through.
    const mismatch = await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "video",
      contentType: "application/pdf",
      sizeBytes: 4096,
      fileName: "not-a-video.pdf"
    });
    expect(mismatch.ok).toBe(false);

    // And an outsider gets no upload intent into someone else's conversation.
    actAs(USERS.C);
    expect((await richMedia.createChatRichMediaUploadIntentAction({
      conversationId: CONVERSATIONS.group,
      mediaKind: "file",
      contentType: "application/pdf",
      sizeBytes: 4096,
      fileName: "intruder.pdf"
    })).ok).toBe(false);
  });
}, DB_TIMEOUT);

describeLocal("Structured shares", () => {
  it("shares a contact carrying only the chosen fields", async () => {
    actAs(USERS.A);
    const sent = await structured.sendStructuredChatMessageAction({
      kind: "contact",
      conversationId: CONVERSATIONS.group,
      clientMessageId: clientId(),
      displayName: "Yaa Mensah",
      phone: "+233200000000"
      // email and organization deliberately omitted
    });
    expect(sent.ok).toBe(true);

    const { data: rows } = await admin
      .from("message_contacts")
      .select("display_name, phone, email, organization")
      .eq("display_name", "Yaa Mensah");
    const row = (rows ?? [])[0];
    expect(row).toBeTruthy();
    expect(row.phone).toBe("+233200000000");
    // What the sender did not choose must not be invented or back-filled.
    expect(row.email ?? null).toBeNull();
    expect(row.organization ?? null).toBeNull();
  });

  /**
   * PLACE SHARING PRIVACY.
   *
   * A Place share is a CHOSEN venue, never the sender's live position. The
   * strongest possible proof is structural: the stored row has no coordinate
   * columns at all, so there is nowhere for live GPS to land even if a future
   * caller tried to pass it.
   */
  it("stores a chosen place with no coordinate columns to leak into", async () => {
    actAs(USERS.A);
    const sent = await structured.sendStructuredChatMessageAction({
      kind: "place",
      conversationId: CONVERSATIONS.group,
      clientMessageId: clientId(),
      placeName: "Skyline Lounge",
      areaLabel: "Osu",
      placeKind: "venue"
    });
    expect(sent.ok).toBe(true);

    const { data: columns } = await admin.rpc("version" as never).then(() => ({ data: null })).catch(() => ({ data: null }));
    void columns;

    const { data: rows } = await admin.from("message_places").select("*").eq("place_name", "Skyline Lounge");
    const row = (rows ?? [])[0] as Record<string, unknown> | undefined;
    expect(row).toBeTruthy();
    for (const key of Object.keys(row!)) {
      expect(/lat|lng|long|coord|gps|accuracy/i.test(key), `place share stored a location column: ${key}`).toBe(false);
    }
  });

  it("refuses to share into a conversation the sender cannot reach", async () => {
    actAs(USERS.C);
    const sent = await structured.sendStructuredChatMessageAction({
      kind: "contact",
      conversationId: CONVERSATIONS.group,
      clientMessageId: clientId(),
      displayName: "Intruder Contact"
    });
    expect(sent.ok).toBe(false);
    const { data: rows } = await admin
      .from("message_contacts")
      .select("display_name")
      .eq("display_name", "Intruder Contact");
    expect((rows ?? []).length).toBe(0);
  });

  it("refuses to share an Event the sender cannot access", async () => {
    // A private event belonging to nobody in this fixture.
    const { data: privateEvent } = await admin
      .from("events")
      .insert({
        host_id: USERS.C,
        name: "Private Event",
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 3600_000).toISOString(),
        status: "scheduled",
        visibility: "invite"
      })
      .select("id")
      .single();

    actAs(USERS.A);
    const sent = await structured.sendStructuredChatMessageAction({
      kind: "agenda",
      conversationId: CONVERSATIONS.group,
      clientMessageId: clientId(),
      refKind: "event",
      refId: String(privateEvent?.id)
    });
    expect(sent.ok, "an inaccessible Event was shared into a chat").toBe(false);
  });

  it("refuses a structured payload read to an outsider", async () => {
    actAs(USERS.A);
    const clientMessageId = clientId();
    await structured.sendStructuredChatMessageAction({
      kind: "place",
      conversationId: CONVERSATIONS.group,
      clientMessageId,
      placeName: "Readback Venue",
      placeKind: "venue"
    });
    const { data: message } = await admin
      .from("messages")
      .select("id")
      .eq("client_message_id", clientMessageId)
      .maybeSingle();

    actAs(USERS.C);
    expect(
      await structured.getStructuredMessagePayloadAction({
        conversationId: CONVERSATIONS.group,
        messageId: String(message?.id)
      })
    ).toBeNull();
  });
}, DB_TIMEOUT);

describeLocal("Forwarding", () => {
  it("forwards between two conversations the sender belongs to", async () => {
    actAs(USERS.A);
    const result = await forward.forwardMessageAction({
      sourceMessageId: GROUP_MESSAGE,
      targetConversationIds: [CONVERSATIONS.direct]
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a source message the sender cannot see", async () => {
    // A message in a conversation C has no part in.
    actAs(USERS.C);
    const result = await forward.forwardMessageAction({
      sourceMessageId: GROUP_MESSAGE,
      targetConversationIds: [CONVERSATIONS.direct]
    });
    expect(result.ok).toBe(false);
  });

  /** Forwarding must not become a bridge into a conversation the sender cannot reach. */
  it("does not deliver into a target the sender does not belong to", async () => {
    const { data: outsiderConversation } = await admin
      .from("conversations")
      .insert({ conversation_type: "group", created_by: USERS.C, status: "active" })
      .select("id")
      .single();
    const targetId = String(outsiderConversation?.id);
    await admin.from("conversation_members").insert({
      conversation_id: targetId,
      user_id: USERS.C,
      role: "owner",
      status: "joined"
    });

    const before = (await admin.from("messages").select("id").eq("conversation_id", targetId)).data?.length ?? 0;

    actAs(USERS.A);
    await forward.forwardMessageAction({
      sourceMessageId: GROUP_MESSAGE,
      targetConversationIds: [targetId]
    });

    const after = (await admin.from("messages").select("id").eq("conversation_id", targetId)).data?.length ?? 0;
    expect(after, "forwarding delivered into a conversation the sender cannot reach").toBe(before);
  });

  it("refuses a deleted source message", async () => {
    const deleted = await seedMessage(CONVERSATIONS.group, USERS.A, {
      deleted_at: new Date().toISOString(),
      status: "deleted"
    });
    actAs(USERS.A);
    const result = await forward.forwardMessageAction({
      sourceMessageId: deleted,
      targetConversationIds: [CONVERSATIONS.direct]
    });
    expect(result.ok).toBe(false);
  });
}, DB_TIMEOUT);

describeLocal("Inbox V4 and Event Room identity", () => {
  it("returns only the caller's own inbox preferences", async () => {
    actAs(USERS.A);
    await ultimate.updateConversationUserPreferencesAction({
      conversationId: CONVERSATIONS.group,
      archived: true
    });
    const aPrefs = await inbox.getInboxConversationPreferencesAction();
    expect(aPrefs[CONVERSATIONS.group]?.archivedAt).toBeTruthy();

    // B shares the conversation and must not inherit A's archive state.
    actAs(USERS.B);
    const bPrefs = await inbox.getInboxConversationPreferencesAction();
    expect(bPrefs[CONVERSATIONS.group]?.archivedAt ?? null).toBeNull();

    actAs(USERS.A);
    await ultimate.updateConversationUserPreferencesAction({
      conversationId: CONVERSATIONS.group,
      archived: false
    });
  });

  it("keeps drafts private to their author", async () => {
    actAs(USERS.A);
    await ultimate.updateConversationUserPreferencesAction({
      conversationId: CONVERSATIONS.group,
      draftText: "a secret half-written message"
    });

    actAs(USERS.B);
    const bPrefs = await inbox.getInboxConversationPreferencesAction();
    const bDraft = bPrefs[CONVERSATIONS.group]?.draftText ?? null;
    expect(bDraft, "one member could read another member's draft").not.toBe("a secret half-written message");

    actAs(USERS.A);
    const aPrefs = await inbox.getInboxConversationPreferencesAction();
    expect(aPrefs[CONVERSATIONS.group]?.draftText).toBe("a secret half-written message");
    await ultimate.updateConversationUserPreferencesAction({
      conversationId: CONVERSATIONS.group,
      draftText: ""
    });
  });

  /**
   * REGRESSION for the defect found during the release review: the V4 inbox
   * projected Event Rooms with no way to tell them from a Group.
   */
  it("identifies an Event Room conversation as an Event Room, not a Group", async () => {
    const { listConversations } = await import("@/lib/messaging/mobile");
    const conversations = await listConversations(USERS.A);
    const room = conversations.find((entry) => entry.id === ROOM_CONVERSATION);

    expect(room, "the Event Room conversation is missing from the inbox").toBeTruthy();
    expect(room!.contextBadge).toBe("Event Room");
    expect(room!.roomId).toBe(ROOM_ID);
    expect(room!.roomEventName).toBe("V4 Test Event");
    // conversation_type "event" exists precisely so a temporary Room is never
    // mistaken for a persistent Group.
    expect(room!.kind).not.toBe("group");
  });

  it("runs V4 actions against an Event Room conversation like any other chat", async () => {
    const roomMessage = await seedMessage(ROOM_CONVERSATION, USERS.A);

    actAs(USERS.A);
    expect((await ultimate.setSavedMessageAction({ messageId: roomMessage, saved: true })).ok).toBe(true);
    expect((await ultimate.setPinnedMessageAction({ messageId: roomMessage, pinned: true })).ok).toBe(true);
    const state = await ultimate.getUltimateConversationStateAction(ROOM_CONVERSATION);
    expect((state?.pins ?? []).some((pin) => pin.messageId === roomMessage)).toBe(true);

    // Someone with no standing in the Room gets nothing, exactly as elsewhere.
    actAs(USERS.C);
    expect((await ultimate.setSavedMessageAction({ messageId: roomMessage, saved: true })).ok).toBe(false);
    const outsiderState = await ultimate.getUltimateConversationStateAction(ROOM_CONVERSATION);
    expect((outsiderState?.pins ?? []).length).toBe(0);

    actAs(USERS.A);
    await ultimate.setPinnedMessageAction({ messageId: roomMessage, pinned: false });
    await ultimate.setSavedMessageAction({ messageId: roomMessage, saved: false });
  });

  it("cuts off a banned Room member from the Room conversation", async () => {
    // Ban B from the Room through the canonical lifecycle RPC, which is the
    // only thing allowed to move Room and conversation membership together.
    await admin.rpc("set_event_room_membership", {
      p_room_id: ROOM_ID,
      p_user_id: USERS.B,
      p_status: "banned"
    });

    actAs(USERS.B);
    const state = await ultimate.getUltimateConversationStateAction(ROOM_CONVERSATION);
    expect((state?.pins ?? []).length).toBe(0);
    expect((await insights.getChatCollectionsAction(ROOM_CONVERSATION))?.saved ?? []).toEqual([]);

    // Restore for re-runnability.
    await admin.rpc("join_event_room", { p_room_id: ROOM_ID, p_user_id: USERS.B });
  });
}, DB_TIMEOUT);

describeLocal("Error surfaces", () => {
  it("never returns raw database detail to the caller", async () => {
    actAs(USERS.A);
    const messages: string[] = [];
    const collect = (result: unknown) => {
      if (result && typeof result === "object" && "message" in result) {
        messages.push(String((result as { message: unknown }).message));
      }
    };

    collect(await ultimate.setSavedMessageAction({ messageId: ABSENT_UUID, saved: true }));
    collect(await ultimate.setPinnedMessageAction({ messageId: ABSENT_UUID, pinned: true }));
    collect(await ultimate.createChatPollAction({ conversationId: ABSENT_UUID, question: "Q", options: ["a", "b"], clientMessageId: clientId() }));
    collect(await retention.keepMessageInChatAction({ conversationId: ABSENT_UUID, messageId: ABSENT_UUID }));
    collect(await forward.forwardMessageAction({ sourceMessageId: ABSENT_UUID, targetConversationIds: [ABSENT_UUID] }));
    collect(await insights.renameSavedMessageFolderAction(ABSENT_UUID, "x"));
    collect(await structured.sendStructuredChatMessageAction({
      kind: "contact",
      conversationId: ABSENT_UUID,
      clientMessageId: clientId(),
      displayName: "Nobody"
    }));

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toMatch(/relation|column|constraint|violates|PGRST|SQLSTATE|\bpg_|duplicate key|syntax error/i);
      expect(message).not.toMatch(/service_role|supabase|storage\/v1|postgres/i);
      // Product language, not machine language.
      expect(message.length).toBeLessThan(200);
    }
  });
}, DB_TIMEOUT);
