import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';
import { TRANSLATIONS, type Lang } from './shared/i18n';
import {
  BLOB47_LAYOUT, BLOB47_COLS, BLOB47_ROWS, BLOB47_BACKGROUND, blobSlotForMask,
  N as BIT_N, E as BIT_E, S as BIT_S, W as BIT_W,
  NE as BIT_NE, SE as BIT_SE, SW as BIT_SW, NW as BIT_NW,
} from './utils/blob47';
import {
  DEFAULT_ROLE_COLOURS, DEFAULT_TEXTURE_COLOURS, paintPatternTileRGBA, parseHexColour,
  patternRamp, toHexColour, type RoleColours,
} from './utils/patternPaint';
import {
  PATTERN_GROUPS, DEFAULT_PATTERN, PATTERN_OFFSET_RANGE, RESEEDABLE_PATTERNS,
  MIN_BAND_STEPS, MAX_BAND_STEPS, DEFAULT_BAND_STEPS, patternLevelsFor, type PatternId,
  DEFAULT_OUTLINE_WIDTH, MIN_OUTLINE_WIDTH, MAX_OUTLINE_WIDTH, OUTLINE_WIDTH_STEP,
  outlineWidthPx, PATTERN_TILE_SIZE,
} from './utils/blob47Pattern';
import {
  NOISE_PRESETS, NOISE_TARGETS, DEFAULT_NOISES, DEFAULT_NOISE_SEED, DEFAULT_NOISE_STRENGTH,
  MAX_NOISE_STRENGTH, type NoiseId, type NoiseTargetId,
} from './utils/patternNoise';
import {
  RIBBON_GROUPS, RIBBON_MIN_WIDTH, RIBBON_PERIODS, DEFAULT_RIBBON, DEFAULT_RIBBON_AMOUNT,
  DEFAULT_RIBBON_PERIOD, DEFAULT_RIBBON_SHADES, MIN_RIBBON_SHADES, MAX_RIBBON_SHADES,
  ribbonUsesInvert, ribbonUsesPeriod, usedRibbonShades, type RibbonId,
} from './utils/patternRibbon';
import {
  TEXTURE_PRESETS, DEFAULT_TEXTURE, DEFAULT_TEXTURE_SHADES, textureRamp, usedTextureShades,
  MIN_TEXTURE_SHADES, MAX_TEXTURE_SHADES, DEFAULT_TEXTURE_SEED, WATER_DOT_COLOUR, type TextureId,
} from './utils/patternTexture';

/**
 * One tileset model: blob47, painted on cells, coloured from baked pattern art.
 * A cell's tile is decided by its 8 neighbours — see docs/AUTOTILE_SCHEMES.md §5
 * for why that is 47 tiles and not 256, and docs/AUTOTILE_PATTERN_BAKE.md for
 * where the art comes from.
 */
const COLS = 16;
const ROWS = 10;

/**
 * The one size the sheet is emitted at, and the resolution the art is baked at:
 * PATTERN_TILE_SIZE is 32 too, so a tile is the stored field thresholded with no
 * resampling in between. There is nothing to choose here — 16 was removed rather
 * than kept as a lossy second option.
 */
const TILE_SIZE = PATTERN_TILE_SIZE;

/** Seeds are typed as well as rolled, so the bound belongs in one place. */
const SEED_MAX = 99999;
const clampSeed = (raw: string) => Math.max(0, Math.min(SEED_MAX, parseInt(raw) || 0));
/** From 1, so a roll never lands on 0 — that value means "exactly as baked". */
const rollSeed = () => Math.floor(Math.random() * SEED_MAX) + 1;

/**
 * A label's long explanation, parked behind a marker. Purely presentational —
 * hover and focus are handled in CSS so nothing here re-renders on mouse move.
 */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="infotip">
      <button type="button" className="infotip-btn" aria-label={text}>?</button>
      <span className="infotip-panel" role="tooltip">{text}</span>
    </span>
  );
}

/**
 * A colour well the whole area of which is clickable.
 *
 * `<input type="color">` cannot be styled, so the swatch is a div wearing the
 * colour with the real input stretched invisibly over it — that is why the
 * input is oversized and transparent rather than hidden, which would take it
 * out of the hit area along with the picker.
 */
