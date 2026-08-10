// patternTexture.ts — speckle inside the solid terrains, so a filled region
// reads as a material rather than a flat wash.
//
// It reuses the noise fields from patternNoise, which means it inherits their
// one non-negotiable property: everything here is a pure function of (x, y)
// modulo the 16px pattern tile. A tile is painted knowing nothing about its
// neighbours, so anything that is not 16-periodic disagrees with itself across
// every seam.
//
// Texture applies only to the two SOLID levels (open terrain B, and the filled
// interior of terrain A). The transition band has its own grain; texturing it
// as well would just muddy the edge.

import { sample, type NoiseId } from './patternNoise';
import type { RGB } from './patternPaint';

/**
 * `ripple`, the three cell fields and the masonry patterns are texture-only; the remaining
 * noise ids are shared with the band grain. `clumped` is deliberately absent
 * here while staying a band-grain option — it reads as a blotch, which is what
 * an edge wants and a material does not.
 */
export type TextureId =
  | 'none' | NoiseId | 'ripple' | 'ripple_diag' | 'cells'
  | 'breeze_block' | 'brick_wall' | 'cobbles2' | 'brick_floor'
  | 'hexagon' | 'isometric' | 'isometric_grid' | 'octagonal' | 'square'
  | 'weave' | 'paving' | 'paving3' | 'paving5' | 'stone_floor' | 'water' | 'brick_bond'
  | 'field' | 'rubble' | 'nonslip';

export const TEXTURE_GROUPS: readonly {
  zh: string; en: string;
  items: readonly { id: TextureId; zh: string; en: string }[];
}[] = [
  {
    zh: '无纹理', en: 'None',
    items: [
      { id: 'none', zh: '无纹理', en: 'None' },
    ],
  },
  {
    zh: '自然与有机', en: 'Nature & Organic',
    items: [
      { id: 'field', zh: '草地颗粒 · Field', en: 'Field — grassy ground' },
      { id: 'rubble', zh: '碎石地面 · Rubble', en: 'Rubble — broken stone' },
      { id: 'ripple', zh: '水面波纹 · Ripples', en: 'Ripples — short horizontal dashes' },
      { id: 'ripple_diag', zh: '斜向水波 · Diagonal Ripples', en: 'Diagonal Ripples — 45° short dashes' },
      { id: 'water', zh: '水面边线 · Water', en: 'Water — edge lines only' },
    ],
  },
  {
    zh: '程序与几何', en: 'Procedural & Geometry',
    items: [
      { id: 'cells', zh: '多边形细胞 · Voronoi 细胞网格', en: 'Polygonal Cells — Voronoi cell mesh' },
      { id: 'square', zh: '正方形铺砖 · 可调尺寸', en: 'Square — plain square paving, sizeable' },
      { id: 'hexagon', zh: '规则六边形 · 可调尺寸', en: 'Hexagon — regular hexagonal tiles, sizeable' },
      { id: 'isometric', zh: '等距菱形块 · 可调尺寸', en: 'Isometric — diamond blocks, sizeable' },
      { id: 'isometric_grid', zh: '等距立体方块 · 可调尺寸', en: 'Isometric Grid — 3D cube mesh, sizeable' },
      { id: 'octagonal', zh: '八边切角砖 (32px)', en: 'Octagonal — chamfered square tiles (32)' },
      { id: 'nonslip', zh: '交叉防滑纹 · 可调尺寸', en: 'Non-slip — textured grip, sizeable' },
    ],
  },
  {
    zh: '砖石与石板铺装', en: 'Masonry & Paving',
    items: [
      { id: 'brick_wall', zh: '错缝砖墙 (32px)', en: 'Brick Wall — running-bond masonry (32)' },
      { id: 'brick_bond', zh: '程序化错缝砖 · 可调尺寸', en: 'Running Bond — procedural offset bricks, sizeable' },
      { id: 'cobbles2', zh: '细密错缝砖 (16px)', en: 'Cobbles2 — fine running-bond bricks' },
      { id: 'brick_floor', zh: '45° 斜铺砖 (16px)', en: 'Brick Floor — diagonal 45° bond' },
      { id: 'weave', zh: '菱格编织砖 (16px)', en: 'Weave — diagonal interlocking bricks' },
      { id: 'breeze_block', zh: '镂空通风砖 (32px)', en: 'Breeze Block — perforated masonry (32)' },
      { id: 'paving', zh: '乱砌石板 (32px)', en: 'Paving — random ashlar flags (32)' },
      { id: 'paving3', zh: '等距立体方块 (32px)', en: 'Paving3 — isometric cubes (32)' },
      { id: 'paving5', zh: '曲边咬合铺砖 (32px)', en: 'Paving5 — interlocking curved pavers (32)' },
      { id: 'stone_floor', zh: '不规则石板地面 (32px)', en: 'Stone Floor — irregular stone slabs (32)' },
    ],
  },
  {
    zh: '散点与半调噪声', en: 'Speckle & Noise',
    items: [
      { id: 'white', zh: '白噪散点 · 随机沙粒', en: 'White speckle — random sand' },
      { id: 'blue', zh: '蓝噪散点 · 均匀细颗粒', en: 'Blue speckle — even fine grain' },
      { id: 'ordered', zh: '有序网点 · 规则半调', en: 'Ordered — regular halftone' },
    ],
  },
];

export const TEXTURE_PRESETS = TEXTURE_GROUPS.flatMap((g) => g.items);

/**
 * The three Stagecast pavings are traced from 32x32 art that is genuinely
 * 32-periodic — measured, not assumed: shifting any of them by 16 leaves 800+
 * of 1024 pixels disagreeing, and that holds for the joint mask alone too, so
 * there is no 16-periodic core hiding under the tint variation.
 */
const PERIOD_32: readonly TextureId[] = [
  'paving', 'paving3', 'paving5', 'stone_floor', 'breeze_block',
  'hexagon', 'isometric', 'isometric_grid', 'octagonal', 'water',
  'field', 'rubble',
  // The geometric fields were widened so their motifs read at the same scale as
  // the pavings: at the old size they repeated four times inside one 32px tile
  // and looked like a finer material sitting next to a coarser one. Widening the
  // Motif scale and output period are independent; all source masonry tiles
  // listed above are genuinely 32-periodic.
  'ripple', 'ripple_diag', 'cells', 'square',
  // nonslip's motif is 8px at its natural size but 32px at the coarsest one
  // it offers, and 32 is a multiple of both, so declaring 32 is right for all.
  'nonslip',
  // brick_bond's period is the brick width by twice the course height, which is
  // 32 at the coarsest size it offers and a divisor of it at the others.
  'brick_bond',
];

/**
 * The textures the density control is MEANINGLESS for, and therefore hidden on:
 * every paving, every generated geometry, every traced masonry table.
 *
 * `amount` has never meant one thing. On a scatter field it is the fraction of
 * pixels that get any texture at all, which is a density and behaves like one. On
 * anything that names its shade outright it instead scales the rank ladder and
 * ROUNDS — `round(rank * shades * amount / BAKED_RANKS)` — so it merges levels
 * rather than fading them. Measured at the 0.4 the app used to open on, every
 * texture in this list painted ZERO pixels at ranks 3 and 4: two of the four
 * swatches were dead on arrival, and `square` was worse than that, its grout and
 * a quarter of its tiles both collapsing onto the bare terrain colour so the
 * joint disappeared between them.
 *
 * Fading a paving toward the terrain made some sense when its ramp was derived
 * from the terrain colour. It stopped making sense once the four shades became
 * things the user picks by hand: quantising them away overrides a deliberate
 * choice. The motif-size control is the real density knob for these.
 */
const NO_AMOUNT: readonly TextureId[] = [
  // `nonslip` is deliberately NOT here: it is the one generated texture that
  // reads the slider as geometry — the dash length, i.e. the gap between one
  // dash and the next — instead of as a scale on the shade ladder. Nothing is
  // quantised, so nothing goes dead.
  'cells', 'square', 'hexagon', 'isometric', 'isometric_grid', 'octagonal',
  'brick_wall', 'brick_bond', 'cobbles2', 'brick_floor', 'weave', 'breeze_block',
  'paving', 'paving3', 'paving5', 'stone_floor',
  // The two organic tables are not pavings, but they are baked art on the same
  // rank path and they measure the same: at 0.4 both lose ranks 3 and 4 outright.
  // The rule is about how the control behaves, not which menu group a texture is
  // filed under, so they follow it.
  'field', 'rubble',
];

/**
 * Whether the density control does anything worth showing for this texture.
 *
 * The scatter fields (`white`, `blue`, `ordered`, both ripples), the two organic
 * tables and `water` keep it: on those it thins coverage, which is what the
 * control claims to do.
 */
export function textureUsesAmount(texture: TextureId): boolean {
  return texture !== 'none' && !NO_AMOUNT.includes(texture);
}

