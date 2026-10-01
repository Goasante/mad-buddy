import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { batchBlockedIds, isBlockedEitherDirection } from "@/lib/social/permissions";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { CONFERENCE_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ConferenceFeedResult,
  ConferenceReply,
  ConferenceReportReason,
  ConferenceSort,
  ConferenceTargetType,
  ConferenceTopic,
  ConferenceTopicDetail,
  ConferenceVote
} from "@/lib/conference/types";

export const CONFERENCE_RADIUS_METERS = 15_000;
export const CONFERENCE_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;
export const CONFERENCE_TOPIC_MAX_CHARS = 300;
export const CONFERENCE_REPLY_MAX_CHARS = 300;
export const CONFERENCE_FEED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type ConferenceDb = SupabaseClient;

type ViewerLocation = {
  latitude: number;
  longitude: number;
  last_updated: string;
};

type TopicRow = {
  id: string;
  author_user_id: string;
  origin_latitude: number;
  origin_longitude: number;
  body: string;
  status: string;
  hype_count: number;
  pass_count: number;
  reply_count: number;
  expires_at: string;
  created_at: string;
};

type ReplyRow = {
  id: string;
  topic_id: string;
  author_user_id: string;
  body: string;
  status: string;
  hype_count: number;
  pass_count: number;
  created_at: string;
};

type VoteRow = {
  topic_id: string | null;
  reply_id: string | null;
  user_id: string;
  value: number;
};

type VoiceRow = {
  topic_id: string;
  user_id: string;
  voice_number: number;
};

type RestrictionState = {
  suspended: boolean;
  writeRestricted: boolean;
};

async function conferenceIsEnabled(admin: Admin) {
  return isFeatureEnabled(admin, CONFERENCE_FLAG);
}

