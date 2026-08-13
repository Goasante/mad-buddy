/**
 * Deterministic derivatives of the approved Mad Buddy raster pack.
 *
 * This script only crops transparent canvas, resizes, or places an unchanged
 * source on a correctly sized canvas. It never recolours, filters, traces,
 * sharpens, or reconstructs supplied artwork.
 */
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const source = {
  logoForLight: "brand-assets-source/primary-brand-assets/mad-buddy-logo-horizontal-dark.png",
  logoForDark: "brand-assets-source/primary-brand-assets/mad-buddy-logo-horizontal-light.png",
  markForLight: "brand-assets-source/primary-brand-assets/mad-buddy-mark-dark.png",
  markForDark: "brand-assets-source/primary-brand-assets/mad-buddy-mark-light.png",
  appIcon: "brand-assets-source/app-system-branding/mad-buddy-app-icon.png",
  pwaIcon: "brand-assets-source/app-system-branding/mad-buddy-pwa-icon.png",
  splashIcon: "brand-assets-source/app-system-branding/mad-buddy-splash-icon.png",
  notificationIcon: "brand-assets-source/app-system-branding/mad-buddy-notification-icon.png",
  social: "brand-assets-source/app-system-branding/mad-buddy-social-share-image.jpg",
  linkrActive: "brand-assets-source/navigation-icons/linkr-active.png",
  linkrInactive: "brand-assets-source/navigation-icons/linkr-inactive.png",
  upforActive: "brand-assets-source/navigation-icons/upfor-active.png",
  upforInactive: "brand-assets-source/navigation-icons/upfor-inactive.png"
};

async function ensureParent(path) {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash >= 0) await mkdir(path.slice(0, slash), { recursive: true });
}

async function alphaBounds(path, threshold = 1) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`No visible artwork in ${path}`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function trimmedAsset(input, output, { width, height, padding = 0.05 }) {
  await ensureParent(output);
  const bounds = await alphaBounds(input);
  const padX = Math.round(bounds.width * padding);
  const padY = Math.round(bounds.height * padding);
  const metadata = await sharp(input).metadata();
  const extract = {
    left: Math.max(0, bounds.left - padX),
    top: Math.max(0, bounds.top - padY),
    width: Math.min(metadata.width - Math.max(0, bounds.left - padX), bounds.width + padX * 2),
    height: Math.min(metadata.height - Math.max(0, bounds.top - padY), bounds.height + padY * 2)
  };
  await sharp(input)
    .extract(extract)
    .resize({ width, height, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

async function exactResize(input, output, width, height, options = {}) {
  await ensureParent(output);
  await sharp(input)
    .resize({ width, height, fit: options.fit ?? "cover", background: options.background })
    .png({ compressionLevel: 9 })
    .toFile(output);
}

await trimmedAsset(source.logoForLight, "public/brand/mad-buddy-logo-light.png", {
  width: 1128,
  height: 256,
  padding: 0.025
});
await trimmedAsset(source.logoForDark, "public/brand/mad-buddy-logo-dark.png", {
  width: 1128,
  height: 256,
  padding: 0.025
});
await trimmedAsset(source.markForLight, "public/brand/mad-buddy-mark-light.png", {
  width: 512,
  height: 512,
  padding: 0.04
});
await trimmedAsset(source.markForDark, "public/brand/mad-buddy-mark-dark.png", {
  width: 512,
  height: 512,
  padding: 0.04
});

for (const [input, output] of [
  [source.linkrActive, "public/icons/navigation/linkr-active.png"],
  [source.linkrInactive, "public/icons/navigation/linkr-inactive.png"],
  [source.upforActive, "public/icons/navigation/upfor-active.png"],
  [source.upforInactive, "public/icons/navigation/upfor-inactive.png"]
]) {
  await trimmedAsset(input, output, { width: 64, height: 64, padding: 0.055 });
}

await exactResize(source.appIcon, "assets/icon.png", 1254, 1254);
await exactResize(source.appIcon, "app/icon.png", 512, 512);
await exactResize(source.appIcon, "app/apple-icon.png", 180, 180);
await exactResize(source.pwaIcon, "public/icons/pwa/icon-192.png", 192, 192);
await exactResize(source.pwaIcon, "public/icons/pwa/icon-512.png", 512, 512);
await exactResize(source.pwaIcon, "public/icons/pwa/icon-maskable-512.png", 512, 512);
await exactResize(source.notificationIcon, "public/icons/notification-badge.png", 96, 96, {
  fit: "contain",
  background: { r: 0, g: 0, b: 0, alpha: 0 }
});
await exactResize(source.notificationIcon, "android/app/src/main/res/drawable/ic_stat_mad_buddy.png", 96, 96, {
  fit: "contain",
  background: { r: 0, g: 0, b: 0, alpha: 0 }
});

// Keep the supplied social artwork's aspect ratio inside the standard card.
for (const output of ["app/opengraph-image.png", "app/twitter-image.png"]) {
  await exactResize(source.social, output, 1200, 630, {
    fit: "contain",
    background: "#111111"
  });
}
await ensureParent("public/brand/mad-buddy-social-share.jpg");
await sharp(source.social)
  .resize({ width: 1200, height: 630, fit: "contain", background: "#111111" })
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile("public/brand/mad-buddy-social-share.jpg");

await exactResize(source.splashIcon, "public/brand/launch-hero.png", 1254, 1254);
await exactResize(source.markForLight, "mobile/public/brand/mad-buddy-mark-light.png", 128, 128, {
  fit: "contain",
  background: { r: 0, g: 0, b: 0, alpha: 0 }
});
await exactResize(source.markForDark, "mobile/public/brand/mad-buddy-mark-dark.png", 128, 128, {
  fit: "contain",
  background: { r: 0, g: 0, b: 0, alpha: 0 }
});

console.log("Approved brand derivatives generated without recolouring.");
