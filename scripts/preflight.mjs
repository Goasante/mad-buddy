import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv.includes("--production")
  ? "production"
  : process.argv.includes("--paystack")
    ? "paystack"
    : "local";

const env = {
  ...parseEnvFile(".env.local"),
  ...process.env
};

const groups = [
  {
    name: "Supabase",
    required: [
      "NEXT_PUBLIC_SUPABASE_URL",
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      "SUPABASE_SERVICE_ROLE_KEY"
    ]
  },
  {
    name: "App",
    required: ["NEXT_PUBLIC_APP_URL"]
  }
];

if (mode === "production") {
  groups.push({
    name: "Production safety",
    required: ["ADMIN_EMAILS"]
  });
}

if (mode === "production" || mode === "paystack") {
  groups.push({
    name: "Paystack",
    required: [
      "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY",
      "PAYSTACK_SECRET_KEY",
      "PAYSTACK_WEBHOOK_SECRET",
      "PAYSTACK_BUDDY_PLUS_PLAN_CODE",
      "PAYSTACK_BUDDY_PRO_PLAN_CODE"
    ]
  });
}

const failures = [];

console.log(`Mad Buddy preflight (${mode})`);

for (const group of groups) {
  console.log(`\n${group.name}`);

  for (const requirement of group.required) {
    const names = Array.isArray(requirement) ? requirement : [requirement];
    const found = names.some((name) => hasValue(env[name]));
    const label = names.join(" or ");

    if (found) {
      console.log(`  OK ${label}`);
    } else {
      console.log(`  MISSING ${label}`);
      failures.push(label);
    }
  }
}

const appUrl = env.NEXT_PUBLIC_APP_URL;

if (hasValue(appUrl) && mode === "production" && /^http:\/\/localhost(?::\d+)?$/.test(appUrl)) {
  failures.push("NEXT_PUBLIC_APP_URL must not be localhost in production");
  console.log("\nMISSING NEXT_PUBLIC_APP_URL must not be localhost in production");
}

if (failures.length > 0) {
  console.log(`\nPreflight failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("\nPreflight passed.");

function parseEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    values[key] = unquote(rawValue);
  }

  return values;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