function conferenceDb(admin: Admin): ConferenceDb {
  // Conference tables are introduced by the unapplied feature migration, so
  // the curated generated Database type does not know them yet. Keep the cast
  // at this one boundary instead of weakening existing-table typing.
  return admin as unknown as ConferenceDb;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function boundingBox(lat: number, lon: number, radiusMeters: number) {
  const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const lonDelta = latDelta / Math.max(0.01, Math.cos(toRad(lat)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
}

function coarseCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function voiceKey(topicId: string, userId: string) {
  return `${topicId}:${userId}`;
}

function voteFromValue(value: number | undefined): ConferenceVote | null {
  if (value === 1) return "hype";
  if (value === -1) return "pass";
  return null;
}

function isFreshLocation(location: ViewerLocation | null | undefined): location is ViewerLocation {
  if (!location) return false;
  const ageMs = Date.now() - Date.parse(location.last_updated);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= CONFERENCE_LOCATION_MAX_AGE_MS;
}

async function getRestrictionState(admin: Admin, userId: string): Promise<RestrictionState> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("user_restrictions")
    .select("restriction_type, starts_at, ends_at")
    .eq("user_id", userId)
    .is("lifted_at", null)
    .lte("starts_at", nowIso);

  const active = (data ?? []).filter((row) => !row.ends_at || row.ends_at > nowIso);
  const types = new Set(active.map((row) => row.restriction_type));

  return {
    suspended: types.has("suspended_temporary") || types.has("suspended_permanent"),
    writeRestricted: types.has("rate_limited")
  };
}

/**
 * Conference owns its own current coarse signal so opening it cannot change
 * Glow. A fresh existing proximity signal may be READ as a fallback, because
 * using a location Mad Buddy already has does not create a new side effect.
 */
async function getViewerLocation(admin: Admin, userId: string): Promise<{
  location: ViewerLocation | null;
  stale: boolean;
}> {
  const conference = conferenceDb(admin);
  const [{ data: conferenceLocation }, { data: existingLocation }, { data: profile }] = await Promise.all([
    conference
      .from("conference_locations")
      .select("latitude, longitude, last_updated")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("user_locations")
      .select("latitude, longitude, last_updated")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("visibility_status")
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  const conferenceCandidate = conferenceLocation as ViewerLocation | null;
  const existingCandidate = existingLocation as ViewerLocation | null;
  const mayReuseGlowSignal = profile?.visibility_status !== "ghost";

  const fresh = [conferenceCandidate, ...(mayReuseGlowSignal ? [existingCandidate] : [])]
    .filter(isFreshLocation)
    .sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated));

  if (fresh[0]) return { location: fresh[0], stale: false };
  return {
    location: null,
    stale: Boolean(conferenceCandidate || (mayReuseGlowSignal && existingCandidate))
  };
}

async function loadHiddenUserIds(conference: ConferenceDb, viewerUserId: string): Promise<Set<string>> {
  const { data } = await conference
    .from("conference_hidden_users")
    .select("hidden_user_id")
    .eq("viewer_user_id", viewerUserId);
  return new Set((data ?? []).map((row) => String(row.hidden_user_id)));
}

async function loadHiddenContentIds(
  admin: Admin,
  viewerUserId: string,
  contentType: "conference_topic" | "conference_reply"
): Promise<Set<string>> {
  const { data } = await admin
    .from("hidden_content")
    .select("content_id")
    .eq("user_id", viewerUserId)
    .eq("content_type", contentType);
  return new Set((data ?? []).map((row) => row.content_id));
}

async function isConferenceUserHidden(conference: ConferenceDb, viewerUserId: string, candidateUserId: string) {
  const { data } = await conference
    .from("conference_hidden_users")
    .select("hidden_user_id")
    .eq("viewer_user_id", viewerUserId)
    .eq("hidden_user_id", candidateUserId)
    .maybeSingle();
  return Boolean(data);
}

async function ensureVoiceNumber(
  conference: ConferenceDb,
  topicId: string,
  userId: string
): Promise<number> {
  const { data: existing } = await conference
    .from("conference_voice_ids")
    .select("voice_number")
    .eq("topic_id", topicId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.voice_number) return Number(existing.voice_number);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const voiceNumber = randomInt(1, 1000);
    const { data, error } = await conference
      .from("conference_voice_ids")
      .insert({ topic_id: topicId, user_id: userId, voice_number: voiceNumber })
      .select("voice_number")
      .single();

    if (!error && data?.voice_number) return Number(data.voice_number);

    // A concurrent request may have created this user's mapping while our
    // random number collided. Prefer that mapping over creating another.
    const { data: wonRace } = await conference
      .from("conference_voice_ids")
      .select("voice_number")
      .eq("topic_id", topicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (wonRace?.voice_number) return Number(wonRace.voice_number);
  }

  throw new Error("Could not assign an anonymous Conference Voice.");
}

function buildTopicProjection(
  row: TopicRow,
  voiceNumbers: Map<string, number>,
  yourVote: ConferenceVote | null,
  viewerUserId: string
): ConferenceTopic {
  const voiceNumber = voiceNumbers.get(voiceKey(row.id, row.author_user_id));
  return {
    id: row.id,
    voiceLabel: voiceNumber ? `Voice ${voiceNumber}` : "Voice",
    body: row.body,
    createdAt: row.created_at,
    hypeCount: row.hype_count,
    passCount: row.pass_count,
    replyCount: row.reply_count,
    yourVote,
    isYours: row.author_user_id === viewerUserId
  };
}

function hotScore(topic: ConferenceTopic): number {
  const ageHours = Math.max(0, (Date.now() - Date.parse(topic.createdAt)) / 3_600_000);
  return topic.hypeCount - topic.passCount * 0.75 + Math.min(topic.replyCount, 20) * 1.5 - ageHours * 0.25;
}

export async function loadConferenceFeed(userId: string, sort: ConferenceSort): Promise<ConferenceFeedResult> {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { locationAvailable: false, locationStale: false, accessRestricted: true, topics: [] };
  }
  const restrictions = await getRestrictionState(admin, userId);
  if (restrictions.suspended) {
    return { locationAvailable: false, locationStale: false, accessRestricted: true, topics: [] };
  }

  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) {
    return {
      locationAvailable: false,
      locationStale: viewer.stale,
      accessRestricted: false,
      topics: []
    };
  }

  const conference = conferenceDb(admin);
  const box = boundingBox(viewer.location.latitude, viewer.location.longitude, CONFERENCE_RADIUS_METERS);
  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - CONFERENCE_FEED_LOOKBACK_MS).toISOString();

  const { data, error } = await conference
    .from("conference_topics")
    .select(
      "id, author_user_id, origin_latitude, origin_longitude, body, status, hype_count, pass_count, reply_count, expires_at, created_at"
    )
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .gte("created_at", cutoffIso)
    .gte("origin_latitude", box.minLat)
    .lte("origin_latitude", box.maxLat)
    .gte("origin_longitude", box.minLon)
    .lte("origin_longitude", box.maxLon)
    .order("created_at", { ascending: false })
    .limit(160);

  if (error) throw error;

  const candidates = (data ?? []) as TopicRow[];
  const [hidden, blocked, hiddenTopics] = await Promise.all([
    loadHiddenUserIds(conference, userId),
    batchBlockedIds(admin, userId, candidates.map((row) => row.author_user_id)),
    loadHiddenContentIds(admin, userId, "conference_topic")
  ]);

  const rows = candidates
    .filter((row) => !hidden.has(row.author_user_id) && !blocked.has(row.author_user_id) && !hiddenTopics.has(row.id))
    .filter(
      (row) =>
        distanceMeters(
          viewer.location!.latitude,
          viewer.location!.longitude,
          row.origin_latitude,
          row.origin_longitude
        ) <= CONFERENCE_RADIUS_METERS
    );

  if (rows.length === 0) {
    return { locationAvailable: true, locationStale: false, accessRestricted: false, topics: [] };
  }

  const topicIds = rows.map((row) => row.id);
  const [{ data: voteRows }, { data: voiceRows }] = await Promise.all([
    conference
      .from("conference_votes")
      .select("topic_id, reply_id, user_id, value")
      .eq("user_id", userId)
      .in("topic_id", topicIds),
    conference
      .from("conference_voice_ids")
      .select("topic_id, user_id, voice_number")
      .in("topic_id", topicIds)
  ]);

  const votes = (voteRows ?? []) as VoteRow[];
  const voices = (voiceRows ?? []) as VoiceRow[];
  const yourVotes = new Map(
    votes
      .filter((row) => row.topic_id)
      .map((row) => [String(row.topic_id), voteFromValue(row.value)])
  );
  const voiceNumbers = new Map(
    voices.map((row) => [voiceKey(row.topic_id, row.user_id), row.voice_number])
  );

  const topics = rows.map((row) =>
    buildTopicProjection(row, voiceNumbers, yourVotes.get(row.id) ?? null, userId)
  );

  if (sort === "hot") topics.sort((a, b) => hotScore(b) - hotScore(a));
  else topics.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    locationAvailable: true,
    locationStale: false,
    accessRestricted: false,
    topics: topics.slice(0, 40)
  };
}

