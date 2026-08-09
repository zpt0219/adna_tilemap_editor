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
  | 'none' | NoiseId | 'ripple' | 'cells' | 'medium_cells' | 'small_cells'
  | 'breeze_block' | 'brick_wall' | 'cobbles2' | 'brick_floor'
  | 'hexagon' | 'isometric' | 'octagonal'
  | 'weave' | 'paving' | 'paving3' | 'paving5' | 'stone_floor' | 'water'
  | 'field' | 'rubble' | 'nonslip';

export const TEXTURE_PRESETS: readonly { id: TextureId; zh: string; en: string }[] = [
  { id: 'none', zh: '无纹理', en: 'None' },
  { id: 'ripple', zh: '波纹 · 横向短划（水面）', en: 'Ripples — short horizontal dashes' },
  { id: 'water', zh: 'Water · 水面边线（仅调边线色）', en: 'Water — edge lines only' },
  { id: 'field', zh: 'Field · 草地颗粒', en: 'Field — grassy ground' },
  { id: 'rubble', zh: 'Rubble · 碎石地面', en: 'Rubble — broken stone' },
  { id: 'nonslip', zh: 'Non-slip · 防滑纹', en: 'Non-slip — textured grip' },
  { id: 'cells', zh: '大细胞 · 2x2 多边形', en: 'Large Cells — 2x2 polygonal cells' },
  { id: 'medium_cells', zh: '中细胞 · 3x3 多边形', en: 'Medium Cells — 3x3 polygonal cells' },
  { id: 'small_cells', zh: '小细胞 · 4x4 细小多边形', en: 'Small Cells — 4x4 fine polygonal cells' },
  { id: 'breeze_block', zh: '通风砖 · 细孔砖墙（32）', en: 'Breeze Block — perforated masonry (32)' },
  { id: 'brick_wall', zh: '砖墙 · 错缝砌砖（32）', en: 'Brick Wall — running-bond masonry (32)' },
  { id: 'cobbles2', zh: '细密砖 · 小块错缝铺装', en: 'Cobbles2 — fine running-bond bricks' },
  { id: 'brick_floor', zh: '斜铺砖 · 45° 错缝铺装', en: 'Brick Floor — diagonal 45° bond' },
  { id: 'hexagon', zh: '六边形 · 规则六边砖（32）', en: 'Hexagon — regular hexagonal tiles (32)' },
  { id: 'isometric', zh: '等距砖 · 菱形立体块（32）', en: 'Isometric — diamond blocks (32)' },
  { id: 'octagonal', zh: '八边形 · 切角方砖（32）', en: 'Octagonal — chamfered square tiles (32)' },
  { id: 'weave', zh: '斜铺砖 · 菱格编织', en: 'Weave — diagonal interlocking bricks' },
  { id: 'paving', zh: '乱砌石板 · 大小板错拼（32）', en: 'Paving — random ashlar flags (32)' },
  { id: 'paving3', zh: '立方体 · 等距方块（32）', en: 'Paving3 — isometric cubes (32)' },
  { id: 'paving5', zh: '互锁铺砖 · 曲边咬合（32）', en: 'Paving5 — interlocking curved pavers (32)' },
  { id: 'stone_floor', zh: '石板地面 · 不规则砖石（32）', en: 'Stone Floor — irregular stone slabs (32)' },
  { id: 'white', zh: '白噪散点 · 细碎', en: 'White speckle — fine' },
  { id: 'blue', zh: '蓝噪散点 · 均匀', en: 'Blue speckle — even' },
  { id: 'ordered', zh: '有序网点 · 规则', en: 'Ordered — regular' },
];

/**
 * The three Stagecast pavings are traced from 32x32 art that is genuinely
 * 32-periodic — measured, not assumed: shifting any of them by 16 leaves 800+
 * of 1024 pixels disagreeing, and that holds for the joint mask alone too, so
 * there is no 16-periodic core hiding under the tint variation.
 */
