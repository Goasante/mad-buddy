import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MA_BOOK } from "./product";
import { bookMetadata, hashBookProof, isVerifiedBookPayment, matchesBookProof, normalizeBookEmail, signBookDownload, verifyBookDownload, type BookPayment } from "./security";
import { isPublicPath, requiredLoginRedirect } from "@/lib/security/route-protection";

const order={id:randomUUID(),reference:`MAB-${randomUUID()}`,email:"buyer@example.com"};
const payment:BookPayment={status:"success",reference:order.reference,amount:20000,currency:"GHS",domain:"live",customer:{email:order.email},metadata:{product:MA_BOOK.id,book_order_id:order.id}};
describe("book payment isolation",()=>{
  it("accepts only the exact successful book order",()=>expect(isVerifiedBookPayment(payment,order,true)).toBe(true));
  it.each([
    {status:"pending"},{status:"reversed"},{amount:499},{amount:19999},{currency:"USD"},{domain:"test"},
    {reference:"someone-elses-reference"},{customer:{email:"other@example.com"}},
    {metadata:{product:"mad_buddy_access",book_order_id:order.id}},
    {metadata:{product:MA_BOOK.id,book_order_id:randomUUID()}},{metadata:null}
  ])("rejects mismatched payment fields: %j",change=>expect(isVerifiedBookPayment({...payment,...change},order,true)).toBe(false));
  it("parses provider string metadata and rejects malformed input",()=>{expect(bookMetadata({...payment,metadata:JSON.stringify(payment.metadata)})?.product).toBe(MA_BOOK.id);expect(bookMetadata({...payment,metadata:"not json"})).toBeNull();});
  it("normalizes bounded ASCII delivery emails",()=>{expect(normalizeBookEmail(" BUYER@EXAMPLE.COM ")).toBe(order.email);expect(normalizeBookEmail("invalid")).toBeNull();expect(normalizeBookEmail("a\n@b.com")).toBeNull();});
});
describe("download proof",()=>{
  const secret="synthetic-book-download-key-at-least-32-characters";const now=1_700_000_000_000;
  it("verifies a signed token and expires it after 24 hours",()=>{const token=signBookDownload(order.id,secret,now);expect(verifyBookDownload(token,secret,now)).toBe(order.id);expect(verifyBookDownload(token,secret,now+86400000)).toBeNull();});
  it("rejects payload changes, signature changes, wrong keys and oversized tokens",()=>{const token=signBookDownload(order.id,secret,now);expect(verifyBookDownload(`x${token}`,secret,now)).toBeNull();expect(verifyBookDownload(token.slice(0,-3)+"xxx",secret,now)).toBeNull();expect(verifyBookDownload(token,"other-secret",now)).toBeNull();expect(verifyBookDownload("x".repeat(1025),secret,now)).toBeNull();});
  it("requires the original checkout browser proof",()=>{const proof="synthetic-browser-proof";expect(matchesBookProof(proof,hashBookProof(proof))).toBe(true);expect(matchesBookProof("wrong",hashBookProof(proof))).toBe(false);expect(matchesBookProof(undefined,hashBookProof(proof))).toBe(false);});
});
describe("guest book access",()=>{
  it("allows book and sample without a Mad Buddy login",()=>{expect(isPublicPath(MA_BOOK.path)).toBe(true);expect(requiredLoginRedirect(`${MA_BOOK.path}/access`)).toBeNull();expect(isPublicPath(MA_BOOK.sample)).toBe(true);});
  it("does not expose other book or app routes",()=>{expect(isPublicPath("/books/private-master.pdf")).toBe(false);expect(requiredLoginRedirect("/settings")).toBe("/login");});
});
