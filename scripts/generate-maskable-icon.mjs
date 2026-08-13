import sharp from "sharp";

// Preserve the approved purpose-built PWA artwork. No recolouring or redraw.
await sharp("brand-assets-source/app-system-branding/mad-buddy-pwa-icon.png")
  .resize({ width: 512, height: 512, fit: "cover" })
  .png()
  .toFile("public/icons/pwa/icon-maskable-512.png");
