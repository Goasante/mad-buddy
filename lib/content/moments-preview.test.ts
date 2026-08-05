import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const preview = read("components/content/moments-preview.tsx");
const home = read("components/dashboard/dashboard-page.tsx");
const page = read("app/(app)/dashboard/page.tsx");

// ---------------------------------------------------------------------------
// One Moments system
// ---------------------------------------------------------------------------

describe("no second Moments system", () => {
  it("renders the canonical projection rather than its own type", () => {
    expect(preview).toContain("VisibleMoment");
    expect(preview).not.toContain("type PreviewMoment");
  });

  it("loads through the canonical feed builder", () => {
    expect(page).toContain("buildMomentFeed(admin, user.id)");
  });

  it("never fetches or mutates on its own", () => {
    for (const banned of ["fetch(", "useEffect", "createSupabase", "Action("]) {
      expect(preview, `preview must not call ${banned}`).not.toContain(banned);
    }
  });

  it("reimplements no feed behaviour", () => {
    // Reactions, expiry, reporting and audience all stay on /moments. Matched
    // as field access so the prose in this file's own header comment (which
    // names those features to say it does NOT implement them) is not a hit.
    for (const field of ["moment.reactionCount", "moment.reactionBreakdown", "moment.expiresAt", "moment.audienceLabel"]) {
      expect(preview, `preview must not read ${field}`).not.toContain(field);
    }
  });

  it("opens the existing viewer rather than inventing a route", () => {
    // There is no per-Moment deep link in the app; /moments is the viewer.
    expect(preview).toContain('href="/moments"');
    expect(preview).not.toMatch(/href=\{`\/moments\/\$\{/);
  });

  it("previews a capped slice, never the whole feed", () => {
    expect(page).toContain("HOME_MOMENTS_LIMIT");
    expect(page).toContain("slice(0, HOME_MOMENTS_LIMIT)");
  });
});

// ---------------------------------------------------------------------------
// Section header + layout
// ---------------------------------------------------------------------------

describe("Moments section", () => {
  it("reuses the canonical section header", () => {
    expect(preview).toContain("<PageSectionHeader");
    const header = read("components/app-shell/page-section-header.tsx");
    expect(header).toContain("text-[1.75rem] font-bold leading-none tracking-tight");
    expect(header).toContain("text-base font-medium text-[var(--color-brand-orange)]");
  });

  it("is a horizontal rail with no snapping or indicators", () => {
    const rail = preview.slice(preview.indexOf("moments.map"), preview.indexOf("function MomentPreviewCard"));
    expect(preview).toContain("overflow-x-auto");
    expect(rail).not.toContain("snap-");
    expect(rail).not.toContain("aria-roledescription");
  });

  it("matches the Near and Suggestions rail geometry", () => {
    // Same bleed and gap, so the three sections line up.
    expect(preview).toContain("-mx-4 flex gap-2.5 overflow-x-auto px-4");
    expect(preview).toContain("[&::-webkit-scrollbar]:hidden");
  });
});

// ---------------------------------------------------------------------------
// Card design
// ---------------------------------------------------------------------------

describe("Moment card", () => {
  it("is a full-bleed image with rounded corners and a soft shadow", () => {
    expect(preview).toContain("rounded-[1.25rem]");
    expect(preview).toContain("shadow-[0_1px_3px_hsl(var(--shadow)/0.08)]");
    expect(preview).toContain("object-cover");
  });

  it("has no badges and no borders", () => {
    const card = preview.slice(preview.indexOf("function MomentPreviewCard"), preview.indexOf("ONBOARDING_CARDS"));
    expect(card).not.toContain("border ");
    expect(card).not.toContain("PremiumPlanBadge");
    expect(card).not.toContain("Badge");
  });

  it("darkens only the caption area so the photo stays the hero", () => {
    expect(preview).toContain("bg-gradient-to-t from-black/75");
    expect(preview).toContain("h-1/2");
  });

  it("shows the creator name and how long ago", () => {
    expect(preview).toContain("formatRelativeTime(moment.createdAt)");
    expect(preview).toContain("{name}");
    expect(preview).toContain("{age}");
  });

  it("shows a first name but announces the full one", () => {
    expect(preview).toContain('fullName.split(/\\s+/)[0]');
    expect(preview).toContain("aria-label={`Moment from ${fullName}, ${age}`}");
  });

  it("renders a text Moment's words instead of an empty box", () => {
    expect(preview).toContain('moment.contentType === "text"');
    expect(preview).toContain("{moment.textContent}");
    // Padded clear of the name/age block so the two never overlap.
    expect(preview).toContain("pb-11");
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("Moments preview performance", () => {
  it("reuses the canonical image component", () => {
    expect(preview).toContain("<MomentImage");
    // Not a raw <img>: MomentImage handles retry and fallback.
    expect(preview).not.toContain("<img");
  });

  it("lazy-loads everything except the first card", () => {
    expect(preview).toContain("priority={index === 0}");
    expect(preview).toContain("priority={priority}");
  });
});

// ---------------------------------------------------------------------------
// Empty onboarding
// ---------------------------------------------------------------------------

describe("empty Moments onboarding", () => {
  it("shows the four educational cards in order", () => {
    for (const title of [
      "Share Moments",
      "Go live with Air",
      "Trusted privacy",
      "Create your first Moment"
    ]) {
      expect(preview, `missing onboarding card: ${title}`).toContain(title);
    }
  });

  it("only renders when the viewer genuinely has none", () => {
    expect(preview).toContain("if (moments.length === 0)");
  });

  it("is never shown once a Moment exists", () => {
    // The rail is the other branch of the same condition, so the two can
    // never both render.
    const empty = preview.indexOf("moments.length === 0");
    const rail = preview.indexOf("moments.map");
    expect(empty).toBeLessThan(rail);
  });

  it("shows no placeholder or fake Moments", () => {
    const onboarding = preview.slice(preview.indexOf("function MomentsOnboarding"));
    expect(onboarding).not.toContain("MomentImage");
    expect(onboarding).not.toContain("animate-pulse");
  });

  it("ends in the create action, pointing at the real route", () => {
    expect(preview).toContain('cta: "Create a Moment"');
  });

  it("uses branded Lucide icons rather than invented artwork", () => {
    expect(preview).toContain('from "lucide-react"');
    expect(preview).not.toContain("<Image");
  });

  it("swipes with real scroll rather than a JS carousel", () => {
    expect(preview).toContain("snap-x snap-mandatory");
    expect(preview).toContain("overflow-x-auto");
  });

  it("keeps its progress dots decorative", () => {
    const dots = preview.slice(preview.indexOf("Progress dots"));
    expect(dots).toContain('aria-hidden="true"');
  });

  it("respects reduced motion", () => {
    expect(preview).toContain("motion-reduce:transition-none");
  });
});

// ---------------------------------------------------------------------------
// Home wiring
// ---------------------------------------------------------------------------

describe("Home wiring", () => {
  it("renders the preview on Home", () => {
    expect(home).toContain("<MomentsPreview moments={moments} />");
  });

  it("takes the moments as a prop rather than loading them itself", () => {
    expect(home).toContain("moments?: VisibleMoment[]");
    // No call — the server page owns the load. (The name appears in a comment
    // pointing at where that happens, so match the call site specifically.)
    expect(home).not.toContain("buildMomentFeed(");
  });

  it("degrades to the onboarding when signed out", () => {
    // The signed-out fallback supplies an empty array, not undefined.
    expect(page).toContain("null, []");
  });
});
