import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(p,"utf8");
const sql=read("supabase/migrations/20260830223000_safe_arrival_s1_authority.sql");

describe("Safe Arrival S1 database authority",()=>{
  it("serializes starts and distinguishes replay",()=>{ expect(sql).toContain("pg_advisory_xact_lock"); expect(sql).toContain("replayed boolean") });
  it("locks current state for every owner transition",()=>{ expect(sql).toContain("where id=p_session_id for update") });
  it("makes expired terminal",()=>{ expect(sql).toContain("if v.status in ('cancelled','expired')"); expect(sql).toContain("if v.status in ('completed','cancelled','expired')") });
  it("derives grace and expires twelve hours after unconfirmed",()=>{ expect(sql).toContain("expected_arrival_at+make_interval"); expect(sql).toContain("unconfirmed_at+interval '12 hours'") });
  it("creates independent durable recipient intents",()=>{ expect(sql).toContain("p_session_id, ':', v_recipient, ':', p_event"); expect(sql).toContain("safe_arrival.lifecycle_notification") });
  it("selects due work before its bound",()=>{ const sweep=sql.slice(sql.indexOf("process_due_safe_arrivals")); expect(sweep.indexOf("where\n    (")).toBeLessThan(sweep.indexOf("limit least")); expect(sweep).toContain("for update skip locked") });
  it("revokes diagnostics from end users",()=>{ expect(sql).toContain("revoke all on function public.admin_safe_arrival_health() from public,anon,authenticated") });
});

describe("Safe Arrival S1 wiring",()=>{
  it("uses canonical RPC results in owner actions",()=>{ const a=read("app/(app)/safe-arrival-actions.ts"); expect(a).toContain("transitionSafeArrival"); expect(a).toContain("startResult.replayed") });
  it("dedupes notification persistence before push",()=>{ const n=read("lib/notifications/server.ts"); expect(n).toContain('persisted.error.code === "23505"'); expect(n).toContain('push: false') });
  it("routes unconfirmed contact help through canonical Messaging",()=>{ const p=read("components/safety/safe-arrival-page.tsx"); expect(p).toContain("openDirectConversationAction(journey.travellerId)"); expect(p).toContain("conversationHref(result.conversationId)") });
  it("revokes service projections after block or ended friendship without treating mute as revocation",()=>{ const s=read("lib/safety/safe-arrival-service.ts"); expect(s).toContain("areApprovedMuddies(admin, session.traveller_id, userId)"); expect(s).toContain("isBlockedEitherDirection(admin, session.traveller_id, userId)"); const resolver=s.slice(s.indexOf("resolveSafeArrivalAccess"),s.indexOf("Canonical journey reads")); expect(resolver).not.toContain("hasOptedOutOfSafeArrival") });
});
