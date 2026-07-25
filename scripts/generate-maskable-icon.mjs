import sharp from "sharp";

const mark = await sharp("public/brand/mad-buddy-mark-128.png")
  .resize({ width: 300, withoutEnlargement: false })
  .png()
  .toBuffer();

const background = Buffer.from(`
  <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="background" cx="50%" cy="46%" r="72%">
        <stop offset="0" stop-color="#2a2020" />
        <stop offset="1" stop-color="#14141b" />
      </radialGradient>
    </defs>
    <rect width="512" height="512" fill="url(#background)" />
  </svg>
`);

await sharp(background)
  .composite([{ input: mark, gravity: "center" }])
  .png()
  .toFile("public/icons/pwa/icon-maskable-512.png");
