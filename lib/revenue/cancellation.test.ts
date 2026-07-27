import { describe, expect, it } from "vitest";
import { CANCELLATION_REASONS, cancellationReasonLabel } from "@/lib/revenue/cancellation";

describe("subscription cancellation reasons", () => {
  it("keeps the supported reason values unique and resolves their labels", () => {
    const values = CANCELLATION_REASONS.map((reason) => reason.value);

    expect(new Set(values).size).toBe(values.length);
    expect(cancellationReasonLabel("too_expensive")).toBe("Too expensive");
    expect(cancellationReasonLabel("technical_problems")).toBe("Technical problems");
  });

  it("uses a privacy-safe fallback for unknown legacy values", () => {
    expect(cancellationReasonLabel("unknown_reason")).toBe("Prefer not to say");
  });
});