async function loadAccessibleTopicRow(
  admin: Admin,
  userId: string,
  topicId: string
): Promise<TopicRow | null> {
  const restrictions = await getRestrictionState(admin, userId);
  if (restrictions.suspended) return null;

  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) return null;

  const conference = conferenceDb(admin);
  const { data, error } = await conference
    .from("conference_topics")
    .select(
      "id, author_user_id, origin_latitude, origin_longitude, body, status, hype_count, pass_count, reply_count, expires_at, created_at"
    )
    .eq("id", topicId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  const row = data as TopicRow | null;
  if (!row) return null;

  const [{ data: hiddenTopic }, hidden, blocked] = await Promise.all([
    admin
      .from("hidden_content")
      .select("id")
      .eq("user_id", userId)
      .eq("content_type", "conference_topic")
      .eq("content_id", row.id)
      .maybeSingle(),
    isConferenceUserHidden(conference, userId, row.author_user_id),
    isBlockedEitherDirection(admin, userId, row.author_user_id)
  ]);
  if (hiddenTopic || hidden || blocked) return null;

  if (
    distanceMeters(
      viewer.location.latitude,
      viewer.location.longitude,
      row.origin_latitude,
      row.origin_longitude
    ) > CONFERENCE_RADIUS_METERS
  ) {
    return null;
  }

  return row;
}

