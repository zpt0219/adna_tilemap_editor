import { sanitizeRecipe, type Recipe } from './recipe';
import { type PatternId } from './blob47Pattern';
import { type NoiseId } from './patternNoise';
import { type RibbonId } from './patternRibbon';
import { type TextureId } from './patternTexture';

const PATTERNS: PatternId[] = [
  'square', 'sharp', 'rounded', 'jagged', 'gravel',
  'boulder', 'thorn', 'coast', 'moss', 'billow',
];

const RIBBONS: RibbonId[] = [
  'none', 'bevel', 'dashes', 'ticks', 'beads', 'rope', 'wave', 'grain', 'speckle',
  'along_brick_wall', 'along_cobbles2', 'along_weave', 'along_stone_floor',
  'along_breeze_block', 'along_octagonal',
];

const TEXTURES: TextureId[] = [
  'none', 'white', 'blue', 'ordered', 'ripple', 'ripple_diag', 'cells',
  'breeze_block', 'brick_wall', 'cobbles2', 'brick_floor', 'hexagon',
  'isometric', 'isometric_grid', 'octagonal', 'square', 'weave',
  'paving', 'paving3', 'paving5', 'stone_floor', 'water', 'brick_bond',
  'field', 'rubble', 'nonslip',
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toH = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}

function write24Bit(view: DataView, offset: number, val: number) {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(val)));
  view.setUint8(offset, (clamped >> 16) & 0xff);
  view.setUint8(offset + 1, (clamped >> 8) & 0xff);
  view.setUint8(offset + 2, clamped & 0xff);
}

function read24Bit(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  return (b0 << 16) | (b1 << 8) | b2;
}

function writeRGB(view: DataView, offset: number, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  view.setUint8(offset, r);
  view.setUint8(offset + 1, g);
  view.setUint8(offset + 2, b);
}

function readRGB(view: DataView, offset: number): string {
  return rgbToHex(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2));
}

/**
 * Encodes a Recipe into a Base64URL string (V1 Bit-Packing format).
 */
