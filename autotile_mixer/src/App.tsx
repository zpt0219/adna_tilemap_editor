import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { TRANSLATIONS, type Lang } from './shared/i18n';
import {
  blendTilePixels, blendBlob47TilePixels,
  type RenderParams, type MaskStyle, EASING_FUNCTIONS,
} from './utils/tiles';
import {
  BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS, BLOB47_BACKGROUND, blobSlotForMask,
  N as BIT_N, E as BIT_E, S as BIT_S, W as BIT_W,
  NE as BIT_NE, SE as BIT_SE, SW as BIT_SW, NW as BIT_NW,
} from './utils/blob47';
import {
  DEFAULT_ROLE_COLOURS, paintPatternTileRGBA, parseHexColour, patternRamp, toHexColour,
  type RoleColours,
} from './utils/patternPaint';
import {
  PATTERN_GROUPS, DEFAULT_PATTERN, PATTERN_OFFSET_RANGE,
  MIN_BAND_STEPS, MAX_BAND_STEPS, DEFAULT_BAND_STEPS, type PatternId,
} from './utils/blob47Pattern';
import {
  NOISE_PRESETS, DEFAULT_NOISES, DEFAULT_NOISE_SEED, DEFAULT_NOISE_STRENGTH,
  MAX_NOISE_STRENGTH, type NoiseId,
} from './utils/patternNoise';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES,
  MIN_TEXTURE_SHADES, MAX_TEXTURE_SHADES, type TextureId,
} from './utils/patternTexture';

/**
 * Corner models paint vertices; blob47 and pattern paint cells.
 * docs/AUTOTILE_SCHEMES.md. 'pattern' shares blob47's mask model and sheet
 * layout but takes its silhouette from baked art instead of a distance field,
 * so it needs colours rather than textures.
 */
export type TilesetMode = 'wang' | 'blob14' | 'blob47' | 'pattern';

const COLS = 16;
const ROWS = 10;

// Standard Brigid's Cross layout indices (0-15 mapped to grid slots in row-major order)
// e.g. Row 0: [4, 3, 14, 6], Row 1: [10, 7, 15, 13], ...
const WANG_LAYOUT = [4, 3, 14, 6, 10, 7, 15, 13, 1, 9, 11, 12, 0, 2, 5, 8];

// Inverse layout mapping (gives the 0-15 grid position of each 0-15 tile Index)
const WANG_INVERSE_LAYOUT = [12, 8, 13, 1, 0, 14, 3, 5, 15, 9, 4, 10, 11, 7, 2, 6];

// Blob layout mapping in a 5x3 grid (3x3 outer/edges + 2x2 inner corners + background + empty)
const BLOB_LAYOUT = [
  5, 1, 6, 11, 12,  // Row 0
  3, 0, 4, 10, 9,   // Row 1
  7, 2, 8, 13, -1   // Row 2 (slot 14 is empty / -1)
];

// Inverse layout mapping (gives the 0-14 grid position of each 0-13 Blob tile Index)
const BLOB_INVERSE_LAYOUT = [
  6,  // 0: Center
  1,  // 1: Edge Top
  11, // 2: Edge Bottom
  5,  // 3: Edge Left
  7,  // 4: Edge Right
  0,  // 5: Outer TL
  2,  // 6: Outer TR
  10, // 7: Outer BL
  12, // 8: Outer BR
  9,  // 9: Inner TL
  8,  // 10: Inner TR
  3,  // 11: Inner BR
  4,  // 12: Inner BL
  13  // 13: Background
];

// Map each of the 16 Wang corner configurations to the corresponding 14 Blob tile index
const WANG_TO_BLOB = [
  13, // 0:  [0,0,0,0] -> Background
  7,  // 1:  [0,0,0,1] -> Outer BL
  5,  // 2:  [0,0,1,0] -> Outer TL
  3,  // 3:  [0,0,1,1] -> Edge Left
  6,  // 4:  [0,1,0,0] -> Outer TR
  0,  // 5:  [0,1,0,1] -> Diagonal NE+SW (fallback to Center)
  1,  // 6:  [0,1,1,0] -> Edge Top
  9,  // 7:  [0,1,1,1] -> Inner TL
  8,  // 8:  [1,0,0,0] -> Outer BR
  2,  // 9:  [1,0,0,1] -> Edge Bottom
  0,  // 10: [1,0,1,0] -> Diagonal NW+SE (fallback to Center)
  12, // 11: [1,0,1,1] -> Inner BL
  4,  // 12: [1,1,0,0] -> Edge Right
  11, // 13: [1,1,0,1] -> Inner BR
  10, // 14: [1,1,1,0] -> Inner TR
  0   // 15: [1,1,1,1] -> Center
];

function imageDataToURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  }
  return '';
}

