import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readBinary = (path: string) => readFileSync(join(ROOT, path));
const RIFF_SIGNATURE = Buffer.from("RIFF");
const WEBP_SIGNATURE = Buffer.from("WEBP");

const artwork = read("components/linkr/linkr-state-artwork.tsx");
const loading = read("app/(app)/linkr/loading.tsx");
const moments = read("components/linkr/linkr-moments.tsx");
const activation = read("components/linkr/linkr-activation.tsx");
const mutualBanner = read("components/linkr/linkr-mutual-banner.tsx");

describe("Linkr product-owned illustration states", () => {
  it("uses the city-square artwork while the discovery surface refreshes", () => {
    expect(loading).toContain('variant="loading"');
    expect(loading).toContain("Refreshing your Linkr…");
    expect(artwork).toContain(
      'src: "/illustrations/linkr/friendly_city_square_meetup.webp"'
    );
  });

  it("uses the new-connections artwork for the primary Linkr intro and empty deck", () => {
    expect(activation).toContain('variant="opened"');
    expect(activation).not.toContain('<LinkrOrb variant="off" />');
    expect(activation).toContain("LINKR_COPY.turnOn");

    expect(moments).toContain('variant="opened"');
    expect(moments).not.toContain('<LinkrOrb variant="empty" />');
    expect(artwork).toContain(
      'src: "/illustrations/linkr/new_connections_in_the_city.webp"'
    );
  });

  it("uses the city-park artwork in the mutual-connection banner", () => {
    expect(mutualBanner).toContain(
      'src="/illustrations/linkr/meetup_in_the_city_park.webp"'
    );
    expect(mutualBanner).toContain("linkr-mutual-banner");
    expect(mutualBanner).toContain('alt=""');
  });

  it("uses a shallow mobile-first crop so artwork supports rather than pushes out the CTA", () => {
    expect(artwork).toContain("aspect-[16/11]");
    expect(artwork).toContain("overflow-hidden");
    expect(artwork).toContain("rounded-[1.75rem]");
    expect(artwork).toContain("object-cover");
    expect(artwork).toContain("object-[50%_43%]");
    expect(artwork).toContain("object-[50%_39%]");
    expect(artwork).toContain("from-background/35");
    expect(artwork).toContain("dark:brightness-[0.78]");
  });

  it("removes the retired built-in Linkr artwork references", () => {
    expect(artwork).not.toContain("/illustrations/linkr/linkr-loading.png");
    expect(artwork).not.toContain("/illustrations/linkr/linkr-opened.png");
  });

  it("commits all three optimized replacement WebP files so production cannot render a broken placeholder", () => {
    for (const path of [
      "public/illustrations/linkr/new_connections_in_the_city.webp",
      "public/illustrations/linkr/friendly_city_square_meetup.webp",
      "public/illustrations/linkr/meetup_in_the_city_park.webp"
    ]) {
      const bytes = readBinary(path);
      expect(bytes.subarray(0, RIFF_SIGNATURE.length)).toEqual(RIFF_SIGNATURE);
      expect(bytes.subarray(8, 12)).toEqual(WEBP_SIGNATURE);
      expect(bytes.byteLength).toBeGreaterThan(8000);
    }
  });
});
