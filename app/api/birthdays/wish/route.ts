import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiUser } from "@/lib/api/auth";
import { preflightResponse, withCors } from "@/lib/api/cors";
import { sendBirthdayWish } from "@/lib/profile/birthday-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ targetUserId: z.string().uuid(), wish: z.string().max(80) });

export function OPTIONS(request: Request) {
  return preflightResponse(request);
}

export async function POST(request: Request) {
  const auth = await resolveApiUser(request);
  if (!auth) return withCors(NextResponse.json({ error: "Authentication required." }, { status: 401 }), request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(NextResponse.json({ error: "Choose a birthday wish." }, { status: 400 }), request);
  const result = await sendBirthdayWish(
    createSupabaseAdminClient(),
    auth.user.id,
    parsed.data.targetUserId,
    parsed.data.wish
  );
  return withCors(NextResponse.json(result, { status: result.ok ? 200 : 400 }), request);
}
