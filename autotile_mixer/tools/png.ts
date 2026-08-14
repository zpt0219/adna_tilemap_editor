// png.ts — a deliberately boring PNG writer for the parity corpus.
//
// Every image it emits is 8-bit RGBA, non-interlaced, no palette, one IDAT, and
// filter type 0 on every scanline. That is not laziness: the verifier on the
// other side is a single dependency-free Python file, and this subset is the one
// a ~40-line decoder can read without implementing Paeth, palettes or Adam7.
//
// Nothing here touches a canvas. `canvas.toBlob` may premultiply and zero the
// RGB under alpha=0 — which `transparentB` produces across most of a sheet —
// and it does so differently across browsers, so a canvas round-trip would make
// the ground truth depend on which machine baked it.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  out.writeUInt32BE(crc32(crcInput), data.length + 8);
  return out;
}

export function encodePngRGBA(rgba: Uint8Array, width: number, height: number): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePngRGBA: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  // Filter byte 0 ("None") in front of each scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, dst + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type 6 = RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Fixed level so re-baking an unchanged corpus produces byte-identical files
  // and `git status` stays quiet.
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** FNV-1a over the raw bytes — the same function patternPaint.test.ts locks its
 *  sheet hashes with, so corpus hashes and test hashes are comparable. */
export function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
  return hash >>> 0;
}

export function fnv1aString(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ (s.charCodeAt(i) & 0xff), 0x01000193) >>> 0;
  return hash >>> 0;
}