export function encodeRecipe(recipe: Recipe): string {
  const clean = sanitizeRecipe(recipe);

  // Dynamic byte estimation
  let dynamicBytes = 0;
  const hasCustomShades = clean.customShadesHex !== null;
  if (hasCustomShades && clean.customShadesHex) {
    dynamicBytes += clean.customShadesHex.length * 3;
  }

  const hasCustomRibbon = clean.customRibbonHex !== null;
  if (hasCustomRibbon && clean.customRibbonHex) {
    dynamicBytes += 1 + clean.customRibbonHex.length * 4; // 1 byte length + 4 bytes per shade (1 byte flag + 3 bytes RGB)
  }

  const hasCustomTexA = clean.customTexHex.terrainA !== null;
  if (hasCustomTexA && clean.customTexHex.terrainA) {
    dynamicBytes += 1 + clean.customTexHex.terrainA.length * 4;
  }

  const hasCustomTexB = clean.customTexHex.terrainB !== null;
  if (hasCustomTexB && clean.customTexHex.terrainB) {
    dynamicBytes += 1 + clean.customTexHex.terrainB.length * 4;
  }

  const totalBytes = 45 + dynamicBytes;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // Byte 0: version (4b = 1) | pattern (4b)
  const patternIdx = Math.max(0, PATTERNS.indexOf(clean.patternId));
  view.setUint8(0, (1 << 4) | (patternIdx & 0x0f));

  // Bytes 1..9: RGB colors
  writeRGB(view, 1, clean.roleHex.terrainA);
  writeRGB(view, 4, clean.roleHex.terrainB);
  writeRGB(view, 7, clean.roleHex.edge);

  // Bytes 10..12: edgeSeed (24b)
  write24Bit(view, 10, clean.edgeSeed);

  // Byte 13: outlineWidth(2b: 1..4 -> 0..3) | bandSteps(2b: 3..5 -> 0..2) | hardEdgeB(1b) | transparentB(1b) | tileSize(1b: 0=16,1=32) | res(1b)
  const outlineIdx = Math.max(0, Math.min(3, clean.outlineWidth - 1));
  const stepsIdx = Math.max(0, Math.min(2, clean.bandSteps - 3));
  const b13 = (outlineIdx << 6) |
              (stepsIdx << 4) |
              ((clean.hardEdgeB ? 1 : 0) << 3) |
              ((clean.transparentB ? 1 : 0) << 2) |
              ((clean.tileSize === 32 ? 1 : 0) << 1);
  view.setUint8(13, b13);

  // Byte 14: bandBias (Int8: -100..100)
  view.setInt8(14, Math.round(clean.bandBias * 100));

  // Byte 15: noiseMask(3b) | ribbonAlgo(3b) | ribbonInvert(1b) | hasCustomShades(1b)
  let noiseMask = 0;
  if (clean.patternNoise.includes('white')) noiseMask |= 1;
  if (clean.patternNoise.includes('blue')) noiseMask |= 2;
  if (clean.patternNoise.includes('ordered')) noiseMask |= 4;

  const ribbonIdx = Math.max(0, RIBBONS.indexOf(clean.ribbonAlgo));
  const b15 = (noiseMask << 5) |
              (ribbonIdx << 2) |
              ((clean.ribbonInvert ? 1 : 0) << 1) |
              (hasCustomShades ? 1 : 0);
  view.setUint8(15, b15);

  // Bytes 16..18: patternNoiseSeed (24b)
  write24Bit(view, 16, clean.patternNoiseSeed);

  // Byte 19: patternNoiseStrength (Uint8: 0..200)
  view.setUint8(19, Math.round(clean.patternNoiseStrength * 100));

  // Bytes 20..21: ribbonAmount(8b) | ribbonPeriod(4b: 1..8 -> 0..7) | ribbonShades(4b: 1..4 -> 0..3)
  view.setUint8(20, Math.round(clean.ribbonAmount * 200));
  const periodIdx = Math.max(0, Math.min(7, clean.ribbonPeriod - 1));
  const shadesIdx = Math.max(0, Math.min(3, clean.ribbonShades - 1));
  view.setUint8(21, (periodIdx << 4) | shadesIdx);

  // Texture A (Bytes 22..29)
  const texAIdx = Math.max(0, TEXTURES.indexOf(clean.textureAlgoA));
  const texAShadesIdx = Math.max(0, Math.min(3, clean.textureShadesA - 1));
  view.setUint8(22, ((texAIdx & 0x1f) << 3) | ((texAShadesIdx & 0x03) << 1));
  view.setUint8(23, Math.round(clean.textureAmountA * 100));
  write24Bit(view, 24, clean.textureSeedA);
  writeRGB(view, 27, '#ffffff'); // reserved placeholder

  // Texture B (Bytes 30..37)
  const texBIdx = Math.max(0, TEXTURES.indexOf(clean.textureAlgoB));
  const texBShadesIdx = Math.max(0, Math.min(3, clean.textureShadesB - 1));
  view.setUint8(30, ((texBIdx & 0x1f) << 3) | ((texBShadesIdx & 0x03) << 1));
  view.setUint8(31, Math.round(clean.textureAmountB * 100));
  write24Bit(view, 32, clean.textureSeedB);
  writeRGB(view, 35, '#ffffff'); // reserved placeholder

  // Fine Scales (Bytes 38..43)
  const encScale = (v: number) => Math.max(1, Math.min(255, Math.round(v)));
  view.setUint8(38, encScale(clean.cellScaleA));
  view.setUint8(39, encScale(clean.cellScaleB));
  view.setUint8(40, encScale(clean.rippleScaleA));
  view.setUint8(41, encScale(clean.rippleScaleB));
  view.setUint8(42, encScale(clean.geoScaleA));
  view.setUint8(43, encScale(clean.geoScaleB));

  // Byte 44: customTexMask(2b: A/B) | hasCustomRibbon(1b) | res(5b)
  const b44 = ((hasCustomTexA ? 1 : 0) << 7) |
              ((hasCustomTexB ? 1 : 0) << 6) |
              ((hasCustomRibbon ? 1 : 0) << 5);
  view.setUint8(44, b44);

  // Dynamic Writing (Byte 45+)
  let cur = 45;
  if (hasCustomShades && clean.customShadesHex) {
    for (const hex of clean.customShadesHex) {
      writeRGB(view, cur, hex);
      cur += 3;
    }
  }

  if (hasCustomRibbon && clean.customRibbonHex) {
    view.setUint8(cur++, clean.customRibbonHex.length);
    for (const hex of clean.customRibbonHex) {
      if (hex) {
        view.setUint8(cur++, 1);
        writeRGB(view, cur, hex);
        cur += 3;
      } else {
        view.setUint8(cur++, 0);
      }
    }
  }

  if (hasCustomTexA && clean.customTexHex.terrainA) {
    view.setUint8(cur++, clean.customTexHex.terrainA.length);
    for (const hex of clean.customTexHex.terrainA) {
      if (hex) {
        view.setUint8(cur++, 1);
        writeRGB(view, cur, hex);
        cur += 3;
      } else {
        view.setUint8(cur++, 0);
      }
    }
  }

  if (hasCustomTexB && clean.customTexHex.terrainB) {
    view.setUint8(cur++, clean.customTexHex.terrainB.length);
    for (const hex of clean.customTexHex.terrainB) {
      if (hex) {
        view.setUint8(cur++, 1);
        writeRGB(view, cur, hex);
        cur += 3;
      } else {
        view.setUint8(cur++, 0);
      }
    }
  }

  // Base64URL conversion
  const bytes = new Uint8Array(buffer);
  let binString = '';
  for (let i = 0; i < bytes.length; i++) {
    binString += String.fromCharCode(bytes[i]);
  }

  return btoa(binString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes a Base64URL string back into a Recipe.
 */
export function decodeRecipe(hash: string): Recipe | null {
  if (!hash || typeof hash !== 'string') return null;

  try {
    let base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }

    if (bytes.length < 45) return null;
    const view = new DataView(bytes.buffer);

    // Byte 0: version & pattern
    const b0 = view.getUint8(0);
    const version = (b0 >> 4) & 0x0f;
    if (version !== 1) return null; // Only V1 handled currently

    const patternIdx = b0 & 0x0f;
    const patternId = PATTERNS[patternIdx] || 'rounded';

    // Bytes 1..9: RGB
    const terrainA = readRGB(view, 1);
    const terrainB = readRGB(view, 4);
    const edge = readRGB(view, 7);

    // Bytes 10..12: edgeSeed
    const edgeSeed = read24Bit(view, 10);

    // Byte 13: outlineWidth, bandSteps, hardEdgeB, transparentB, tileSize
    const b13 = view.getUint8(13);
    const outlineWidth = ((b13 >> 6) & 0x03) + 1;
    const bandSteps = ((b13 >> 4) & 0x03) + 3;
    const hardEdgeB = ((b13 >> 3) & 0x01) === 1;
    const transparentB = ((b13 >> 2) & 0x01) === 1;
    const tileSize = ((b13 >> 1) & 0x01) === 1 ? 32 : 16;

    // Byte 14: bandBias
    const bandBias = view.getInt8(14) / 100;

    // Byte 15: noiseMask, ribbonAlgo, ribbonInvert, hasCustomShades
    const b15 = view.getUint8(15);
    const noiseMask = (b15 >> 5) & 0x07;
    const patternNoise: NoiseId[] = [];
    if (noiseMask & 1) patternNoise.push('white');
    if (noiseMask & 2) patternNoise.push('blue');
    if (noiseMask & 4) patternNoise.push('ordered');

    const ribbonIdx = (b15 >> 2) & 0x07;
    const ribbonAlgo = RIBBONS[ribbonIdx] || 'none';
    const ribbonInvert = ((b15 >> 1) & 0x01) === 1;
    const hasCustomShades = (b15 & 0x01) === 1;

    // Bytes 16..18: patternNoiseSeed
    const patternNoiseSeed = read24Bit(view, 16);

    // Byte 19: patternNoiseStrength
    const patternNoiseStrength = view.getUint8(19) / 100;

    // Bytes 20..21: ribbonAmount, ribbonPeriod, ribbonShades
    const ribbonAmount = view.getUint8(20) / 200;
    const b21 = view.getUint8(21);
    const ribbonPeriod = ((b21 >> 4) & 0x0f) + 1;
    const ribbonShades = (b21 & 0x0f) + 1;

    // Texture A (Bytes 22..29)
    const b22 = view.getUint8(22);
    const textureAlgoA = TEXTURES[(b22 >> 3) & 0x1f] || 'none';
    const textureShadesA = ((b22 >> 1) & 0x03) + 1;
    const textureAmountA = view.getUint8(23) / 100;
    const textureSeedA = read24Bit(view, 24);

    // Texture B (Bytes 30..37)
    const b30 = view.getUint8(30);
    const textureAlgoB = TEXTURES[(b30 >> 3) & 0x1f] || 'none';
    const textureShadesB = ((b30 >> 1) & 0x03) + 1;
    const textureAmountB = view.getUint8(31) / 100;
    const textureSeedB = read24Bit(view, 32);

    // Fine Scales (Bytes 38..43)
    const decScale = (v: number) => (v <= 16 ? v : Math.round((v / 100 + 0.5) * 100) / 100);
    const cellScaleA = decScale(view.getUint8(38));
    const cellScaleB = decScale(view.getUint8(39));
    const rippleScaleA = decScale(view.getUint8(40));
    const rippleScaleB = decScale(view.getUint8(41));
    const geoScaleA = decScale(view.getUint8(42));
    const geoScaleB = decScale(view.getUint8(43));

    // Byte 44: customTexMask & hasCustomRibbon
    const b44 = view.getUint8(44);
    const hasCustomTexA = ((b44 >> 7) & 0x01) === 1;
    const hasCustomTexB = ((b44 >> 6) & 0x01) === 1;
    const hasCustomRibbon = ((b44 >> 5) & 0x01) === 1;

    let cur = 45;
    let customShadesHex: string[] | null = null;
    if (hasCustomShades) {
      const shadeCount = bandSteps + 2;
      customShadesHex = [];
      for (let i = 0; i < shadeCount; i++) {
        if (cur + 3 <= bytes.length) {
          customShadesHex.push(readRGB(view, cur));
          cur += 3;
        }
      }
    }

    let customRibbonHex: (string | undefined)[] | null = null;
    if (hasCustomRibbon && cur < bytes.length) {
      const len = view.getUint8(cur++);
      customRibbonHex = [];
      for (let i = 0; i < len; i++) {
        const flag = view.getUint8(cur++);
        if (flag === 1) {
          customRibbonHex.push(readRGB(view, cur));
          cur += 3;
        } else {
          customRibbonHex.push(undefined);
        }
      }
    }

    let customTexA: (string | undefined)[] | null = null;
    if (hasCustomTexA && cur < bytes.length) {
      const len = view.getUint8(cur++);
      customTexA = [];
      for (let i = 0; i < len; i++) {
        const flag = view.getUint8(cur++);
        if (flag === 1) {
          customTexA.push(readRGB(view, cur));
          cur += 3;
        } else {
          customTexA.push(undefined);
        }
      }
    }

    let customTexB: (string | undefined)[] | null = null;
    if (hasCustomTexB && cur < bytes.length) {
      const len = view.getUint8(cur++);
      customTexB = [];
      for (let i = 0; i < len; i++) {
        const flag = view.getUint8(cur++);
        if (flag === 1) {
          customTexB.push(readRGB(view, cur));
          cur += 3;
        } else {
          customTexB.push(undefined);
        }
      }
    }

    const rawRecipe: Recipe = {
      roleHex: { terrainA, terrainB, edge },
      patternId,
      edgeSeed,
      outlineWidth,
      bandSteps,
      hardEdgeB,
      transparentB,
      bandBias,
      customShadesHex,
      patternNoise,
      patternNoiseSeed,
      patternNoiseStrength,
      ribbonAlgo,
      ribbonAmount,
      ribbonPeriod,
      ribbonShades,
      ribbonInvert,
      customRibbonHex,
      textureAlgoA,
      textureAlgoB,
      textureAmountA,
      textureAmountB,
      textureShadesA,
      textureShadesB,
      textureSeedA,
      textureSeedB,
      cellScaleA,
      cellScaleB,
      rippleScaleA,
      rippleScaleB,
      geoScaleA,
      geoScaleB,
      customTexHex: {
        terrainA: customTexA,
        terrainB: customTexB,
      },
      tileSize,
    };

    return sanitizeRecipe(rawRecipe);
  } catch {
    return null;
  }
}
