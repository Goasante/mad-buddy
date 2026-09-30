import { describe, expect, it } from "vitest";
import { formatClockValue } from "@/lib/datetime/clock";

describe("formatClockValue", () => {
  it("renders AM explicitly", () => {
    expect(formatClockValue("00:00")).toBe("12:00 AM");
    expect(formatClockValue("09:05")).toBe("9:05 AM");
  });

  it("renders PM explicitly", () => {
    expect(formatClockValue("12:00")).toBe("12:00 PM");
    expect(formatClockValue("23:45")).toBe("11:45 PM");
  });

  it("rejects malformed values", () => {
    expect(formatClockValue("24:00")).toBe("");
    expect(formatClockValue("9:30")).toBe("");
  });
});