/**
 * The density a texture opens on, the same way `naturalGeoScale` gives the size
 * it opens on.
 *
 * Only `nonslip` differs, and it has to: there `amount` is the dash length, and
 * the traced art is the full-length dash. Inheriting the 0.4 a scatter field was
 * left on would show it as stubs and look nothing like the plate it is. Everything
 * else keeps the shared default, so switching between two speckles does not
 * silently move the slider.
 */
export function naturalTextureAmount(texture: TextureId): number {
  return texture === 'nonslip' ? 1 : DEFAULT_TEXTURE_AMOUNT;
}

/**
 * The output-pixel period of a texture, which must DIVIDE the tile size for the
 * texture to be seamless — a seam falls every tile, and only lands on a period
 * boundary when it divides. The sheet is emitted at 32 only, so both 16 and 32
 * are fine here; a texture with any other period would need this checked again.
 */
export function texturePeriod(texture: TextureId): 16 | 32 {
  return PERIOD_32.includes(texture) ? 32 : 16;
}

export const DEFAULT_TEXTURE: TextureId = 'none';
export const MIN_TEXTURE_SHADES = 1;
export const MAX_TEXTURE_SHADES = 4;
export const DEFAULT_TEXTURE_SHADES = 4;
export const DEFAULT_TEXTURE_SEED = 0;
export const DEFAULT_TEXTURE_AMOUNT = 0.4;
export const DEFAULT_CELL_SCALE = 3;
export const MIN_CELL_SCALE = 2;
export const MAX_CELL_SCALE = 6;
export const DEFAULT_RIPPLE_SCALE = 4;
export const MIN_RIPPLE_SCALE = 2;
export const MAX_RIPPLE_SCALE = 8;

/** Salt the texture field so its own algorithms do not share a phase. */
const TEXTURE_SALT = 0x5bd1;

// --- texture-only fields ---------------------------------------------------
// Both are built on lattices whose cell counts divide 16, so they repeat with
// the tile exactly like everything else here does.

