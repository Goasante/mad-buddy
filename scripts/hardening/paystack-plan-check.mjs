/**
 * Confirms the configured plan exists in the SAME Paystack mode as the
 * production secret key, by asking Paystack. Prints only non-sensitive
 * attributes: name, amount, currency, interval, and whether the key/plan pair
 * resolves. Never prints the key.
 */
const key = process.env.PAYSTACK_SECRET_KEY;
if (!key) { console.log("PAYSTACK_SECRET_KEY: MISSING in this shell"); process.exit(1); }
console.log(`secret key present: yes (mode prefix ${key.slice(0,8)}…)`);
const res = await fetch("https://api.paystack.co/plan/PLN_pbpn6h7vprirvlu", {
  headers: { Authorization: `Bearer ${key}` }
});
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`);
if (!body?.status) { console.log("lookup failed:", String(body?.message).slice(0,120)); process.exit(2); }
const d = body.data ?? {};
console.log(`  name        ${d.name}`);
console.log(`  plan_code   ${d.plan_code}`);
console.log(`  amount      ${d.amount} (minor units)`);
console.log(`  currency    ${d.currency}`);
console.log(`  interval    ${d.interval}`);
console.log(`  active      ${d.is_archived === false ? "yes" : String(d.is_archived)}`);
console.log(`  MODE MATCHES THE KEY: yes (the API resolved it with this key)`);
