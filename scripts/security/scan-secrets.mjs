/**
 * Structural secret scan. Runs in CI and locally; needs no credentials.
 *
 * WHY THIS EXISTS
 * ---------------
 * CI ran lint, types, tests and a build, but nothing that would notice a real
 * credential being committed. `scripts/preflight.mjs` is not that check: it
 * verifies environment variables are PRESENT, which is why CI runs it with
 * `|| true` (PR builds legitimately have no production secrets). Presence and
 * leakage are different questions, and only the second one can be answered
 * without secrets -- so it belongs in a gate that genuinely fails.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It never prints a matched value, only its type and location. A scanner that
 * echoes the secret into a public build log has published it a second time.
 *
 * KNOWN-PUBLIC VALUES ARE NOT SECRETS
 * -----------------------------------
 * The Supabase CLI ships a fixed local `service_role` JWT (iss=supabase-demo),
 * identical on every developer machine and required by local seed scripts. It
 * matches the shape of a real key but grants nothing anywhere. Flagging it
 * would train people to ignore this scanner, so it is decoded and allowed by
 * issuer -- while any project-scoped JWT still fails.
 *
 * Exit 0 = clean. Exit 1 = something needs a human.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MODE = process.argv.includes("--history") ? "history" : "tree";

const RULES = [
  { type: "JWT", re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, jwt: true },
  { type: "SUPABASE_SECRET_KEY", re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g },
  { type: "PAYSTACK_SECRET_KEY", re: /\bsk_(live|test)_[A-Za-z0-9]{20,}/g },
  { type: "PRIVATE_KEY_BLOCK", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { type: "GOOGLE_API_KEY", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: "AWS_ACCESS_KEY_ID", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "GITHUB_TOKEN", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: "SLACK_TOKEN", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { type: "DB_URL_WITH_PASSWORD", re: /postgres(ql)?:\/\/[^:\s"']+:[^@\s"']{8,}@[^\s"']+/g }
];

/** Documentation placeholders, not credentials. */
const PLACEHOLDER = /your[-_]|example|placeholder|dummy|redacted|xxxx|<[a-z-]+>|test-only|changeme|\.\.\./i;

/** Issuers whose keys are published by the tool that generates them. */
const PUBLIC_JWT_ISSUERS = new Set(["supabase-demo"]);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
}

/** True when this JWT is a known-public local development key. */
function isPublicDevJwt(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json);
    // A project-scoped key carries a ref and a real issuer; the local demo key
    // carries neither. Anything we cannot prove is public is treated as real.
    return PUBLIC_JWT_ISSUERS.has(claims.iss) && !claims.ref;
  } catch {
    return false;
  }
}

const findings = [];

function inspect(text, where) {
  for (const line of text.split("\n")) {
    if (PLACEHOLDER.test(line)) continue;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const match of line.match(rule.re) ?? []) {
        if (rule.jwt && isPublicDevJwt(match)) continue;
        findings.push({ type: rule.type, where });
      }
    }
  }
}

if (MODE === "tree") {
  const files = git(["ls-files"]).trim().split("\n").filter(Boolean);
  for (const file of files) {
    if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|mp3|wav|pdf|zip|jar|keystore)$/i.test(file)) {
      continue;
    }
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    inspect(content, file);
  }
} else {
  for (const sha of git(["rev-list", "HEAD"]).trim().split("\n").filter(Boolean)) {
    let diff;
    try {
      diff = git(["show", "--format=", "--unified=0", "--no-color", sha]);
    } catch {
      continue;
    }
    let file = "?";
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ b/")) file = line.slice(6);
      else if (line.startsWith("+")) inspect(line, `${file} @ ${sha.slice(0, 8)}`);
    }
  }
}

// Collapse to type+location so one repeated key is one line, not a thousand.
const unique = [...new Map(findings.map((f) => [`${f.type}|${f.where}`, f])).values()];

if (unique.length === 0) {
  console.log(`Secret scan (${MODE}): clean.`);
  process.exit(0);
}

console.error(`Secret scan (${MODE}) FAILED — ${unique.length} finding(s). Values are never printed.\n`);
for (const finding of unique) {
  console.error(`  TYPE = ${finding.type}`);
  console.error(`  WHERE = ${finding.where}`);
  console.error(`  ACTION = treat as compromised; ROTATE the credential first, then remove it.\n`);
}
process.exit(1);
