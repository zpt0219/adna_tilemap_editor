// Standalone test script to generate Wang tileset PNG and visually verify
// Usage: node test_wang.mjs

import { writeFileSync } from 'fs';

// ---- Minimal PNG encoder (no dependencies) ----
function createPNG(width, height, rgba) {
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ crc32Table[(c ^ buf[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  }
  const crc32Table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc32Table[n] = c;
  }

  function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  // Build raw scanline data (filter byte 0 = None for each row)
  const rawLen = height * (1 + width * 4);
  const raw = new Uint8Array(rawLen);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4);
    raw[rowOff] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = rowOff + 1 + x * 4;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      raw[di + 3] = rgba[si + 3];
    }
  }

  // Deflate using zlib stored blocks (uncompressed but valid)
  const blocks = [];
  const BLOCK = 65535;
  for (let i = 0; i < raw.length; i += BLOCK) {
    const end = Math.min(i + BLOCK, raw.length);
    const len = end - i;
    const last = end >= raw.length ? 1 : 0;
    const blk = new Uint8Array(5 + len);
    blk[0] = last;
    blk[1] = len & 0xff;
    blk[2] = (len >> 8) & 0xff;
    blk[3] = ~len & 0xff;
    blk[4] = (~len >> 8) & 0xff;
    blk.set(raw.subarray(i, end), 5);
    blocks.push(blk);
  }

  const totalBlocks = blocks.reduce((s, b) => s + b.length, 0);
  const deflated = new Uint8Array(2 + totalBlocks + 4); // zlib header + blocks + adler32
  deflated[0] = 0x78;
  deflated[1] = 0x01;
  let off = 2;
  for (const b of blocks) {
    deflated.set(b, off);
    off += b.length;
  }
  const adl = adler32(raw);
  deflated[off] = (adl >> 24) & 0xff;
  deflated[off + 1] = (adl >> 16) & 0xff;
  deflated[off + 2] = (adl >> 8) & 0xff;
  deflated[off + 3] = adl & 0xff;

  // Build PNG file
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = data.length;
    const buf = new Uint8Array(4 + 4 + len + 4);
    buf[0] = (len >> 24) & 0xff;
    buf[1] = (len >> 16) & 0xff;
    buf[2] = (len >> 8) & 0xff;
    buf[3] = len & 0xff;
    for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
    buf.set(data, 8);
    const crcData = buf.subarray(4, 8 + len);
    const c = crc32(crcData);
    buf[8 + len] = (c >> 24) & 0xff;
    buf[8 + len + 1] = (c >> 16) & 0xff;
    buf[8 + len + 2] = (c >> 8) & 0xff;
    buf[8 + len + 3] = c & 0xff;
    return buf;
  }

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >> 24) & 0xff;
  ihdr[1] = (width >> 16) & 0xff;
  ihdr[2] = (width >> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >> 24) & 0xff;
  ihdr[5] = (height >> 16) & 0xff;
  ihdr[6] = (height >> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', deflated);
  const iendChunk = chunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  png.set(sig, 0);
  png.set(ihdrChunk, sig.length);
  png.set(idatChunk, sig.length + ihdrChunk.length);
  png.set(iendChunk, sig.length + ihdrChunk.length + idatChunk.length);
  return png;
}

// ---- Wang tile logic (same as tiles.ts) ----
function getWangCorners(i) {
  const ne = (i >> 0) & 1;
  const se = (i >> 1) & 1;
  const sw = (i >> 2) & 1;
  const nw = (i >> 3) & 1;
  return [nw, ne, se, sw];
}

function calculateWangBaseWeight(tx, ty, corners) {
  const [nw, ne, se, sw] = corners;
  const top = nw * (1 - tx) + ne * tx;
  const bot = sw * (1 - tx) + se * tx;
  return top * (1 - ty) + bot * ty;
}

// ---- Generate the 4x4 tileset ----
const TILE_SIZE = 32;
const COLS = 4;
const ROWS = 4;
const W = COLS * TILE_SIZE;
const H = ROWS * TILE_SIZE;
const rgba = new Uint8Array(W * H * 4);

const GRASS = [34, 197, 94, 255];  // green
const DIRT = [120, 53, 15, 255];   // brown
const THRESHOLD = 0.5;

const WANG_LAYOUT = [4, 3, 14, 6, 10, 7, 15, 13, 1, 9, 11, 12, 0, 2, 5, 8];

for (let i = 0; i < 16; i++) {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const tileIdx = WANG_LAYOUT[i];
  const corners = getWangCorners(tileIdx);

  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const tx = x / (TILE_SIZE - 1);
      const ty = y / (TILE_SIZE - 1);

      const weight = calculateWangBaseWeight(tx, ty, corners);
      const isGrass = weight > THRESHOLD;

      const color = isGrass ? GRASS : DIRT;
      const px = (col * TILE_SIZE + x);
      const py = (row * TILE_SIZE + y);
      const idx = (py * W + px) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }

  // Draw thin grid line around each tile for clarity
  for (let i = 0; i < TILE_SIZE; i++) {
    const positions = [
      [col * TILE_SIZE + i, row * TILE_SIZE],           // top edge
      [col * TILE_SIZE + i, row * TILE_SIZE + TILE_SIZE - 1], // bottom edge
      [col * TILE_SIZE, row * TILE_SIZE + i],            // left edge
      [col * TILE_SIZE + TILE_SIZE - 1, row * TILE_SIZE + i], // right edge
    ];
    for (const [px, py] of positions) {
      const idx = (py * W + px) * 4;
      rgba[idx] = 50;
      rgba[idx + 1] = 50;
      rgba[idx + 2] = 50;
      rgba[idx + 3] = 255;
    }
  }
}

const png = createPNG(W, H, rgba);
const outPath = '/home/ubuntu/game_dev/adna_tilemap_editor/test_wang_output.png';
writeFileSync(outPath, png);
console.log(`Written ${outPath} (${W}x${H})`);

// Also print a text representation
console.log("\nTile layout (4x4 grid, index 0-15):");
console.log("Standard bit order: NE=1, SE=2, SW=4, NW=8\n");
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const idx = row * 4 + col;
    const tileIdx = WANG_LAYOUT[idx];
    const c = getWangCorners(tileIdx);
    console.log(`  Tile at (${col},${row}) - Index ${tileIdx.toString().padStart(2)}: NW=${c[0]} NE=${c[1]} SE=${c[2]} SW=${c[3]}`);
  }
}
