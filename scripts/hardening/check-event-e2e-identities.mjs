/** Verify the four controlled identities used by the local Event E2E pass. */
import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PASSWORD = "HardeningPass123!";

if (!URL.includes("127.0.0.1")) throw new Error("refusing to check non-local identities");

const identities = [
  ["Host", "qa@local.test"],
  ["Attendee A", "kofi@local.test"],
  ["Attendee B", "ama@local.test"],
  ["Unauthorized", "saa@local.test"]
];

let failed = 0;
for (const [role, email] of identities) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) {
    failed += 1;
    console.log(`FAIL  ${role} (${email}) — ${error?.message ?? "missing user"}`);
  } else {
    console.log(`PASS  ${role} (${email}) — ${data.user.id}`);
  }
  await client.auth.signOut();
}

if (failed) process.exitCode = 1;
