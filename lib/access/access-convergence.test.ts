import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(join(process.cwd(),p),"utf8");

describe("Mad Buddy Access convergence source contract",()=>{
  it("public pricing has one ad-free paid product and keeps core features free",()=>{
    const p=read("components/premium/pricing-page.tsx");
    expect(p).toContain("Mad Buddy Access");
    expect(p).toContain("GHS 4.99");
    expect(p).toContain("Mad Buddy is free to use. Access removes the ads.");
    expect(p).toContain("Do Linkr or UpFor require Access?");
    expect(p).toContain("No card is required");
    expect(p).not.toMatch(/expanding it is paid|Linkr and UpFor expansion|UpFor expansion/i);
    expect(p).not.toMatch(/Buddy Plus|Buddy Pro|Upgrade to Pro|Choose the plan that fits/i);
  });
  it("landing surfaces the free app and ad-free Access model",()=>{
    const nav=read("components/landing/landing-nav.tsx");
    expect(nav).toContain("Mad Buddy is free to use.");
    expect(nav).toContain("Light ads support the free app.");
    expect(nav).toContain("Access removes ads");
  });
  it("legacy billing routes converge to Access",()=>{
    expect(read("app/(billing)/billing/page.tsx")).toContain('redirect("/settings/access")');
    expect(read("app/(billing)/upgrade/page.tsx")).toContain('redirect("/settings/access")');
  });
  it("Meeting Pings and old premium actions do not require a subscription",()=>{
    expect(read("lib/meetups/service.ts")).not.toContain("requirePremiumPlan");
    const actions=read("app/(app)/premium-actions.ts");
    expect(actions).not.toContain("await requirePremiumPlan");
    expect(actions).not.toMatch(/active Buddy (Plus|Pro) plan is required/i);
  });
  it("wallpaper and circle compatibility no longer branch on paid tier",()=>{
    expect(read("lib/wallpapers/catalog.ts")).toContain("return true; // ACCESS_CONVERGENCE");
    expect(read("lib/social/visibility.ts")).not.toContain('plan === "free" ? 20');
  });
  it("ordinary Moments and Messaging contain no Plus/Pro denial copy",()=>{
    expect(read("app/(app)/moments-actions.ts")).not.toMatch(/included with Buddy Pro/i);
    expect(read("lib/content/moment-mobile.ts")).not.toMatch(/included with Buddy Pro/i);
    expect(read("lib/messaging/rules.ts")).not.toMatch(/on the free plan/i);
  });
  it("consumer tier identity is disabled",()=>{
    expect(read("components/premium/premium-plan-badge.tsx")).toContain("return null");
    expect(read("lib/billing/premium-identity.ts")).toContain('return "free"');
  });
});