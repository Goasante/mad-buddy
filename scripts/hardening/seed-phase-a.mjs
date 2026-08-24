/**
 * Seeds a LOCAL review account with a Circle that has unread messages, so the
 * Phase A fixes can be verified in a real signed-in browser session.
 *
 * Local only -- it refuses to run against anything but 127.0.0.1.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "ReviewPass123!";

async function upsertPerson(handle, fullName) {
  const email = `${handle}@review.local`;
  // Look the account up by profile first; listUsers pages and can miss it.
  const { data: byUsername } = await admin.from("profiles")
    .select("user_id").eq("username", handle).maybeSingle();
  let id = byUsername?.user_id ?? null;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true
    });
    if (error) {
      // Already registered: find the id by scanning pages for the address.
      for (let page = 1; page <= 10 && !id; page++) {
        const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        id = (list?.users ?? []).find((u) => u.email === email)?.id ?? null;
        if ((list?.users ?? []).length === 0) break;
      }
      if (!id) throw new Error(`${handle}: ${error.message}`);
      // Make the password predictable for the review sign-in.
      await admin.auth.admin.updateUserById(id, { password: PASSWORD });
    } else {
      id = data.user.id;
    }
  }
  await admin.from("profiles").upsert(
    { user_id: id, username: handle, full_name: fullName, is_onboarded: true },
    { onConflict: "user_id" }
  );
  return id;
}

const me = await upsertPerson("phasea", "Phase Reviewer");
const mate = await upsertPerson("phaseb", "Kwame Boateng");
const third = await upsertPerson("phasec", "Ama Serwaa");

// A Circle with unread messages waiting for the reviewer.
const { data: existingCircle } = await admin
  .from("conversations").select("id")
  .eq("conversation_type", "group").eq("created_by", mate).limit(1).maybeSingle();

let circleId = existingCircle?.id;
if (!circleId) {
  const { data: conv, error } = await admin.from("conversations")
    .insert({ conversation_type: "group", created_by: mate, status: "active" })
    .select("id").maybeSingle();
  if (error) throw new Error(`circle: ${error.message}`);
  circleId = conv.id;
  await admin.from("conversation_members").insert(
    [me, mate, third].map((u) => ({
      conversation_id: circleId, user_id: u,
      role: u === mate ? "owner" : "member", status: "joined"
    }))
  );
}

const { count } = await admin.from("messages")
  .select("id", { count: "exact", head: true }).eq("conversation_id", circleId);
if ((count ?? 0) === 0) {
  for (const text of ["are we still on for saturday?", "i can bring the speaker", "say something"]) {
    await admin.from("messages").insert({
      conversation_id: circleId, sender_id: mate, message_type: "text",
      text_content: text, client_message_id: crypto.randomUUID()
    });
  }
}

// Groups are the product-level wrapper around the conversation, when present.
let groupRow = null;
try {
  const { data } = await admin.from("groups")
    .select("id").eq("conversation_id", circleId).maybeSingle();
  groupRow = data;
} catch {
  // The Circle may be modelled as the conversation alone.
}

console.log(`reviewer  = phasea@review.local / ${PASSWORD}`);
console.log(`circle    = ${circleId}`);
console.log(`group row = ${groupRow?.id ?? "(none -- conversation only)"}`);
console.log(`messages  = ${count ?? 3}`);