function ColourSwatch({ hex, onChange, title, isCustom = false, disabled = false }: {
  hex: string;
  onChange: (hex: string) => void;
  title: string;
  isCustom?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`colour-swatch${isCustom ? ' is-custom' : ''}${disabled ? ' is-disabled' : ''}`}
      title={title}
      style={{ background: hex }}
    >
      {disabled && (
        <svg className="swatch-cross" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(0,0,0,0.6)" strokeWidth="16" />
          <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(0,0,0,0.6)" strokeWidth="16" />
          <line x1="0" y1="0" x2="100" y2="100" stroke="#ef4444" strokeWidth="10" />
          <line x1="100" y1="0" x2="0" y2="100" stroke="#ef4444" strokeWidth="10" />
        </svg>
      )}
      <input
        type="color"
        value={hex}
        disabled={disabled}
        aria-label={title}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Typed seed plus a dice roll. Used by both the edge and the grain seed. */
function SeedField({ value, onChange, diceTitle }: {
  value: number;
  onChange: (seed: number) => void;
  diceTitle: string;
}) {
  return (
    <div className="seed-field">
      <input
        type="number"
        className="text-input"
        min={0}
        max={SEED_MAX}
        value={value}
        onChange={(e) => onChange(clampSeed(e.target.value))}
      />
      <button className="btn-action btn-secondary btn-dice" onClick={() => onChange(rollSeed())} title={diceTitle}>
        🎲
      </button>
    </div>
  );
}

/** "Back to the derived colours." Shown only while an override is in force. */
function ResetLink({ label, title, onClick }: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button className="btn-action btn-secondary btn-reset" onClick={onClick} title={title}>
      ↺ {label}
    </button>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('adna_lang') as Lang) || 'zh';
  });

  const t = TRANSLATIONS[lang];

  // One colour per role, kept as hex for the <input type="color">.
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

  // Which built-in pattern the colours are painted onto.
  const [patternId, setPatternId] = useState<PatternId>(DEFAULT_PATTERN);

  // Re-roll of the baked irregular silhouette. 0 = exactly as authored.
  const [edgeSeed, setEdgeSeed] = useState(0);
  const canReseed = RESEEDABLE_PATTERNS.has(patternId);

  // Grain on the pattern's transition band. The algorithms stack, so this is a
  // set; empty means no grain.
  const [patternNoise, setPatternNoise] = useState<NoiseId[]>([...DEFAULT_NOISES]);
  const [patternNoiseSeed, setPatternNoiseSeed] = useState(DEFAULT_NOISE_SEED);
  const [patternNoiseStrength, setPatternNoiseStrength] = useState(DEFAULT_NOISE_STRENGTH);

  // What is painted INSIDE the outline. The other half of the same split: the
  // outline is a canvas with width, the rings either side of it are a dither.
  const [ribbonAlgo, setRibbonAlgo] = useState<RibbonId>(DEFAULT_RIBBON);
  const [ribbonAmount, setRibbonAmount] = useState(DEFAULT_RIBBON_AMOUNT);
  const [ribbonPeriod, setRibbonPeriod] = useState<number>(DEFAULT_RIBBON_PERIOD);
  const [ribbonShades, setRibbonShades] = useState(DEFAULT_RIBBON_SHADES);
  const [ribbonInvert, setRibbonInvert] = useState(false);
  const [customRibbonHex, setCustomRibbonHex] = useState<(string | undefined)[] | null>(null);

  // Speckle inside the solid terrains, so a filled region reads as a material.
  // Per terrain: the two solid regions are different materials, so paving under
  // grass wants a different field from the grass.
  const [textureAlgoA, setTextureAlgoA] = useState<TextureId>(DEFAULT_TEXTURE);
  const [textureAlgoB, setTextureAlgoB] = useState<TextureId>(DEFAULT_TEXTURE);
  const [textureAmountA, setTextureAmountA] = useState(0.4);
  const [textureAmountB, setTextureAmountB] = useState(0.4);
  const [textureShadesA, setTextureShadesA] = useState(DEFAULT_TEXTURE_SHADES);
  const [textureShadesB, setTextureShadesB] = useState(DEFAULT_TEXTURE_SHADES);
  const [textureSeedA, setTextureSeedA] = useState(DEFAULT_TEXTURE_SEED);
  const [textureSeedB, setTextureSeedB] = useState(DEFAULT_TEXTURE_SEED);
  // Picked independently of the terrain colours: the speckle in hand-drawn
  // pixel art is usually a different material, not a lighter version of the
  // ground it sits on.
  // Per-step overrides of each terrain's texture ramp, sparse and indexed from
  // the bare terrain at 0; null means every step is still derived. The single
  // target picker this replaces could only ever move the ramp's far end, so the
  // steps between it and the terrain were not reachable at all.
  const [customTexHex, setCustomTexHex] =
    useState<Record<'terrainA' | 'terrainB', (string | undefined)[] | null>>({
      terrainA: null,
      terrainB: null,
    });
  const effectiveTextureShadesA = textureAlgoA === 'water' ? 2 : textureShadesA;
  const effectiveTextureShadesB = textureAlgoB === 'water' ? 2 : textureShadesB;
  // Memoised, not built inline: the render effects key off object identity, so
  // a fresh object every render would repaint all 48 tiles on every keystroke.
  const textureOpts = useMemo(() => {
    const textureRampFor = (role: 'terrainA' | 'terrainB', algo: TextureId, shadeCount: number) => {
      const custom = customTexHex[role]?.length === shadeCount + 1
        ? customTexHex[role]?.map((h) => (h ? parseHexColour(h) : undefined))
        : undefined;
      if (algo !== 'water') return custom;
      const waterRamp = custom ? [...custom] : new Array(3).fill(undefined);
      waterRamp[2] ??= WATER_DOT_COLOUR;
      return waterRamp;
    };
    return {
      algoA: textureAlgoA,
      algoB: textureAlgoB,
      amountA: textureAmountA,
      amountB: textureAmountB,
      shadesA: effectiveTextureShadesA,
      shadesB: effectiveTextureShadesB,
      seedA: textureSeedA,
      seedB: textureSeedB,
      colourA: DEFAULT_TEXTURE_COLOURS.terrainA,
      colourB: DEFAULT_TEXTURE_COLOURS.terrainB,
      rampA: textureRampFor('terrainA', textureAlgoA, effectiveTextureShadesA),
      rampB: textureRampFor('terrainB', textureAlgoB, effectiveTextureShadesB),
    };
  }, [textureAlgoA, textureAlgoB, textureAmountA, textureAmountB,
       effectiveTextureShadesA, effectiveTextureShadesB,
       textureSeedA, textureSeedB, customTexHex]);

  const TEXTURE_SHADE_CHOICES = Array.from(
    { length: MAX_TEXTURE_SHADES - MIN_TEXTURE_SHADES + 1 },
    (_, i) => MIN_TEXTURE_SHADES + i
  );

  // How many colours the transition band is drawn with.
  const [bandSteps, setBandSteps] = useState(DEFAULT_BAND_STEPS);
  const BAND_STEP_CHOICES = Array.from(
    { length: MAX_BAND_STEPS - MIN_BAND_STEPS + 1 },
    (_, i) => MIN_BAND_STEPS + i
  );

  // Stroke outline width in pixels.
  const [outlineWidth, setOutlineWidth] = useState<number>(DEFAULT_OUTLINE_WIDTH);

  // Collapse the terrain-B shade so open terrain meets the outline hard.
  const [hardEdgeB, setHardEdgeB] = useState(false);

  // Where the transition band sits, as -1 (toward the cell centre) .. +1
  // (toward its border). Kept normalised because each pattern has its own
  // usable range — a fixed pixel slider would be mostly dead travel on the
  // noisier ones. See PATTERN_OFFSET_RANGE.
  const [bandBias, setBandBias] = useState(0);
  const bandOffsetPx = useMemo(() => {
    const [lo, hi] = PATTERN_OFFSET_RANGE[patternId];
    return bandBias < 0 ? -bandBias * lo : bandBias * hi;
  }, [patternId, bandBias]);
  const toggleNoise = (id: NoiseId) =>
    setPatternNoise((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]
    );
  // Grid helper
  const [showGrid, setShowGrid] = useState(true);

  // The playground's per-cell markers. On by default because they show what a
  // click toggles, but they sit on top of the art, so judging whether a tileset
  // actually reads well means being able to take them away.
  const [showCellDots, setShowCellDots] = useState(true);

  // Zoom config (integer scale factor for visual canvas sizes)
  const [zoom, setZoom] = useState(2);

  // Playground zoom (independent from tileset zoom, default 1x, supports 1x, 2x, 4x)
  const [playgroundZoom, setPlaygroundZoom] = useState(1);

  // blob47 is cell-based, so the playground stores cells, not vertices.
  const [blobCells, setBlobCells] = useState<number[][]>(() =>
    Array(ROWS).fill(null).map(() => Array(COLS).fill(0))
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawVal, setDrawVal] = useState<number>(1); // 1 = paint A, 0 = paint B (erase)

  // Custom shades overrides state (null = derived automatically from roleColours)
  const [customShadesHex, setCustomShadesHex] = useState<string[] | null>(null);

  const levels = useMemo(() => patternLevelsFor(bandSteps), [bandSteps]);

  const bandShadeIndices = useMemo(() => {
    return levels
      .map((lvl, idx) => ({ lvl, idx }))
      .filter(({ lvl }) => lvl.shade > 0)
      .map(({ idx }) => idx);
  }, [levels]);

  /** Which level is the outline. Extra band steps go on the terrain-A side, so
   *  its index moves with the step count rather than being a constant 2. */
  const outlineLevel = useMemo(() => levels.findIndex((l) => l.role === 'edge'), [levels]);

  const derivedRamp = useMemo(() => patternRamp(roleColours, bandSteps), [roleColours, bandSteps]);

  const currentRampRGB = useMemo(() => {
    if (customShadesHex && customShadesHex.length === derivedRamp.length) {
      return derivedRamp.map((c, i) =>
        customShadesHex[i] ? parseHexColour(customShadesHex[i]) : c
      );
    }
    return derivedRamp;
  }, [customShadesHex, derivedRamp]);

  /**
   * Each terrain's texture ramp as the swatches show it and the painter uses it:
   * derived from the terrain colour toward the default texture colour, with any
   * hand-picked step substituted in. Memoised because the paint effect keys off
   * object identity.
   */
  const textureRamps = useMemo(() => {
    const build = (role: 'terrainA' | 'terrainB') => {
      const algo = role === 'terrainA' ? textureAlgoA : textureAlgoB;
      const shadeCount = role === 'terrainA' ? effectiveTextureShadesA : effectiveTextureShadesB;
      const custom = customTexHex[role]?.length === shadeCount + 1
        ? customTexHex[role]?.map((h) => (h ? parseHexColour(h) : undefined))
        : undefined;
      if (algo === 'water') {
        const waterRamp = custom ? [...custom] : new Array(3).fill(undefined);
        waterRamp[2] ??= WATER_DOT_COLOUR;
        return textureRamp(roleColours[role], DEFAULT_TEXTURE_COLOURS[role], shadeCount, waterRamp);
      }
      return textureRamp(
        roleColours[role],
        DEFAULT_TEXTURE_COLOURS[role],
        shadeCount,
        custom
      );
    };
    return { terrainA: build('terrainA'), terrainB: build('terrainB') };
  }, [roleColours, textureAlgoA, textureAlgoB, effectiveTextureShadesA, effectiveTextureShadesB, customTexHex]);

  /** Which texture shades each terrain is actually painting right now. */
  const reachable = useMemo(() => ({
    terrainA: usedTextureShades(textureAlgoA, textureAmountA, effectiveTextureShadesA),
    terrainB: usedTextureShades(textureAlgoB, textureAmountB, effectiveTextureShadesB),
  }), [textureAlgoA, textureAmountA, textureAlgoB, textureAmountB,
    effectiveTextureShadesA, effectiveTextureShadesB]);

  // Custom noise colors state (null = derived from band ramp)
  const [customNoiseHex, setCustomNoiseHex] = useState<{ b?: string; edge?: string; a?: string } | null>(null);

  const customNoiseColours = useMemo(() => {
    if (!customNoiseHex) return undefined;
    return {
      b: customNoiseHex.b ? parseHexColour(customNoiseHex.b) : undefined,
      edge: customNoiseHex.edge ? parseHexColour(customNoiseHex.edge) : undefined,
      a: customNoiseHex.a ? parseHexColour(customNoiseHex.a) : undefined,
    };
  }, [customNoiseHex]);

  // Noise target regions
  const [noiseTargets, setNoiseTargets] = useState<NoiseTargetId[]>(['edge', 'terrainA', 'terrainB']);

  const toggleNoiseTarget = (id: NoiseTargetId) => {
    setNoiseTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  /** The outline is the ribbon's canvas, so its width decides what fits on it. */
  const ribbonWidthPx = useMemo(
    () => outlineWidthPx(patternId, bandSteps, hardEdgeB, outlineWidth, TILE_SIZE),
    [patternId, bandSteps, hardEdgeB, outlineWidth]
  );
  const ribbonTooNarrow = ribbonAlgo !== 'none' && ribbonWidthPx < RIBBON_MIN_WIDTH[ribbonAlgo];

  /** The ribbon's own ramp, walked from the outline colour the band ramp names. */
  const ribbonRamp = useMemo(() => {
    const custom = customRibbonHex?.length === ribbonShades + 1
      ? customRibbonHex.map((h) => (h ? parseHexColour(h) : undefined))
      : undefined;
    return textureRamp(currentRampRGB[outlineLevel], undefined, ribbonShades, custom);
  }, [currentRampRGB, outlineLevel, ribbonShades, customRibbonHex]);

  /** Which ribbon shades the current motif actually paints. */
  const ribbonReachable = useMemo(
    () => usedRibbonShades(ribbonAlgo, ribbonWidthPx, ribbonAmount, ribbonShades, ribbonPeriod, ribbonInvert),
    [ribbonAlgo, ribbonWidthPx, ribbonAmount, ribbonShades, ribbonPeriod, ribbonInvert]
  );

  const RIBBON_SHADE_CHOICES = Array.from(
    { length: MAX_RIBBON_SHADES - MIN_RIBBON_SHADES + 1 },
    (_, i) => MIN_RIBBON_SHADES + i
  );

  const ribbon = useMemo(() => ({
    algo: ribbonAlgo,
    amount: ribbonAmount,
    period: ribbonPeriod,
    shades: ribbonShades,
    // One dice for the edge: the silhouette re-roll and the motif's phase both
    // follow it, so rolling once changes the edge rather than one aspect of it.
    seed: edgeSeed,
    invert: ribbonInvert,
    ramp: customRibbonHex?.length === ribbonShades + 1
      ? customRibbonHex.map((h) => (h ? parseHexColour(h) : undefined))
      : undefined,
  }), [ribbonAlgo, ribbonAmount, ribbonPeriod, ribbonShades, edgeSeed, ribbonInvert, customRibbonHex]);

  /**
   * Everything paintPatternTileRGBA needs, in one memoised object.
   *
   * Both render effects depend on this and nothing else, so the list of things
   * that change a tile is written down ONCE. It used to be spread over two
   * hand-maintained dependency arrays plus six string keys (`roleHexKey`,
   * `textureKey`, …), which meant a new parameter had to be remembered in three
   * places and a miss showed up as "I changed it and nothing happened".
   *
   * Every entry is either a primitive or already memoised, so the identity of
   * this object changes exactly when the pixels would.
   */
  const paintArgs = useMemo(() => ({
    patternId,
    roleColours,
    opts: {
      tileSize: TILE_SIZE,
      offsetPx: bandOffsetPx,
      bandSteps,
      hardEdgeB,
      edgeSeed,
      outlineWidth,
      noises: patternNoise,
      noiseSeed: patternNoiseSeed,
      noiseStrength: patternNoiseStrength,
      noiseTargets,
      noiseColours: customNoiseColours,
      ribbon,
      texture: textureOpts,
      ramp: currentRampRGB,
    },
  }), [patternId, roleColours, bandOffsetPx, bandSteps, textureOpts, hardEdgeB,
       edgeSeed, currentRampRGB, outlineWidth, patternNoise, patternNoiseSeed,
       patternNoiseStrength, noiseTargets, customNoiseColours, ribbon]);

  // Canvas refs
  const tilesetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanSheetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The plain terrain-B tile. The blob47 sheet has no background slot, so the
   *  playground keeps it aside instead of blitting it out of the sheet. */
  const bgTileCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Handle language toggle
  const toggleLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    localStorage.setItem('adna_lang', next);
  };

  // Re-generate tileset sheet on state changes
  useEffect(() => {
    const canvas = tilesetCanvasRef.current;
    if (!canvas) return;

    // Maintain an offscreen canvas with clean tileset pixels (without grid lines)
    if (!cleanSheetCanvasRef.current) {
      cleanSheetCanvasRef.current = document.createElement('canvas');
    }
    const cleanCanvas = cleanSheetCanvasRef.current;
    cleanCanvas.width = BLOB47_COLS * TILE_SIZE;
    cleanCanvas.height = BLOB47_ROWS * TILE_SIZE;

    const cleanCtx = cleanCanvas.getContext('2d');
    if (!cleanCtx) return;
    cleanCtx.clearRect(0, 0, cleanCanvas.width, cleanCanvas.height);

    const a = paintArgs;
    const paint = (mask: number) => new ImageData(
      paintPatternTileRGBA(a.patternId, mask, a.roleColours, a.opts),
      TILE_SIZE, TILE_SIZE
    );

    for (let i = 0; i < BLOB47_LAYOUT.length; i++) {
      const col = i % BLOB47_COLS;
      const row = Math.floor(i / BLOB47_COLS);
      cleanCtx.putImageData(paint(BLOB47_LAYOUT[i]), col * TILE_SIZE, row * TILE_SIZE);
    }

    // The plain terrain-B tile lives outside the sheet (see BLOB47_LAYOUT), so
    // render it separately for the playground to use on unpainted cells.
    if (!bgTileCanvasRef.current) bgTileCanvasRef.current = document.createElement('canvas');
    const bg = bgTileCanvasRef.current;
    bg.width = TILE_SIZE;
    bg.height = TILE_SIZE;
    const bgCtx = bg.getContext('2d');
    if (bgCtx) bgCtx.putImageData(paint(BLOB47_BACKGROUND), 0, 0);

    // Render to on-screen preview canvas
    canvas.width = BLOB47_COLS * TILE_SIZE;
    canvas.height = BLOB47_ROWS * TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cleanCanvas, 0, 0);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      for (let r = 1; r < BLOB47_ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * TILE_SIZE);
        ctx.lineTo(canvas.width, r * TILE_SIZE);
        ctx.stroke();
      }
      for (let c = 1; c < BLOB47_COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE_SIZE, 0);
        ctx.lineTo(c * TILE_SIZE, canvas.height);
        ctx.stroke();
      }
    }
  }, [showGrid, paintArgs]);

  // Re-draw playground
  useEffect(() => {
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = COLS * TILE_SIZE;
    canvas.height = ROWS * TILE_SIZE;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawSheetSlot = (sheetIndex: number, destCol: number, destRow: number) => {
      const srcCol = sheetIndex % BLOB47_COLS;
      const srcRow = Math.floor(sheetIndex / BLOB47_COLS);
      const sourceCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
      if (sourceCanvas) {
        ctx.drawImage(
          sourceCanvas,
          srcCol * TILE_SIZE, srcRow * TILE_SIZE, TILE_SIZE, TILE_SIZE,
          destCol * TILE_SIZE, destRow * TILE_SIZE, TILE_SIZE, TILE_SIZE
        );
      }
    };

    // A cell's tile is decided by its 8 neighbours. Out of bounds counts as
    // terrain B, so a painted region reads as an island.
    const cellAt = (r: number, c: number) =>
      r < 0 || c < 0 || r >= ROWS || c >= COLS ? 0 : blobCells[r]?.[c] ?? 0;

    const bg = bgTileCanvasRef.current;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!cellAt(r, c)) {
          if (bg) ctx.drawImage(bg, c * TILE_SIZE, r * TILE_SIZE);
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
        drawSheetSlot(blobSlotForMask(mask), c, r);
      }
    }

    // Painting guide dots on cell centres, matching what a click toggles.
    if (!showCellDots) return;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = blobCells[r]?.[c] ?? 0;
        ctx.beginPath();
        ctx.arc((c + 0.5) * TILE_SIZE, (r + 0.5) * TILE_SIZE, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = val === 1 ? '#22c55e' : '#78350f';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
  // `paintArgs` is here for its side effect on the sheet: the playground blits
  // out of cleanSheetCanvasRef, so it has to redraw after the sheet effect has
  // refilled it. Depending on the same object is what orders the two.
  }, [blobCells, showCellDots, paintArgs]);

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

    const val = e.button === 0 ? 1 : 0; // Left click = 1 (A), Right click = 0 (B)
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
    const val = 1;
    setDrawVal(val);
    setIsDrawing(true);
    paintPixel(x, y, val);
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

  /** A click toggles the cell it lands in. */
  const paintPixel = (px: number, py: number, val: number) => {
    const cx = Math.floor(px / TILE_SIZE);
    const cy = Math.floor(py / TILE_SIZE);
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
    setBlobCells(prev => {
      if (prev[cy][cx] === val) return prev;
      const next = prev.map(row => [...row]);
      next[cy][cx] = val;
      return next;
    });
  };

  const clearPlayground = () => {
    setBlobCells(Array(ROWS).fill(null).map(() => Array(COLS).fill(0)));
  };

  const fillPlaygroundA = () => {
    setBlobCells(Array(ROWS).fill(null).map(() => Array(COLS).fill(1)));
  };

  const downloadTileset = () => {
    const cleanCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
    if (!cleanCanvas) return;
    const link = document.createElement('a');
    link.download = `tileset_blob47_${patternId}_${TILE_SIZE}px.png`;
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
        </div>
        <div className="app-title-group">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="header-right">
          <button className="btn-lang" onClick={toggleLang}>
            {t.langBtn}
          </button>
        </div>
      </header>

      <main className="main-grid">
        {/* Controls flank the canvases, ordered by what gets decided first:
            LEFT is what the terrains are and how their boundary is shaped,
            RIGHT is surface detail and output size. */}
        <aside className="sidebar sidebar-left">

          {/* 1 — Terrain colours */}
          <section className="panel-card">
            <h2 className="panel-title">{t.sectionTerrain}</h2>

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

            <button
              className="btn-preset"
              style={{ marginTop: '12px', width: '100%' }}
              onClick={() => {
                setRoleHex({
                  terrainA: toHexColour(DEFAULT_ROLE_COLOURS.terrainA),
                  terrainB: toHexColour(DEFAULT_ROLE_COLOURS.terrainB),
                  edge: toHexColour(DEFAULT_ROLE_COLOURS.edge),
                });
                setCustomShadesHex(null);
              }}
            >
              {t.resetColours}
            </button>
          </section>

          {/* 2 — Transition band and pattern */}
          <section className="panel-card">
            <h2 className="panel-title">{t.sectionBand}</h2>

            <div className="slider-header" style={{ marginBottom: '6px' }}>
              <span className="slider-name">{t.patternStyle}<InfoTip text={t.patternHint} /></span>
            </div>
            <select
              className="text-input"
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

            {canReseed && (<>
              <div className="slider-header" style={{ margin: '12px 0 6px' }}>
                <span className="slider-name">{t.edgeSeed}<InfoTip text={t.edgeRerollHint} /></span>
                {edgeSeed === 0 && <span className="slider-val">{t.edgeSeedOriginal}</span>}
              </div>
              <SeedField value={edgeSeed} onChange={setEdgeSeed} diceTitle={t.randomSeed} />
            </>)}

            <div className="slider-header" style={{ margin: '14px 0 6px' }}>
              <span className="slider-name">{t.bandSteps}<InfoTip text={t.bandStepsHint} /></span>
            </div>
            <div className="type-tabs" style={{ marginBottom: '8px' }}>
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

            <div className="slider-header" style={{ margin: '12px 0 6px' }}>
              <span className="slider-name" style={{ fontSize: '11px' }}>{t.patternShades}</span>
              {customShadesHex && bandShadeIndices.some((idx: number) => Boolean(customShadesHex[idx])) && (
                <ResetLink
                  label={t.reset}
                  title={t.resetShadesHint}
                  onClick={() => setCustomShadesHex(null)}
                />
              )}
            </div>
            <div className="swatch-row" style={{ marginBottom: '10px' }}>
              {bandShadeIndices.map((idx: number) => {
                const hex = toHexColour(currentRampRGB[idx]);
                // hardEdgeB collapses the terrain-B shade, so its swatch has
                // nothing left to colour.
                const isDisabled = hardEdgeB && idx === 1;
                const roleLabel = levels[idx].role === 'terrainA' ? t.shadeSideA : t.shadeSideB;
                return (
                  <ColourSwatch
                    key={idx}
                    hex={hex}
                    disabled={isDisabled}
                    isCustom={Boolean(customShadesHex && customShadesHex[idx])}
                    title={isDisabled
                      ? `${roleLabel} — ${t.shadeDisabled}`
                      : `${roleLabel} (${hex}) — ${t.clickToCustomize}`}
                    onChange={(next) => {
                      // Start from the derived ramp unless an override of the
                      // RIGHT LENGTH is already in force — a stale one from a
                      // different step count would mis-index.
                      const base = (customShadesHex && customShadesHex.length === derivedRamp.length)
                        ? [...customShadesHex]
                        : derivedRamp.map(toHexColour);
                      base[idx] = next;
                      setCustomShadesHex(base);
                    }}
                  />
                );
              })}
            </div>

            <div className="slider-header" style={{ margin: '12px 0 6px' }}>
              <span className="slider-name">{t.outlineWidth}<InfoTip text={t.outlineWidthHint} /></span>
              <span className="slider-val">{outlineWidth.toFixed(2)} px</span>
            </div>
            <input
              type="range"
              className="slider-input"
              min={MIN_OUTLINE_WIDTH}
              max={MAX_OUTLINE_WIDTH}
              step={OUTLINE_WIDTH_STEP}
              value={outlineWidth}
              onChange={(e) => setOutlineWidth(parseFloat(e.target.value))}
            />

            {/* The marker sits outside the <label>: inside it, clicking the
                button would count as a click on the label and toggle the box. */}
            <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0 14px' }}>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={hardEdgeB}
                  onChange={(e) => setHardEdgeB(e.target.checked)}
                />
                <span className="checkbox-label">{t.hardEdgeB}</span>
              </label>
              <InfoTip text={t.hardEdgeBHint} />
            </div>

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
              fontSize: '10.5px', color: 'var(--muted)', marginTop: '2px',
            }}>
              <span>{t.bandTowardCentre}</span>
              <span>{t.bandTowardBorder}</span>
            </div>
          </section>
        </aside>

        {/* 3 — Surface detail */}
        <aside className="sidebar sidebar-right">
          <section className="panel-card">
            <h2 className="panel-title">{t.sectionGrain}</h2>

            {/* The outline is a ribbon with width, so it gets a motif of its
                own. Separate from the band grain below, which erodes the band
                rather than decorating the line inside it. */}
            <div className="slider-header" style={{ marginBottom: '4px' }}>
              <span className="slider-name">{t.ribbonAlgo}<InfoTip text={t.ribbonHint} /></span>
            </div>
            <select
              className="text-input"
              value={ribbonAlgo}
              onChange={(e) => setRibbonAlgo(e.target.value as RibbonId)}
            >
              {RIBBON_GROUPS.map((g) => (
                <optgroup key={g.en} label={lang === 'zh' ? g.zh : g.en}>
                  {g.items.map((r) => (
                    <option key={r.id} value={r.id}>{lang === 'zh' ? r.zh : r.en}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            {ribbonAlgo !== 'none' && (<>
              {/* Said outright rather than dropping the motif from the menu: a
                  motif that needs three pixels is a reason to widen the outline,
                  not a reason to hide it. */}
              {ribbonTooNarrow && (
                <p className="field-note field-warn">
                  {t.ribbonTooNarrow
                    .replace('{n}', String(RIBBON_MIN_WIDTH[ribbonAlgo]))
                    .replace('{w}', String(Math.round(ribbonWidthPx * 10) / 10))}
                </p>
              )}

              <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                <span className="slider-name">
                  {t.ribbonAmount}<InfoTip text={t.ribbonAmountHint} />
                </span>
                <span className="slider-val">
                  {ribbonAmount === 0 ? t.noiseOff : `${Math.round(ribbonAmount * 100)}%`}
                </span>
              </div>
              <input
                type="range"
                className="slider-input"
                min={0} max={1} step={0.05}
                value={ribbonAmount}
                onChange={(e) => setRibbonAmount(parseFloat(e.target.value))}
              />

              {ribbonUsesPeriod(ribbonAlgo) && (<>
                <div className="slider-header" style={{ margin: '10px 0 4px' }}>
                  <span className="slider-name" style={{ fontSize: '11px' }}>
                    {t.ribbonPeriod}<InfoTip text={t.ribbonPeriodHint} />
                  </span>
                </div>
                <div className="type-tabs" style={{ marginBottom: '6px' }}>
                  {RIBBON_PERIODS.map((n) => (
                    <button
                      key={n}
                      className={`tab-btn ${ribbonPeriod === n ? 'active' : ''}`}
                      onClick={() => setRibbonPeriod(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </>)}

              {ribbonUsesInvert(ribbonAlgo) && (
                <label className="checkbox-group" style={{ margin: '8px 0' }}>
                  <input
                    type="checkbox"
                    className="checkbox-input"
                    checked={ribbonInvert}
                    onChange={(e) => setRibbonInvert(e.target.checked)}
                  />
                  <span className="checkbox-label">{t.ribbonInvert}</span>
                </label>
              )}

              <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                <span className="slider-name" style={{ fontSize: '11px' }}>{t.ribbonColours}</span>
                {customRibbonHex?.some(Boolean) && (
                  <ResetLink
                    label={t.reset}
                    title={t.resetRibbonColoursHint}
                    onClick={() => setCustomRibbonHex(null)}
                  />
                )}
              </div>
              <div className="swatch-row">
                {Array.from({ length: MAX_RIBBON_SHADES }, (_, i) => i + 1).map((k) => {
                  // Same rule as the terrain swatches: every slot is drawn so the
                  // row never reflows, and the ones this motif cannot reach at
                  // its current width and strength are crossed out rather than
                  // silently doing nothing when clicked.
                  const isDisabled = !ribbonReachable.has(k);
                  const hex = toHexColour(ribbonRamp[Math.min(k, ribbonShades)]);
                  return (
                    <ColourSwatch
                      key={k}
                      hex={hex}
                      disabled={isDisabled}
                      isCustom={Boolean(customRibbonHex?.[k])}
                      title={isDisabled
                        ? `${t.ribbonColours} ${k} — ${t.textureShadeDisabled}`
                        : `${t.ribbonColours} ${k} (${hex}) — ${t.clickToCustomize}`}
                      onChange={(next) => setCustomRibbonHex((prev) => {
                        // Start from an override of the RIGHT LENGTH; a stale one
                        // from a different shade count would mis-index.
                        const base = prev && prev.length === ribbonShades + 1
                          ? [...prev]
                          : new Array<string | undefined>(ribbonShades + 1).fill(undefined);
                        base[k] = next;
                        return base;
                      })}
                    />
                  );
                })}
              </div>

              <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                <span className="slider-name" style={{ fontSize: '11px' }}>{t.ribbonShades}</span>
                <span className="slider-val">{ribbonShades}</span>
              </div>
              <div className="type-tabs" style={{ marginBottom: '6px' }}>
                {RIBBON_SHADE_CHOICES.map((n) => (
                  <button
                    key={n}
                    className={`tab-btn ${ribbonShades === n ? 'active' : ''}`}
                    onClick={() => setRibbonShades(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>)}

            <div className="slider-header" style={{ marginBottom: '6px' }}>
              <span className="slider-name">{t.patternNoise}<InfoTip text={t.noiseStackHint} /></span>
              <span className="slider-val">
                {patternNoise.length === 0 ? t.noiseOff : `${patternNoise.length}`}
              </span>
            </div>
            <div className="noise-preset-tabs" style={{ marginBottom: '8px' }}>
              {NOISE_PRESETS.map((n) => {
                const isActive = patternNoise.includes(n.id);
                const shortLabel = lang === 'zh'
                  ? n.zh.split(' · ')[0]
                  : n.en.split(' — ')[0];
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`noise-preset-btn ${isActive ? 'active' : ''}`}
                    onClick={() => toggleNoise(n.id)}
                    title={lang === 'zh' ? n.zh : n.en}
                  >
                    {shortLabel}
                  </button>
                );
              })}
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
                  <span className="slider-name">{t.noiseSeed}<InfoTip text={t.noiseSeedHint} /></span>
                </div>
                <SeedField
                  value={patternNoiseSeed}
                  onChange={setPatternNoiseSeed}
                  diceTitle={t.randomSeed}
                />

                <div className="slider-header" style={{ margin: '10px 0 4px' }}>
                  <span className="slider-name" style={{ fontSize: '11px' }}>
                    {t.noiseTargets}<InfoTip text={t.noiseTargetsHint} />
                  </span>
                </div>
                <div className="noise-preset-tabs" style={{ marginBottom: '10px' }}>
                  {NOISE_TARGETS.map((tTarget) => {
                    const isActive = noiseTargets.includes(tTarget.id);
                    return (
                      <button
                        key={tTarget.id}
                        type="button"
                        className={`noise-preset-btn compact ${isActive ? 'active' : ''}`}
                        onClick={() => toggleNoiseTarget(tTarget.id)}
                        title={lang === 'zh' ? tTarget.zh : tTarget.en}
                      >
                        {lang === 'zh' ? tTarget.shortZh : tTarget.shortEn}
                      </button>
                    );
                  })}
                </div>

                <div className="slider-header" style={{ margin: '12px 0 6px' }}>
                  <span className="slider-name" style={{ fontSize: '11px' }}>{t.noiseColours}</span>
                  {customNoiseHex && (customNoiseHex.b || customNoiseHex.edge || customNoiseHex.a) && (
                    <ResetLink
                      label={t.reset}
                      title={t.resetNoiseColoursHint}
                      onClick={() => setCustomNoiseHex(null)}
                    />
                  )}
                </div>
                <div className="swatch-row" style={{ marginBottom: '12px' }}>
                  {(['b', 'edge', 'a'] as const).map((side) => {
                    // Three pickers over a band that can have up to five steps:
                    // each stands for a DIRECTION the grain nudges a pixel, not
                    // for one particular level.
                    const defaultHex = toHexColour(
                      side === 'b' ? derivedRamp[1]
                      : side === 'edge' ? derivedRamp[2]
                      : derivedRamp[derivedRamp.length - 2]
                    );
                    const hex = customNoiseHex?.[side] ?? defaultHex;
                    const label = side === 'b' ? t.noiseColourB
                      : side === 'edge' ? t.noiseColourEdge : t.noiseColourA;
                    return (
                      <div key={side} className="swatch-cell">
                        <span className="swatch-cell-label">{label}</span>
                        <ColourSwatch
                          hex={hex}
                          isCustom={Boolean(customNoiseHex?.[side])}
                          title={`${label} (${hex}) — ${t.clickToCustomize}`}
                          onChange={(next) => setCustomNoiseHex((prev) => ({ ...prev, [side]: next }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="slider-header" style={{ margin: '16px 0 6px' }}>
              <span className="slider-name">{t.terrainTexture}<InfoTip text={t.textureHint} /></span>
            </div>


            {([
              ['terrainA', textureAlgoA, setTextureAlgoA, textureAmountA, setTextureAmountA,
                textureShadesA, setTextureShadesA, textureSeedA, setTextureSeedA,
                t.textureAlgoA, t.textureAmountA, t.textureColourA, t.textureSeedA],
              ['terrainB', textureAlgoB, setTextureAlgoB, textureAmountB, setTextureAmountB,
                textureShadesB, setTextureShadesB, textureSeedB, setTextureSeedB,
                t.textureAlgoB, t.textureAmountB, t.textureColourB, t.textureSeedB],
            ] as const).map(([role, algo, setAlgo, val, set, shadeCount, setShadeCount,
              seedValue, setSeed, algoLabel, amountLabel, colourLabel, seedLabel]) => {
              const isWater = algo === 'water';
              const effectiveShadeCount = isWater ? 2 : shadeCount;
              const effectiveColourLabel = isWater ? t.textureWaterEdgeColour : colourLabel;
              const shadeSlots = isWater
                ? [1, 2]
                : Array.from({ length: MAX_TEXTURE_SHADES }, (_, i) => i + 1);
              return (
              <div key={role} className={`texture-material-block texture-material-${role}`}>
                <div className="slider-header" style={{ marginBottom: '4px' }}>
                  <span className="slider-name">{algoLabel}</span>
                </div>
                <select
                  className="text-input"
                  value={algo}
                  onChange={(e) => setAlgo(e.target.value as TextureId)}
                >
                  {TEXTURE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{lang === 'zh' ? p.zh : p.en}</option>
                  ))}
                </select>

                {algo !== 'none' && (<>
                  <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                    <span className="slider-name">{amountLabel}</span>
                    <span className="slider-val">
                      {val === 0 ? t.noiseOff : `${Math.round(val * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="slider-input"
                    style={{ width: '100%' }}
                    min={0} max={1} step={0.05}
                    value={val}
                    onChange={(e) => set(parseFloat(e.target.value))}
                  />

                  <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                    <span className="slider-name" style={{ fontSize: '11px' }}>
                      {seedLabel}<InfoTip text={t.textureSeedHint} />
                    </span>
                  </div>
                  <SeedField
                    value={seedValue}
                    onChange={setSeed}
                    diceTitle={t.randomSeed}
                  />

                  <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                    <span className="slider-name" style={{ fontSize: '11px' }}>{effectiveColourLabel}</span>
                    {customTexHex[role]?.some(Boolean) && (
                      <ResetLink
                        label={t.reset}
                        title={t.resetTextureColoursHint}
                        onClick={() => setCustomTexHex((p) => ({ ...p, [role]: null }))}
                      />
                    )}
                  </div>
                  <div className="swatch-row">
                    {shadeSlots.map((k) => {
                      // Every slot is drawn whatever the settings, so the row
                      // never reflows; the ones the texture cannot currently
                      // reach are crossed out rather than hidden. That covers
                      // both a step count below the slot and a density too low
                      // for the ramp to climb this far, which otherwise leaves a
                      // swatch that silently does nothing when clicked.
                      const isDisabled = !reachable[role].has(k);
                      const ramp = textureRamps[role];
                      const hex = toHexColour(ramp[isDisabled ? effectiveShadeCount : k]);
                      const swatchLabel = isWater && k === 2
                        ? t.textureWaterDotColour
                        : effectiveColourLabel;
                      return (
                        <ColourSwatch
                          key={k}
                          hex={hex}
                          disabled={isDisabled}
                          isCustom={Boolean(customTexHex[role]?.[k])}
                          title={isDisabled
                            ? `${swatchLabel} ${k} — ${t.textureShadeDisabled}`
                            : `${swatchLabel} ${k} (${hex}) — ${t.clickToCustomize}`}
                          onChange={(next) => setCustomTexHex((p) => {
                            // Start from an override of the RIGHT LENGTH; a stale
                            // one from a different step count would mis-index.
                            const prev = p[role];
                            const base = prev && prev.length === effectiveShadeCount + 1
                              ? [...prev]
                              : new Array<string | undefined>(effectiveShadeCount + 1).fill(undefined);
                            base[k] = next;
                            return { ...p, [role]: base };
                          })}
                        />
                      );
                    })}
                  </div>
                  {!isWater && <>
                    <div className="slider-header" style={{ margin: '8px 0 4px' }}>
                      <span className="slider-name" style={{ fontSize: '11px' }}>{t.textureShades}</span>
                      <span className="slider-val">{shadeCount}</span>
                    </div>
                    <div className="type-tabs" style={{ marginBottom: '6px' }}>
                      {TEXTURE_SHADE_CHOICES.map((n) => (
                        <button
                          key={n}
                          className={`tab-btn ${shadeCount === n ? 'active' : ''}`}
                          onClick={() => setShadeCount(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </>}
                </>)}
              </div>
              );
            })}

          </section>

        </aside>

        {/* Previews and Painter Playground */}
        <div className="content-area">
          {/* Tileset Sheet Preview */}
          <section className="panel-card preview-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', width: '100%', marginBottom: '16px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>{t.tilesetPreview}</h2>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '14px', marginLeft: 'auto',
                flexWrap: 'wrap', justifyContent: 'flex-end',
              }}>
                <label className="checkbox-group compact">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="checkbox-input"
                  />
                  <span className="checkbox-label">{t.showGrid}</span>
                </label>
                <div className="scale-selector">
                  <span className="scale-label" style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>SCALE:</span>
                  <div className="scale-tabs">
                    {[1, 2, 4, 8].map((s) => (
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
            </div>
            <div className="canvas-container">
              <canvas
                ref={tilesetCanvasRef}
                className="tileset-canvas"
                style={{
                  width: `${BLOB47_COLS * TILE_SIZE * zoom}px`,
                  height: `${BLOB47_ROWS * TILE_SIZE * zoom}px`
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', width: '100%', marginBottom: '16px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>{t.playgroundTitle}</h2>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '14px', marginLeft: 'auto',
                // Narrow panels cannot fit markers + scale tabs on one line;
                // let them stack rather than run off the edge.
                flexWrap: 'wrap', justifyContent: 'flex-end',
              }}>
                <label className="checkbox-group compact">
                  <input
                    type="checkbox"
                    className="checkbox-input"
                    checked={showCellDots}
                    onChange={(e) => setShowCellDots(e.target.checked)}
                  />
                  <span className="checkbox-label">{t.showCellDots}</span>
                </label>
                <div className="scale-selector">
                  <span className="scale-label" style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>SCALE:</span>
                  <div className="scale-tabs">
                    {[1, 2, 4, 8].map((s) => (
                      <button key={s} className={`scale-tab-btn ${playgroundZoom === s ? 'active' : ''}`} onClick={() => setPlaygroundZoom(s)}>{s}x</button>
                    ))}
                  </div>
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
                  width: `${COLS * TILE_SIZE * playgroundZoom}px`,
                  height: `${ROWS * TILE_SIZE * playgroundZoom}px`,
                  touchAction: 'none',
                }}
              />
            </div>
            <div className="action-bar" style={{ marginTop: '16px' }}>
              <button className="btn-action btn-secondary" onClick={fillPlaygroundA} title={t.fillPlaygroundAHint}>
                🎨 {t.fillPlaygroundA}
              </button>
              <button className="btn-action btn-secondary" onClick={clearPlayground} title={t.clearPlaygroundHint}>
                🗑️ {t.clearPlayground}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
