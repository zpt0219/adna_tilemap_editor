// decode.ts — pure decoders for pack payloads.

import type { MappingMatrix } from "./types";

/** base64 → bytes (browser atob; pack payloads are small). */
export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode `mappingMatrix.data_b64` — little-endian int32 (x,y) pairs, row-major
 * over width×height. cell(i,j) = (cells[(j*w+i)*2], cells[(j*w+i)*2+1]) =
 * absolute atlas pixel coord. (Verified: cell(0,0) == manifest rect {x,y}.)
 */
export function decodeMappingMatrix(mm: { width: number; height: number; data_b64: string }): MappingMatrix {
  const bytes = base64ToUint8(mm.data_b64);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 4);
  const cells = new Int32Array(count);
  for (let i = 0; i < count; i++) cells[i] = dv.getInt32(i * 4, true); // little-endian
  return { width: mm.width, height: mm.height, cells };
}
