import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import type { EdgeStyle } from './utils/edgeStyles';
import {
  PRESETS, defaultRecipe, sanitizeRecipe, readRecipeFile, RECIPE_VERSION, TILE_PX,
  type Recipe,
} from './utils/recipe';
import {
  EDGE_KINDS, edgeUsesWave, ARC_PERIODS, maxArcAmplitude, KERB_PX,
  MAX_ARC_AMPLITUDE, ARC_AMPLITUDE_STEP, arcRadiusFor, arcAngleFor,
  MIN_EDGE_DISTANCE, MAX_EDGE_DISTANCE, EDGE_DISTANCE_STEP, type EdgeKind,
  surfaceHalfFor, ROUGH_STYLES, maxRoughness, ROUGHNESS_STEP,
  KERB_MOTIFS, KERB_PERIODS, kerbWidthsFor, maxKerbWidth, type KerbMotif,
  SCHEMES, areaBendFor, type Scheme,
} from './utils/boundary';
import {
  CENTRE_KINDS, centreUsesPeriod, doubleLineWidth,
  centreWidthsFor, centrePeriodsFor, dashGap, maxLong, maxShort, longShortIsRigid,
  randomRuns, maxJitter, jitterAt, RAND_MIN, RAND_MAX, MAX_RAND_MIN,
  MIN_LONG, MIN_SHORT, DASH_LENGTH_STEP, ROOMY_LONGSHORT_PERIOD, type CentreKind,
} from './utils/centre';
import {
  SURFACE_KINDS, AREA_SURFACE_KINDS, surfaceUsesPeriod, CAMBER_RINGS, camberEdge,
  rutWidthsFor, ribWidthsFor, rutInner, maxRibWidth, SURFACE_PERIODS,
  type SurfaceKind,
} from './utils/surface';
import { renderSheetRGBA, renderMapRGBA } from './utils/renderSheet';
import { SHEET_COLS, TWO_EDGE_LAYOUT, bitsAt, bitsLabel } from './utils/twoEdge';
import { cellsAlongSegment, type GridCell } from './utils/playgroundPaint';
import { downloadJsonFile, downloadSheetBundle, buildSheetExportData } from './utils/exportSheet';

const MAP_COLS = 16;
const MAP_ROWS = 10;

type Tool = 'paint' | 'erase';

/** A starting network that exercises every mask worth looking at. */
function seedMap(): Uint8Array {
  const cells = new Uint8Array(MAP_COLS * MAP_ROWS);
  const set = (c: number, r: number) => { cells[r * MAP_COLS + c] = 1; };
  for (let c = 1; c <= 12; c++) set(c, 3);          // a long east-west run
  for (let r = 1; r <= 8; r++) set(5, r);           // crossing it: a crossroads
  for (let r = 3; r <= 6; r++) set(9, r);           // a T, then a corner
  for (let c = 9; c <= 12; c++) set(c, 6);
  for (let r = 6; r <= 8; r++) set(12, r);
  set(2, 8);                                        // an isolated cell
  set(14, 1); set(14, 2);                           // a short dead-ended stub
  return cells;
}

