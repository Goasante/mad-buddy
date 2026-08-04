/**
 * Generates the native (iOS/Android) splash images and the PWA
 * apple-touch-startup-image set directly from the launch hero photo
 * (public/brand/launch-hero.png), writing straight into the exact paths
 * Capacitor's native shells already reference.
 *
 * Why this bypasses `@capacitor/assets generate`: that CLI resolves its input
 * directory by checking `assets/` before `resources/`, with no reliable way to
 * scope a run to splash-only. This repo's `assets/` already holds a real
 * `icon.png` (the actual Mad Buddy app icon source, unrelated to this splash
 * work), and running the generator unscoped silently re-derives and overwrites
 * every Android/iOS app-launcher icon from a mix of that file and the splash
 * photo. Scoping via --assetPath to a splash-only directory avoided the icon
 * overwrite, but switched the tool onto an unrelated code path that skips
 * per-density downscaling entirely (writing the full 2732x2732 source into
 * every bucket), producing 77 MB of native splash assets. Neither mode was
 * usable, so this script writes every target file itself with `sharp`,
 * touching ONLY the paths listed below — never assets/, resources/, or any
 * app-icon file.
 *
 * JPEG everywhere (native and PWA alike). Android's @drawable/splash and iOS's
 * Assets.xcassets both resolve by filename, not a hardcoded extension — a
 * photograph re-encoded as lossless PNG at these dimensions runs into
 * multi-megabyte files (confirmed: 20MB Android / 23MB iOS) for no visible
 * quality benefit over quality-82 JPEG, which is what the PWA startup images
 * already use.
 *
 * Run once, output is committed. Not part of the build; re-run by hand if
 * launch-hero.png changes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "public/brand/launch-hero.png";

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function writeSplashJpeg(destPath, width, height) {
  await sharp(SOURCE)
    .resize({ width, height, fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(destPath);
}

// Standard Android splash density buckets — Google's documented reference
// sizes, matching what this project's stock Capacitor setup already used.
const ANDROID_DENSITIES = [
  { density: "ldpi", port: [240, 320], land: [320, 240] },
  { density: "mdpi", port: [320, 480], land: [480, 320] },
  { density: "hdpi", port: [480, 800], land: [800, 480] },
  { density: "xhdpi", port: [720, 1280], land: [1280, 720] },
  { density: "xxhdpi", port: [960, 1600], land: [1600, 960] },
  { density: "xxxhdpi", port: [1280, 1920], land: [1920, 1280] }
];

async function buildAndroidSplash() {
  const resRoot = "android/app/src/main/res";
  let count = 0;

  for (const { density, port, land } of ANDROID_DENSITIES) {
    for (const [orientation, [width, height]] of [
      ["port", port],
      ["land", land]
    ]) {
      // Light.
      const lightDir = `${resRoot}/drawable-${orientation}-${density}`;
      await ensureDir(lightDir);
      await writeSplashJpeg(`${lightDir}/splash.jpg`, width, height);
      count += 1;

      // Dark: the photo is already a night scene, so dark reuses the same
      // render rather than needing a second visual treatment.
      const darkDir = `${resRoot}/drawable-${orientation}-night-${density}`;
      await ensureDir(darkDir);
      await writeSplashJpeg(`${darkDir}/splash.jpg`, width, height);
      count += 1;
    }
  }

  // Base (density-less) fallback + its night variant, matching the stock
  // layout's drawable/splash.png and drawable-night/splash.png.
  await ensureDir(`${resRoot}/drawable`);
  await writeSplashJpeg(`${resRoot}/drawable/splash.jpg`, 320, 480);
  count += 1;

  await ensureDir(`${resRoot}/drawable-night`);
  await writeSplashJpeg(`${resRoot}/drawable-night/splash.jpg`, 320, 480);
  count += 1;

  console.log(`android: ${count} splash.jpg files written`);
}

async function buildIosSplash() {
  const imagesetDir = "ios/App/App/Assets.xcassets/Splash.imageset";
  await ensureDir(imagesetDir);

  // Stock Capacitor layout: one square source reused at all three scale slots
  // (the storyboard's scaleAspectFill performs the actual on-device
  // crop/scale to fill whatever the real screen size is). Light and dark are
  // the same render, for the same reason as the Android dark variants above.
  const square = await sharp(SOURCE)
    .resize({ width: 2732, height: 2732, fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const filenames = ["splash-2732x2732.jpg", "splash-2732x2732-1.jpg", "splash-2732x2732-2.jpg"];
  for (const filename of filenames) {
    await sharp(square).toFile(`${imagesetDir}/${filename}`);
  }

  const contents = {
    images: [
      { idiom: "universal", filename: "splash-2732x2732-2.jpg", scale: "1x" },
      { idiom: "universal", filename: "splash-2732x2732-1.jpg", scale: "2x" },
      { idiom: "universal", filename: "splash-2732x2732.jpg", scale: "3x" }
    ],
    info: { version: 1, author: "xcode" }
  };
  await writeFile(`${imagesetDir}/Contents.json`, `${JSON.stringify(contents, null, 2)}\n`, "utf8");

  console.log("ios: Splash.imageset written (2732x2732, 3 scale slots)");
}

async function buildPwaStartupImages() {
  const targets = [
    { name: "iphone-se", width: 640, height: 1136 },
    { name: "iphone-8", width: 750, height: 1334 },
    { name: "iphone-8-plus", width: 1242, height: 2208 },
    { name: "iphone-x", width: 1125, height: 2436 },
    { name: "iphone-14-pro", width: 1179, height: 2556 },
    { name: "iphone-14-pro-max", width: 1290, height: 2796 },
    { name: "ipad", width: 1536, height: 2048 },
    { name: "ipad-pro-11", width: 1668, height: 2388 },
    { name: "ipad-pro-12.9", width: 2048, height: 2732 }
  ];

  await ensureDir("public/splash");
  for (const target of targets) {
    await sharp(SOURCE)
      .resize({ width: target.width, height: target.height, fit: "cover", position: "attention" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(`public/splash/${target.name}.jpg`);
  }
  console.log(`pwa: ${targets.length} startup images written to public/splash/`);
}

await buildAndroidSplash();
await buildIosSplash();
await buildPwaStartupImages();
console.log("\nDone. Nothing under assets/ or any app-icon path was touched.");
