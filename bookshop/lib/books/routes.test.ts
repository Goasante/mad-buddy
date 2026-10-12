import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({
  enabled:vi.fn(()=>true),initialize:vi.fn(),getOrder:vi.fn(),finalize:vi.fn(),
  cookie:vi.fn(()=>({value:"wrong-browser-proof"})),guard:vi.fn(async()=>null)
}));
vi.mock("@/lib/books/service",()=>({bookReady:mocks.enabled,initializeBookCheckout:mocks.initialize,getBookOrder:mocks.getOrder,finalizeBookPayment:mocks.finalize,bookSigningSecret:()=>"synthetic-book-secret-key-with-32-characters",assertBookMasterPrivate:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({get:mocks.cookie})}));
vi.mock("@/lib/books/http",()=>({bookPrivateHeaders:{"Cache-Control":"no-store"},guardBookRequest:mocks.guard,readBookJson:(request:Request)=>request.json()}));
import { POST as checkout } from "@/app/api/books/checkout/route";
import { POST as verify } from "@/app/api/books/verify/route";
import { POST as download } from "@/app/api/books/download/route";
import { MA_BOOK } from "./product";
function request(path:string,body:unknown){return new Request(`https://mad-buddy.com/api/books/${path}`,{method:"POST",headers:{"Content-Type":"application/json","Origin":"https://mad-buddy.com"},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.enabled.mockReturnValue(true);});
describe("book HTTP access boundaries",()=>{
  it("rejects a client-selected amount before starting payment",async()=>{expect((await checkout(request("checkout",{product:MA_BOOK.id,email:"buyer@example.com",amount:1}))).status).toBe(400);expect(mocks.initialize).not.toHaveBeenCalled();});
  it("fails closed before activation",async()=>{mocks.enabled.mockReturnValue(false);expect((await checkout(request("checkout",{product:MA_BOOK.id,email:"buyer@example.com"}))).status).toBe(503);expect(mocks.initialize).not.toHaveBeenCalled();});
  it("stores the proof in an HTTP-only cookie rather than response JSON",async()=>{const reference="MAB-11111111-1111-4111-8111-111111111111";mocks.initialize.mockResolvedValue({reference,proof:"synthetic-proof",url:"https://checkout.paystack.com/example"});const result=await checkout(request("checkout",{product:MA_BOOK.id,email:"buyer@example.com"}));expect(result.status).toBe(200);expect(result.headers.get("set-cookie")).toContain("HttpOnly");expect(JSON.stringify(await result.json())).not.toContain("synthetic-proof");});
  it("a callback reference alone cannot obtain a download token",async()=>{mocks.getOrder.mockResolvedValue({browser_proof_hash:"a".repeat(64)});const result=await verify(request("verify",{reference:"MAB-11111111-1111-4111-8111-111111111111"}));expect(result.status).toBe(403);expect(mocks.finalize).not.toHaveBeenCalled();});
  it("a modified download token cannot reach order or storage access",async()=>{const result=await download(request("download",{token:"modified.token"}));expect(result.status).toBe(403);expect(mocks.finalize).not.toHaveBeenCalled();});
});