export async function loadConferenceTopic(
  userId: string,
  topicId: string
): Promise<ConferenceTopicDetail | null> {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return null;
  }
  const topic = await loadAccessibleTopicRow(admin, userId, topicId);
  if (!topic) return null;

  const conference = conferenceDb(admin);
  const { data: replyData, error: replyError } = await conference
    .from("conference_replies")
    .select("id, topic_id, author_user_id, body, status, hype_count, pass_count, created_at")
    .eq("topic_id", topicId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(300);

  if (replyError) throw replyError;

  const replyCandidates = ((replyData ?? []) as ReplyRow[]).reverse();
  const [hidden, blocked, hiddenReplies] = await Promise.all([
    loadHiddenUserIds(conference, userId),
    batchBlockedIds(admin, userId, replyCandidates.map((reply) => reply.author_user_id)),
    loadHiddenContentIds(admin, userId, "conference_reply")
  ]);
  const replies = replyCandidates.filter(
    (reply) =>
      !hidden.has(reply.author_user_id) &&
      !blocked.has(reply.author_user_id) &&
      !hiddenReplies.has(reply.id)
  );
  const replyIds = replies.map((reply) => reply.id);

  const [{ data: topicVoteRows }, { data: replyVoteRows }, { data: voiceRows }] = await Promise.all([
    conference
      .from("conference_votes")
      .select("topic_id, reply_id, user_id, value")
      .eq("user_id", userId)
      .eq("topic_id", topicId),
    replyIds.length
      ? conference
          .from("conference_votes")
          .select("topic_id, reply_id, user_id, value")
          .eq("user_id", userId)
          .in("reply_id", replyIds)
      : Promise.resolve({ data: [] }),
    conference
      .from("conference_voice_ids")
      .select("topic_id, user_id, voice_number")
      .eq("topic_id", topicId)
  ]);

  const votes = [
    ...((topicVoteRows ?? []) as VoteRow[]),
    ...((replyVoteRows ?? []) as VoteRow[])
  ];
  const voices = (voiceRows ?? []) as VoiceRow[];
  const voiceNumbers = new Map(
    voices.map((row) => [voiceKey(row.topic_id, row.user_id), row.voice_number])
  );

  const topicVote = votes.find((vote) => vote.topic_id === topicId);
  const topicProjection = buildTopicProjection(
    { ...topic, reply_count: replies.length },
    voiceNumbers,
    voteFromValue(topicVote?.value),
    userId
  );

  const replyProjections: ConferenceReply[] = replies.map((reply) => {
    const vote = votes.find((item) => item.reply_id === reply.id);
    const voiceNumber = voiceNumbers.get(voiceKey(topicId, reply.author_user_id));
    return {
      id: reply.id,
      voiceLabel: voiceNumber ? `Voice ${voiceNumber}` : "Voice",
      body: reply.body,
      createdAt: reply.created_at,
      hypeCount: reply.hype_count,
      passCount: reply.pass_count,
      yourVote: voteFromValue(vote?.value),
      isYours: reply.author_user_id === userId
    };
  });

  return { ...topicProjection, replies: replyProjections };
}

function writeRestrictionMessage(state: RestrictionState) {
  if (state.suspended) return "Conference is unavailable while this account restriction is active.";
  if (state.writeRestricted) return "Conference posting is temporarily limited for this account.";
  return null;
}

