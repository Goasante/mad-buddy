import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivacyPolicyPage } from "@/components/legal/privacy-policy-page";

describe("privacy choices", () => {
  it("renders usable Google privacy and opt-out links without trailing punctuation", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPolicyPage));
    for (const url of [
      "https://myadcenter.google.com",
      "https://tools.google.com/dlpage/gaoptout",
      "https://policies.google.com/technologies/partner-sites"
    ]) {
      expect(html).toContain(`href="${url}"`);
    }
    expect(html).toContain("<strong");
    expect(html).not.toContain("We do not currently use third-party analytics");
  });
});