function hash01(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise on a deliberately anisotropic lattice: wide cells across, one
 * pixel tall down. Correlated horizontally and independent vertically, it
 * thresholds into the short horizontal dashes pixel art draws water with —
 * which no isotropic field produces, however it is tuned.
 */
function rippleField(x: number, y: number, seed: number, perX: number = DEFAULT_RIPPLE_SCALE): number {
  const perY = 32;  // one cell per row -> rows stay independent
  const fx = (x / 32) * perX;
  const iy = ((y % perY) + perY) % perY;
  const x0 = Math.floor(fx);
  const u = smooth(fx - x0);
  const h = (ix: number) => hash01(((ix % perX) + perX) % perX, iy, seed);
  return h(x0) * (1 - u) + h(x0 + 1) * u;
}

/**
 * Anisotropic value noise rotated 45°: correlated diagonally (top-left to bottom-right),
 * thresholding into short 45° diagonal dashes common in pixel art tilesets.
 */
function rippleDiagField(x: number, y: number, seed: number, perDiag: number = DEFAULT_RIPPLE_SCALE): number {
  const diagLine = wrapN(x - y, 32);
  const along = ((x + y) / 32) * perDiag;
  const x0 = Math.floor(along);
  const u = smooth(along - x0);
  const h = (ix: number) => hash01(((ix % perDiag) + perDiag) % perDiag, diagLine, seed);
  return h(x0) * (1 - u) + h(x0 + 1) * u;
}

/** Grout width between cells, in output pixels. */
const LINE_WIDTH_PX = 1;

/**
 * Nearest and second-nearest Voronoi feature point, plus which cell won.
 * `per` is the number of cells across the 32px tile (2, 3 or 4).
 */
function cellsAt(x: number, y: number, seed: number, per: number) {
  const fx = (x / 32) * per;
  const fy = (y / 32) * per;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 9, f2 = 9;
  let nearestX = 0, nearestY = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iy = cy + dy;
      const wx = ((ix % per) + per) % per;
      const wy = ((iy % per) + per) % per;

      // For 3x3 (medium) and 4x4 (small) cells, use fully random free-floating Voronoi points
      // so cells wander naturally without any rigid grid skeleton or square box lines.
      const px = per >= 3
        ? ix + hash01(wx, wy, seed ^ 0x3c6ef3)
        : ix + (wy % 2) * 0.5 + 0.16 + hash01(wx, wy, seed ^ 0x3c6ef3) * 0.55;
      const py = per >= 3
        ? iy + hash01(wx, wy, seed ^ 0xa54ff5)
        : iy + 0.16 + hash01(wx, wy, seed ^ 0xa54ff5) * 0.55;

      const d = Math.hypot(px - fx, py - fy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        nearestX = wx;
        nearestY = wy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, nearestX, nearestY };
}

/**
 * Cells name their shade outright, the way the baked tables do, instead of being
 * thresholded into one — which is the whole difference between a paving and a
 * net of coloured lines.
 *
 * Going through `textureShadeAt`'s scatter path collapsed them: the interior
 * carried a value in [0.10, 0.24], and that path squares it before scaling, so
 * `1 + floor(4 * 0.24^2)` is 1 for *every* cell however the hash fell. Every
 * interior landed on the same shade and only the boundary ever climbed, so the
 * texture read as a wireframe. Here the cell's own hash picks a flat block from
 * the ramp, so a filled region reads as tiles of differing tone with grout
 * between them.
 *
 * The boundary takes the top shade and the interiors are dealt across
 * 0..shades-1, so one cell in every deal is the bare terrain. That is the layout
 * every generated geometry here follows — see JOINT_RANK. It was briefly inverted
 * to put the grout on the terrain colour and the cells on 1..shades, and reversed
 * back: cells was the texture that had it right first.
 *
 * This one names its own shade rather than going through `rankToShade`, because
 * its deal is sized by the cell count rather than by a fixed rank ladder.
 */
function cellsShade(
  x: number, y: number, seed: number, per: number, amount: number, shades: number
): number {
  const { f1, f2, nearestX, nearestY } = cellsAt(x, y, seed, per);
  // F2-F1 is small on a Voronoi boundary, and grows at roughly twice the rate of
  // the distance to it, so a grout line one output pixel wide is `f2 - f1` under
  // one pixel expressed in cell units. Testing the old soft field's `* mult < 1`
  // instead marked everything within 0.42 of a cell as boundary — 71% of the
  // tile at 2x2 and 92% at 4x4, which is a net with tiles between it rather than
  // tiles with a net between them.
  const cellPx = per / 32;
  const onBoundary = (f2 - f1) < cellPx * LINE_WIDTH_PX;
  // Interiors are dealt out evenly rather than hashed. A plain hash has to be *lucky* to cover
  // the ramp when there are only per^2 cells to draw from, and at 2x2 it draws
  // four times — measured, it produced nothing but shades 1 and 2, so half the
  // ramp went unused and the texture read as two-tone.
  //
  // The cell count is known, so the even split can just be constructed: step
  // through the cells by a stride coprime to their number (5 is coprime to 4, 9
  // and 16 alike) and cut that permutation into equal parts. Four cells then
  // take four distinct shades, nine split 3/2/2/2, sixteen split 4/4/4/4 — exact
  // at every size rather than near-uniform. The seed rotates where the deal
  // starts, so the dice still reshuffles which cell is which tone.
  const nCells = per * per;
  // Rank the current cell by its pseudo-random 2D hash score relative to all other cells.
  // This guarantees exact even split across shades while completely scattering colors
  // in 2D space without any vertical/horizontal/diagonal striping at any scale.
  const hashSalt = seed ^ 0x3c6ef3;
  const myScore = hash01(nearestX, nearestY, hashSalt);
  let dealt = 0;
  for (let cy = 0; cy < per; cy++) {
    for (let cx = 0; cx < per; cx++) {
      if (hash01(cx, cy, hashSalt) < myScore) dealt++;
    }
  }
  const rank = onBoundary ? shades : Math.floor((dealt * shades) / nCells);
  return Math.max(0, Math.min(shades, Math.round(rank * Math.min(1, amount))));
}

/**
 * Wrap into the tile before anything else looks at the coordinate. The two
 * geometric fields below are built on lattices rather than hashes, so this is
 * what makes their 16-periodicity structural instead of something to check:
 * negative and out-of-tile coordinates land on the same pixel by construction.
 */
const wrapN = (v: number, n: number) => ((v % n) + n) % n;

/**
 * Paving laid in running bond: 16x8 bricks with every other course half-dropped,
 * and the field reads as nearness to a joint. `amount` therefore behaves as
 * mortar weight — the joint lines appear first at low amounts and thicken from
 * there, rather than the surface filling with scatter.
 *
 * Both 16 and 8 divide 32 and the half-drop repeats every two courses, so the
 * pattern closes on the tile in both axes.
 *
 * The 1.5 falloff is load-bearing, not a taste call. It keeps a joint one crisp
 * line wide with a single soft pixel beside it, which is what leaves the
 * strongest shade rarer than the weakest — the sparsity test rejects the other
 * way round. Over the 32px period that is 184 pixels at full strength against
 * 840 below half.
 */
/**
 * Diagonal interlocking brick weave, traced from `assets/test3.png`.
 *
 * Baked rather than derived: four rhombic facets interlock around a shared
 * point with one of them outlined, and no field expression gets that — the
 * generator would have to encode the four orientations anyway, at which point
 * the table IS the cheaper description. It is a 16x16 tile already, which is
 * exactly the period everything here has to have.
 *
 * Each digit is the luminance RANK of the reference's five tones, 0 lightest.
 * That is what lets two picked colours reproduce the reference: rank 0 stays the
 * plain terrain colour and rank 4 is the texture colour at full strength.
 */
const WEAVE =
  '0032222222311300' +
  '0003222222233000' +
  '0004422222230000' +
  '0043342222300000' +
  '0433334223000000' +
  '4333333430000000' +
  '4333333340000003' +
  '1433333334000031' +
  '1143333333400311' +
  '1114333333343111' +
  '1113433333341111' +
  '1132243333411111' +
  '1322224334111111' +
  '3222222441111111' +
  '3222222231111113' +
  '0322222223111130';

/**
 * Cobbles2, traced from `wang_tiles/art/icons/cobb2.gif`. The source repeats
 * every 16 pixels in both directions, so it stays a small, fine brick texture
 * beside the larger 32px masonry patterns.
 */
const COBBLES2 =
  '3323322014332230' +
  '1222222122222221' +
  '1222221012222110' +
  '0111000001110000' +
  '3221143332202433' +
  '2221122222212222' +
  '2211122222101222' +
  '0010011011001111' +
  '1333232014213221' +
  '2222222112212221' +
  '1222221012211110' +
  '0110100000111000' +
  '3221033332201433' +
  '2221122222202222' +
  '2111022222101222' +
  '1000011110001111';

/** Brick Floor, traced from `wang_tiles/art/icons/brick45.gif`. It is a 16px
 * diagonal brick pattern, so it stays finer than the 32px masonry variants. */
const BRICK_FLOOR =
  '2222221043222222' +
  '2222220422322222' +
  '2222204332222222' +
  '2222042322222222' +
  '2220423223222222' +
  '2204322222222222' +
  '2042323222222222' +
  '0423222222222222' +
  '0322222222222220' +
  '2032222222222204' +
  '2203222222222043' +
  '3220322222220432' +
  '2222032222204222' +
  '2222203222042322' +
  '2222220320423222' +
  '2222222004232222';

/**
 * Three pavings traced from Guy Walker's Stagecast seamless-pattern gallery
 * (mirrored at boristhebrave.com/permanent/24/06/cr31/stagecast/wang/patts.html),
 * sources `art/patt/paving2.gif`, `art/icons/cu1.gif`, `art/patt/pav5.gif`.
 *
 * Same encoding as WEAVE — luminance rank, 0 lightest — but 32x32, because the
 * art is. See PERIOD_32 for why that is allowed and what it costs.
 *
 * The rank is ordinal, so it flattens hue differences the source drew with: in
 * `paving3` two faces sit 0.8 luminance apart (#f79779 against #e79f64) and are
 * told apart only by rarity, the 68-pixel tone taking the deeper rank because a
 * sparse tone in pixel art is shading rather than a face. On a one-dimensional
 * ramp they land on adjacent steps instead of reading as two colours.
 */
const PAVING =
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '22222222224222222222241111111114' +
  '44444444444222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333400004222222222241111111114' +
  '33333444444444444444441111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '33333422222222224000041111111114' +
  '44444422222222224444444444444444' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222422222222224333333333422222' +
  '22222444444444444444444444422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '22222400004111111111111111422222' +
  '44444444444111111111111111444444' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224111111111111111400004' +
  '22222222224444444444444444444444';

const PAVING3 =
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '44444443000000000000000344444444' +
  '11111134300000000000003431111114' +
  '11111113430000000000034311111114' +
  '11111111343000000000343111111114' +
  '11111111134300000003431111111114' +
  '11111111113430000034311111111114' +
  '11111111111343000343111111111114' +
  '11111111111134303431111111111114' +
  '11111111111113434311111111111114' +
  '11111111111111343111111111111114' +
  '11111111111113434311111111111114' +
  '11111111111134303431111111111114' +
  '11111111111343000343111111111114' +
  '11111111113430000034311111111114' +
  '11111111134300000003431111111114' +
  '11111111343000000000343111111114' +
  '11111113430000000000034311111114' +
  '11111134300000000000003431111114' +
  '44444443000000000000000344444444' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222240000000000000000042222222' +
  '22222244444444444444444442222222';

const PAVING5 =
  '44444444444222222222241111111111' +
  '43333333334222222222241111111111' +
  '33333333333422222222241111111114' +
  '33333333333422222222241111111114' +
  '33333333333342222222241111111143' +
  '33333333333342222222444111111143' +
  '33333333333342222444000444111143' +
  '33333333333334444000000000444433' +
  '43333333334444000000000000000444' +
  '24443334441114000000000000000422' +
  '22224441111111400000000000004222' +
  '22222411111111400000000000004222' +
  '22222411111111140000000000042222' +
  '22222411111111140000000000042222' +
  '22222411111111140000000000042222' +
  '22222411111111114000000000422222' +
  '22222411111111114444444444422222' +
  '22222411111111114333333333422222' +
  '22222411111111143333333333342222' +
  '22222411111111143333333333342222' +
  '22222411111111143333333333342222' +
  '22222411111111433333333333334222' +
  '22224441111111433333333333334222' +
  '24440004441114333333333333333422' +
  '40000000004444333333333333333444' +
  '00000000000004444333333333444400' +
  '00000000000042222444333444111140' +
  '00000000000042222222444111111140' +
  '00000000000042222222241111111140' +
  '00000000000422222222241111111114' +
  '00000000000422222222241111111114' +
  '40000000004222222222241111111111';

/**
 * Stone Floor, traced from `wang_tiles/art/icons/floor2.gif` in the mirrored
 * Stagecast seamless-pattern gallery. The source uses sixteen grey tones; they
 * are reduced to five luminance ranks so the user-selected texture ramp can
 * colour the same irregular slabs and dark joints.
 */
const STONE_FLOOR =
  '22444444443334201344441013444310' +
  '43222223322222303322232023212240' +
  '42222222222222303222333122222240' +
  '42122222222222413222234142222240' +
  '41222222222222413222332133222241' +
  '44323333222223302222234132322241' +
  '23444444434443102332234143322341' +
  '00011111111110003332233143222341' +
  '14443333344222103322224043223241' +
  '43222211222222214222234033223331' +
  '42222212222222313222224033222231' +
  '43212222222222312233324013333331' +
  '42322222222222314223234123333340' +
  '43232222222233303233333024333240' +
  '43444444434443101423341023444320' +
  '00000011011110000111100000000000' +
  '12444410134433102243323443333420' +
  '43322310432221303332222332222241' +
  '43212210432221204233222222222241' +
  '42122221432222204222112233223341' +
  '31123231332222214222221133233341' +
  '32221231322222214432323323333430' +
  '33322241432212312344444443332210' +
  '33322231422123410001111111100000' +
  '42221240421232211444333333143310' +
  '42112340321122114322223333332221' +
  '43112240332212314223233333232231' +
  '42223240322212314322223332233331' +
  '42332341232232404232233322223231' +
  '33333330143332404322333233333330' +
  '14233420234443203344344443444320' +
  '01111000000000000000111001111000';

/**
 * Breeze Block and Brick Wall, traced from the corresponding 32x32 tiles in
 * `wang_tiles/art/icons/brick2.gif` and `brick.gif`. Both are already seamless
 * source patterns; the eight and seven source tones are reduced to the same
 * five-rank ramp used by the other masonry textures.
 */
const BREEZE_BLOCK =
  '00000000000000000000000000000000' +
  '33333333333333333333333332044333' +
  '33333333333333333333333322043333' +
  '33333333333333333333333322033333' +
  '33333333333333333333333322033333' +
  '33333333333333333333333322033333' +
  '33333333333333333333333322033333' +
  '33233333333333333333333322033333' +
  '23333333333333333332333322033333' +
  '33333332333323332333333322033333' +
  '33333333333333333333332322033323' +
  '23323333323333333332333322033333' +
  '33323323333322333333323322033333' +
  '22332333333332232323333322033333' +
  '22222222222222222222222211032222' +
  '22222222222222222222222211022222' +
  '00000000000000000000000000000000' +
  '33333333320443333333333333333333' +
  '33333333220433333333333333333333' +
  '33333333220333333333333333333333' +
  '33333333220333333333333333333333' +
  '33333333220333333333333333333333' +
  '33333333220333333333333333333333' +
  '33333333220333333323333333333333' +
  '33323333220333332333333333333333' +
  '23333333220333333333333233332333' +
  '33333323220333233333333333333333' +
  '33323333220333332332333332333333' +
  '33333233220333333332332333332233' +
  '23233333220333332233233333333223' +
  '22222222110322222222222222222222' +
  '22222222110222222222222222222222';

const BRICK_WALL =
  '00000000000000000000000000000000' +
  '33333333330433333333333333043333' +
  '33333333320333333333333332033333' +
  '33333333220333323333333322033332' +
  '33332333320333233333233332033323' +
  '33313312320331323331331232033132' +
  '12311331120331131231133112033113' +
  '11111111110111111111111111011111' +
  '00000000000000000000000000000000' +
  '33043333333333333304333333333333' +
  '32033333333333333203333333333333' +
  '22033332333333332203333233333333' +
  '32033323333323333203332333332333' +
  '32033132333133123203313233313312' +
  '12033113123113311203311312311331' +
  '11011111111111111101111111111111' +
  '00000000000000000000000000000000' +
  '33333333330433333333333333043333' +
  '33333333320333333333333332033333' +
  '33333333220333323333333322033332' +
  '33332333320333233333233332033323' +
  '33313312320331323331331232033132' +
  '12311331120331131231133112033113' +
  '11111111110111111111111111011111' +
  '00000000000000000000000000000000' +
  '33043333333333333304333333333333' +
  '32033333333333333203333333333333' +
  '22033332333333332203333233333333' +
  '32033323333323333203332333332333' +
  '32033132333133123203313233313312' +
  '12033113123113311203311312311331' +
  '11011111111111111101111111111111';

// Water has three source tones: 0 is the blue body, 2 is the bright-blue line,
// and 4 is the small pale/white dot. The line is the only editable layer; the
// dot stays a fixed pale accent while the body follows the terrain colour.
const WATER =
  '00000002200000002222000202222000' +
  '00000020020000222000222000002200' +
  '00002220002244000000002200000222' +
  '22244000000002000000002000000002' +
  '00002400000002000000220200000020' +
  '00000200000222200042020240000020' +
  '00000222242000222200000004422220' +
  '20022022024000000200000022000022' +
  '42200000002000000200000020000000' +
  '24000000002000000200002220000000' +
  '00200000002000022000000020000002' +
  '00022022222222220420020020000002' +
  '00000220000020000042200002240002' +
  '00042200000020000002000000024422' +
  '22220000000200000002000000022002' +
  '00022220002400000002200022220000' +
  '00002022222220000024022200020000' +
  '00022000000022000020000000022000' +
  '22200000000002222220000000200222' +
  '00220000000020000020000000200000' +
  '00022244222220000020000000200000' +
  '02200000000024000240000002222200' +
  '22000000000022222204222220000222' +
  '00000000000020000000200000000004' +
  '40000000004220000000220000000002' +
  '22220222222200000000020000000002' +
  '00002200000200000000002200000020' +
  '00002000000020400000244022224220' +
  '00002000000022022222222000002400' +
  '00244000000020020000002000000200' +
  '22202440002200020000000200000222' +
  '00000020022000024000000220002200';

export const WATER_DOT_COLOUR = { r: 215, g: 215, b: 215 };

/** Field, traced from `wang_tiles/art/seamless/field.gif`. */
const FIELD =
  '02444434432222432222224300000310' +
  '03432003442222332222223000002432' +
  '43200002442223442222333100003444' +
  '10000000443344443344444431024444' +
  '10000000344102334444313444334444' +
  '30000000143000001343111234444444' +
  '41000000033000000442111112344444' +
  '43000000241000001431111111343234' +
  '44100134440000003411111113442223' +
  '34313444431000003421111114422222' +
  '23444431344321014443211134222222' +
  '22443211134444334444431243222222' +
  '23442111124444444322443444222222' +
  '44443111113423442222344444422222' +
  '44444311234222342222244334442224' +
  '31444423442222233222244211134344' +
  '00344444422222224223444111134331' +
  '00044444432222234444444111134100' +
  '00024222234222343344444111134300' +
  '00024222234423440012344333344400' +
  '02344222234444430000001344444420' +
  '34444222234444430000000344213442' +
  '44444333333134410000001444111134' +
  '34444444321124410000002442111111' +
  '34423443111113300000003431111111' +
  '44222343111112310000003421111113' +
  '42222234311111343321014411111114' +
  '22222223411123444444334433111134' +
  '32222224431344443322244444321144' +
  '43222244444444422222234443443344' +
  '24322444443323422222234420244441' +
  '00434444432222422222224400002420';

/** Rubble, traced from `wang_tiles/art/icons/rubble.gif`. */
const RUBBLE =
  '44422224422222242220000000222422' +
  '22244442200000024220000000244200' +
  '02222422000000024220000002422000' +
  '00022422000000002420000002420000' +
  '00022422000000002422000024220000' +
  '00002422200000002422000224220000' +
  '00002244222000002422202242200000' +
  '00000222422220022242222422200000' +
  '00000222244222222224224222200000' +
  '00000022422422220002442442200000' +
  '00000222422242200000222224200000' +
  '00000224220224200000002222420000' +
  '00002242200024220000000022420000' +
  '00022422000002422200000002422000' +
  '02224220000000244220000022422200' +
  '22242222000000022422222224222222' +
  '44444442000000002244444442444444' +
  '22222224200000224422222422222222' +
  '22222222422002442220022422220000' +
  '00000022244224222220022422200000' +
  '00000000222444222200002422000000' +
  '00000000022222422000002242200000' +
  '00000000000222242000000242200000' +
  '00000000000022242000000242200000' +
  '00000000000002242200000242220000' +
  '00000000000002242200000224220000' +
  '00000000000000242200000024222000' +
  '00000000000000224200000022422200' +
  '00000000000002224220000000242220' +
  '20000000000022224220000000224222' +
  '22222200022224424220000000022422' +
  '22222222244442242220000000222244';

/** Every baked table so far tops out at rank 4; `shades` rescales onto the caller's ramp. */
const BAKED_RANKS = 4;

/**
 * Baked art names its shade outright instead of being thresholded into one: the
 * tones are already a ramp, so `amount` scales that ramp — full pattern at 1,
 * flattening toward the bare terrain as it drops.
 *
 * `size` is the table's own edge length, which is also its output-pixel period,
 * so the seed offset has to wrap at `size` rather than at 16 — offsetting a
 * 32-wide table by a 0..15 amount would sample the wrong half of it.
 *
 * `jointAtZero` rotates the ladder for the tables whose mortar was traced onto
 * rank 0 — see JOINT_AT_RANK_0.
 */
function bakedShade(
  table: string,
  size: number,
  x: number,
  y: number,
  seed: number,
  amount: number,
  shades: number,
  jointAtZero: boolean = false
): number {
  // The shift stays at 4 rather than widening with `size` so that weave, the
  // table this generalises, keeps the exact seed-to-offset mapping its locked
  // sheet hashes were taken with.
  const m = size - 1;
  const px = wrapN(x + (seed & m), size);
  const py = wrapN(y + ((seed >>> 4) & m), size);
  const raw = table.charCodeAt(py * size + px) - 48;
  return rankToShade(jointAtZero ? wrapN(raw - 1, BAKED_RANKS + 1) : raw, amount, shades);
}

/**
 * The traced tables whose MORTAR sits on rank 0 rather than on rank 4, and which
 * therefore need the ladder rotated one step to meet the shared rule: joint on the
 * top shade, one face left as the bare terrain, the rest between.
 *
 * Rotation rather than reversal, `rank -> (rank - 1) mod 5`, so 0 wraps to the top
 * and every face steps DOWN one. That is what preserves the art's own light-to-dark
 * ordering — a reversal would put each brick's highlight where its shadow was.
 *
 * Which tables belong here was measured, not read off the encoding: for each of
 * these five, rank 0 is a pure one-pixel line (no 2x2 block of it anywhere) while
 * every other rank is a region. `weave` looks like it belongs and does not — its
 * rank 0 is 63% solid, i.e. a face, and its outline is already on rank 4. The
 * three Stagecast pavings are already the right way up too.
 */
const JOINT_AT_RANK_0: readonly TextureId[] = [
  'brick_wall', 'cobbles2', 'brick_floor', 'breeze_block', 'stone_floor',
];

/**
 * The 0..4 rank ladder mapped onto the caller's shade count.
 *
 * The top rank is handled apart from the rest, and that is the whole point: it is
 * the joint, and the joint has to stay on the top shade at every shade count. The
 * plain proportional map put rank 3 and rank 4 both on shade 2 when there were
 * only two shades, so a face came out the same colour as the line separating it
 * from its neighbour. Ranks 0..3 are therefore squeezed into 0..shades-1 and the
 * top shade is left for rank 4 alone.
 *
 * At 4 shades this is arithmetically identical to the proportional map it
 * replaces, at every `amount` — which is why no locked sheet hash moves.
 */
function rankToShade(rank: number, amount: number, shades: number): number {
  const a = Math.min(1, amount);
  const clamp = (k: number) => Math.max(0, Math.min(shades, k));
  if (rank >= BAKED_RANKS) return clamp(Math.round(shades * a));
  return Math.min(shades - 1, clamp(Math.round((rank * (shades - 1) * a) / (BAKED_RANKS - 1))));
}

// --- generated geometric pavings --------------------------------------------
// `isometric` and `octagonal` were traced 32x32 tables until their geometry was
// solved: both are now generated from a formula that reproduces those tables
// BYTE FOR BYTE at the original size, which is what makes a size control safe to
// add — the default cannot drift, and the test holds the old tables as the
// oracle. `hexagon` resisted the same treatment; see the note on HEXAGON.
//
// Both are 32-periodic at every size offered, because the motif count per axis
// divides 32.

/**
 * Motif sizes offered for the generated pavings, as the number of motifs across
 * the 32px tile. 1 is the traced original.
 *
 * Only divisors of 32 that keep the motif an even number of pixels across are
 * offered: `octagonal` compares integer distances against its cell half-width,
 * which a fractional cell would never hit, and the shared edge line it draws
 * once per cell would land between pixels.
 */
export const GEO_SCALES: readonly { id: number; zh: string; en: string }[] = [
  { id: 1, zh: '32px · 原尺寸', en: '32px — original' },
  { id: 2, zh: '16px', en: '16px' },
  { id: 4, zh: '8px', en: '8px' },
  { id: 8, zh: '4px', en: '4px' },
];
export const DEFAULT_GEO_SCALE = 1;

/** Whether a texture takes the motif-size control. */
export function textureUsesGeoScale(texture: TextureId): boolean {
  return texture === 'isometric' || texture === 'isometric_grid' || texture === 'octagonal'
    || texture === 'square' || texture === 'nonslip' || texture === 'hexagon'
    || texture === 'brick_bond';
}

/**
 * The size a texture was authored at, which is the one it opens on.
 *
 * The control is shared between the generated pavings, but they were not all
 * drawn at the same size: `nonslip` is an 8px grip plate and the rest are 32px
 * pavings. Without this, selecting nonslip while the control sat at 32px would
 * show it four times coarser than the art it came from and look nothing like it.
 */
export function naturalGeoScale(texture: TextureId): number {
  // brick_bond opens on 16x8 bricks, the proportions of the traced BRICK_WALL.
  if (texture === 'brick_bond') return 2;
  // square and octagonal open one size down from their 32px original, because at
  // 32 the period holds a single motif and there is nothing for the deal to deal:
  // square shows one tile in one shade with its joint falling on the sheet's own
  // seam, and octagonal shows one octagon plus one corner square, so two of the
  // four swatches grey out on arrival. At 16 both lay out the full four. The 32px
  // size is still offered — it is a legitimate large plain flag, just a poor
  // first impression of what the texture is.
  if (texture === 'square' || texture === 'octagonal') return 2;
  return texture === 'nonslip' ? 4 : DEFAULT_GEO_SCALE;
}

/**
 * The sizes offered for a texture.
 *
 * `nonslip` stops at its natural 8px because its motif is built on an 8px cell —
 * the dash length, the gap and the two dash positions are all whole multiples of
 * an eighth of it, and at 4px they would land on half pixels. It scales UP only.
 */
export function geoScalesFor(texture: TextureId): readonly { id: number; zh: string; en: string }[] {
  // nonslip's motif is built on an 8px cell in whole eighths; hexagon's smallest
  // useful cell is 5x4px, and halving that again leaves 2px of hexagon under a
  // 1px outline, which is all outline and no face.
  // brick_bond stops at 8x4 bricks: one row of bed joint plus the two bevel rows
  // is three of the four, and halving again leaves no face at all.
  // isometric_grid stops at an 8x4 cube: measured at 4x2, the outline swallows
  // the left and right facets outright — 768 of 1024 pixels came out outline and
  // the only face left was the top, so two of its three shades painted nothing.
  return texture === 'nonslip' || texture === 'hexagon' || texture === 'brick_bond'
    || texture === 'isometric_grid'
    ? GEO_SCALES.filter((g) => g.id <= 4)
    : GEO_SCALES;
}

/**
 * Non-slip grip plate: two short diagonal dashes per cell, one running down-left
 * and one down-right, each a 2px dark core with a 1px shadow on its
 * perpendicular-DOWN side. Both shadows point down, i.e. one light direction for
 * the pair, which is what makes them read as a chevron pressed into metal rather
 * than two unrelated strokes.
 *
 * Reproduces the traced 8x8 art byte for byte at its natural size — see the
 * oracle test. Everything is expressed in `u`, the cell size in eighths, and the
 * LINE WEIGHT DELIBERATELY DOES NOT SCALE WITH IT: the core stays 2px and the
 * shadow 1px, and only the dash length and spacing grow. Both ways were rendered
 * before choosing; scaling the weight too turns the 32px size into coarse
 * diagonal wedges that no longer read as grip, and makes the dash's end cap a
 * block instead of a taper.
 *
 * The four shades each mean one thing, so every picker is worth using:
 *
 *   1  shadow of the down-LEFT dash
 *   2  shadow of the down-RIGHT dash
 *   3  core of the down-left dash
 *   4  core of the down-right dash
 *
 * Cores on the strong end and shadows on the weak end, with the direction picking
 * which of the pair — so setting 1 and 2 alike, and 3 and 4 alike, gives the plain
 * two-tone plate, and pulling them apart tells the two dash directions apart. The
 * plate itself is rank 0, the bare terrain: this is a surface with grip pressed
 * into it, not a surface laid on top of the terrain.
 *
 * `amount` is the DASH LENGTH, i.e. the gap between one dash and the next along
 * its own run. The cell size cannot carry that job — it has to divide 32 for the
 * texture to tile, so it only offers 8, 16 and 32 — and it is already spoken for
 * by the motif-size control. At 1 the dash fills its half of the cell, which is
 * the traced art; below that it shortens and the plate shows between the dashes.
 * This is the one texture where the density slider means something, so it is the
 * one that still shows it.
 *
 * THE TAIL CAP AND THE SHADOW'S OVERHANG ARE A CONSTANT PIXEL, not a multiple of
 * `u`. They are the rounding on the end of a stroke, and a stroke drawn with the
 * same 2px nib at every size has the same rounding at every size — at 32px the
 * old `4u`/`7u` bounds gave it a four-pixel overhang, which read as a wedge glued
 * to the end of each dash rather than as a tapered tip.
 */
export function nonslipRank(x: number, y: number, n: number, amount: number = 1): number {
  // Cell = 8u px. u = 1 is the traced art; n is motifs across the 32px tile.
  const u = Math.max(1, Math.round(4 / n));
  const S = 8 * u;
  const inR = (v: number, lo: number, hi: number) => {
    const w = wrapN(v, S);
    return w >= lo && w <= hi;
  };
  const s = x + y;      // constant along the down-left dash
  const d = x - y;      // constant along the down-right dash
  const ax = wrapN(x, S);

  // Core length along x, in pixels. 3u is the traced art; the cap needs the one
  // pixel after it, so it stops at 4u - 1 and the dash never runs into its
  // neighbour in the cell's other half.
  const core = Math.max(1, Math.min(4 * u - 1, Math.round(3 * u * Math.min(1, amount))));

  // Dash A, down-left, in the cell's left half: 2px core, 1px shadow one step
  // further down-right, and a cap one pixel past the head that rounds the tail.
  if (inR(s, 2 * u, 2 * u + 1) && ax <= core - 1) return 3;
  if (inR(s, 2 * u + 2, 2 * u + 2) && ax <= core) return 1;
  if (inR(s, 2 * u + 1, 2 * u + 2) && ax === core) return 1;

  // Dash B, down-right, in the right half. Its core straddles d = 0, so the range
  // wraps and is tested as two pieces; its shadow sits at d = -2, i.e. down-LEFT,
  // which is the same downward side relative to this dash's own direction.
  const coreB = inR(d, S - 1, S - 1) || inR(d, 0, 0);
  if (coreB && ax >= 4 * u && ax <= 4 * u + core - 1) return 4;
  if (inR(d, S - 2, S - 2) && ax >= 4 * u && ax <= 4 * u + core - 1) return 2;
  if (coreB && ax === 4 * u + core) return 2;

  return 0;                                   // the plate: the bare terrain
}

/**
 * THE LAYOUT EVERY GENERATED GEOMETRY FOLLOWS (settled 2026-08-09).
 *
 *   rank 4, the top shade   the joint between tiles, fixed
 *   rank 0                  one face, left as the bare terrain colour
 *   ranks 1..3              the remaining faces
 *
 * So a picked palette reads outward from the terrain: the ground shows through
 * one tile in every deal, the others step up from it, and the strongest colour is
 * spent on the line that separates them. `rankToShade` maps rank 4 onto whatever
 * the current shade count is, so the joint is the top shade at 2 shades or at 4.
 *
 * This is the second arrangement tried. The first had it the other way up — joint
 * on the bare terrain, faces on 1..4 — and it was reversed deliberately: a joint
 * drawn in the ground colour reads as a gap rather than as grout, and the four
 * pickers then had no way to set the line itself.
 *
 * `FACE_RANKS` is how many face slots that leaves, and the whole file counts
 * faces against it.
 */
const JOINT_RANK = 4;
const FACE_RANKS = 4;   // ranks 0..3

/**
 * The rank a geometric FACE takes, 0..3, so a face is always a flat block of one
 * colour and the ramp is dealt out rather than left to luck.
 *
 * At seed 0 it is the 2x2 cell parity, which fills all four slots on any lattice
 * with at least two cells per axis inside the 32px period. A lattice with fewer —
 * `square` and `octagonal` at their 32px size fit exactly one cell — reaches only
 * as many as it has faces, and the panel greys the rest out on its own via
 * `usedTextureShades`.
 *
 * At any other seed the cell hashes instead, so the dice reshuffles which face is
 * which tone without ever leaving the range.
 */
function dealFaceRank(cellX: number, cellY: number, seed: number): number {
  if (seed === 0) return wrapN(cellX, 2) + 2 * wrapN(cellY, 2);
  return Math.floor(hash01(cellX, cellY, seed ^ 0x9e3779b9) * FACE_RANKS);
}

/**
 * Plain square paving: a one-pixel grout line, and flat tile faces.
 *
 * The grout is drawn on two sides of each cell rather than four, so neighbours
 * share it instead of doubling it up.
 *
 * The face lattice IS the grout lattice. It used to be forced to 16px at the
 * largest motif size, which dealt four tints inside one 32px square with no
 * grout between them — it read as a single big tile smeared with four colours
 * rather than as four tiles. A 32px square cannot be four-toned and stay
 * seamless: the period has to divide 32, so there is room for exactly one of
 * them, and the other three swatches correctly grey out.
 */
function squareRank(x: number, y: number, n: number, seed: number = 0): number {
  const S = 32 / n;
  // Distance to the nearest grout line, in pixels: 0 on the grout itself.
  const toGrout = (v: number) => {
    const u = wrapN(v, S);
    return Math.min(u + 1, S - 1 - u);
  };
  const e = Math.min(toGrout(x), toGrout(y));
  if (e === 0) return JOINT_RANK;

  return dealFaceRank(Math.floor(x / S), Math.floor(y / S), seed);
}

/**
 * The rank an isometric diamond takes — NOT the shared `dealFaceRank`, because
 * this lattice does not line up with the 32px period the way a square one does.
 *
 * Going 32px right is `(cellX, cellY) -> (cellX + n, cellY + n)` and going 32px
 * down is `-> (cellX + 2n, cellY - 2n)`. A deal keyed on the cell parity is
 * therefore NOT invariant across a horizontal seam at odd n: one diamond comes out
 * two different colours depending on which side it was reached from, with no
 * outline between the halves because it is a single diamond. Measured at the
 * default size, a five-pixel strip either side of every vertical seam.
 *
 * This is the same failure hexagon carries the `floor(bc / 2)` term for. The fix
 * here is to key on `cellX - cellY`, which the horizontal shift leaves alone and
 * the vertical shift moves by 4n — so taking it mod 4 is invariant under both, at
 * every size, and still separates all four diamonds. Edge-sharing neighbours are
 * `(cellX +- 1, cellY)` and `(cellX, cellY +- 1)`, which all move it by one, so no
 * two touching faces collide.
 */
function isoFaceRank(cellX: number, cellY: number, n: number, seed: number): number {
  const a = wrapN(cellX - cellY, 4 * n);
  if (seed === 0) return wrapN(a, FACE_RANKS);
  // The hash needs a seam-invariant key too. `cellX + cellY` is left alone by the
  // vertical shift and moved by 2n by the horizontal one.
  return Math.floor(hash01(a, wrapN(cellX + cellY, 2 * n), seed ^ 0x9e3779b9) * FACE_RANKS);
}

/**
 * Isometric rhombi: two interleaved sets of diamond centres with the shared
 * boundary inked as rank 0, i.e. the bare terrain colour, and each diamond a flat
 * block of one shade.
 */
export function isometricRank(x: number, y: number, n: number, seed: number = 0): number {
  const W = 16 / n;
  const H = 8 / n;

  const u = x / W;
  const v = y / H;

  const cellX = Math.floor((u + v) / 2);
  const cellY = Math.floor((u - v) / 2);

  const centerX = (cellX + cellY + 1) * W;
  const centerY = (cellX - cellY) * H;

  const dx = Math.abs(x - centerX);
  const dy = Math.abs(y - centerY);

  const distInPixels = dx * H + dy * W;
  const maxDist = W * H;

  // The joint between diamonds, on the top shade like every other geometry here.
  if (distInPixels >= maxDist - Math.max(1, H)) return JOINT_RANK;

  return isoFaceRank(cellX, cellY, n, seed);
}

/**
 * 3D isometric cube grid: top, left and right facets, with the shared diamond
 * boundary inked as rank 0, i.e. the bare terrain colour.
 *
 * THREE faces, so three shades — a cube has no fourth side to give the fourth
 * one to, and the panel greys that swatch out. They are dealt lightest-facing-up:
 * top 3, right 2, left 1, which is the one arrangement that reads as a solid lit
 * from above rather than as three unrelated rhombi.
 *
 * The seed used to nudge each cube's facets a step up or down the ramp. It was
 * dropped: a cube whose three faces are 2/3/4 sitting beside one at 1/2/3 stops
 * reading as the same material, and it was the only thing here that could reach
 * shade 4 — so the swatch was live but only at some seeds, which is exactly the
 * silent-dead-control problem the grey-out exists to prevent. The seed still
 * moves the lattice's phase through `geoShade`.
 */
export function isometricGridRank(x: number, y: number, n: number): number {
  const W = 16 / n;
  const H = 8 / n;

  const u = x / W;
  const v = y / H;

  const cellX = Math.floor((u + v) / 2);
  const cellY = Math.floor((u - v) / 2);

  const centerX = (cellX + cellY + 1) * W;
  const centerY = (cellX - cellY) * H;

  const dx = Math.abs(x - centerX);
  const dy = Math.abs(y - centerY);

  const distInPixels = dx * H + dy * W;
  const maxDist = W * H;

  if (distInPixels >= maxDist - Math.max(1, H)) return JOINT_RANK;   // the cube's outline

  const relX = x - centerX;
  const relY = y - centerY;

  // Lit from above: the top face is the strongest of the three, and the left one
  // is left as the bare terrain. Rank 3 goes unused — a cube has no fourth side —
  // and the panel greys that swatch out.
  if (relY < 0 && Math.abs(relX) < W * (1 - Math.abs(relY) / H)) return 2;  // top
  return relX < 0 ? 0 : 1;                                                  // left / right
}

/**
 * Chamfered square tiles: an octagon face, a small square in the gap between
 * four of them, and a two-tone bevel on the diagonal.
 *
 * The cell centre sits at `S/2 - 1` rather than at `S/2 - 0.5`, which is what
 * puts the straight edge on a whole pixel line at the cell boundary instead of
 * between two pixels. Adjacent octagons therefore share one inked edge, drawn
 * once by the cell on its far side — that asymmetry is in the traced art and is
 * why the edge is tested separately from the chamfer.
 */
/**
 * Running-bond brick, generated, and INVERTED relative to every other paving
 * here: the brick face is rank 0, i.e. the bare terrain colour, and all four
 * shades go to the things drawn on top of it. That is what was asked for — the
 * brick is the ground, and the ramp paints the joints and the bevel.
 *
 * The four shades each mean one thing, so the per-step colour pickers are worth
 * using:
 *
 *   1  highlight along the brick's top edge, inside the brick
 *   2  shadow along its bottom edge, inside the brick
 *   3  the bed joint — the horizontal mortar between courses
 *   4  the head joint — the vertical mortar, a step deeper than the bed
 *
 * Giving the two joint directions different steps is what makes the wall read as
 * having depth rather than as a flat grid; set 3 and 4 to the same colour for
 * uniform mortar. The bed joint wins at a T-junction, which is what the traced
 * BRICK_WALL does too (its horizontal mortar rows run unbroken).
 *
 * Proportions follow the traced art: bricks are 2:1, and each course is offset by
 * half a brick. Everything scales with the motif size, and the bed joint plus the
 * two bevel rows are why the smallest offered brick is 8x4 — at 4x2 there is one
 * row of joint and one row of brick, with nowhere to put the bevel.
 */
export function brickBondRank(x: number, y: number, n: number): number {
  const bw = 32 / n;        // brick width
  const bh = 16 / n;        // brick height, joint included
  const course = Math.floor(y / bh);
  const ry = wrapN(y, bh);
  // Every other course starts half a brick along; that half is a whole number of
  // pixels at every offered size, so the head joints stay on the pixel grid.
  const vx = wrapN(x - wrapN(course, 2) * (bw / 2), bw);

  if (ry === 0) return 3;               // bed joint, unbroken across the course
  if (vx === 0) return 4;               // head joint
  // The top highlight is dropped once the brick is too short to carry it: at 8x4
  // the joint, the highlight and the shadow would be three of the four rows and
  // the brick would be all bevel and no face. Leaving it off there is what a
  // pixel artist does at that size, and it is why shade 1 goes unused on the
  // smallest brick — the picker greys it out on its own.
  if (ry === 1 && bh >= 5) return 1;    // top highlight
  if (ry === bh - 1) return 2;          // bottom shadow
  return 0;                             // brick face: the terrain colour
}

/**
 * The four hexagon face tones, indexed by column and row parity.
 *
 * The traced art used three, with one tone taking two of the four slots. All
 * four are distinct now, which is what puts a hexagon on the same footing as a
 * square or a rhombus: one flat shade per face, every swatch live. No two
 * neighbours collide — a step in the row flips the second index, a step in the
 * column flips the first, and the diagonal neighbour flips both.
 */
const HEX_FACES: readonly (readonly number[])[] = [[0, 1], [2, 3]];

/** Half-width of the hexagon outline, in output pixels. */
const HEX_EDGE_HALF = 0.5;

/**
 * Regular hexagons, three-toned — the same nearest-cell-plus-wall-distance model
 * as the rest of the generated pavings.
 *
 * The only one of them that is NOT byte-exact against its traced table, and
 * deliberately so. The traced art ran a ring of "tip" pixels along each
 * hexagon's slanted edges, one shade off the face and placed by hand; no
 * distance rule reproduces them (the best fit left 131 of 1024 pixels wrong and
 * plateaued there, which is why hexagon was skipped the first time round).
 * Merging those tips into the edge line is what puts it on the same model as the
 * others.
 *
 * Measured against the traced art WITH the tips merged, this differs on 32 of
 * 1024 pixels and the difference is benign in a way worth recording: every one is
 * outline-versus-face, never face-versus-face, and the tone census is IDENTICAL
 * (140 outline / 221 / 221 / 442) — 16 pixels swapped each way. All that differs
 * is which of two adjacent pixels a diagonal step lands on: the traced edge
 * climbs in an irregular 1,1,2,2,1,2,2 stair while this one alternates evenly,
 * and for a texture called "regular hexagons" the even one is arguably righter.
 */
export function hexagonRank(x: number, y: number, n: number): number {
  const step = 16 / n;      // pitch between columns, and between rows in a column
  const stagger = 8 / n;    // how far each column is dropped relative to the last
  const ox = 10 / n;
  const oy = 8 / n;

  // Derive the candidate cells from the pixel rather than scanning a fixed range
  // around the origin: at the finest size the cells are 4px and a fixed range
  // covers a few pixels of the tile, leaving the rest with no candidate at all
  // and painting most of the sheet as solid outline.
  const c0 = Math.round((x - ox) / step);
  let bestD = Infinity;
  let bc = 0;
  let br = 0;
  let bx = 0;
  let by = 0;
  for (let c = c0 - 1; c <= c0 + 1; c++) {
    const r0 = Math.round((y - oy - stagger * c) / step);
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const cx = ox + step * c;
      const cy = oy + stagger * c + step * r;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        bc = c; br = r; bx = cx; by = cy;
      }
    }
  }

  // Distance to the nearest of the six walls, in output pixels.
  const nb: readonly (readonly [number, number])[] = [
    [step, stagger], [-step, -stagger], [0, step], [0, -step],
    [step, stagger - step], [-step, step - stagger],
  ];
  let edge = Infinity;
  for (const [nx, ny] of nb) {
    const d = ((nx * nx + ny * ny) / 2 - ((x - bx) * nx + (y - by) * ny)) / Math.hypot(nx, ny);
    if (d < edge) edge = d;
  }
  if (edge < HEX_EDGE_HALF) return JOINT_RANK;

  // NOT indexed by the row parity directly. Moving 32px right is
  // (c, r) -> (c + 2, r - 1), so r's parity flips and one hexagon would come out
  // two different colours depending on which side of a seam it was reached from —
  // measured as 52 wrongly coloured pixels before the floor(c/2) term was added.
  return HEX_FACES[wrapN(bc, 2)][wrapN(br + Math.floor(bc / 2), 2)];
}

