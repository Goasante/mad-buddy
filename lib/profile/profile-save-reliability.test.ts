import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  saveDateOfBirth: vi.fn(),
  recordProductEvent: vi.fn(),
  createSupabaseAdminClient: vi.fn(() => ({ tag: "admin" }))
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/profile/date-of-birth-service", () => ({ saveDateOfBirth: dependencies.saveDateOfBirth }));
vi.mock("@/lib/analytics/track", () => ({ recordProductEvent: dependencies.recordProductEvent }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: dependencies.createSupabaseAdminClient }));

import { updateProfile } from "@/lib/profile/service";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type FakeOptions = {
  previousDateOfBirth?: string | null;
  previousPrivacy?: Array<{ field_name: string; visibility: string }>;
  profileError?: { code: string } | null;
  privacyError?: { code: string } | null;
};

function fakeClient(options: FakeOptions = {}) {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          upsert() {
            return { select: () => ({ maybeSingle: async () => ({
              data: options.profileError ? null : { user_id: "user-1" },
              error: options.profileError ?? null
            }) }) };
          }
        };
      }
      if (table === "profile_birth_details") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: options.previousDateOfBirth ? { date_of_birth: options.previousDateOfBirth } : null,
            error: null
          }) }) })
        };
      }
      if (table === "profile_field_privacy") {
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: options.previousPrivacy ?? [], error: null }) }) }),
          upsert: async () => ({ data: null, error: options.privacyError ?? null })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  } as unknown as SupabaseClient<Database>;
}

const input = {
  fullName: "Godfred Asante",
  username: "godfred",
  bio: "Building Mad Buddy",
  moodStatus: "Focused",
  dateOfBirth: "1995-05-12",
  birthdayVisibility: "only_me" as const,
  ageVisibility: "only_me" as const,
  zodiacVisibility: "only_me" as const
};

describe("profile save partial-completion reliability", () => {
  beforeEach(() => {
    dependencies.saveDateOfBirth.mockReset();
    dependencies.recordProductEvent.mockReset();
    dependencies.createSupabaseAdminClient.mockClear();
    dependencies.saveDateOfBirth.mockResolvedValue({ ok: true, canCorrect: true, status: "unchanged" });
    dependencies.recordProductEvent.mockResolvedValue(undefined);
  });

  it("reports a later privacy failure after DOB succeeds, then permits an idempotent retry", async () => {
    const failed = await updateProfile(
      fakeClient({ previousDateOfBirth: input.dateOfBirth, privacyError: { code: "42501" } }),
      "user-1",
      input
    );
    expect(failed).toEqual({ ok: false, message: "Couldn't save your birthday privacy choices. Try again." });
    expect(dependencies.saveDateOfBirth).toHaveBeenCalledTimes(1);
    const retried = await updateProfile(fakeClient({ previousDateOfBirth: input.dateOfBirth }), "user-1", input);
    expect(retried).toMatchObject({ ok: true, dateOfBirthCanCorrect: true });
    expect(dependencies.saveDateOfBirth).toHaveBeenCalledTimes(2);
  });

  it("does not turn a committed profile/DOB save into failure when analytics rejects", async () => {
    dependencies.recordProductEvent.mockRejectedValueOnce(new Error("analytics unavailable"));
    const result = await updateProfile(fakeClient(), "user-1", input);
    expect(result).toMatchObject({ ok: true, dateOfBirthCanCorrect: true });
  });

  it("does not invoke DOB when the preceding profile write returns a server error", async () => {
    const result = await updateProfile(fakeClient({ profileError: { code: "500" } }), "user-1", input);
    expect(result).toEqual({ ok: false, message: "Couldn't update your profile. Try again." });
    expect(dependencies.saveDateOfBirth).not.toHaveBeenCalled();
  });
});