export async function createConferenceTopic(userId: string, body: string) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }
  const restrictions = await getRestrictionState(admin, userId);
  const restrictionMessage = writeRestrictionMessage(restrictions);
  if (restrictionMessage) return { ok: false, message: restrictionMessage };

  const rate = await consumeRateLimit({ action: "conference.topic.create", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) {
    return { ok: false, message: "Refresh Around You before starting a Topic." };
  }

  const conference = conferenceDb(admin);
  const { data, error } = await conference
    .from("conference_topics")
    .insert({
      author_user_id: userId,
      origin_latitude: coarseCoordinate(viewer.location.latitude),
      origin_longitude: coarseCoordinate(viewer.location.longitude),
      body
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return { ok: false, message: "Couldn't start that Topic. Try again." };
  }

  const topicId = String(data.id);
  try {
    await ensureVoiceNumber(conference, topicId, userId);
  } catch {
    // Do not leave a Topic that cannot satisfy Conference's anonymity contract.
    await conference.from("conference_topics").delete().eq("id", topicId);
    return { ok: false, message: "Couldn't assign your anonymous Voice. Try again." };
  }

  return { ok: true, message: "Topic posted Around You.", topicId };
}

export async function createConferenceReply(userId: string, topicId: string, body: string) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }
  const restrictions = await getRestrictionState(admin, userId);
  const restrictionMessage = writeRestrictionMessage(restrictions);
  if (restrictionMessage) return { ok: false, message: restrictionMessage };

  const rate = await consumeRateLimit({ action: "conference.reply.create", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const topic = await loadAccessibleTopicRow(admin, userId, topicId);
  if (!topic) return { ok: false, message: "That Topic isn't available Around You." };

  const conference = conferenceDb(admin);
  try {
    await ensureVoiceNumber(conference, topicId, userId);
  } catch {
    return { ok: false, message: "Couldn't assign your anonymous Voice. Try again." };
  }

  const { error } = await conference
    .from("conference_replies")
    .insert({ topic_id: topicId, author_user_id: userId, body });

  return error
    ? { ok: false, message: "Couldn't add your Voice. Try again." }
    : { ok: true, message: "Your Voice was added." };
}

async function resolveTarget(
  admin: Admin,
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string
): Promise<{ topicId: string; authorUserId: string } | null> {
  if (targetType === "topic") {
    const topic = await loadAccessibleTopicRow(admin, userId, targetId);
    return topic ? { topicId: topic.id, authorUserId: topic.author_user_id } : null;
  }

  const conference = conferenceDb(admin);
  const { data, error } = await conference
    .from("conference_replies")
    .select("id, topic_id, author_user_id")
    .eq("id", targetId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const topic = await loadAccessibleTopicRow(admin, userId, String(data.topic_id));
  if (!topic) return null;

  const authorUserId = String(data.author_user_id);
  const [hidden, blocked] = await Promise.all([
    isConferenceUserHidden(conference, userId, authorUserId),
    isBlockedEitherDirection(admin, userId, authorUserId)
  ]);
  if (hidden || blocked) return null;

  return { topicId: topic.id, authorUserId };
}

export async function voteConference(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string,
  vote: ConferenceVote
) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }
  const restrictions = await getRestrictionState(admin, userId);
  if (restrictions.suspended || restrictions.writeRestricted) {
    return { ok: false, message: "Conference voting is temporarily unavailable for this account." };
  }

  const rate = await consumeRateLimit({ action: "conference.vote", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That conversation isn't available Around You." };
  if (target.authorUserId === userId) {
    return { ok: false, message: "You can't Hype or Pass your own Voice." };
  }

  const conference = conferenceDb(admin);
  const targetColumn = targetType === "topic" ? "topic_id" : "reply_id";
  const value = vote === "hype" ? 1 : -1;
  const { data: existing, error: existingError } = await conference
    .from("conference_votes")
    .select("id, value")
    .eq("user_id", userId)
    .eq(targetColumn, targetId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id && Number(existing.value) === value) {
    const { error } = await conference.from("conference_votes").delete().eq("id", existing.id);
    return error
      ? { ok: false, message: "Couldn't update your vote." }
      : { ok: true, message: "Vote removed." };
  }

  if (existing?.id) {
    const { error } = await conference
      .from("conference_votes")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return error
      ? { ok: false, message: "Couldn't update your vote." }
      : { ok: true, message: "Vote updated." };
  }

  const insert =
    targetType === "topic"
      ? conference
          .from("conference_votes")
          .insert({ user_id: userId, topic_id: targetId, reply_id: null, value })
      : conference
          .from("conference_votes")
          .insert({ user_id: userId, topic_id: null, reply_id: targetId, value });
  const { error } = await insert;

  return error
    ? { ok: false, message: "Couldn't add your vote." }
    : { ok: true, message: vote === "hype" ? "Hyped." : "Passed." };
}

export async function reportConference(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string,
  reason: ConferenceReportReason
) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }
  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That conversation isn't available Around You." };
  if (target.authorUserId === userId) {
    return { ok: false, message: "You can't flag your own Voice." };
  }

  const rate = await consumeRateLimit({ action: "content.report", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const contentType = targetType === "topic" ? "conference_topic" : "conference_reply";
  const { data: existing } = await admin
    .from("content_reports")
    .select("id")
    .eq("reporter_id", userId)
    .eq("content_type", contentType)
    .eq("content_id", targetId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await admin.from("hidden_content").upsert(
      { user_id: userId, content_type: contentType, content_id: targetId },
      { onConflict: "user_id,content_type,content_id" }
    );
    return { ok: true, message: "You've already flagged this. It remains hidden from you." };
  }

  const { requiresHumanReview } = await import("@/lib/content/safety");
  const { error } = await admin.from("content_reports").insert({
    reporter_id: userId,
    content_type: contentType,
    content_id: targetId,
    reported_user_id: target.authorUserId,
    category: reason,
    status: requiresHumanReview(reason) ? "under_review" : "received"
  });

  if (error && error.code !== "23505") {
    return { ok: false, message: "Couldn't send the flag. Try again." };
  }

  // Reporting immediately removes only this item from the reporter's view.
  // "Hide this Voice" is the broader Conference-only account mute.
  await admin.from("hidden_content").upsert(
    { user_id: userId, content_type: contentType, content_id: targetId },
    { onConflict: "user_id,content_type,content_id" }
  );

  return {
    ok: true,
    message: error?.code === "23505"
      ? "You've already flagged this. It remains hidden from you."
      : "Thanks. We've hidden this content and sent the flag for safety review."
  };
}

export async function hideConferenceVoice(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string
) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }
  const restrictions = await getRestrictionState(admin, userId);
  if (restrictions.suspended) {
    return { ok: false, message: "Conference is unavailable while this account restriction is active." };
  }

  const rate = await consumeRateLimit({ action: "conference.hide", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That Voice isn't available Around You." };
  if (target.authorUserId === userId) {
    return { ok: false, message: "You can't hide your own Voice." };
  }

  const conference = conferenceDb(admin);
  const { error } = await conference
    .from("conference_hidden_users")
    .upsert(
      { viewer_user_id: userId, hidden_user_id: target.authorUserId },
      { onConflict: "viewer_user_id,hidden_user_id" }
    );

  return error
    ? { ok: false, message: "Couldn't hide that Voice." }
    : { ok: true, message: "That Voice is hidden from your Conference." };
}


export async function deleteConferenceContent(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string
) {
  const admin = createSupabaseAdminClient();
  if (!(await conferenceIsEnabled(admin))) {
    return { ok: false, message: "Conference is unavailable." };
  }

  // Deleting your own content is a privacy/user-control action, so it does not
  // depend on current location and is not blocked by participation rate limits
  // or account restrictions.
  const conference = conferenceDb(admin);
  const table = targetType === "topic" ? "conference_topics" : "conference_replies";
  const { data: row, error: readError } = await conference
    .from(table)
    .select(targetType === "topic" ? "id, author_user_id, status" : "id, author_user_id, topic_id, status")
    .eq("id", targetId)
    .maybeSingle();

  if (readError || !row) {
    return { ok: false, message: targetType === "topic" ? "Topic not found." : "Voice not found." };
  }
  if (String(row.author_user_id) !== userId) {
    return { ok: false, message: "You can only delete your own Conference content." };
  }
  if (row.status !== "active" && row.status !== "hidden") {
    return { ok: true, message: targetType === "topic" ? "Topic already deleted." : "Voice already deleted." };
  }

  const now = new Date().toISOString();
  if (targetType === "topic") {
    const { error } = await conference
      .from("conference_topics")
      .update({
        status: "removed",
        origin_latitude: null,
        origin_longitude: null,
        updated_at: now
      })
      .eq("id", targetId)
      .eq("author_user_id", userId);

    return error
      ? { ok: false, message: "Couldn't delete that Topic." }
      : { ok: true, message: "Topic deleted." };
  }

  const { error } = await conference
    .from("conference_replies")
    .update({ status: "removed", updated_at: now })
    .eq("id", targetId)
    .eq("author_user_id", userId);

  return error
    ? { ok: false, message: "Couldn't delete that Voice." }
    : { ok: true, message: "Voice deleted." };
}