/**
 * Chamfered square tiles: an octagon face, and a small square in the gap where
 * four of them meet.
 *
 * The SILHOUETTE is the traced art's, pixel for pixel — which pixels are line and
 * which are face is unchanged, and the oracle test still pins that. What changed
 * is the shading, and it changed in two ways:
 *
 *   - The traced art gave every octagon the same tone, so three of the four
 *     swatches were doing nothing (one drew the corner square, one drew a bevel,
 *     and one was unreachable). Octagons are now dealt across the ramp by cell,
 *     like every other paving here.
 *   - Its inner chamfer ring was a second, darker line just inside the outline.
 *     A one-pixel ring is not a face, and with the octagons dealt across the ramp
 *     it would collide with whichever face landed on its tone. It is merged into
 *     the face, which is what leaves the outline exactly one pixel wide.
 *
 * The corner square is a tile in its own right, so it takes a face rank too — the
 * last one, fixed, with the octagons dealing across the other three. That split is
 * forced, not a preference: a square sits where four cells meet, so its four
 * neighbours cover all four parities at once. Dealt from the same pool of four it
 * would ALWAYS match one of them and merge into it, whatever offset it was given
 * — measured at 16px, where the square landed on the same shade as the octagon
 * up and to its left.
 *
 * Three ranks over a 2x2 parity means one of them is used twice. It is placed on
 * the DIAGONAL pair, which in a square lattice of octagons meet only at the
 * corner the small square occupies, so no two same-toned faces ever share an edge.
 */