function generateDefaultTexture(type: 'grass' | 'dirt', size: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(size, size);
  
  if (type === 'grass') {
    ctx.fillStyle = '#16a34a'; // Grass base green
    ctx.fillRect(0, 0, size, size);
    
    // Add texture detail pixels
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rand = Math.random();
        if (rand < 0.15) {
          ctx.fillStyle = '#15803d'; // darker
          ctx.fillRect(x, y, 1, 1);
        } else if (rand > 0.85) {
          ctx.fillStyle = '#22c55e'; // lighter
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    
    // Add small pixel grass clumps
    ctx.fillStyle = '#4ade80';
    const clumps = Math.floor(size * size * 0.015);
    for (let i = 0; i < clumps; i++) {
      const gx = Math.floor(Math.random() * (size - 2));
      const gy = Math.floor(Math.random() * (size - 3)) + 2;
      ctx.fillRect(gx, gy, 1, 1);
      ctx.fillRect(gx + 1, gy - 1, 1, 2);
    }
  } else {
    ctx.fillStyle = '#78350f'; // Dirt base brown
    ctx.fillRect(0, 0, size, size);
    
    // Add texture details
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rand = Math.random();
        if (rand < 0.2) {
          ctx.fillStyle = '#451a03'; // dark brown
          ctx.fillRect(x, y, 1, 1);
        } else if (rand > 0.8) {
          ctx.fillStyle = '#9a3412'; // light brown
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    
    // Add pixel stones
    ctx.fillStyle = '#a16207';
    const stones = Math.floor(size * size * 0.008);
    for (let i = 0; i < stones; i++) {
      const sx = Math.floor(Math.random() * (size - 1));
      const sy = Math.floor(Math.random() * (size - 1));
      ctx.fillRect(sx, sy, 2, 1);
      ctx.fillRect(sx, sy + 1, 1, 1);
    }
  }
  
  return ctx.getImageData(0, 0, size, size);
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('adna_lang') as Lang) || 'zh';
  });

  const t = TRANSLATIONS[lang];

  // Tileset model. 'wang' and 'blob14' are both corner (dual-grid) models and
  // paint on vertices; 'blob47' is cell-based and paints on cells.
  // See docs/AUTOTILE_SCHEMES.md.
  const [mode, setMode] = useState<TilesetMode>('wang');
  const isWang = mode === 'wang';
  const isBlob47 = mode === 'blob47';
  const isPattern = mode === 'pattern';
  /** blob47 and pattern share the cell-based sheet layout and playground rules. */
  const isCellBased = isBlob47 || isPattern;

  // Pattern mode: one colour per role, kept as hex for the <input type="color">.
  const [roleHex, setRoleHex] = useState<Record<keyof RoleColours, string>>(() => ({
    terrainA: toHexColour(DEFAULT_ROLE_COLOURS.terrainA),
    terrainB: toHexColour(DEFAULT_ROLE_COLOURS.terrainB),
    edge: toHexColour(DEFAULT_ROLE_COLOURS.edge),
  }));
  const roleColours: RoleColours = React.useMemo(() => ({
    terrainA: parseHexColour(roleHex.terrainA),
    terrainB: parseHexColour(roleHex.terrainB),
    edge: parseHexColour(roleHex.edge),
  }), [roleHex]);
  const roleHexKey = `${roleHex.terrainA}|${roleHex.terrainB}|${roleHex.edge}`;

  // Which built-in pattern the colours are painted onto.
  const [patternId, setPatternId] = useState<PatternId>(DEFAULT_PATTERN);
  // Grain on the pattern's transition band. The algorithms stack, so this is a
  // set; empty means no grain.
  const [patternNoise, setPatternNoise] = useState<NoiseId[]>([...DEFAULT_NOISES]);
  const patternNoiseKey = patternNoise.join(',');
  const [patternNoiseSeed, setPatternNoiseSeed] = useState(DEFAULT_NOISE_SEED);
  const [patternNoiseStrength, setPatternNoiseStrength] = useState(DEFAULT_NOISE_STRENGTH);

  // Speckle inside the solid terrains, so a filled region reads as a material.
  const [textureAlgo, setTextureAlgo] = useState<TextureId>(DEFAULT_TEXTURE);
  const [textureAmountA, setTextureAmountA] = useState(0.4);
  const [textureAmountB, setTextureAmountB] = useState(0);
  const [textureShades, setTextureShades] = useState(DEFAULT_TEXTURE_SHADES);
  const textureOpts = {
    algo: textureAlgo,
    amountA: textureAmountA,
    amountB: textureAmountB,
    shades: textureShades,
    seed: patternNoiseSeed,
  };
  const textureKey = `${textureAlgo}|${textureAmountA}|${textureAmountB}|${textureShades}`;
  const TEXTURE_SHADE_CHOICES = Array.from(
    { length: MAX_TEXTURE_SHADES - MIN_TEXTURE_SHADES + 1 },
    (_, i) => MIN_TEXTURE_SHADES + i
  );

  // Where the transition band sits, as -1 (toward the cell centre) .. +1
  // (toward its border). Kept normalised because each pattern has its own
  // usable range — a fixed pixel slider would be mostly dead travel on the
  // noisier ones. See PATTERN_OFFSET_RANGE.
  // How many colours the transition band is drawn with.
  const [bandSteps, setBandSteps] = useState(DEFAULT_BAND_STEPS);
  const BAND_STEP_CHOICES = Array.from(
    { length: MAX_BAND_STEPS - MIN_BAND_STEPS + 1 },
    (_, i) => MIN_BAND_STEPS + i
  );

  // Collapse the terrain-B shade so open terrain meets the outline hard.
  const [hardEdgeB, setHardEdgeB] = useState(false);

  const [bandBias, setBandBias] = useState(0);
  const bandOffsetPx = (() => {
    const [lo, hi] = PATTERN_OFFSET_RANGE[patternId];
    return bandBias < 0 ? -bandBias * lo : bandBias * hi;
  })();
  const toggleNoise = (id: NoiseId) =>
    setPatternNoise((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]
    );

  // Textures state
  const [imgAData, setImgAData] = useState<ImageData | null>(null);
  const [imgBData, setImgBData] = useState<ImageData | null>(null);
  const [imgAUrl, setImgAUrl] = useState<string>('');
  const [imgBUrl, setImgBUrl] = useState<string>('');
  const [hasUploadedA, setHasUploadedA] = useState(false);
  const [hasUploadedB, setHasUploadedB] = useState(false);

  // Grid helper
  const [showGrid, setShowGrid] = useState(true);

  // Tile size config
  const [tileSize, setTileSize] = useState(32);

  // Smoothness (gradient transition width) config
  const [smoothness, setSmoothness] = useState(0.15);

  // Easing function configuration (defaults to 'linear')
  const [easing, setEasing] = useState<string>('linear');

  // Mask shape style
  const [maskStyle, setMaskStyle] = useState<MaskStyle>('linear');

  // Pixel steps (only used when maskStyle === 'pixel')
  const [pixelSteps, setPixelSteps] = useState(4);

  // Edge noise perturbation
  const [noiseStrength, setNoiseStrength] = useState(0);
  const [noiseScale, setNoiseScale] = useState(5);
  const [noiseSeed, setNoiseSeed] = useState(42);

  // Zoom config (integer scale factor for visual canvas sizes)
  const [zoom, setZoom] = useState(2);

  // Playground zoom (independent from tileset zoom)
  const [playgroundZoom, setPlaygroundZoom] = useState(2);

  // Interactive playground state. Corner models (Wang / blob14) live on the dual
  // grid, so they store vertices; blob47 is cell-based and stores cells.
  const [wangVertices, setWangVertices] = useState<number[][]>(() =>
    Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0))
  );
  const [blobCells, setBlobCells] = useState<number[][]>(() =>
    Array(ROWS).fill(null).map(() => Array(COLS).fill(0))
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawVal, setDrawVal] = useState<number>(1); // 1 = paint A, 0 = paint B (erase)
  const [touchPaintVal, setTouchPaintVal] = useState<0 | 1>(1); // touch mode toggle

  // Canvas refs
  const tilesetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanSheetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The plain terrain-B tile. The blob47 sheet has no background slot, so the
   *  playground keeps it aside instead of blitting it out of the sheet. */
  const bgTileCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Input file refs
  const fileInputARef = useRef<HTMLInputElement | null>(null);
  const fileInputBRef = useRef<HTMLInputElement | null>(null);

  // Handle language toggle
  const toggleLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    localStorage.setItem('adna_lang', next);
  };

  // Generate presets on start or when tileSize changes (if not uploaded)
  useEffect(() => {
    if (!hasUploadedA) {
      const defaultA = generateDefaultTexture('grass', tileSize);
      setImgAData(defaultA);
      setImgAUrl(imageDataToURL(defaultA));
    }
  }, [tileSize, hasUploadedA]);

  useEffect(() => {
    if (!hasUploadedB) {
      const defaultB = generateDefaultTexture('dirt', tileSize);
      setImgBData(defaultB);
      setImgBUrl(imageDataToURL(defaultB));
    }
  }, [tileSize, hasUploadedB]);

  // Read uploaded images
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, target: 'A' | 'B') => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadImgFile(file, target);
  };

  const loadImgFile = (file: File, target: 'A' | 'B') => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        if (target === 'A') {
          setImgAData(data);
          setImgAUrl(url);
          setHasUploadedA(true);
        } else {
          setImgBData(data);
          setImgBUrl(url);
          setHasUploadedB(true);
        }
      }
    };
    img.src = url;
  };

  const usePreset = (target: 'A' | 'B') => {
    if (target === 'A') {
      setHasUploadedA(false);
      const defaultA = generateDefaultTexture('grass', tileSize);
      setImgAData(defaultA);
      setImgAUrl(imageDataToURL(defaultA));
    } else {
      setHasUploadedB(false);
      const defaultB = generateDefaultTexture('dirt', tileSize);
      setImgBData(defaultB);
      setImgBUrl(imageDataToURL(defaultB));
    }
  };

  const swapTextures = () => {
    setImgAData(imgBData);
    setImgBData(imgAData);

    setImgAUrl(imgBUrl);
    setImgBUrl(imgAUrl);

    const tempHasUploaded = hasUploadedA;
    setHasUploadedA(hasUploadedB);
    setHasUploadedB(tempHasUploaded);
  };

  // Re-generate tileset sheet on state changes
  useEffect(() => {
    const canvas = tilesetCanvasRef.current;
    if (!canvas) return;

    const cols = isCellBased ? BLOB47_COLS : isWang ? 4 : 5;
    const rows = isCellBased ? BLOB47_ROWS : isWang ? 4 : 3;

    // Maintain an offscreen canvas with clean tileset pixels (without grid lines)
    if (!cleanSheetCanvasRef.current) {
      cleanSheetCanvasRef.current = document.createElement('canvas');
    }
    const cleanCanvas = cleanSheetCanvasRef.current;
    cleanCanvas.width = cols * tileSize;
    cleanCanvas.height = rows * tileSize;

    const cleanCtx = cleanCanvas.getContext('2d');
    if (!cleanCtx) return;
    cleanCtx.clearRect(0, 0, cleanCanvas.width, cleanCanvas.height);

    const params: RenderParams = {
      tileSize, smoothness, easing, maskStyle,
      pixelSteps: maskStyle === 'pixel' ? pixelSteps : undefined,
      noiseStrength, noiseScale, noiseSeed,
      // blob47's boundaries sit on the tile border — the edge-fade the corner
      // models rely on would erase the jitter exactly there (§6.1).
      noiseTileable: isBlob47,
    };

    const totalTiles = isCellBased ? BLOB47_LAYOUT.length : isWang ? 16 : 15;
    for (let i = 0; i < totalTiles; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      let tileData: ImageData;
      if (isPattern) {
        // Baked art, nearest-scaled. Every tileSize offered is a multiple of the
        // pattern's 16px, so the scale-up stays pixel-clean.
        tileData = new ImageData(
          paintPatternTileRGBA(patternId, BLOB47_LAYOUT[i], roleColours, tileSize, patternNoise, bandOffsetPx, patternNoiseSeed, patternNoiseStrength, bandSteps, textureOpts, hardEdgeB),
          tileSize, tileSize
        );
      } else if (isBlob47) {
        tileData = blendBlob47TilePixels(BLOB47_LAYOUT[i], imgAData, imgBData, params);
      } else {
        const tileIdx = isWang ? WANG_LAYOUT[i] : BLOB_LAYOUT[i];
        if (tileIdx === -1) continue;
        tileData = blendTilePixels(tileIdx, isWang, imgAData, imgBData, params);
      }
      cleanCtx.putImageData(tileData, col * tileSize, row * tileSize);
    }

    // The plain terrain-B tile lives outside the sheet (see BLOB47_LAYOUT), so
    // render it separately for the playground to use on unpainted cells.
    if (isCellBased) {
      if (!bgTileCanvasRef.current) bgTileCanvasRef.current = document.createElement('canvas');
      const bg = bgTileCanvasRef.current;
      bg.width = tileSize;
      bg.height = tileSize;
      const bgCtx = bg.getContext('2d');
      if (bgCtx) {
        bgCtx.putImageData(
          isPattern
            ? new ImageData(paintPatternTileRGBA(patternId, BLOB47_BACKGROUND, roleColours, tileSize, patternNoise, bandOffsetPx, patternNoiseSeed, patternNoiseStrength, bandSteps, textureOpts, hardEdgeB), tileSize, tileSize)
            : blendBlob47TilePixels(BLOB47_BACKGROUND, imgAData, imgBData, params),
          0, 0
        );
      }
    }

    // Render to on-screen preview canvas
    canvas.width = cols * tileSize;
    canvas.height = rows * tileSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cleanCanvas, 0, 0);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      // Horizontal lines
      for (let r = 1; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * tileSize);
        ctx.lineTo(canvas.width, r * tileSize);
        ctx.stroke();
      }
      // Vertical lines
      for (let c = 1; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * tileSize, 0);
        ctx.lineTo(c * tileSize, canvas.height);
        ctx.stroke();
      }
    }
  }, [mode, tileSize, showGrid, imgAData, imgBData, smoothness, easing, maskStyle, pixelSteps, noiseStrength, noiseScale, noiseSeed, roleHexKey, patternId, patternNoiseKey, bandOffsetPx, patternNoiseSeed, patternNoiseStrength, bandSteps, textureKey, hardEdgeB]);

  // Re-draw playground
  useEffect(() => {
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = COLS * tileSize;
    canvas.height = ROWS * tileSize;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawSheetSlot = (sheetIndex: number, sheetCols: number, destCol: number, destRow: number) => {
      const srcCol = sheetIndex % sheetCols;
      const srcRow = Math.floor(sheetIndex / sheetCols);
      const sourceCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
      if (sourceCanvas) {
        ctx.drawImage(
          sourceCanvas,
          srcCol * tileSize, srcRow * tileSize, tileSize, tileSize,
          destCol * tileSize, destRow * tileSize, tileSize, tileSize
        );
      }
    };

    if (isCellBased) {
      // Cell-based: a cell's tile is decided by its 8 neighbours. Out of bounds
      // counts as terrain B, so a painted region reads as an island.
      const cellAt = (r: number, c: number) =>
        r < 0 || c < 0 || r >= ROWS || c >= COLS ? 0 : blobCells[r]?.[c] ?? 0;

      const bg = bgTileCanvasRef.current;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (!cellAt(r, c)) {
            if (bg) ctx.drawImage(bg, c * tileSize, r * tileSize);
            continue;
          }
          let mask = 0;
          if (cellAt(r - 1, c)) mask |= BIT_N;
          if (cellAt(r, c + 1)) mask |= BIT_E;
          if (cellAt(r + 1, c)) mask |= BIT_S;
          if (cellAt(r, c - 1)) mask |= BIT_W;
          if (cellAt(r - 1, c + 1)) mask |= BIT_NE;
          if (cellAt(r + 1, c + 1)) mask |= BIT_SE;
          if (cellAt(r + 1, c - 1)) mask |= BIT_SW;
          if (cellAt(r - 1, c - 1)) mask |= BIT_NW;
          drawSheetSlot(blobSlotForMask(mask), BLOB47_COLS, c, r);
        }
      }
    } else {
      // Corner models: the tile comes from the 4 surrounding vertices.
      const sheetCols = isWang ? 4 : 5;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const nw = wangVertices[r]?.[c] ?? 0;
          const ne = wangVertices[r]?.[c + 1] ?? 0;
          const se = wangVertices[r + 1]?.[c + 1] ?? 0;
          const sw = wangVertices[r + 1]?.[c] ?? 0;
          const wangTileIdx = (nw << 3) | (sw << 2) | (se << 1) | ne;

          const finalTileIdx = isWang ? wangTileIdx : WANG_TO_BLOB[wangTileIdx];
          const sheetIndex = isWang
            ? WANG_INVERSE_LAYOUT[finalTileIdx]
            : BLOB_INVERSE_LAYOUT[finalTileIdx];
          drawSheetSlot(sheetIndex, sheetCols, c, r);
        }
      }
    }

    // Painting guide dots — on vertices for the corner models, on cell centres
    // for blob47, matching what a click actually toggles.
    const dot = (cx: number, cy: number, val: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = val === 1 ? '#22c55e' : '#78350f';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    };

    if (isCellBased) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          dot((c + 0.5) * tileSize, (r + 0.5) * tileSize, blobCells[r]?.[c] ?? 0);
        }
      }
    } else {
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
          dot(c * tileSize, r * tileSize, wangVertices[r]?.[c] ?? 0);
        }
      }
    }
  }, [wangVertices, blobCells, mode, tileSize, showGrid, imgAData, imgBData, smoothness, easing, maskStyle, roleHexKey, patternId, patternNoiseKey, bandOffsetPx, patternNoiseSeed, patternNoiseStrength, bandSteps, textureKey, hardEdgeB]);

  // Painting interaction logic
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const val = e.button === 0 ? 1 : 0; // Left = 1 (A), Right = 0 (B)
    setDrawVal(val);
    setIsDrawing(true);

    paintPixel(x * scaleX, y * scaleY, val);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    paintPixel(x * scaleX, y * scaleY, drawVal);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const getCanvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!e.touches[0]) return;
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;
    const { x, y } = getCanvasPoint(canvas, e.touches[0].clientX, e.touches[0].clientY);
    setDrawVal(touchPaintVal);
    setIsDrawing(true);
    paintPixel(x, y, touchPaintVal);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !e.touches[0]) return;
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;
    const { x, y } = getCanvasPoint(canvas, e.touches[0].clientX, e.touches[0].clientY);
    paintPixel(x, y, drawVal);
  };

  const handleTouchEnd = () => {
    setIsDrawing(false);
  };

  const paintPixel = (px: number, py: number, val: number) => {
    if (isCellBased) {
      // Cell-based model: a click toggles the cell it lands in.
      const cx = Math.floor(px / tileSize);
      const cy = Math.floor(py / tileSize);
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
      setBlobCells(prev => {
        if (prev[cy][cx] === val) return prev;
        const next = prev.map(row => [...row]);
        next[cy][cx] = val;
        return next;
      });
      return;
    }

    // Corner models paint on vertices
    const vx = Math.round(px / tileSize);
    const vy = Math.round(py / tileSize);
    if (vx >= 0 && vx <= COLS && vy >= 0 && vy <= ROWS) {
      setWangVertices(prev => {
        const next = prev.map(row => [...row]);
        next[vy][vx] = val;
        return next;
      });
    }
  };

  const clearPlayground = () => {
    setWangVertices(Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0)));
    setBlobCells(Array(ROWS).fill(null).map(() => Array(COLS).fill(0)));
  };

  const downloadTileset = () => {
    const cleanCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
    if (!cleanCanvas) return;
    const link = document.createElement('a');
    const kind = mode === 'wang' ? 'wang16' : mode === 'blob14' ? 'blob14'
      : mode === 'pattern' ? `blob47_${patternId}` : 'blob47';
    link.download = `tileset_${kind}_${tileSize}px.png`;
    link.href = cleanCanvas.toDataURL();
    link.click();
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <a href="/" className="back-btn">
            <span>←</span> Back to Home
          </a>
          <div className="app-title-group">
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <div className="header-right">
          <button className="btn-lang" onClick={toggleLang}>
            {t.langBtn}
          </button>
        </div>
      </header>

      <main className="main-grid">
        {/* Sidebar Controls */}
        <aside className="sidebar">
          {/* Section: Textures — pattern mode is coloured, not textured. */}
          {!isPattern && (
          <section className="panel-card">
            <h2 className="panel-title">{t.terrainA} / {t.terrainB}</h2>
            <div className="textures-grid">
              <div className="texture-box">
                <span className="texture-label">Terrain A (Grass)</span>
                <div 
                  className="dropzone" 
                  onClick={() => fileInputARef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputARef} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'A')}
                  />
                  {imgAUrl ? (
                    <img src={imgAUrl} alt="Terrain A" className="preview-thumb" />
                  ) : (
                    <div style={{ fontSize: '20px' }}>🌱</div>
                  )}
                  <span className="dropzone-text">{t.dropzoneA}</span>
                </div>
                {hasUploadedA && (
                  <button className="btn-preset" onClick={() => usePreset('A')}>
                    {t.placeholderA}
                  </button>
                )}
              </div>

              <button className="btn-swap" onClick={swapTextures} title="Swap Terrains">
                ⇄
              </button>

              <div className="texture-box">
                <span className="texture-label">Terrain B (Dirt)</span>
                <div 
                  className="dropzone" 
                  onClick={() => fileInputBRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputBRef} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'B')}
                  />
                  {imgBUrl ? (
                    <img src={imgBUrl} alt="Terrain B" className="preview-thumb" />
                  ) : (
                    <div style={{ fontSize: '20px' }}>🧱</div>
                  )}
                  <span className="dropzone-text">{t.dropzoneB}</span>
                </div>
                {hasUploadedB && (
                  <button className="btn-preset" onClick={() => usePreset('B')}>
                    {t.placeholderB}
                  </button>
                )}
              </div>
            </div>
            <p style={{ margin: '12px 0 0 0', fontSize: '11px', color: 'var(--muted)' }}>
              {t.recommendSize}
            </p>
          </section>
          )}

          {/* Section: Type & Options */}
          <section className="panel-card">
            <h2 className="panel-title">{t.tilesetType}</h2>
            <div className="type-tabs" style={{ marginBottom: '16px' }}>
              <button
                className={`tab-btn ${mode === 'wang' ? 'active' : ''}`}
                onClick={() => setMode('wang')}
              >
                {t.wang16}
              </button>
              <button
                className={`tab-btn ${mode === 'blob14' ? 'active' : ''}`}
                onClick={() => setMode('blob14')}
              >
                {t.blob14}
              </button>
              <button
                className={`tab-btn ${mode === 'blob47' ? 'active' : ''}`}
                onClick={() => setMode('blob47')}
              >
                {t.blob47}
              </button>
              <button
                className={`tab-btn ${mode === 'pattern' ? 'active' : ''}`}
                onClick={() => {
                  setMode('pattern');
                  // Pattern mode only offers 16 and 32; carry a larger size
                  // back in here rather than rendering one and correcting it.
                  if (tileSize !== 16 && tileSize !== 32) setTileSize(32);
                }}
              >
                {t.pattern}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label className="checkbox-group">
                <input 
                  type="checkbox" 
                  checked={showGrid} 
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="checkbox-input"
                />
                <span className="checkbox-label">{t.showGrid}</span>
              </label>

              {/* The pattern's silhouette is baked art, so none of the field
                  controls below do anything in that mode — hide them rather
                  than leave dead sliders on screen. */}
              {!isPattern && (<>
              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.smoothness}</span>
                  <span className="slider-val">{smoothness.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0.0" max="1.0" step="0.01" 
                  value={smoothness} 
                  onChange={(e) => setSmoothness(parseFloat(e.target.value))}
                  className="slider-input"
                />
              </div>

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.easingFunc}</span>
                </div>
                <select 
                  className="text-input"
                  value={easing}
                  onChange={(e) => setEasing(e.target.value)}
                >
                  {Object.keys(EASING_FUNCTIONS).map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.maskStyle}</span>
                </div>
                <select
                  className="text-input"
                  value={maskStyle}
                  onChange={(e) => setMaskStyle(e.target.value as MaskStyle)}
                >
                  <option value="linear">{lang === 'zh' ? 'Linear 线性（默认）' : 'Linear (Default)'}</option>
                  <option value="arc">{lang === 'zh' ? 'Arc 圆弧' : 'Arc (Rounded)'}</option>
                  <option value="pixel">{lang === 'zh' ? 'Pixel 锯齿' : 'Pixel (Stepped)'}</option>
                </select>
              </div>

              {maskStyle === 'pixel' && (
                <div className="slider-group" style={{ marginTop: '4px' }}>
                  <div className="slider-header">
                    <span className="slider-name">{lang === 'zh' ? '锯齿台阶数' : 'Pixel Steps'}</span>
                    <span className="slider-val">{pixelSteps}</span>
                  </div>
                  <input
                    type="range"
                    className="slider"
                    min={2} max={16} step={2}
                    value={pixelSteps}
                    onChange={(e) => setPixelSteps(parseInt(e.target.value))}
                  />
                </div>
              )}

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header">
                  <span className="slider-name">{t.noiseStrength}</span>
                  <span className="slider-val">{noiseStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  className="slider"
                  min={0} max={1} step={0.05}
                  value={noiseStrength}
                  onChange={(e) => setNoiseStrength(parseFloat(e.target.value))}
                />
              </div>

              {noiseStrength > 0 && (<>
                <div className="slider-group" style={{ marginTop: '4px' }}>
                  <div className="slider-header">
                    <span className="slider-name">{t.noiseScale}</span>
                    <span className="slider-val">{noiseScale}</span>
                  </div>
                  <input
                    type="range"
                    className="slider"
                    min={1} max={20} step={1}
                    value={noiseScale}
                    onChange={(e) => setNoiseScale(parseInt(e.target.value))}
                  />
                </div>

                <div className="slider-group" style={{ marginTop: '4px' }}>
                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.noiseSeed}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="number"
                      className="text-input"
                      style={{ flex: 1 }}
                      min={0} max={99999}
                      value={noiseSeed}
                      onChange={(e) => setNoiseSeed(parseInt(e.target.value) || 0)}
                    />
                    <button
                      className="btn-action btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '14px' }}
                      onClick={() => setNoiseSeed(Math.floor(Math.random() * 99999))}
                      title={lang === 'zh' ? '随机种子' : 'Randomize seed'}
                    >🎲</button>
                  </div>
                </div>
              </>)}
              </>)}

              {isPattern && (
                <div className="slider-group" style={{ marginTop: '4px' }}>
                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.patternStyle}</span>
                  </div>
                  <select
                    className="text-input"
                    style={{ marginBottom: '16px' }}
                    value={patternId}
                    onChange={(e) => setPatternId(e.target.value as PatternId)}
                  >
                    {PATTERN_GROUPS.map((g) => (
                      <optgroup key={g.en} label={lang === 'zh' ? g.zh : g.en}>
                        {g.items.map((p) => (
                          <option key={p.id} value={p.id}>{lang === 'zh' ? p.zh : p.en}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>

                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.bandSteps}</span>
                  </div>
                  <div className="type-tabs" style={{ marginBottom: '4px' }}>
                    {BAND_STEP_CHOICES.map((n) => (
                      <button
                        key={n}
                        className={`tab-btn ${bandSteps === n ? 'active' : ''}`}
                        onClick={() => setBandSteps(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: '4px 0 8px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {t.bandStepsHint}
                  </p>

                  <label className="checkbox-group" style={{ marginBottom: '4px' }}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={hardEdgeB}
                      onChange={(e) => setHardEdgeB(e.target.checked)}
                    />
                    <span className="checkbox-label">{t.hardEdgeB}</span>
                  </label>
                  <p style={{ margin: '2px 0 14px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {t.hardEdgeBHint}
                  </p>

                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.bandBias}</span>
                    <span className="slider-val">
                      {bandOffsetPx === 0 ? t.bandBiasZero : `${bandOffsetPx > 0 ? '+' : ''}${bandOffsetPx.toFixed(2)} px`}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="slider-input"
                    min={-1} max={1} step={0.05}
                    value={bandBias}
                    onChange={(e) => setBandBias(parseFloat(e.target.value))}
                  />
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '10.5px', color: 'var(--muted)', margin: '2px 0 14px',
                  }}>
                    <span>{t.bandTowardCentre}</span>
                    <span>{t.bandTowardBorder}</span>
                  </div>

                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.patternNoise}</span>
                    <span className="slider-val">
                      {patternNoise.length === 0 ? t.noiseOff : `${patternNoise.length}`}
                    </span>
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    {NOISE_PRESETS.map((n) => (
                      <label key={n.id} className="checkbox-group" style={{ marginBottom: '4px' }}>
                        <input
                          type="checkbox"
                          className="checkbox-input"
                          checked={patternNoise.includes(n.id)}
                          onChange={() => toggleNoise(n.id)}
                        />
                        <span className="checkbox-label">{lang === 'zh' ? n.zh : n.en}</span>
                      </label>
                    ))}
                  </div>
                  {patternNoise.length > 0 && (
                    <div style={{ margin: '2px 0 10px' }}>
                      <div className="slider-header" style={{ marginBottom: '6px' }}>
                        <span className="slider-name">{t.noiseAmount}</span>
                        <span className="slider-val">
                          {patternNoiseStrength === 0
                            ? t.noiseOff
                            : `${Math.round(patternNoiseStrength * 100)}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        className="slider-input"
                        style={{ marginBottom: '12px' }}
                        min={0} max={MAX_NOISE_STRENGTH} step={0.05}
                        value={patternNoiseStrength}
                        onChange={(e) => setPatternNoiseStrength(parseFloat(e.target.value))}
                      />

                      <div className="slider-header" style={{ marginBottom: '6px' }}>
                        <span className="slider-name">{t.noiseSeed}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="number"
                          className="text-input"
                          style={{ flex: 1 }}
                          min={0} max={99999}
                          value={patternNoiseSeed}
                          onChange={(e) => setPatternNoiseSeed(
                            Math.max(0, Math.min(99999, parseInt(e.target.value) || 0))
                          )}
                        />
                        <button
                          className="btn-action btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '14px' }}
                          onClick={() => setPatternNoiseSeed(Math.floor(Math.random() * 99999) + 1)}
                          title={lang === 'zh' ? '随机种子' : 'Randomize seed'}
                        >🎲</button>
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                        {t.noiseSeedHint}
                      </p>
                    </div>
                  )}

                  <p style={{ margin: '0 0 16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {t.noiseStackHint}
                  </p>

                  <div className="slider-header" style={{ marginBottom: '6px' }}>
                    <span className="slider-name">{t.terrainTexture}</span>
                  </div>
                  <select
                    className="text-input"
                    style={{ marginBottom: textureAlgo === 'none' ? '16px' : '10px' }}
                    value={textureAlgo}
                    onChange={(e) => setTextureAlgo(e.target.value as TextureId)}
                  >
                    {TEXTURE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>{lang === 'zh' ? p.zh : p.en}</option>
                    ))}
                  </select>

                  {textureAlgo !== 'none' && (<>
                    {([['A', textureAmountA, setTextureAmountA, t.textureAmountA],
                       ['B', textureAmountB, setTextureAmountB, t.textureAmountB]] as const)
                      .map(([key, val, set, label]) => (
                        <div key={key}>
                          <div className="slider-header" style={{ marginBottom: '4px' }}>
                            <span className="slider-name">{label}</span>
                            <span className="slider-val">
                              {val === 0 ? t.noiseOff : `${Math.round(val * 100)}%`}
                            </span>
                          </div>
                          <input
                            type="range"
                            className="slider-input"
                            style={{ marginBottom: '8px' }}
                            min={0} max={1} step={0.05}
                            value={val}
                            onChange={(e) => set(parseFloat(e.target.value))}
                          />
                        </div>
                      ))}

                    <div className="slider-header" style={{ marginBottom: '6px' }}>
                      <span className="slider-name">{t.textureShades}</span>
                    </div>
                    <div className="type-tabs" style={{ marginBottom: '6px' }}>
                      {TEXTURE_SHADE_CHOICES.map((n) => (
                        <button
                          key={n}
                          className={`tab-btn ${textureShades === n ? 'active' : ''}`}
                          onClick={() => setTextureShades(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                      {t.textureHint}
                    </p>
                  </>)}

                  <div className="slider-header" style={{ marginBottom: '8px' }}>
                    <span className="slider-name">{t.patternColours}</span>
                  </div>
                  {([
                    ['terrainA', t.colourTerrainA],
                    ['terrainB', t.colourTerrainB],
                    ['edge', t.colourEdge],
                  ] as const).map(([role, label]) => (
                    <div key={role} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <input
                        type="color"
                        value={roleHex[role]}
                        onChange={(e) => setRoleHex((p) => ({ ...p, [role]: e.target.value }))}
                        style={{ width: '38px', height: '28px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                        aria-label={label}
                      />
                      <span style={{ fontSize: '12px', flex: 1 }}>{label}</span>
                      <code style={{ fontSize: '11px', color: 'var(--muted)' }}>{roleHex[role]}</code>
                    </div>
                  ))}

                  <div className="slider-header" style={{ margin: '12px 0 6px' }}>
                    <span className="slider-name" style={{ fontSize: '11px' }}>{t.patternShades}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {patternRamp(roleColours).map((c, i) => (
                      <div
                        key={i}
                        title={toHexColour(c)}
                        style={{
                          flex: 1, height: '22px', borderRadius: '4px',
                          border: '1px solid var(--line, rgba(255,255,255,.15))',
                          background: toHexColour(c),
                        }}
                      />
                    ))}
                  </div>

                  <button
                    className="btn-preset"
                    style={{ marginTop: '10px', width: '100%' }}
                    onClick={() => setRoleHex({
                      terrainA: toHexColour(DEFAULT_ROLE_COLOURS.terrainA),
                      terrainB: toHexColour(DEFAULT_ROLE_COLOURS.terrainB),
                      edge: toHexColour(DEFAULT_ROLE_COLOURS.edge),
                    })}
                  >
                    {t.resetColours}
                  </button>

                  <p style={{ margin: '10px 0 0', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {t.patternHint}
                  </p>
                </div>
              )}

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.tileSize}</span>
                  <span className="slider-val">{tileSize} px</span>
                </div>
                <select
                  className="text-input"
                  value={tileSize}
                  onChange={(e) => setTileSize(parseInt(e.target.value))}
                >
                  <option value={16}>16 x 16</option>
                  <option value={32}>32 x 32</option>
                  {/* The pattern is 16px art resampled up; past 32 there is no
                      more detail in the field to recover, so it stops there.
                      The texture modes have real source pixels and do not. */}
                  {!isPattern && <option value={48}>48 x 48</option>}
                  {!isPattern && <option value={64}>64 x 64</option>}
                  {!isPattern && <option value={128}>128 x 128</option>}
                </select>
              </div>
            </div>
          </section>
        </aside>

        {/* Previews and Painter Playground */}
        <div className="content-area">
          {/* Tileset Sheet Preview */}
          <section className="panel-card preview-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>{t.tilesetPreview}</h2>
              <div className="scale-selector">
                <span className="scale-label" style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>SCALE:</span>
                <div className="scale-tabs">
                  {[1, 2, 3, 4, 6, 8].map((s) => (
                    <button
                      key={s}
                      className={`scale-tab-btn ${zoom === s ? 'active' : ''}`}
                      onClick={() => setZoom(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="canvas-container">
              <canvas 
                ref={tilesetCanvasRef} 
                className="tileset-canvas" 
                style={{
                  width: `${(isCellBased ? BLOB47_COLS : isWang ? 4 : 5) * tileSize * zoom}px`,
                  height: `${(isCellBased ? BLOB47_ROWS : isWang ? 4 : 3) * tileSize * zoom}px`
                }}
              />
            </div>
            <div className="action-bar">
              <button className="btn-action" onClick={downloadTileset}>
                💾 {t.downloadPng}
              </button>
            </div>
          </section>

          {/* Interactive Playground Painter */}
          <section className="panel-card playground-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>{t.playgroundTitle}</h2>
              <div className="scale-selector">
                <span className="scale-label" style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>SCALE:</span>
                <div className="scale-tabs">
                  {[1, 2, 3, 4, 6, 8].map((s) => (
                    <button key={s} className={`scale-tab-btn ${playgroundZoom === s ? 'active' : ''}`} onClick={() => setPlaygroundZoom(s)}>{s}x</button>
                  ))}
                </div>
              </div>
            </div>
            <p className="playground-tip">
              <span className="tip-badge">Tip</span>
              {t.playgroundTip}
            </p>
            <div className="playground-canvas-wrapper">
              <canvas
                ref={playgroundCanvasRef}
                className="playground-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onContextMenu={(e) => e.preventDefault()}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                  width: `${COLS * tileSize * playgroundZoom}px`,
                  height: `${ROWS * tileSize * playgroundZoom}px`,
                  touchAction: 'none',
                }}
              />
            </div>
            <div className="action-bar" style={{ marginTop: '16px' }}>
              <button
                className={`btn-action ${touchPaintVal === 1 ? '' : 'btn-secondary'}`}
                onClick={() => setTouchPaintVal(v => v === 1 ? 0 : 1)}
                title={lang === 'zh' ? '触摸绘制模式（鼠标右键也可直接涂 B）' : 'Touch paint mode (right-click also paints B on desktop)'}
              >
                {touchPaintVal === 1 ? `✏️ ${lang === 'zh' ? '涂 A' : 'Paint A'}` : `✏️ ${lang === 'zh' ? '涂 B' : 'Paint B'}`}
              </button>
              <button className="btn-action btn-secondary" onClick={clearPlayground}>
                🗑️ {t.clearPlayground}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
