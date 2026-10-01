import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  ConferenceFeedResult,
  ConferenceReply,
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

const CONFERENCE_FEED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const EARTH_RADIUS_M = 6_371_000;
const TOPICS_PER_HOUR = 5;
const REPLIES_PER_HOUR = 30;
const REPORTS_PER_DAY = 20;

type Db = SupabaseClient;

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
  created_at: string;
};

type ReplyRow = {
  id: string;
  topic_id: string;
  author_user_id: string;
  body: string;
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

function db(): Db {
  return createSupabaseAdminClient() as unknown as Db;
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

/**
 * Conference stores only a coarse topic anchor, not the viewer's raw fix.
 * Two decimal places is roughly kilometre-scale around Ghana, enough for a
 * 15km feed without turning a historical Topic into a precise location record.
 */
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

async function loadHiddenUserIds(admin: Db, viewerUserId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("conference_hidden_users")
    .select("hidden_user_id")
    .eq("viewer_user_id", viewerUserId);
  return new Set((data ?? []).map((row) => String(row.hidden_user_id)));
}

async function getViewerLocation(admin: Db, userId: string): Promise<{
  location: ViewerLocation | null;
  stale: boolean;
}> {
  const { data } = await admin
    .from("user_locations")
    .select("latitude, longitude, last_updated")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { location: null, stale: false };

  const location = data as ViewerLocation;
  const ageMs = Date.now() - Date.parse(location.last_updated);
  if (!Number.isFinite(ageMs) || ageMs > CONFERENCE_LOCATION_MAX_AGE_MS) {
    return { location: null, stale: true };
  }
  return { location, stale: false };
}

async function restrictionAllows(admin: Db, userId: string, capability: "post" | "reply" | "vote" | "report") {
  const { data } = await admin
    .from("conference_restrictions")
    .select("can_post, can_reply, can_vote, can_report, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return true;
  if (data.expires_at && Date.parse(String(data.expires_at)) <= Date.now()) return true;

  const key =
    capability === "post"
      ? "can_post"
      : capability === "reply"
        ? "can_reply"
        : capability === "vote"
          ? "can_vote"
          : "can_report";
  return data[key] !== false;
}

async function withinRateLimit(
  admin: Db,
  table: "conference_topics" | "conference_replies" | "conference_reports",
  userColumn: "author_user_id" | "reporter_user_id",
  userId: string,
  sinceIso: string,
  max: number
) {
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(userColumn, userId)
    .gte("created_at", sinceIso);
  return (count ?? 0) < max;
}

async function ensureVoiceNumber(admin: Db, topicId: string, userId: string): Promise<number> {
  const { data: existing } = await admin
    .from("conference_voice_ids")
    .select("voice_number")
    .eq("topic_id", topicId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.voice_number) return Number(existing.voice_number);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const voiceNumber = randomInt(1, 1000);
    const { data, error } = await admin
      .from("conference_voice_ids")
      .insert({ topic_id: topicId, user_id: userId, voice_number: voiceNumber })
      .select("voice_number")
      .single();

    if (!error && data?.voice_number) return Number(data.voice_number);

    const { data: wonRace } = await admin
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
  votes: VoteRow[],
  replyCount: number,
  viewerUserId: string
): ConferenceTopic {
  let hypeCount = 0;
  let passCount = 0;
  let yourValue: number | undefined;
  for (const vote of votes) {
    if (vote.topic_id !== row.id) continue;
    if (vote.value === 1) hypeCount += 1;
    if (vote.value === -1) passCount += 1;
    if (vote.user_id === viewerUserId) yourValue = vote.value;
  }

  return {
    id: row.id,
    voiceLabel: `Voice ${voiceNumbers.get(voiceKey(row.id, row.author_user_id)) ?? "?"}`,
    body: row.body,
    createdAt: row.created_at,
    hypeCount,
    passCount,
    replyCount,
    yourVote: voteFromValue(yourValue)
  };
}

function hotScore(topic: ConferenceTopic): number {
  const ageHours = Math.max(0, (Date.now() - Date.parse(topic.createdAt)) / 3_600_000);
  return topic.hypeCount - topic.passCount * 0.75 + Math.min(topic.replyCount, 20) * 1.5 - ageHours * 0.25;
}

export async function loadConferenceFeed(userId: string, sort: ConferenceSort): Promise<ConferenceFeedResult> {
  const admin = db();
  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) {
    return { locationAvailable: false, locationStale: viewer.stale, topics: [] };
  }

  const hidden = await loadHiddenUserIds(admin, userId);
  const box = boundingBox(viewer.location.latitude, viewer.location.longitude, CONFERENCE_RADIUS_METERS);
  const cutoffIso = new Date(Date.now() - CONFERENCE_FEED_LOOKBACK_MS).toISOString();

  const { data } = await admin
    .from("conference_topics")
    .select("id, author_user_id, origin_latitude, origin_longitude, body, created_at")
    .eq("status", "active")
    .gte("created_at", cutoffIso)
    .gte("origin_latitude", box.minLat)
    .lte("origin_latitude", box.maxLat)
    .gte("origin_longitude", box.minLon)
    .lte("origin_longitude", box.maxLon)
    .order("created_at", { ascending: false })
    .limit(160);

  const rows = ((data ?? []) as TopicRow[])
    .filter((row) => !hidden.has(row.author_user_id))
    .filter(
      (row) =>
        distanceMeters(
          viewer.location!.latitude,
          viewer.location!.longitude,
          row.origin_latitude,
          row.origin_longitude
        ) <= CONFERENCE_RADIUS_METERS
    );

  if (rows.length === 0) return { locationAvailable: true, locationStale: false, topics: [] };

  const topicIds = rows.map((row) => row.id);
  const [{ data: replyRows }, { data: voteRows }, { data: voiceRows }] = await Promise.all([
    admin
      .from("conference_replies")
      .select("id, topic_id, author_user_id, body, created_at")
      .in("topic_id", topicIds)
      .eq("status", "active")
      .limit(2000),
    admin
      .from("conference_votes")
      .select("topic_id, reply_id, user_id, value")
      .in("topic_id", topicIds)
      .limit(4000),
    admin
      .from("conference_voice_ids")
      .select("topic_id, user_id, voice_number")
      .in("topic_id", topicIds)
      .limit(4000)
  ]);

  const replies = (replyRows ?? []) as ReplyRow[];
  const votes = (voteRows ?? []) as VoteRow[];
  const voices = (voiceRows ?? []) as VoiceRow[];
  const voiceNumbers = new Map(voices.map((row) => [voiceKey(row.topic_id, row.user_id), row.voice_number]));
  const replyCounts = new Map<string, number>();

  for (const reply of replies) {
    if (hidden.has(reply.author_user_id)) continue;
    replyCounts.set(reply.topic_id, (replyCounts.get(reply.topic_id) ?? 0) + 1);
  }

  const topics = rows.map((row) =>
    buildTopicProjection(row, voiceNumbers, votes, replyCounts.get(row.id) ?? 0, userId)
  );

  if (sort === "hot") topics.sort((a, b) => hotScore(b) - hotScore(a));
  else topics.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return { locationAvailable: true, locationStale: false, topics: topics.slice(0, 40) };
}

async function loadAccessibleTopicRow(admin: Db, userId: string, topicId: string): Promise<TopicRow | null> {
  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) return null;

  const hidden = await loadHiddenUserIds(admin, userId);
  const { data } = await admin
    .from("conference_topics")
    .select("id, author_user_id, origin_latitude, origin_longitude, body, created_at")
    .eq("id", topicId)
    .eq("status", "active")
    .maybeSingle();

  const row = data as TopicRow | null;
  if (!row || hidden.has(row.author_user_id)) return null;
  if (
    distanceMeters(
      viewer.location.latitude,
      viewer.location.longitude,
      row.origin_latitude,
      row.origin_longitude
    ) > CONFERENCE_RADIUS_METERS
  ) return null;

  return row;
}

export async function loadConferenceTopic(userId: string, topicId: string): Promise<ConferenceTopicDetail | null> {
  const admin = db();
  const topic = await loadAccessibleTopicRow(admin, userId, topicId);
  if (!topic) return null;

  const hidden = await loadHiddenUserIds(admin, userId);
  const { data: replyData } = await admin
    .from("conference_replies")
    .select("id, topic_id, author_user_id, body, created_at")
    .eq("topic_id", topicId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(300);

  const replies = ((replyData ?? []) as ReplyRow[]).filter((reply) => !hidden.has(reply.author_user_id));
  const replyIds = replies.map((reply) => reply.id);

  const [{ data: topicVotes }, { data: replyVotes }, { data: voiceRows }] = await Promise.all([
    admin
      .from("conference_votes")
      .select("topic_id, reply_id, user_id, value")
      .eq("topic_id", topicId),
    replyIds.length
      ? admin
          .from("conference_votes")
          .select("topic_id, reply_id, user_id, value")
          .in("reply_id", replyIds)
      : Promise.resolve({ data: [] }),
    admin
      .from("conference_voice_ids")
      .select("topic_id, user_id, voice_number")
      .eq("topic_id", topicId)
  ]);

  const votes = [...((topicVotes ?? []) as VoteRow[]), ...((replyVotes ?? []) as VoteRow[])];
  const voices = (voiceRows ?? []) as VoiceRow[];
  const voiceNumbers = new Map(voices.map((row) => [voiceKey(row.topic_id, row.user_id), row.voice_number]));
  const topicProjection = buildTopicProjection(topic, voiceNumbers, votes, replies.length, userId);

  const replyProjections: ConferenceReply[] = replies.map((reply) => {
    let hypeCount = 0;
    let passCount = 0;
    let yourValue: number | undefined;
    for (const vote of votes) {
      if (vote.reply_id !== reply.id) continue;
      if (vote.value === 1) hypeCount += 1;
      if (vote.value === -1) passCount += 1;
      if (vote.user_id === userId) yourValue = vote.value;
    }
    return {
      id: reply.id,
      voiceLabel: `Voice ${voiceNumbers.get(voiceKey(topicId, reply.author_user_id)) ?? "?"}`,
      body: reply.body,
      createdAt: reply.created_at,
      hypeCount,
      passCount,
      yourVote: voteFromValue(yourValue)
    };
  });

  return { ...topicProjection, replies: replyProjections };
}

export async function createConferenceTopic(userId: string, body: string): Promise<{ ok: boolean; message: string; topicId?: string }> {
  const admin = db();
  if (!(await restrictionAllows(admin, userId, "post"))) {
    return { ok: false, message: "Conference posting is temporarily unavailable for this account." };
  }

  const limitOk = await withinRateLimit(
    admin,
    "conference_topics",
    "author_user_id",
    userId,
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    TOPICS_PER_HOUR
  );
  if (!limitOk) return { ok: false, message: "You've started several Topics recently. Try again a little later." };

  const viewer = await getViewerLocation(admin, userId);
  if (!viewer.location) {
    return { ok: false, message: "Update your location to start a Topic Around You." };
  }

  const { data, error } = await admin
    .from("conference_topics")
    .insert({
      author_user_id: userId,
      origin_latitude: coarseCoordinate(viewer.location.latitude),
      origin_longitude: coarseCoordinate(viewer.location.longitude),
      body
    })
    .select("id")
    .single();

  if (error || !data?.id) return { ok: false, message: "Couldn't start that Topic. Try again." };
  await ensureVoiceNumber(admin, String(data.id), userId);
  return { ok: true, message: "Topic posted Around You.", topicId: String(data.id) };
}

export async function createConferenceReply(userId: string, topicId: string, body: string) {
  const admin = db();
  if (!(await restrictionAllows(admin, userId, "reply"))) {
    return { ok: false, message: "Conference replies are temporarily unavailable for this account." };
  }

  const topic = await loadAccessibleTopicRow(admin, userId, topicId);
  if (!topic) return { ok: false, message: "That Topic isn't available Around You." };

  const limitOk = await withinRateLimit(
    admin,
    "conference_replies",
    "author_user_id",
    userId,
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    REPLIES_PER_HOUR
  );
  if (!limitOk) return { ok: false, message: "You've added several Voices recently. Try again a little later." };

  await ensureVoiceNumber(admin, topicId, userId);
  const { error } = await admin
    .from("conference_replies")
    .insert({ topic_id: topicId, author_user_id: userId, body });

  return error
    ? { ok: false, message: "Couldn't add your Voice. Try again." }
    : { ok: true, message: "Your Voice was added." };
}

async function resolveTarget(
  admin: Db,
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string
): Promise<{ topicId: string; authorUserId: string } | null> {
  if (targetType === "topic") {
    const topic = await loadAccessibleTopicRow(admin, userId, targetId);
    return topic ? { topicId: topic.id, authorUserId: topic.author_user_id } : null;
  }

  const { data } = await admin
    .from("conference_replies")
    .select("id, topic_id, author_user_id")
    .eq("id", targetId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;

  const topic = await loadAccessibleTopicRow(admin, userId, String(data.topic_id));
  return topic ? { topicId: topic.id, authorUserId: String(data.author_user_id) } : null;
}

export async function voteConference(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string,
  vote: ConferenceVote
) {
  const admin = db();
  if (!(await restrictionAllows(admin, userId, "vote"))) {
    return { ok: false, message: "Voting is temporarily unavailable for this account." };
  }
  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That conversation isn't available Around You." };

  const targetColumn = targetType === "topic" ? "topic_id" : "reply_id";
  const value = vote === "hype" ? 1 : -1;
  const { data: existing } = await admin
    .from("conference_votes")
    .select("id, value")
    .eq("user_id", userId)
    .eq(targetColumn, targetId)
    .maybeSingle();

  if (existing?.id && Number(existing.value) === value) {
    const { error } = await admin.from("conference_votes").delete().eq("id", existing.id);
    return error ? { ok: false, message: "Couldn't update your vote." } : { ok: true, message: "Vote removed." };
  }

  if (existing?.id) {
    const { error } = await admin
      .from("conference_votes")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return error ? { ok: false, message: "Couldn't update your vote." } : { ok: true, message: "Vote updated." };
  }

  const payload =
    targetType === "topic"
      ? { user_id: userId, topic_id: targetId, reply_id: null, value }
      : { user_id: userId, topic_id: null, reply_id: targetId, value };
  const { error } = await admin.from("conference_votes").insert(payload);
  return error ? { ok: false, message: "Couldn't add your vote." } : { ok: true, message: vote === "hype" ? "Hyped." : "Passed." };
}

export async function reportConference(
  userId: string,
  targetType: ConferenceTargetType,
  targetId: string,
  reason: string
) {
  const admin = db();
  if (!(await restrictionAllows(admin, userId, "report"))) {
    return { ok: false, message: "Reporting is temporarily unavailable for this account." };
  }
  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That conversation isn't available Around You." };

  const limitOk = await withinRateLimit(
    admin,
    "conference_reports",
    "reporter_user_id",
    userId,
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    REPORTS_PER_DAY
  );
  if (!limitOk) return { ok: false, message: "You've sent several reports today. Try again later." };

  const payload =
    targetType === "topic"
      ? { reporter_user_id: userId, topic_id: targetId, reply_id: null, reason }
      : { reporter_user_id: userId, topic_id: null, reply_id: targetId, reason };
  const { error } = await admin.from("conference_reports").insert(payload);

  if (error?.code === "23505") return { ok: true, message: "You've already flagged this." };
  return error
    ? { ok: false, message: "Couldn't send the flag. Try again." }
    : { ok: true, message: "Thanks. The flag was recorded for review." };
}

export async function hideConferenceVoice(userId: string, targetType: ConferenceTargetType, targetId: string) {
  const admin = db();
  const target = await resolveTarget(admin, userId, targetType, targetId);
  if (!target) return { ok: false, message: "That Voice isn't available Around You." };
  if (target.authorUserId === userId) return { ok: false, message: "You can't hide your own Voice." };

  const { error } = await admin
    .from("conference_hidden_users")
    .upsert(
      { viewer_user_id: userId, hidden_user_id: target.authorUserId },
      { onConflict: "viewer_user_id,hidden_user_id" }
    );

  return error
    ? { ok: false, message: "Couldn't hide that Voice." }
    : { ok: true, message: "That Voice is hidden from your Conference." };
}