const OCT_FACES: readonly number[] = [0, 1, 2, 0];
export function octagonalRank(x: number, y: number, n: number, seed: number = 0): number {
  const S = 32 / n;
  const H = S / 2;
  // The lattice is offset by one pixel — see the note above on why the cell
  // centre sits at S/2 - 1 — so the cell a pixel belongs to is indexed off x + 1.
  const ux = wrapN(x + 1, S);
  const uy = wrapN(y + 1, S);
  const dx = Math.abs(ux - H);
  const dy = Math.abs(uy - H);
  // Where the chamfer cuts the corner, in the same units as dx + dy. 0.6875 is
  // 22/32, read off the traced table.
  const C = Math.round(S * 0.6875);
  const m = dx + dy;
  const face = () => {
    const cx = wrapN(Math.floor((x + 1) / S), n);
    const cy = wrapN(Math.floor((y + 1) / S), n);
    if (seed === 0) return OCT_FACES[wrapN(cx, 2) + 2 * wrapN(cy, 2)];
    // Three ranks to draw from, the same three the parity deal uses, so the dice
    // reshuffles the octagons without ever reaching the corner square's own rank.
    return Math.floor(hash01(cx, cy, seed ^ 0x9e3779b9) * 3);
  };
  const SQUARE_RANK = FACE_RANKS - 1;
  if (dx === H || dy === H) return m <= C ? JOINT_RANK : SQUARE_RANK;
  if (m > C) return SQUARE_RANK;   // the square between the octagons
  if (m === C) return JOINT_RANK;  // the outline
  return face();                   // octagon face, bevel ring included
}