export default function App() {
  // Opens on the aligned bake rather than on DEFAULT_RECIPE. Those are two
  // different things and conflating them is a bug the mixer actually shipped:
  // DEFAULT_RECIPE is the per-field fallback table the sanitiser reads, not a
  // look, and starting from it left the preset dropdown naming a preset that
  // was not on screen.
  const [recipe, setRecipeRaw] = useState<Recipe>(defaultRecipe);
  const [cells, setCells] = useState<Uint8Array>(seedMap);
  const [tool, setTool] = useState<Tool>('paint');
  const [sheetScale, setSheetScale] = useState(3);
  const [mapScale, setMapScale] = useState(2);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [borderConnected, setBorderConnected] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Every write goes through the sanitiser, because the controls are not
  // independent: halfWidth's ceiling moves when band steps, outline width or
  // the hard edge move, and a road that no longer fits has to be pulled in
  // rather than left putting band pixels on a closed border.
  const setRecipe = useCallback((next: Recipe | ((r: Recipe) => Recipe)) => {
    setRecipeRaw((prev) => sanitizeRecipe(typeof next === 'function' ? next(prev) : next));
  }, []);

  const patch = useCallback(
    (p: Partial<Recipe>) => setRecipe((r) => ({ ...r, ...p })),
    [setRecipe]
  );

  const be = recipe.edge;
  // How far the arcs may swing depends on how far out the boundary is, so the
  // slider's own maximum has to move with it — otherwise the UI offers a value
  // the sanitiser will silently take back. Same rule as `hwCeiling` above.
  const ampCeiling = maxArcAmplitude(be.distance);
  // The arc's control READS as a radius, because that is the handle that makes
  // the shape legible: a big radius is a shallow small-angle sector, which is
  // the thing an eye calls a gentle arc. But it MOVES through the amplitudes,
  // deepest first, and that is not a compromise — it is the only honest stop
  // list. Amplitude is what ARC_CEILING is measured in and what quantises onto
  // a step that renders differently; a uniform radius slider over 17px to 256px
  // in quarter-pixel steps would have some 950 positions drawing 16 pictures.
  // So the stops are the amplitudes, and each one displays the radius it is.
  const arcStops = useMemo(() => {
    const out: number[] = [];
    for (let a = ampCeiling; a >= ARC_AMPLITUDE_STEP - 1e-9; a -= ARC_AMPLITUDE_STEP) {
      out.push(Math.round(a * 100) / 100);
    }
    return out;
  }, [ampCeiling]);
  const arcIndex = Math.max(0,
    arcStops.findIndex((v) => Math.abs(v - be.amplitude) < 1e-9));
  const arcRadius = arcRadiusFor(be.period, be.amplitude);
  // Same rule again: the noise is two-sided, so how far it may wobble is
  // bounded both by how wide the road is and by how much room is left against
  // the closed border.
  const roughCeiling = maxRoughness(be.distance);
  // Same rule once more: a tooth has to leave plain kerb between two of itself,
  // so how wide it may be depends on the period it repeats at.
  const kerbWidths = kerbWidthsFor(be.kerbPeriod);
  // The AREA reading is a different picture from the same 16 masks, so a good
  // deal of the panel below means something else or nothing at all under it.
  const isArea = be.scheme === 'area';
  const patchEdge = useCallback(
    (p: Partial<Recipe['edge']>) =>
      setRecipe((r) => ({ ...r, edge: { ...r.edge, ...p } })),
    [setRecipe]
  );
  const bc = recipe.centre;
  const patchCentre = useCallback(
    (p: Partial<Recipe['centre']>) =>
      setRecipe((r) => ({ ...r, centre: { ...r.centre, ...p } })),
    [setRecipe]
  );
  // How wide 双直线 can actually draw depends on how much SURFACE the current
  // boundary leaves, so the note under the slider says what the geometry will
  // do rather than letting the number quietly saturate.
  const surfaceHalf = surfaceHalfFor(be);
  const doubleWidth = doubleLineWidth(bc.width, surfaceHalf);
  // Only the widths this road can actually carry, so the control never offers
  // one the sanitiser will take back. Same rule as `ampCeiling` above.
  const centreWidths = centreWidthsFor(bc.kind, surfaceHalf);
  const bs = recipe.surface;
  const patchSurface = useCallback(
    (p: Partial<Recipe['surface']>) =>
      setRecipe((r) => ({ ...r, surface: { ...r.surface, ...p } })),
    [setRecipe]
  );
  // Both ceilings, for the same reason: a track has to fit inside the surface
  // the boundary leaves, and a rib has to leave road between two of itself.
  const rutWidths = rutWidthsFor(surfaceHalf);
  const ribWidths = ribWidthsFor(bs.period);
  const TS = TILE_PX;
  const SHEET_W = SHEET_COLS * TS;
  const SHEET_H = 4 * TS;

  const sheetPixels = useMemo(() => renderSheetRGBA(recipe), [recipe]);

  const bitsOf = useCallback(
    (c: number, r: number) => bitsAt(cells, MAP_COLS, MAP_ROWS, c, r, borderConnected),
    [cells, borderConnected]
  );
  const mapPixels = useMemo(
    () => renderMapRGBA(recipe, cells, MAP_COLS, MAP_ROWS, bitsOf),
    [recipe, cells, bitsOf]
  );

  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const sheetCanvasRef = useRef<HTMLCanvasElement>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- the clean sheet, which is what gets exported -------------------------
  useEffect(() => {
    const ctx = exportCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SHEET_W, SHEET_H);
    ctx.putImageData(new ImageData(sheetPixels, SHEET_W, SHEET_H), 0, 0);
  }, [sheetPixels, SHEET_W, SHEET_H]);

  // --- the preview, which may carry grid lines and labels the export must not -
  useEffect(() => {
    const canvas = sheetCanvasRef.current;
    const src = exportCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !src || !ctx) return;
    const size = TS * sheetScale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Checkerboard, not the ground colour: the sheet IS transparent outside the
    // kerb, and painting a plausible ground behind it here would hide the one
    // property that lets it drop onto any terrain.
    const sq = 8 * sheetScale;
    for (let y = 0; y * sq < canvas.height; y++) {
      for (let x = 0; x * sq < canvas.width; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#2b2b2b' : '#242424';
        ctx.fillRect(x * sq, y * sq, sq, sq);
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    if (!showMarkers) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    for (let i = 1; i < SHEET_COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * size + 0.5, 0);
      ctx.lineTo(i * size + 0.5, canvas.height);
      ctx.moveTo(0, i * size + 0.5);
      ctx.lineTo(canvas.width, i * size + 0.5);
      ctx.stroke();
    }
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    TWO_EDGE_LAYOUT.forEach((bits, slot) => {
      const x = (slot % SHEET_COLS) * size + 3;
      const y = Math.floor(slot / SHEET_COLS) * size + 2;
      const label = bitsLabel(bits);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 2, y - 1, ctx.measureText(label).width + 5, 13);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(label, x, y);
    });
  }, [sheetPixels, sheetScale, showMarkers, TS]);

  // --- the playground ------------------------------------------------------
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = MAP_COLS * TS;
    const h = MAP_ROWS * TS;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showGround) {
      ctx.fillStyle = recipe.previewGroundHex;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      // Checkerboard, so `transparentGround` is visible rather than implied.
      const s = 8 * mapScale;
      for (let y = 0; y * s < canvas.height; y++) {
        for (let x = 0; x * s < canvas.width; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#2b2b2b' : '#242424';
          ctx.fillRect(x * s, y * s, s, s);
        }
      }
    }

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    off.getContext('2d')!.putImageData(new ImageData(mapPixels, w, h), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    if (!showMarkers) return;
    const cell = TS * mapScale;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1;
    for (let c = 1; c < MAP_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cell + 0.5, 0);
      ctx.lineTo(c * cell + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let r = 1; r < MAP_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cell + 0.5);
      ctx.lineTo(canvas.width, r * cell + 0.5);
      ctx.stroke();
    }
  }, [mapPixels, mapScale, showMarkers, showGround, recipe.previewGroundHex, TS]);

  // --- painting ------------------------------------------------------------
  const lastCell = useRef<GridCell | null>(null);

  const cellFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): GridCell | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const size = TS * mapScale;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * (MAP_COLS * size) / size);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * (MAP_ROWS * size) / size);
    if (col < 0 || row < 0 || col >= MAP_COLS || row >= MAP_ROWS) return null;
    return { col, row };
  };

  const applyStroke = (to: GridCell) => {
    const from = lastCell.current ?? to;
    const painted = cellsAlongSegment(from, to);
    lastCell.current = to;
    setCells((prev) => {
      const next = new Uint8Array(prev);
      let changed = false;
      for (const { col, row } of painted) {
        if (col < 0 || row < 0 || col >= MAP_COLS || row >= MAP_ROWS) continue;
        const v = tool === 'paint' ? 1 : 0;
        if (next[row * MAP_COLS + col] !== v) {
          next[row * MAP_COLS + col] = v;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastCell.current = null;
    applyStroke(cell);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons === 0) return;
    const cell = cellFromEvent(e);
    if (cell) applyStroke(cell);
  };

  const onPointerUp = () => { lastCell.current = null; };

  // --- export --------------------------------------------------------------
  const exportBundle = () => {
    const canvas = exportCanvasRef.current;
    if (canvas) void downloadSheetBundle(canvas, recipe);
  };

  const exportRecipe = () => {
    downloadJsonFile('autotile_path_recipe.json', { v: RECIPE_VERSION, recipe });
  };

  // ⚠ Refuses rather than sanitises. `sanitizeRecipe` fills what is missing and
  // drops what it does not know, which turns a recipe from an older version
  // into the DEFAULT road with its colours kept — no error, nothing to notice.
  // See `readRecipeFile`.
  const importRecipe = (file: File) => {
    void file.text().then((text) => {
      const read = readRecipeFile(text);
      if (read.ok) {
        setImportError(null);
        setRecipe(read.recipe);
      } else {
        setImportError(`${file.name}：${read.reason}`);
      }
    });
  };

  return (
    <div className="app">
      <header>
        <h1>autotile_path</h1>
        <p className="sub">
          2-edge 路网自动图块 · 16 张 · {TS}px · 距离场运行时计算
        </p>
      </header>

      <div className="columns">
        <aside className="panel">
          <section>
            <h2>预设</h2>
            <div className="row wrap">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setRecipe(p.recipe)}>{p.zh}</button>
              ))}
              <button className="ghost" onClick={() => setRecipe(defaultRecipe())}>重置</button>
            </div>
          </section>

          <section>
            <h2>颜色</h2>
            <ColourRow label="路面" value={recipe.roleHex.path}
              onChange={(v) => patch({ roleHex: { ...recipe.roleHex, path: v } })} />
            <ColourRow label="路沿" value={recipe.roleHex.edge}
              onChange={(v) => patch({ roleHex: { ...recipe.roleHex, edge: v } })} />
            <ColourRow label="中轴" value={recipe.roleHex.centre}
              onChange={(v) => patch({ roleHex: { ...recipe.roleHex, centre: v } })} />
            <ColourRow label="暗色" value={recipe.roleHex.edgeAlt}
              onChange={(v) => patch({ roleHex: { ...recipe.roleHex, edgeAlt: v } })} />
            <p className="note">
              图集里只有这四种颜色。路沿以外全部透明——路铺在什么地面上，图块并不知道，
              所以它没有第二种地形可画。
              <br />
              <b>暗色</b>是路沿抖动的第二个色，也是路面纹理用的那个色。原图这四个色不是随便挑的：
              量出来 <code>暗色</code> 正好落在<b>路面色到路沿色的连线上</b>，
              走了 53%（RGB 拟合 k=0.530，误差 2.49/255；HSV 明度那一路也是 0.532）。
              所以路面纹理不需要第五个色——它要的那个色，画里已经有了。
            </p>
          </section>

          <section>
            <h2>预览底色</h2>
            <ColourRow label="地面" value={recipe.previewGroundHex}
              onChange={(v) => patch({ previewGroundHex: v })} />
            <p className="note">
              只画在试铺画布下面，用来判断路配不配这块地。<b>不进导出的 PNG。</b>
            </p>
          </section>
          <section>
            <h2>边界</h2>
            <Radio label="读法" value={be.scheme}
              options={SCHEMES.map((s) => [s.id, s.zh] as const)}
              onChange={(v: Scheme) => patchEdge({ scheme: v })} />
            <p className="note">
              同样 16 张 mask，两种完全不同的美术含义。<b>网络</b>：格子是路，
              邻居说路往哪通。<b>区域</b>：格子<b>就是</b>地形，邻居说地形是否延续。
              导出的 JSON 里 <code>scheme</code> 会跟着写 two-edge-network /
              two-edge-area——猜错的导入方会得到一张看起来合理、连起来却不对的图集。
              {isArea && (
                <>
                  <br />
                  ⚠ <b>区域读法是"廉价版"，接缝做不到精确</b>，这是方案本身的账不是实现的：
                  一个象限需要 5 种状态，2-edge 只能表达 4 种，缺的那种是<b>内凹角</b>
                  （两条边都通、但对角不通），而 4 个 bit 里根本没有对角。
                  所以 L 形区域的内凹角上会有一个台阶。
                  实测：块状地图 50 条竖接缝里 3 条有断层，占边界像素 0.4%（内缩 2px 时）；
                  而且<b>只要两块图对侧墙的判断一致，接缝就是精确的</b>——测试钉着这条。
                  路网形状的地图会到 7.7%，但那本来就不是区域读法该用的形状。
                </>
              )}
            </p>
            {!isArea && (
              <Radio label="边缘" value={be.kind}
                options={EDGE_KINDS.map((k) => [k.id, k.zh] as const)}
                onChange={(v: EdgeKind) => patchEdge({ kind: v })} />
            )}
              <Slider label={isArea ? '边缘内缩' : '边界到中心的距离'} value={be.distance}
                min={MIN_EDGE_DISTANCE} max={MAX_EDGE_DISTANCE}
                step={EDGE_DISTANCE_STEP} unit="px"
                onChange={(v) => patchEdge({ distance: v })}
                note={isArea
                  ? '不通的那几条边从格子边缘往里缩多少。通的边一律齐平——'
                    + '它不是边界，地形从那里连过去，所以那上面既不画路沿也不许噪点动它。'
                    + `路沿始终 ${KERB_PX}px，只沿着真正的边缘走：四面都通的格子是实心的，`
                    + '一圈描边都没有。'
                  : `${MIN_EDGE_DISTANCE}–${MAX_EDGE_DISTANCE}px，两头都是在 32px 上重新量的（不是把 16px 的数乘 2）。`
                    + `上限就是格子边缘本身：孤立圆点原本会先撞上，现在它的倍率跟着收，`
                    + `所以卡住的是路自己。路沿始终 ${KERB_PX}px，跟着外边界走。`} />
              {isArea && (
                <Slider label="圆角半径" value={be.amplitude}
                  min={0} max={ampCeiling} step={ARC_AMPLITUDE_STEP} unit="px"
                  onChange={(v) => patchEdge({ amplitude: v })}
                  display={`${areaBendFor(be).toFixed(1)}px`}
                  note={'外凸角切多圆。只有两条边都不通的角才是外凸角，才会被切；'
                    + '一边通一边不通的角上直边直接接过去，切了就会在必须齐平的'
                    + '边上啃出一个缺口。用的是圆弧幅度那个滑块——'
                    + '网络读法里它说弧往里咬多深，这里说角切掉多少，'
                    + '两个都是"边上拿掉多少"，再开一个滑块就是又一个死控件。'} />
              )}
              {!isArea && edgeUsesWave(be.kind) && (
                <>
                  <Radio label="圆弧周期" value={String(be.period)}
                    options={ARC_PERIODS.map((p) => [String(p), `${p}px`] as const)}
                    onChange={(v) => patchEdge({ period: Number(v) })} />
                  <Slider label="圆弧半径" value={arcIndex}
                    min={0} max={Math.max(0, arcStops.length - 1)} step={1}
                    display={`${arcRadius.toFixed(1)}px · 半角 ${arcAngleFor(be.period, be.amplitude).toFixed(1)}°`}
                    onChange={(i) => patchEdge({ amplitude: arcStops[i] ?? be.amplitude })}
                    note={`真圆弧——之前那个不是。旧版把一个单位半圆按 周期/2 × 幅度/2 拉扁，`
                      + `那是椭圆弧：拟合圆最大偏差 0.48px（P=32 幅度4），`
                      + `而椭圆在两端是竖直切线，所以边界在两个极值上各趴十行再一口气跨过中间。`
                      + `换成真圆弧，同样设置下用满 5 个像素档位、跳 8 次，旧版只有 4 档跳 5 次还漏掉一档。`
                      + ` 半径是它的把手：${be.period / 4}px 就是半圆（半角 90°，最深），`
                      + `半径越大弧越浅，越接近一个小角度的扇形。`
                      + `给定周期，半径和深度是同一个自由度——`
                      + `所以只给一个滑块，深度（当前 ${be.amplitude}px）跟着算出来，`
                      + `跟长短虚线的空档同一个道理。`
                      + ` 档位走的是深度的整数格：图集是 32px，`
                      + `半径连续调没有意义，能画出来的弧一共就这 ${arcStops.length} 种。`
                      + (ampCeiling < MAX_ARC_AMPLITUDE
                        ? ` 这个距离最深只到 ${ampCeiling}px，再深路会被咬断，`
                          + `所以半径也就下不去 ${arcRadiusFor(be.period, ampCeiling).toFixed(1)}px 以下。`
                        : '')} />
                </>
              )}
              <Radio label="边界噪点" value={be.roughStyle}
                options={ROUGH_STYLES.map((s) => [s.id, s.zh] as const)}
                onChange={(v: EdgeStyle) => patchEdge({ roughStyle: v })} />
              {be.roughStyle !== 'smooth' && (
                <Slider label="噪点幅度" value={be.roughness}
                  min={0} max={Math.max(ROUGHNESS_STEP, roughCeiling)}
                  step={ROUGHNESS_STEP} unit="px"
                  onChange={(v) => patchEdge({ roughness: v })}
                  note={'轮廓自己抖多少。这是原图那种边界溶解真正缺的那一块——'
                    + '路沿实心度换的是颜色，圆弧波浪线是个规规矩矩的周期，都不是它。'
                    + ` 上限 ${roughCeiling}px：一半来自路自己（抖动不能超过半宽的一半，`
                    + `再大路会被咬出细颈），一半来自格子边缘的余量。`
                    + '掉出来的碎点不靠这个上限管，是生成时直接剔掉的——'
                    + '按种子采样出来的上限挡不住碎点，换个种子就漏。'
                    + (be.roughStyle === 'hand'
                      ? ' 手绘这一档是照着原图拟合的：原图那条边绕着均值抖 ±1 个原图像素，'
                        + '而且没有周期——自相关 lag1 是 0.62、lag2 是 0.22、lag3 就已经 0 了，'
                        + '一直到 lag8 都没有正峰。按 32px 扫下来 4px 一格的噪声最贴（rms 0.104），'
                        + '4 个输出像素正好是 2 个原图像素，两次独立测量落在同一个数上。'
                      : ' 想还原原图那条边就用 手绘 那一档，它是照着原图拟合的；'
                        + '这几档是参数化模式那一套，各有各的性格。')} />
              )}
              <Slider label="路沿实心度" value={be.coverage}
                min={0} max={1} step={0.01}
                onChange={(v) => patchEdge({ coverage: v })}
                note={'1 是实心描边（blob47 规整边缘的样子）；调低把路沿那一圈的着色抖散。'
                  + ' ⚠ 它一个不透明像素都不动——实测实心度 0 和 1 的图集都是同样多的像素，'
                  + '它换的是路沿那一圈像素取什么颜色。要让轮廓本身溶解，用上面的噪点。'} />
              <Radio label="路沿花纹" value={be.kerbMotif}
              options={KERB_MOTIFS.map((m) => [m.id, m.zh] as const)}
              onChange={(v: KerbMotif) => patchEdge({ kerbMotif: v })} />
            {be.kerbMotif !== 'none' && (
              <>
                <Radio label="花纹周期" value={String(be.kerbPeriod)}
                  options={KERB_PERIODS.map((p) => [String(p), `${p}px`] as const)}
                  onChange={(v) => patchEdge({
                    kerbPeriod: Number(v),
                    kerbWidth: Math.min(be.kerbWidth, Math.max(2, maxKerbWidth(Number(v)))),
                  })} />
                {be.kerbMotif === 'tick' && (
                  <Radio label="齿宽" value={String(be.kerbWidth)}
                    options={kerbWidths.map((w) => [String(w), `${w}px`] as const)}
                    onChange={(v) => patchEdge({ kerbWidth: Number(v) })} />
                )}
                <p className="note">
                  {be.kerbMotif === 'dash'
                    ? `路沿每 ${be.kerbPeriod}px 断一次，断掉的地方露出路面色。`
                      + '断口的相位和中轴虚线走的是同一个函数——两份"周期落在哪"的算法'
                      + '一定会走偏，症状是四岔的四条臂各有各的相位。'
                    : `每 ${be.kerbPeriod}px 往路面里长一颗 ${be.kerbWidth}px 宽的齿。`
                      + '只往内长：往外是格子边缘的余量，轮廓已经花掉了。'
                      + '只走偶数宽——齿以路口为中心对折，奇数宽会把边界正好压在采样点上。'}
                  {' '}⚠ 它读的是<b>连续的沿路坐标</b>而不是 <code>s</code>：一条世界轴
                  跟不过拐角，<code>s</code> 在那里跳 14px，虚线路沿会直接断开而不是顿一下。
                  {kerbWidths.length < 3 && be.kerbMotif === 'tick'
                    && ` ${be.kerbPeriod}px 的周期最宽只到 ${maxKerbWidth(be.kerbPeriod)}px，`
                      + '再宽两颗齿就连上了。'}
                </p>
              </>
            )}
            {(be.coverage < 1 || be.roughStyle !== 'smooth') && (
                <div className="row wrap" style={{ marginBottom: 12 }}>
                  <button className="ghost"
                    onClick={() => patchEdge({ seed: (be.seed % 999) + 1 })}>
                    换一个种子（{be.seed}）
                  </button>
                </div>
              )}
            <p className="note">
              <b>只换轮廓和路沿。</b>路面还是原图那一个单色；中轴归下面那一组管，
              这一组碰不到它——量出来的：当初那张参考图的 127 个中轴像素里，
              落在最外环的是 <b>0 个</b>，所以边界够不着它。
              骨架用的是拟合那张图的那组常数（92.70% 像素吻合）。
            </p>
          </section>
        </aside>

        <main className="panel">
          <section>
            <div className="head">
              <h2>图集（4×4，16 张）</h2>
              <div className="row">
                <Zoom value={sheetScale} onChange={setSheetScale} options={[2, 3, 4, 6]} />
                <label className="check inline">
                  <input type="checkbox" checked={showMarkers}
                    onChange={(e) => setShowMarkers(e.target.checked)} />
                  标记
                </label>
              </div>
            </div>
            <div className="canvas-wrap">
              <canvas ref={sheetCanvasRef}
                width={SHEET_W * sheetScale} height={SHEET_H * sheetScale} />
            </div>
            <canvas ref={exportCanvasRef} width={SHEET_W} height={SHEET_H} hidden />
          </section>

          <section>
            <div className="head">
              <h2>试铺</h2>
              <div className="row wrap">
                <div className="seg">
                  <button className={tool === 'paint' ? 'on' : ''} onClick={() => setTool('paint')}>画路</button>
                  <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')}>擦除</button>
                </div>
                <Zoom value={mapScale} onChange={setMapScale} options={[1, 2, 3]} />
                <label className="check inline">
                  <input type="checkbox" checked={showGround}
                    onChange={(e) => setShowGround(e.target.checked)} />
                  底色
                </label>
                <label className="check inline" title="地图边界之外算作有路，用来看一张图块单独长什么样">
                  <input type="checkbox" checked={borderConnected}
                    onChange={(e) => setBorderConnected(e.target.checked)} />
                  边界连通
                </label>
                <button className="ghost" onClick={() => setCells(new Uint8Array(MAP_COLS * MAP_ROWS))}>清空</button>
                <button className="ghost" onClick={() => setCells(seedMap())}>示例</button>
              </div>
            </div>
            <div className="canvas-wrap">
              <canvas ref={mapCanvasRef}
                width={MAP_COLS * TS * mapScale}
                height={MAP_ROWS * TS * mapScale}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={{ touchAction: 'none', cursor: 'crosshair' }} />
            </div>
            <p className="note">
              每格按四个正交邻居取 mask，查 16 张表。对角线不参与——这就是 2-edge。
            </p>
          </section>

          <section>
            <h2>导出的 JSON</h2>
            <pre className="json">{JSON.stringify(
              { ...buildSheetExportData(recipe), recipe: '…（完整配方）' }, null, 1
            )}</pre>
          </section>
        </main>

        <aside className="panel">
          <section className={isArea ? 'muted' : undefined}>
            <h2>中轴</h2>
            {isArea ? (
              <p className="note">
                <b>区域读法没有中轴。</b>这里每一种花纹都画在路的骨架上，
                而一块填充的地形没有骨架——"这格是草地"里没有方向可言。
                不是界面藏起来了：<b>配方里就被强制成"无花纹"</b>，
                这样绘制器永远不用去解释一个画不出来的状态。
              </p>
            ) : (
              <>
            <Radio label="中轴花纹" value={bc.kind}
              options={CENTRE_KINDS.map((k) => [k.id, k.zh] as const)}
              onChange={(v: CentreKind) => patchCentre({
                kind: v,
                // 虚线's default period is 8, and at 8 长短虚线 has exactly
                // one legal form — both sliders pinned to their minimum. So
                // arriving there opens the period up once, rather than
                // handing over two controls that cannot move.
                ...(v === 'longShort' && longShortIsRigid(bc.period)
                  ? { period: ROOMY_LONGSHORT_PERIOD } : {}),
              })} />
              <Radio label="中轴线宽" value={String(bc.width)}
                options={centreWidths.map((w) => [String(w), `${w}px`] as const)}
                onChange={(v) => patchCentre({ width: Number(v) })} />
              <p className="note">
                {bc.kind === 'doubleLine'
                  ? (doubleWidth <= 0
                    ? '这条路没有路面了，两条线无处可放——把边界距离调大。'
                    : doubleWidth < bc.width / 2
                      ? `这条路每条只放得下 ${doubleWidth}px：中间那道缝优先保住，两条挨上就是一条了。`
                      : `一共 ${bc.width}px，分成两条各 ${bc.width / 2}px；间距跟着路面走（半宽的一半），路越宽分得越开——不另开一个滑块。`)
                  : `默认 2px 就是原图那条 1 像素的线放大 2 倍——量出来的，不是挑的。`}
                {' '}只给这几档：线是对称的，一格像素的中心在半整数上，所以它只能盖住偶数列——
                原来那种 1–6 的滑块 11 档里只有 3 个不同结果，1px 那档在直路上根本不画。
              </p>
              {centreUsesPeriod(bc.kind) && (
                <Radio label="虚线周期" value={String(bc.period)}
                  options={centrePeriodsFor(bc.kind).map((p) => [String(p), `${p}px`] as const)}
                  onChange={(v) => patchCentre({ period: Number(v) })} />
              )}
              {bc.kind === 'randomDash' && (
                <>
                  <Slider label="最短段" value={bc.randMin}
                    min={RAND_MIN} max={MAX_RAND_MIN} step={1} unit="px"
                    onChange={(v) => patchCentre({ randMin: v })} />
                  <Slider label="最长段" value={bc.randMax}
                    min={bc.randMin + 1} max={RAND_MAX} step={1} unit="px"
                    onChange={(v) => patchCentre({ randMax: v })} />
                  <Slider label="横向偏移" value={bc.randJitter}
                    min={0} max={Math.max(1, maxJitter(bc.width, surfaceHalf))}
                    step={1} unit="档"
                    onChange={(v) => patchCentre({ randJitter: v })}
                    note={bc.randJitter === 0
                      ? '0：所有短线排在一条直线上。原图不是这样的。'
                      : `每段左右偏 1–${jitterAt(bc.randJitter)}px，偏多少是抽的，`
                        + `方向左右交替——一格里只有两三段能偏，各自抛硬币的话`
                        + `有一半的种子会整条偏到一边去。`
                        + `想法来自原图：它的中轴不在一条线上，南北那张在原图第 6、7、8 列，`
                        + `东西那张在第 7、8、9 行，换算成输出就是偏 -3、-1、+1。`
                        + `但这里按 1 输出像素一档走，不按原图那 2 像素一档——`
                        + `图集是 32px 的，原图那个格子是它画在 16px 上留下的，不是路的性质。`
                        + `路口那一段不偏，偏了路口会空。`} />
                  <div className="row wrap" style={{ marginBottom: 12 }}>
                    <button className="ghost"
                      onClick={() => patchCentre({ seed: (bc.seed % 999) + 1 })}>
                      换一个种子（{bc.seed}）
                    </button>
                  </div>
                  <p className="note">
                    这颗种子这一格里排了 <b>{randomRuns(bc).runs.length}</b> 段，
                    长度都在 {bc.randMin}–{bc.randMax}px 之间随机取。
                    <b>空档和线段同一个范围抽</b>，所以任何两段之间至少隔 {bc.randMin}px——
                    挨上就不是两段了，是一段更长的。
                    <br />
                    <b>“随机”只能随机到这个份上</b>：图集就 16 张，
                    铺图是把同一张反复盖下去，所以直路上的花纹每 32px 必然重复一次，
                    这是瓦片集本身决定的、跟这里怎么写无关。种子换的是那 32px 长什么样。
                    <b>不做镜像</b>：镜像能白送路口对称，但也把预算砍到 16px，
                    长一点的线段就只塞得下一段，一段只能往一边偏，整条路就歪了——
                    实测线段 4–8px 时 26 个种子里 <b>0 个</b>两边都用上。
                    所以这一种花纹（只有这一种）没有对称性，四岔的上下两臂是不一样的。
                    原图也是这样：它自己那张四岔跟镜像差 104 个像素。
                  </p>
                </>
              )}
              {bc.kind === 'longShort' && (
                <>
                  <Slider label="长段" value={bc.long}
                    min={MIN_LONG} max={Math.max(MIN_LONG, maxLong(bc.period))}
                    step={DASH_LENGTH_STEP} unit="px"
                    onChange={(v) => patchCentre({ long: v })} />
                  <Slider label="短段" value={bc.short}
                    min={MIN_SHORT}
                    max={Math.max(MIN_SHORT, maxShort(bc.period, bc.long))}
                    step={DASH_LENGTH_STEP} unit="px"
                    onChange={(v) => patchCentre({ short: v })} />
                  <p className="note">
                    一个周期 {bc.period}px = 长 {bc.long} + 空 {dashGap(bc)} + 短 {bc.short} + 空 {dashGap(bc)}。
                    <b>空档不给滑块</b>：三段长度要凑满周期，只有两个自由度，
                    第三个滑块只会被另外两个当场拿回去。
                    两段都只走偶数：像素中心在半整数上，奇数长度的边界正好压在采样点上，
                    画成什么样就得看 <code>&lt;</code> 往哪边倒了。
                    长段永远比短段长至少 {DASH_LENGTH_STEP}px——一样长就退化成半个周期的普通虚线了。
                  </p>
                </>
              )}
            <p className="note">
              <b>只换中轴。</b>轮廓、路沿、路面一个像素都不动。生成的线永远进不了最外
              那一环——参考图自己就是这样，127 个里 0 个——所以它压不到路沿上去。
              {bc.kind !== 'none' &&
                ' 三岔四岔的交界一律走直线：那里几条线是真的碰在一起，'
                + '而骨架把两臂之间接成半径 11 的圆弧，细线一卡就把圆弧描了出来，'
                + '画成一个星形而不是十字。两臂的拐角不算交界，仍旧跟着路自己的弯。'
                + ' 路口不断线：参考图四岔那张有 5/13 个中轴像素就落在正中央，'
                + '"路口让开" 那条直觉在它身上是反的。'}
            </p>
              </>
            )}
          </section>
          <section>
            <h2>路面</h2>
            <Radio label="路面花纹" value={bs.kind}
              options={SURFACE_KINDS
                .filter((k) => !isArea || AREA_SURFACE_KINDS.includes(k.id))
                .map((k) => [k.id, k.zh] as const)}
              onChange={(v: SurfaceKind) => patchSurface({ kind: v })} />
            {isArea && (
              <p className="note">
                <b>车辙</b>和<b>横纹</b>在区域读法里没有：两个都是沿路坐标的函数，
                而一块填充的地形没有沿路坐标。<b>横向渐变</b>留着，因为它只读"这个像素有多深"
                ——区域和路一样有深度，只是它从边界往里数，不是从中轴往外数，
                所以环的顺序是反的。
              </p>
            )}
            {bs.kind === 'camber' && (
              <>
                <Radio label="渐变环数" value={String(bs.rings)}
                  options={CAMBER_RINGS.map((n) => [String(n), String(n)] as const)}
                  onChange={(v) => patchSurface({ rings: Number(v) })} />
                <p className="note">
                  路拱：中间最亮，往路沿逐环变暗。<b>渐变锚在中轴</b>——
                  路面被等分成 {bs.rings + 1} 圈，最亮那圈永远在正中间，
                  路一宽整条渐变跟着宽。反过来做（从路沿往里数固定宽度的环）是镶边效果，
                  中间会留一块随路变宽的死板，路上有中轴线时看着就像画错了。
                  所以<b>加环不占宽度</b>，只是把已有的路面切得更细：
                  这条路的分界落在{' '}
                  {Array.from({ length: bs.rings }, (_, i) =>
                    `${camberEdge(i + 1, bs.rings, surfaceHalf)}px`).join(' / ')}。
                  <br />
                  ⚠ <b>最深那环就是调色板里的「暗色」本身</b>，不是一个凑近它的派生色——
                  那个色是你挑的。所以 1 环时图集还是四种颜色；
                  {bs.rings > 1
                    && `${bs.rings} 环会多出 ${bs.rings - 1} 个派生色（从路面色往暗色插值）。`}
                  只给 1–3 档：再多相邻两环差不到 3，肉眼就分不出来了，
                  而且这么窄的路面也放不下。
                </p>
              </>
            )}
            {bs.kind === 'gravel' && (
              <>
                <Slider label="碎石密度" value={bs.coverage}
                  min={0} max={1} step={0.01}
                  onChange={(v) => patchSurface({ coverage: v })}
                  note={`路面有多少比例转成暗色。默认 0.2，比路沿那条（0.43）低不少——`
                    + `0.43 是量着还原原图那条“边”解出来的，那里抖动本身就是边界；`
                    + `摊到整条路上到 0.4 就不像砂砾，像双色路了。`
                    + `颗粒是 1 个输出像素，不是原图那 2 个：原图的 2 像素是它画在 16px 上留下的，`
                    + `不是砂砾的性质。`} />
                <div className="row wrap" style={{ marginBottom: 12 }}>
                  <button className="ghost"
                    onClick={() => patchSurface({ seed: (bs.seed % 999) + 1 })}>
                    换一个种子（{bs.seed}）
                  </button>
                </div>
              </>
            )}
            {bs.kind === 'ruts' && (
              <>
                <Radio label="车辙宽" value={String(bs.rutWidth)}
                  options={rutWidths.map((w) => [String(w), `${w}px`] as const)}
                  onChange={(v) => patchSurface({ rutWidth: Number(v) })} />
                <p className="note">
                  两条辙印一边一条，位置跟着路自己的宽度走（半宽的 0.55 处），
                  <b>不另开一个滑块</b>——路越宽，两道辙分得越开，这才是它看起来更宽的原因；
                  车不会为了配合路而加宽轮距。这个 0.55 是参数化模式那条 车辙 用的同一个数。
                  这条路上内缘落在 <b>{rutInner(bs.rutWidth, surfaceHalf)}px</b> 处。
                  {rutWidths.length < 3 && ` 更宽的几档没给：这条路的路面只有 ${surfaceHalf}px，`
                    + `再宽辙就压到路沿上去了。`}
                  {' '}这里<b>奇数宽是真的</b>：辙印不对称于中轴，所以 1、2、3px 是三张不同的图——
                  中轴那条线不行，它对称，只能盖偶数列。
                </p>
              </>
            )}
            {surfaceUsesPeriod(bs.kind) && (
              <>
                <Radio label="横纹周期" value={String(bs.period)}
                  options={SURFACE_PERIODS.map((p) => [String(p), `${p}px`] as const)}
                  onChange={(v) => patchSurface({
                    period: Number(v),
                    // A rib as wide as its period is a solid dark road, so
                    // narrowing the period pulls the width down with it
                    // rather than handing over a control the sanitiser
                    // immediately takes back.
                    ribWidth: Math.min(bs.ribWidth, Math.max(2, maxRibWidth(Number(v)))),
                  })} />
                <Radio label="横纹宽" value={String(bs.ribWidth)}
                  options={ribWidths.map((w) => [String(w), `${w}px`] as const)}
                  onChange={(v) => patchSurface({ ribWidth: Number(v) })} />
                <p className="note">
                  横着铺的暗色带，每 {bs.period}px 一条，宽 {bs.ribWidth}px，
                  中间留 {bs.period - bs.ribWidth}px 路面。
                  条纹<b>正卡在路口中心</b>，和虚线用的是同一套相位——
                  两份“周期落在哪”的算法一定会走偏，症状就是四岔的四条臂各有各的相位
                  （实测过一次：64 个像素对不上）。
                  只走偶数宽：条纹以路口为中心对折，奇数宽会把边界正好压在采样点上。
                  {ribWidths.length < 3 && ` ${bs.period}px 的周期最宽只到 ${maxRibWidth(bs.period)}px，`
                    + `再宽两条就贴上了，那就是一条暗色的路。`}
                </p>
              </>
            )}
            <p className="note">
              <b>只换路面颜色。</b>这一层<b>一个像素都不增不减</b>——它只在轮廓已经认下的
              像素上换色，所以边界那一整套接缝证明原封不动。路沿和中轴的像素它根本不问。
              {' '}<b>单色不是“无花纹”，它就是路面本来的样子</b>——
              当初那张参考图 1912 个像素里 1566 个（81.9%）是同一个单色，
              所以这一档只给一个条目，不给两个画出来一样的东西。
              {bs.kind !== 'flat' &&
                ' 纹理没有“不许进最外环”那条规矩（中轴有）：参考图有 679 个路面像素'
                + '就落在最外环上，路面本来就一直铺到路沿跟前。'}
            </p>
          </section>
          <section>
            <h2>导出</h2>
            <div className="row wrap">
              <button onClick={exportBundle}>下载 PNG + JSON</button>
              <button className="ghost" onClick={exportRecipe}>导出配方</button>
              <label className="file ghost">
                导入配方
                <input type="file" accept="application/json"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importRecipe(f); e.target.value = ''; }} />
              </label>
            </div>
            {importError && (
              <p className="note warn">
                <b>没有导入。</b>{importError}
                {' '}宁可什么都不做，也不能只把颜色读进来、几何悄悄变成默认值——
                那样看起来像成功了。
              </p>
            )}
            <p className="note">
              4×4 布局用的是引擎 <code>TWO_EDGE_MATRIX</code> 的槽位顺序，导出的
              128×128 可以直接进 <code>TERRAIN_2_EDGE</code> palette。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ColourRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="colour">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <code>{value}</code>
    </label>
  );
}

function Slider({ label, value, min, max, step, unit, note, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; note?: string;
  /**
   * What to SHOW, when the slider moves in a different quantity than it means.
   *
   * The arc's radius needs this: the shape is quantised by the pixel grid into
   * about sixteen distinct arcs per period, so a raw radius slider would be
   * mostly dead stops. It moves through those sixteen and displays the radius
   * each one actually is.
   */
  display?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="field-head">
        <span>{label}</span>
        <b>{display ?? `${value}${unit ?? ''}`}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      {note && <small>{note}</small>}
    </div>
  );
}

function Radio<T extends string>({ label, value, options, onChange }: {
  label: string; value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <div className="field-head"><span>{label}</span></div>
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function Zoom({ value, onChange, options }: {
  value: number; onChange: (v: number) => void; options: number[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}×</button>
      ))}
    </div>
  );
}
