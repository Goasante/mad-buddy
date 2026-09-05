#!/usr/bin/env node
/**
 * Mad Buddy staging seeder.
 *
 *   npm run seed:staging            -- dry run (default). Mutates nothing.
 *   npm run seed:staging -- --apply -- actually writes.
 *
 * Safety, in order:
 *   1. the resolved project ref must not be production;
 *   2. MAD_BUDDY_ALLOW_STAGING_SEED=YES must be set;
 *   3. an unparseable target refuses rather than guessing;
 *   4. --apply additionally requires the service-role key and the password.
 *
 * The guard logic lives in lib/staging/safety.ts and is unit-tested there
 * without a database. This file is the I/O shell around it.
 *
 * Nothing here prints a secret. The dry run prints counts only.
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const esbuild = require("esbuild");

// The pure modules are TypeScript; tsx/vitest own them in tests, but this
// script runs under plain node. Loading via a tiny bundle-free transpile step
// would add a dependency, so the deterministic dataset is re-derived here from
// the same rules and kept honest by lib/staging/dataset.test.ts.
const {
  PRODUCTION_PROJECT_REF,
  STAGING_OPT_IN_ENV,
  STAGING_PASSWORD_ENV,
  evaluateSafety
} = await loadTs("../lib/staging/safety.ts");

const {
  STAGING_ACCOUNT_COUNT,
  STAGING_MARKER,
  buildAccounts,
  buildBuddyEdges,
  buildCohorts,
  buildGroupConversationMessages,
  buildPrimaryConversationMessages,
  buildSecondaryConversationMessages,
  directConversationKey,
  planDataset,
  GROUP_MEMBER_INDEXES
} = await loadTs("../lib/staging/dataset.ts");

const { buildAttachmentPng, buildVoiceWav, buildWaveform, ATTACHMENT_FIXTURE, VOICE_FIXTURE } =
  await loadTs("../lib/staging/fixtures.ts");

/**
 * Load a local TypeScript module.
 *
 * Uses esbuild's real parser rather than regex type-stripping. This is a
 * safety-critical path -- the production guard lives in one of these modules --
 * and a regex that silently mangles `string | null` would be a catastrophic
 * way to save a dependency. esbuild is already present in the tree.
 */