/**
 * A generated paving's shade, seeded the same way a baked one is so the dice
 * keeps working and the 32px output is identical to the table it replaced.
 */
function geoShade(
  rank: (x: number, y: number, n: number, seed?: number) => number,
  x: number, y: number, seed: number, amount: number, shades: number, n: number
): number {
  const gx = wrapN(x + (seed & 31), 32);
  const gy = wrapN(y + ((seed >>> 4) & 31), 32);
  return rankToShade(rank(gx, gy, n, seed), amount, shades);
}

/**
 * Which texture shade a pixel takes: 0 for the plain terrain colour, 1..shades
 * for progressively stronger ones.
 *
 * `amount` is the fraction of pixels that get any texture at all. Within that
 * fraction the strength is biased low (u squared), so the strongest shade stays
 * a sparse highlight instead of half the surface — which is how the speckle in
 * a hand-drawn material actually distributes.
 */
export function textureShadeAt(
  texture: TextureId,
  x: number,
  y: number,
  seed: number,
  amount: number,
  shades: number = DEFAULT_TEXTURE_SHADES,
  cellScale: number = DEFAULT_CELL_SCALE,
  rippleScale: number = DEFAULT_RIPPLE_SCALE,
  geoScale: number = DEFAULT_GEO_SCALE
): number {
  if (texture === 'none' || amount <= 0 || shades < 1) return 0;
  const s = (seed ^ TEXTURE_SALT) >>> 0;
  const geo = Math.max(1, geoScale);
  // Baked art, not a field: it already knows which tone each pixel is.
  if (texture === 'weave') return bakedShade(WEAVE, 16, x, y, s, amount, shades);
  if (texture === 'paving') return bakedShade(PAVING, 32, x, y, s, amount, shades);
  if (texture === 'paving3') return bakedShade(PAVING3, 32, x, y, s, amount, shades);
  if (texture === 'paving5') return bakedShade(PAVING5, 32, x, y, s, amount, shades);
  // The five whose mortar was traced onto rank 0 pass `true` and get the ladder
  // rotated, so their joint lands on the top shade like everything else here.
  const rot = JOINT_AT_RANK_0.includes(texture);
  if (texture === 'stone_floor') return bakedShade(STONE_FLOOR, 32, x, y, s, amount, shades, rot);
  if (texture === 'breeze_block') return bakedShade(BREEZE_BLOCK, 32, x, y, s, amount, shades, rot);
  if (texture === 'brick_wall') return bakedShade(BRICK_WALL, 32, x, y, s, amount, shades, rot);
  if (texture === 'cobbles2') return bakedShade(COBBLES2, 16, x, y, s, amount, shades, rot);
  if (texture === 'brick_floor') return bakedShade(BRICK_FLOOR, 16, x, y, s, amount, shades, rot);
  // Generated, with the traced art's hand-placed edge tips merged into the
  // outline. Seeded off the salted seed like the other generated pavings, which
  // keeps the phase the traced table was rendered at.
  if (texture === 'hexagon') return geoShade(hexagonRank, x, y, s, amount, shades, geo);
  if (texture === 'brick_bond') return geoShade(brickBondRank, x, y, s, amount, shades, geo);
  // Generated rather than traced, and byte-identical to the tables they replaced
  // at geoScale 1 — see the oracle test.
  if (texture === 'isometric') return geoShade(isometricRank, x, y, seed, amount, shades, geo);
  if (texture === 'isometric_grid') return geoShade(isometricGridRank, x, y, seed, amount, shades, geo);
  // Phased off the RAW seed, like square and isometric and unlike the traced
  // tables: its faces are dealt by cell parity at seed 0, and the salt is not 0,
  // so routing it salted meant the deterministic deal could never be reached from
  // the UI — seed 0 landed on the hash path and the grid sat at the salt's (17,29)
  // offset instead of on the tile.
  if (texture === 'octagonal') return geoShade(octagonalRank, x, y, seed, amount, shades, geo);
  // reads as a bug even though every seam still lines up.
  if (texture === 'square') return geoShade(squareRank, x, y, seed, amount, shades, geo);
  if (texture === 'water') {
    // Water has two visible texture ranks. Density thins both source accents
    // rather than scaling them back to the terrain, which keeps the line and
    // pale dot visible at ordinary values such as 40%.
    const rank = bakedShade(WATER, 32, x, y, s, 1, shades);
    if (rank === 0 || amount >= 1) return rank;
    return hash01(wrapN(x, 32), wrapN(y, 32), s ^ 0x2f6e2b1) < amount ? rank : 0;
  }
  if (texture === 'field') return bakedShade(FIELD, 32, x, y, s, amount, shades);
  if (texture === 'rubble') return bakedShade(RUBBLE, 32, x, y, s, amount, shades);
  // Generated, and byte-identical to the table it replaced at its natural 8px.
  // Seeded off the SALTED seed like the other generated pavings, which is what
  // keeps the phase the traced table was rendered at.
  //
  // The only texture that reads `amount` as GEOMETRY rather than as a ramp scale:
  // it goes into the dash length and a flat 1 goes to `geoShade`, so the four
  // shades stay exactly where the pickers put them at every density.
  if (texture === 'nonslip') {
    return geoShade((gx, gy, gn) => nonslipRank(gx, gy, gn, amount), x, y, s, 1, shades, geo);
  }
  // Cells name their shade too — see cellsShade for why the scatter path below
  // flattened them into a wireframe.
  if (texture === 'cells') return cellsShade(x, y, s, Math.max(MIN_CELL_SCALE, Math.min(MAX_CELL_SCALE, cellScale)), amount, shades);
  const rScale = Math.max(MIN_RIPPLE_SCALE, Math.min(MAX_RIPPLE_SCALE, rippleScale));
  const n = texture === 'ripple' ? rippleField(x, y, s, rScale)
    : texture === 'ripple_diag' ? rippleDiagField(x, y, s, rScale)
    : sample(texture, x, y, s);
  const cut = 1 - Math.min(1, amount);
  if (n < cut) return 0;
  const u = cut >= 1 ? 1 : (n - cut) / (1 - cut);
  return Math.min(shades, 1 + Math.floor(shades * u * u));
}

