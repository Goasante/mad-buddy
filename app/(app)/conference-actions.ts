"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserRecord } from "@/lib/supabase/auth";
import {
  createConferenceReply,
  createConferenceTopic,
  hideConferenceVoice,
  reportConference,
  voteConference
} from "@/lib/conference/server";
import type { ConferenceActionResult } from "@/lib/conference/types";

const uuid = z.string().uuid();
const bodySchema = z.string().trim().min(1).max(300);
const targetTypeSchema = z.enum(["topic", "reply"]);
const voteSchema = z.enum(["hype", "pass"]);
const reportReasonSchema = z.enum(["spam", "harassment", "hate", "false_info", "other"]);

async function userId() {
  const user = await getCurrentUserRecord();
  return user?.id ?? null;
}

function refresh(topicId?: string) {
  revalidatePath("/conference");
  if (topicId) revalidatePath(`/conference/${topicId}`);
}

export async function createConferenceTopicAction(body: string): Promise<ConferenceActionResult> {
  const user = await userId();
  if (!user) return { ok: false, message: "Log in to use Conference." };
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, message: "Keep your Topic between 1 and 300 characters." };

  const result = await createConferenceTopic(user, parsed.data);
  if (result.ok) refresh(result.topicId);
  return result;
}

export async function createConferenceReplyAction(topicId: string, body: string): Promise<ConferenceActionResult> {
  const user = await userId();
  if (!user) return { ok: false, message: "Log in to join Conference." };
  if (!uuid.safeParse(topicId).success) return { ok: false, message: "Topic not found." };
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, message: "Keep your Voice between 1 and 300 characters." };

  const result = await createConferenceReply(user, topicId, parsed.data);
  if (result.ok) refresh(topicId);
  return result;
}

export async function voteConferenceAction(
  targetType: string,
  targetId: string,
  vote: string,
  topicId?: string
): Promise<ConferenceActionResult> {
  const user = await userId();
  if (!user) return { ok: false, message: "Log in to vote." };
  const type = targetTypeSchema.safeParse(targetType);
  const id = uuid.safeParse(targetId);
  const parsedVote = voteSchema.safeParse(vote);
  if (!type.success || !id.success || !parsedVote.success) return { ok: false, message: "Invalid vote." };

  const result = await voteConference(user, type.data, id.data, parsedVote.data);
  if (result.ok) refresh(topicId ?? (type.data === "topic" ? id.data : undefined));
  return result;
}

export async function reportConferenceAction(
  targetType: string,
  targetId: string,
  reason: string,
  topicId?: string
): Promise<ConferenceActionResult> {
  const user = await userId();
  if (!user) return { ok: false, message: "Log in to flag content." };
  const type = targetTypeSchema.safeParse(targetType);
  const id = uuid.safeParse(targetId);
  const parsedReason = reportReasonSchema.safeParse(reason);
  if (!type.success || !id.success || !parsedReason.success) return { ok: false, message: "Invalid report." };

  const result = await reportConference(user, type.data, id.data, parsedReason.data);
  if (result.ok) refresh(topicId ?? (type.data === "topic" ? id.data : undefined));
  return result;
}

export async function hideConferenceVoiceAction(
  targetType: string,
  targetId: string,
  topicId?: string
): Promise<ConferenceActionResult> {
  const user = await userId();
  if (!user) return { ok: false, message: "Log in to hide a Voice." };
  const type = targetTypeSchema.safeParse(targetType);
  const id = uuid.safeParse(targetId);
  if (!type.success || !id.success) return { ok: false, message: "Invalid Voice." };

  const result = await hideConferenceVoice(user, type.data, id.data);
  if (result.ok) refresh(topicId ?? (type.data === "topic" ? id.data : undefined));
  return result;
}
