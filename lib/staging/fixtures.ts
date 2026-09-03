/**
 * Binary fixtures for the R7 attachment and voice proofs.
 *
 * Both are GENERATED, not committed: a real PNG and a real WAV built byte by
 * byte at run time. That keeps the repository free of binary blobs, removes
 * any network dependency, and guarantees the bytes are identical on every
 * machine.
 *
 * These must be genuinely valid files. The messages media guard checks
 * `content_type` against the message type, and a decoder that rejects the
 * bytes would turn an R7 media test into a debugging session about fixtures.
 */

/** CRC-32, needed for PNG chunk framing. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** zlib stream with stored (uncompressed) deflate blocks + adler32. */
function zlibStored(raw: Uint8Array): Uint8Array {
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i += 1) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;

  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const MAX = 65535;
  for (let offset = 0; offset < raw.length; offset += MAX) {
    const chunk = raw.subarray(offset, Math.min(offset + MAX, raw.length));
    const final = offset + MAX >= raw.length ? 1 : 0;
    const len = chunk.length;
    blocks.push(
      new Uint8Array([final, len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff]),
      chunk
    );
  }
  blocks.push(u32(adler));
  return concat(blocks);
}

export const ATTACHMENT_FIXTURE = {
  contentType: "image/png" as const,
  width: 16,
  height: 16
};

/**
 * A valid 16x16 PNG with a deterministic checkerboard, so a human looking at
 * the seeded thread can see immediately that it is a test fixture.
 */
export function buildAttachmentPng(): Uint8Array {
  const { width, height } = ATTACHMENT_FIXTURE;

  // Raw scanlines: each row is a filter byte followed by RGB triples.
  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter: none
    p += 1;
    for (let x = 0; x < width; x += 1) {
      const dark = ((x >> 2) + (y >> 2)) % 2 === 0;
      raw[p] = dark ? 0x2f : 0xd8;
      raw[p + 1] = dark ? 0x6b : 0xe6;
      raw[p + 2] = dark ? 0xd8 : 0xf7;
      p += 3;
    }
  }

  const ihdr = concat([
    u32(width),
    u32(height),
    new Uint8Array([8, 2, 0, 0, 0]) // 8-bit, truecolour RGB
  ]);

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStored(raw)),
    pngChunk("IEND", new Uint8Array(0))
  ]);
}

export const VOICE_FIXTURE = {
  // The schema's audio allowlist includes audio/mpeg, audio/mp4, audio/ogg and
  // audio/webm. WAV is the only format we can synthesise correctly without an
  // encoder, so the seeder registers it as audio/mpeg only if the deployment
  // allows it; see seed-staging.mjs, which reads the live allowlist first.
  contentType: "audio/mpeg" as const,
  durationSeconds: 3,
  sampleRate: 8000
};

/**
 * A valid mono PCM WAV containing a quiet 440Hz tone.
 *
 * A tone rather than silence: a waveform of pure zeros is indistinguishable
 * from a broken upload when someone plays it back during R7.
 */
export function buildVoiceWav(): Uint8Array {
  const { durationSeconds, sampleRate } = VOICE_FIXTURE;
  const samples = durationSeconds * sampleRate;
  const dataBytes = samples * 2;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples; i += 1) {
    const value = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.25 * 32767;
    view.setInt16(44 + i * 2, Math.round(value), true);
  }

  return new Uint8Array(buffer);
}

/** Deterministic 24-bar waveform for the voice bubble. */
export function buildWaveform(): number[] {
  return Array.from({ length: 24 }, (_, i) =>
    Number((0.25 + 0.6 * Math.abs(Math.sin(i * 0.7))).toFixed(3))
  );
}