/**
 * Which shades a texture actually paints at the given settings.
 *
 * Asked rather than derived because `amount` means different things to
 * different textures: it thins a scatter but scales the ramp of the baked and
 * cell textures, and a scaled ramp simply cannot reach its top steps at low
 * density — at 40% a cell texture paints only shades 0 and 1, leaving three of
 * the four colour swatches inert with nothing on screen to say so. Scanning one
 * period is exact for every texture and costs at most 1024 evaluations, which
 * is cheaper than keeping a second copy of each texture's amount semantics in
 * the UI and getting one of them wrong.
 */
export function usedTextureShades(
  texture: TextureId,
  amount: number,
  shades: number = DEFAULT_TEXTURE_SHADES,
  cellScale: number = DEFAULT_CELL_SCALE,
  rippleScale: number = DEFAULT_RIPPLE_SCALE,
  geoScale: number = DEFAULT_GEO_SCALE,
  // Scanned at the actual seed, not at 0. The generated pavings deal their faces
  // by cell parity at seed 0 and by hash otherwise, so which shades are reachable
  // genuinely moves with the dice — a lattice holding three faces lands on three
  // of the four shades, but not always the same three.
  seed: number = DEFAULT_TEXTURE_SEED
): Set<number> {
  const used = new Set<number>();
  if (texture === 'none') return used;
  const p = texturePeriod(texture);
  for (let y = 0; y < p; y++) {
    for (let x = 0; x < p; x++) {
      used.add(textureShadeAt(texture, x, y, seed, amount, shades, cellScale, rippleScale, geoScale));
    }
  }
  return used;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 709 luminance, 0..1 — decides which way a colour has room to move. */
function luminance({ r, g, b }: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * A terrain colour shifted for texture, `t` in (0, 1].
 *
 * The direction follows the colour's luminance rather than being fixed: a deep
 * blue has nowhere to go but lighter, a near-white nowhere but darker. Picking
 * by value instead would misread strongly saturated darks — a full-saturation
 * blue sits high in HSV value while reading almost black.
 */
export function textureColour(c: RGB, t: number): RGB {
  if (t <= 0) return c;
  const [h, s, v] = rgbToHsv(c);
  const lighten = luminance(c) < 0.5;
  const nv = lighten ? v * (1 + 0.3 * t) : v * (1 - 0.18 * t);
  const ns = lighten ? s * (1 - 0.15 * t) : s * (1 + 0.1 * t);
  return hsvToRgb(h, clamp01(ns), clamp01(nv));
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/**
 * The `shades + 1` colours a textured terrain is drawn with, index 0 being the
 * plain terrain colour.
 *
 * With an explicit `target` the ramp walks from the terrain colour to exactly
 * that colour, which lets the texture be any colour at all rather than a
 * brightness shift of the terrain — a grass field can carry yellow flecks, water
 * white foam. Without one it falls back to deriving the shift, which is what
 * makes a freshly picked terrain colour look textured before anything is set.
 *
 * `overrides` replaces individual steps, sparsely: an entry that is present wins
 * outright, and anything absent is still derived, so a ramp with one step picked
 * by hand keeps following the terrain colour everywhere else. Index 0 is the
 * bare terrain and overriding it is allowed but pointless — nothing paints it.
 */
export function textureRamp(
  base: RGB,
  target: RGB | undefined,
  shades: number = DEFAULT_TEXTURE_SHADES,
  overrides?: readonly (RGB | undefined)[]
): RGB[] {
  const n = Math.max(1, shades);
  return Array.from({ length: n + 1 }, (_, k) => {
    const picked = overrides?.[k];
    if (picked) return picked;
    const t = k / n;
    if (!target) return textureColour(base, t);
    return {
      r: mix(base.r, target.r, t),
      g: mix(base.g, target.g, t),
      b: mix(base.b, target.b, t),
    };
  });
}

// --- local HSV, kept here so this module does not depend on patternPaint ----
function rgbToHsv({ r, g, b }: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const range = mx - mn;
  if (range === 0) return [0, 0, mx];
  const rc = (mx - R) / range, gc = (mx - G) / range, bc = (mx - B) / range;
  let hue: number;
  if (R === mx) hue = bc - gc;
  else if (G === mx) hue = 2 + rc - bc;
  else hue = 4 + gc - rc;
  hue = (hue / 6) % 1;
  return [hue < 0 ? hue + 1 : hue, range / mx, mx];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const to255 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  if (s === 0) return { r: to255(v), g: to255(v), b: to255(v) };
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const table: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q],
  ];
  const [R, G, B] = table[((i % 6) + 6) % 6];
  return { r: to255(R), g: to255(G), b: to255(B) };
}