async function loadTs(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = readFileSync(url, "utf8");
  const { code } = await esbuild.transform(source, {
    loader: "ts",
    format: "esm",
    target: "node20"
  });
  const encoded = Buffer.from(code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

/**
 * Load .env.staging.local if present.
 *
 * Deliberately NOT .env.local: that file points at production on developer
 * machines, and auto-loading it would aim the seeder straight at the database
 * this script exists to protect. Only the explicitly-named staging file is
 * read, and the production guard still runs afterwards regardless.
 *
 * Existing process env always wins, so an explicit shell value is never
 * silently overridden by a stale file.
 */
function loadStagingEnv() {
  const file = new URL("../.env.staging.local", import.meta.url);
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return false;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    // A leftover placeholder is treated as absent so the guards refuse
    // rather than sending "PASTE_HERE" to the API as a key.
    if (!value || value === "PASTE_HERE") continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOADED_ENV_FILE = loadStagingEnv();

const log = (...parts) => console.log(...parts);

function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const safety = evaluateSafety({
    supabaseUrl,
    serviceRoleKey,
    optIn: process.env[STAGING_OPT_IN_ENV],
    password: process.env[STAGING_PASSWORD_ENV],
    apply: APPLY
  });

  log("Mad Buddy staging seeder");
  log("─".repeat(56));
  log(`mode              ${APPLY ? "APPLY (will write)" : "DRY RUN (no mutations)"}`);
  log(`env file          ${LOADED_ENV_FILE ? ".env.staging.local loaded" : "not present (using shell env)"}`);

  if (!safety.ok) {
    log(`target            refused`);
    log("");
    log(`REFUSED [${safety.code}]`);
    log(safety.message);
    if (safety.code === "production_ref") {
      log("");
      log(`Production ref ${PRODUCTION_PROJECT_REF} is permanently blocked by this seeder.`);
    }
    process.exit(1);
  }

  // Origin only. The key is never printed, in either mode.
  log(`target            ${safety.supabaseUrl}`);
  log(`project ref       ${safety.projectRef}`);
  log("");

  const plan = planDataset(STAGING_ACCOUNT_COUNT);
  log("Planned dataset");
  for (const [key, value] of Object.entries(plan)) {
    if (key === "cohorts") continue;
    log(`  ${key.padEnd(22)} ${value}`);
  }
  log(`  cohorts                ${Object.entries(plan.cohorts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  log("");

  if (!APPLY) {
    log("Dry run complete. No database connection was opened and nothing was written.");
    log("Re-run with --apply (plus the staging env vars) to write.");
    return;
  }

  return apply(safety, serviceRoleKey);
}

async function apply(safety, serviceRoleKey) {
  const admin = createClient(safety.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const password = process.env[STAGING_PASSWORD_ENV];
  const accounts = buildAccounts(STAGING_ACCOUNT_COUNT);

  log("Seeding auth users…");
  const userIdByIndex = new Map();

  // Idempotency: listUsers is paged and matched on the synthetic email, so a
  // rerun updates the existing account instead of creating a second one.
  const existing = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const user of data.users) existing.set(user.email?.toLowerCase(), user.id);
    if (data.users.length < 1000) break;
  }

  let created = 0;
  let reused = 0;
  for (const account of accounts) {
    const found = existing.get(account.email.toLowerCase());
    if (found) {
      userIdByIndex.set(account.index, found);
      reused += 1;
      continue;
    }

    // Repository truth: admin.createUser with email_confirm, never auth.signUp
    // (which sends a rate-limited confirmation mail and breaks first login).
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { staging_fixture: STAGING_MARKER, label: account.label }
    });
    if (error) throw new Error(`createUser ${account.label} failed: ${error.message}`);
    userIdByIndex.set(account.index, data.user.id);
    created += 1;
  }
  log(`  auth users: ${created} created, ${reused} reused`);

  log("Seeding profiles…");
  const profileRows = accounts.map((account) => ({
    user_id: userIdByIndex.get(account.index),
    full_name: account.fullName,
    username: account.username,
    bio: account.bio,
    is_onboarded: account.isOnboarded
  }));
  await upsert(admin, "profiles", profileRows, "user_id");

  await upsert(
    admin,
    "profile_birth_details",
    accounts.map((account) => ({
      user_id: userIdByIndex.get(account.index),
      date_of_birth: account.dateOfBirth
    })),
    "user_id"
  );

  log("Seeding buddy graph…");
  const edges = buildBuddyEdges(STAGING_ACCOUNT_COUNT).map((edge) => {
    const a = userIdByIndex.get(edge.a);
    const b = userIdByIndex.get(edge.b);
    // friendships_ordered: user_one_id < user_two_id.
    return a < b ? { user_one_id: a, user_two_id: b } : { user_one_id: b, user_two_id: a };
  });
  await upsert(admin, "friendships", edges, "user_one_id,user_two_id");
  log(`  ${edges.length} buddy edges`);

  const conversations = await seedConversations(admin, userIdByIndex);
  await seedMedia(admin, userIdByIndex, conversations);

  writeManifest(safety, accounts, userIdByIndex, conversations);
  log("");
  log("Seed complete.");
}

/**
 * Upsert on a natural key so a rerun updates rather than duplicating.
 * Chunked because a single 4000-row request is rejected.
 */
async function upsert(admin, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from(table).upsert(chunk, { onConflict, ignoreDuplicates: false });
    if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

async function seedConversations(admin, userIdByIndex) {
  log("Seeding conversations…");
  const user = (i) => userIdByIndex.get(i);

  const primary = await ensureDirectConversation(admin, user(1), user(2));
  const secondary = await ensureDirectConversation(admin, user(1), user(3));
  const group = await ensureGroupConversation(admin, userIdByIndex);

  await seedMessages(admin, primary, buildPrimaryConversationMessages(), userIdByIndex);
  await seedMessages(admin, secondary, buildSecondaryConversationMessages(), userIdByIndex);
  await seedMessages(admin, group, buildGroupConversationMessages(), userIdByIndex);

  // Non-empty settings + preferences so local-first reconciliation has real
  // server values to reconcile against (R3/R4).
  await upsert(
    admin,
    "conversation_chat_settings",
    [
      { conversation_id: primary, message_lifetime_seconds: null, who_can_pin: "all_members" },
      { conversation_id: group, message_lifetime_seconds: 604800, who_can_pin: "admins" }
    ],
    "conversation_id"
  );

  await upsert(
    admin,
    "conversation_user_preferences",
    [
      { conversation_id: primary, user_id: user(1), notification_preview: "always", favorite_rank: 0 },
      { conversation_id: primary, user_id: user(2), notification_preview: "when_unlocked" },
      { conversation_id: group, user_id: user(1), notification_preview: "when_unlocked" }
    ],
    "conversation_id,user_id"
  );

  return { primary, secondary, group };
}

async function ensureDirectConversation(admin, a, b) {
  const key = directConversationKey(a, b);

  const { data: found } = await admin
    .from("conversations")
    .select("id")
    .eq("direct_key", key)
    .eq("conversation_type", "direct")
    .maybeSingle();

  if (found) return found.id;

  const { data, error } = await admin
    .from("conversations")
    .insert({ conversation_type: "direct", direct_key: key, created_by: a, status: "active" })
    .select("id")
    .single();
  if (error) throw new Error(`create direct conversation failed: ${error.message}`);

  await upsert(
    admin,
    "conversation_members",
    [
      { conversation_id: data.id, user_id: a, role: "member", status: "joined" },
      { conversation_id: data.id, user_id: b, role: "member", status: "joined" }
    ],
    "conversation_id,user_id"
  );

  return data.id;
}

async function ensureGroupConversation(admin, userIdByIndex) {
  // conversations has no natural key for groups, so the marker on context_id
  // is not available; discovery is by created_by + type + a fixed title-ish
  // context. A deterministic UUID keeps the rerun idempotent.
  const CONTEXT = "00000000-0000-4000-8000-00000000f001";

  const { data: found } = await admin
    .from("conversations")
    .select("id")
    .eq("conversation_type", "group")
    .eq("context_id", CONTEXT)
    .maybeSingle();

  const id =
    found?.id ??
    (
      await admin
        .from("conversations")
        .insert({
          conversation_type: "group",
          created_by: userIdByIndex.get(1),
          context_id: CONTEXT,
          status: "active"
        })
        .select("id")
        .single()
    ).data.id;

  await upsert(
    admin,
    "conversation_members",
    GROUP_MEMBER_INDEXES.map((index) => ({
      conversation_id: id,
      user_id: userIdByIndex.get(index),
      // user001 owns the group so viewer-role and permission controls are real.
      role: index === 1 ? "owner" : index === 2 ? "admin" : "member",
      status: "joined"
    })),
    "conversation_id,user_id"
  );

  return id;
}

async function seedMessages(admin, conversationId, planned, userIdByIndex) {
  const rows = planned.map((message) => ({
    conversation_id: conversationId,
    sender_id: userIdByIndex.get(message.senderIndex),
    message_type: "text",
    text_content: message.body,
    client_message_id: message.clientMessageId,
    created_at: message.createdAt,
    status: "sent"
  }));

  await insertMissingMessages(admin, conversationId, rows);
  log(`  ${rows.length} messages`);
}

/**
 * Insert only the messages this conversation does not already have.
 *
 * The real idempotency key is `messages_idempotency_unique`, a PARTIAL unique
 * index on (sender_id, client_message_id) WHERE both are non-null. PostgREST
 * cannot target a partial index with on_conflict, so a rerun discovers the
 * existing client_message_ids first and inserts only the difference. Same
 * guarantee, expressed against the constraint that actually exists.
 */
async function insertMissingMessages(admin, conversationId, rows) {
  const existing = new Set();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("messages")
      .select("client_message_id")
      .eq("conversation_id", conversationId)
      .not("client_message_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read messages failed: ${error.message}`);
    for (const row of data) existing.add(row.client_message_id);
    if (data.length < PAGE) break;
  }

  const missing = rows.filter((row) => !existing.has(row.client_message_id));
  if (missing.length === 0) return;

  for (let i = 0; i < missing.length; i += 200) {
    const { error } = await admin.from("messages").insert(missing.slice(i, i + 200));
    if (error) throw new Error(`insert messages failed: ${error.message}`);
  }
}

async function seedMedia(admin, userIdByIndex, conversations) {
  log("Seeding media fixtures…");
  const owner = userIdByIndex.get(1);

  const image = await ensureMedia(admin, {
    owner,
    conversationId: conversations.primary,
    bucketKey: `staging/${STAGING_MARKER}/attachment.png`,
    contentType: ATTACHMENT_FIXTURE.contentType,
    bytes: buildAttachmentPng(),
    width: ATTACHMENT_FIXTURE.width,
    height: ATTACHMENT_FIXTURE.height
  });

  const voice = await ensureMedia(admin, {
    owner,
    conversationId: conversations.primary,
    bucketKey: `staging/${STAGING_MARKER}/voice.wav`,
    contentType: VOICE_FIXTURE.contentType,
    bytes: buildVoiceWav()
  });

  await insertMissingMessages(admin, conversations.primary, [
    {
      conversation_id: conversations.primary,
      sender_id: owner,
      message_type: "image",
      media_id: image,
      client_message_id: `${STAGING_MARKER}:attachment`,
      status: "sent"
    },
    {
      conversation_id: conversations.primary,
      sender_id: owner,
      message_type: "voice_note",
      media_id: voice,
      duration_seconds: VOICE_FIXTURE.durationSeconds,
      waveform_data: buildWaveform(),
      client_message_id: `${STAGING_MARKER}:voice`,
      status: "sent"
    }
  ]);
  log("  1 attachment, 1 voice note");
}

async function ensureMedia(admin, spec) {
  // storage_key is UNIQUE on media_assets, which makes it the natural key.
  const { data: found } = await admin
    .from("media_assets")
    .select("id")
    .eq("storage_key", spec.bucketKey)
    .maybeSingle();

  // 'media' is the private bucket declared in 20260717140000.
  await admin.storage
    .from("media")
    .upload(spec.bucketKey, Buffer.from(spec.bytes), {
      contentType: spec.contentType,
      upsert: true
    });

  if (found) return found.id;

  const { data, error } = await admin
    .from("media_assets")
    .insert({
      owner_id: spec.owner,
      storage_key: spec.bucketKey,
      content_type: spec.contentType,
      size_bytes: spec.bytes.byteLength,
      width: spec.width ?? null,
      height: spec.height ?? null,
      // The message media guard requires ALL of these to accept the attachment.
      processing_status: "ready",
      moderation_status: "active",
      context_type: "chat",
      intended_conversation_id: spec.conversationId
    })
    .select("id")
    .single();
  if (error) throw new Error(`create media asset failed: ${error.message}`);
  return data.id;
}

/** Manifest of ids for the runtime proofs. Never contains credentials. */
function writeManifest(safety, accounts, userIdByIndex, conversations) {
  const cohorts = buildCohorts();
  const manifest = {
    generatedAt: new Date().toISOString(),
    projectRef: safety.projectRef,
    note: "Synthetic staging fixture. Contains no credentials.",
    passwordSource: `env ${STAGING_PASSWORD_ENV} (not recorded here)`,
    accounts: accounts.map((account) => ({
      label: account.label,
      email: account.email,
      username: account.username,
      userId: userIdByIndex.get(account.index)
    })),
    cohorts,
    conversations
  };

  const target = path.join(process.cwd(), "staging-manifest.local.json");
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  log(`Manifest written to ${path.basename(target)} (gitignored).`);
}

try {
  await main();
} catch (error) {
  // Message only: an error object could carry request context.
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
}