const PERIOD_32: readonly TextureId[] = [
  'paving', 'paving3', 'paving5', 'stone_floor', 'breeze_block',
  'hexagon', 'isometric', 'octagonal', 'water',
  'field', 'rubble',
  // The geometric fields were widened so their motifs read at the same scale as
  // the pavings: at the old size they repeated four times inside one 32px tile
  // and looked like a finer material sitting next to a coarser one. Widening the
  // Motif scale and output period are independent; all source masonry tiles
  // listed above are genuinely 32-periodic.
  'ripple', 'cells', 'medium_cells', 'small_cells',
];

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
function rippleField(x: number, y: number, seed: number): number {
  const perX = 4;   // 4 cells across 32px -> ~8px of horizontal correlation
  const perY = 32;  // one cell per row -> rows stay independent
  const fx = (x / 32) * perX;
  const iy = ((y % perY) + perY) % perY;
  const x0 = Math.floor(fx);
  const u = smooth(fx - x0);
  const h = (ix: number) => hash01(((ix % perX) + perX) % perX, iy, seed);
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
 * the ramp and the shared boundary takes the strongest shade, so a filled region
 * reads as tiles of differing tone with grout between them.
 *
 * `amount` scales the ramp rather than thinning a scatter, matching weave and
 * the pavings: the blocks converge on the bare terrain colour as it drops.
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
  // Interiors span every shade below the boundary's, so the flattest-looking
  // cell is bare terrain and the rest step up toward the texture colour.
  //
  // Dealt out evenly rather than hashed. A plain hash has to be *lucky* to cover
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
  const n = per * per;
  const idx = nearestY * per + nearestX;
  const off = Math.floor(hash01(0, 0, seed) * n);
  const dealt = (idx * 5 + off) % n;
  const rank = onBoundary ? shades : Math.floor((dealt * shades) / n);
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

/** Rule-based geometric patterns from the same Stagecast gallery. */
const HEXAGON =
  '44442000000000002444444444444444' +
  '44440333333333330444444444444444' +
  '44401333333333331044444444444444' +
  '44203333333333333024444444444444' +
  '44033333333333333304444444444444' +
  '40133333333333333310444444444444' +
  '20333333333333333330244444444444' +
  '03333333333333333333044444444444' +
  '13333333333333333333100000000000' +
  '03333333333333333333022222222222' +
  '00333333333333333330022222222222' +
  '20133333333333333310222222222222' +
  '22033333333333333302222222222222' +
  '22003333333333333002222222222222' +
  '22201333333333331022222222222222' +
  '22220333333333330222222222222222' +
  '22220000000000000222222222222222' +
  '22220444444444440222222222222222' +
  '22202444444444442022222222222222' +
  '22004444444444444002222222222222' +
  '22044444444444444402222222222222' +
  '20244444444444444420222222222222' +
  '00444444444444444440022222222222' +
  '04444444444444444444022222222222' +
  '24444444444444444444200000000000' +
  '04444444444444444444044444444444' +
  '20444444444444444440244444444444' +
  '40244444444444444420444444444444' +
  '44044444444444444404444444444444' +
  '44204444444444444024444444444444' +
  '44402444444444442044444444444444' +
  '44440444444444440444444444444444';

const ISOMETRIC =
  '44444444444444400444444444444444' +
  '44444444444440022004444444444444' +
  '44444444444002222220044444444444' +
  '44444444400222222222200444444444' +
  '44444440022222222222222004444444' +
  '44444002222222222222222220044444' +
  '44400222222222222222222222200444' +
  '40022222222222222222222222222004' +
  '02222222222222222222222222222220' +
  '40022222222222222222222222222004' +
  '44400222222222222222222222200444' +
  '44444002222222222222222220044444' +
  '44444440022222222222222004444444' +
  '44444444400222222222200444444444' +
  '44444444444002222220044444444444' +
  '44444444444440022004444444444444' +
  '44444444444444400444444444444444' +
  '44444444444440022004444444444444' +
  '44444444444002222220044444444444' +
  '44444444400222222222200444444444' +
  '44444440022222222222222004444444' +
  '44444002222222222222222220044444' +
  '44400222222222222222222222200444' +
  '40022222222222222222222222222004' +
  '02222222222222222222222222222220' +
  '40022222222222222222222222222004' +
  '44400222222222222222222222200444' +
  '44444002222222222222222220044444' +
  '44444440022222222222222004444444' +
  '44444444400222222222200444444444' +
  '44444444444002222220044444444444' +
  '44444444444440022004444444444444';

const OCTAGONAL =
  '11111111034444444444430111111111' +
  '11111110344444444444443011111111' +
  '11111103444444444444444301111111' +
  '11111034444444444444444430111111' +
  '11110344444444444444444443011111' +
  '11103444444444444444444444301111' +
  '11034444444444444444444444430111' +
  '10344444444444444444444444443011' +
  '03444444444444444444444444444301' +
  '34444444444444444444444444444430' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '44444444444444444444444444444440' +
  '34444444444444444444444444444430' +
  '03444444444444444444444444444301' +
  '10344444444444444444444444443011' +
  '11034444444444444444444444430111' +
  '11103444444444444444444444301111' +
  '11110344444444444444444443011111' +
  '11111034444444444444444430111111' +
  '11111103444444444444444301111111' +
  '11111110344444444444443011111111' +
  '11111111034444444444430111111111' +
  '11111111100000000000001111111111';

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

/** Non-slip, traced from `wang_tiles/art/icons/nonslip.gif`. */
const NONSLIP =
  '22042244220422442204224422042244' +
  '20042222200422222004222220042222' +
  '00422222004222220042222200422222' +
  '04222222042222220422222204222222' +
  '42220222422202224222022242220222' +
  '22220022222200222222002222220022' +
  '22224002222240022222400222224002' +
  '22222404222224042222240422222404' +
  '22042244220422442204224422042244' +
  '20042222200422222004222220042222' +
  '00422222004222220042222200422222' +
  '04222222042222220422222204222222' +
  '42220222422202224222022242220222' +
  '22220022222200222222002222220022' +
  '22224002222240022222400222224002' +
  '22222404222224042222240422222404' +
  '22042244220422442204224422042244' +
  '20042222200422222004222220042222' +
  '00422222004222220042222200422222' +
  '04222222042222220422222204222222' +
  '42220222422202224222022242220222' +
  '22220022222200222222002222220022' +
  '22224002222240022222400222224002' +
  '22222404222224042222240422222404' +
  '22042244220422442204224422042244' +
  '20042222200422222004222220042222' +
  '00422222004222220042222200422222' +
  '04222222042222220422222204222222' +
  '42220222422202224222022242220222' +
  '22220022222200222222002222220022' +
  '22224002222240022222400222224002' +
  '22222404222224042222240422222404';

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
 */
function bakedShade(
  table: string,
  size: number,
  x: number,
  y: number,
  seed: number,
  amount: number,
  shades: number
): number {
  // The shift stays at 4 rather than widening with `size` so that weave, the
  // table this generalises, keeps the exact seed-to-offset mapping its locked
  // sheet hashes were taken with.
  const m = size - 1;
  const px = wrapN(x + (seed & m), size);
  const py = wrapN(y + ((seed >>> 4) & m), size);
  const rank = table.charCodeAt(py * size + px) - 48;
  const k = Math.round((rank * shades * Math.min(1, amount)) / BAKED_RANKS);
  return Math.max(0, Math.min(shades, k));
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
  shades: number = DEFAULT_TEXTURE_SHADES
): number {
  if (texture === 'none' || amount <= 0 || shades < 1) return 0;
  const s = (seed ^ TEXTURE_SALT) >>> 0;
  // Baked art, not a field: it already knows which tone each pixel is.
  if (texture === 'weave') return bakedShade(WEAVE, 16, x, y, s, amount, shades);
  if (texture === 'paving') return bakedShade(PAVING, 32, x, y, s, amount, shades);
  if (texture === 'paving3') return bakedShade(PAVING3, 32, x, y, s, amount, shades);
  if (texture === 'paving5') return bakedShade(PAVING5, 32, x, y, s, amount, shades);
  if (texture === 'stone_floor') return bakedShade(STONE_FLOOR, 32, x, y, s, amount, shades);
  if (texture === 'breeze_block') return bakedShade(BREEZE_BLOCK, 32, x, y, s, amount, shades);
  if (texture === 'brick_wall') return bakedShade(BRICK_WALL, 32, x, y, s, amount, shades);
  if (texture === 'cobbles2') return bakedShade(COBBLES2, 16, x, y, s, amount, shades);
  if (texture === 'brick_floor') return bakedShade(BRICK_FLOOR, 16, x, y, s, amount, shades);
  if (texture === 'hexagon') return bakedShade(HEXAGON, 32, x, y, s, amount, shades);
  if (texture === 'isometric') return bakedShade(ISOMETRIC, 32, x, y, s, amount, shades);
  if (texture === 'octagonal') return bakedShade(OCTAGONAL, 32, x, y, s, amount, shades);
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
  if (texture === 'nonslip') return bakedShade(NONSLIP, 32, x, y, s, amount, shades);
  // Cells name their shade too — see cellsShade for why the scatter path below
  // flattened them into a wireframe.
  if (texture === 'cells') return cellsShade(x, y, s, 2, amount, shades);
  if (texture === 'medium_cells') return cellsShade(x, y, s, 3, amount, shades);
  if (texture === 'small_cells') return cellsShade(x, y, s, 4, amount, shades);
  const n = texture === 'ripple' ? rippleField(x, y, s) : sample(texture, x, y, s);
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
  shades: number = DEFAULT_TEXTURE_SHADES
): Set<number> {
  const used = new Set<number>();
  if (texture === 'none') return used;
  const p = texturePeriod(texture);
  for (let y = 0; y < p; y++) {
    for (let x = 0; x < p; x++) used.add(textureShadeAt(texture, x, y, 0, amount, shades));
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
