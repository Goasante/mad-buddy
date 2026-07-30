import { describe, expect, it } from "vitest";
import { validateMutationRequest } from "@/lib/security/csrf";

const endpoint = "https://mad-buddy.com/api/messages/send";

describe("cookie mutation origin validation", () => {
  it("allows safe methods without origin evidence", () => {
    expect(validateMutationRequest(new Request(endpoint, { method: "GET" }))).toEqual({
      ok: true,
      transport: "safe_method"
    });
  });

  it("allows same-origin cookie mutations", () => {
    const result = validateMutationRequest(
      new Request(endpoint, {
        method: "POST",
        headers: {
          origin: "https://mad-buddy.com",
          "sec-fetch-site": "same-origin"
        }
      })
    );
    expect(result).toEqual({ ok: true, transport: "cookie" });
  });

  it("rejects cross-origin cookie mutations", () => {
    const result = validateMutationRequest(
      new Request(endpoint, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      })
    );
    expect(result.ok).toBe(false);
    expect(result.transport).toBe("cookie");
  });

  it("allows explicit Bearer authentication regardless of browser fetch metadata", () => {
    const result = validateMutationRequest(
      new Request(endpoint, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          origin: "capacitor://localhost",
          "sec-fetch-site": "cross-site"
        }
      })
    );
    expect(result).toEqual({ ok: true, transport: "bearer" });
  });

  it("accepts a same-origin Referer fallback and rejects missing evidence", () => {
    expect(
      validateMutationRequest(
        new Request(endpoint, {
          method: "PATCH",
          headers: { referer: "https://mad-buddy.com/notifications" }
        })
      )
    ).toEqual({ ok: true, transport: "cookie" });
    expect(validateMutationRequest(new Request(endpoint, { method: "DELETE" }))).toEqual({
      ok: false,
      transport: "cookie",
      reason: "missing_origin_evidence"
    });
  });
});
