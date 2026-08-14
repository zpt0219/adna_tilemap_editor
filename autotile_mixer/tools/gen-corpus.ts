// gen-corpus.ts — bake the parity corpus.
//
//   npm run gen-corpus            # writes ../../autotile_imgui/corpus
//   npm run gen-corpus -- --out X # somewhere else
//
// The corpus lives in the DESKTOP repo, not here: it is that project's grader,
// and keeping it there means its test suite needs neither node nor this repo.
// This generator stays here because it has to run the TypeScript it captures.
//
// Output layout:
//   corpus/manifest.json          index: id, tier, note, hashes, per-case allowance
//   corpus/recipes/<id>.json      the input the desktop app reads
//   corpus/expected/<id>.png      ground truth, 256x192 RGBA
//   corpus/expected/<id>.lvl.gz   the level grid, for attributing a failure
//
// Determinism matters more than speed here: an unchanged corpus must re-bake to
// byte-identical files, so that regenerating it after an algorithm change shows
// exactly which cases moved.

import { gzipSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderSheetRGBA, renderLevelGrid, SHEET_WIDTH, SHEET_HEIGHT, SHEET_TILE_SIZE,
} from '../src/utils/renderSheet';
import { BLOB47_COLS, BLOB47_ROWS, BLOB47_LAYOUT } from '../src/utils/blob47';
import { buildCorpus, FUZZ_SEED, FUZZ_COUNT, type CorpusCase } from './corpusCases';
import { encodePngRGBA, fnv1a, fnv1aString } from './png';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Bumped by hand whenever the corpus's own shape changes (a new tier, a new
 * field in the manifest). It is NOT a content hash — content changes are
 * detected by the per-case hashes moving, which is the point.
 */
const CORPUS_VERSION = 1;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hex32(n: number): string {
  return '0x' + (n >>> 0).toString(16).padStart(8, '0');
}

function main() {
  const outDir = resolve(HERE, '..', arg('out', '../../autotile_imgui/corpus'));
  const recipesDir = join(outDir, 'recipes');
  const expectedDir = join(outDir, 'expected');

  const cases = buildCorpus();
  console.log(`corpus: ${cases.length} cases -> ${outDir}`);

  // Wiped rather than merged: a case that has been renamed or dropped must not
  // linger as an orphan PNG that nothing verifies any more.
  rmSync(recipesDir, { recursive: true, force: true });
  rmSync(expectedDir, { recursive: true, force: true });
  mkdirSync(recipesDir, { recursive: true });
  mkdirSync(expectedDir, { recursive: true });

  const entries: unknown[] = [];
  const byTier = new Map<string, number>();
  let pngBytes = 0;
  let lvlBytes = 0;
  const started = Date.now();

  for (const c of cases as CorpusCase[]) {
    const rgba = renderSheetRGBA(c.recipe, c.overrides ?? {});
    const levels = renderLevelGrid(c.recipe, c.overrides ?? {});

    const png = encodePngRGBA(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), SHEET_WIDTH, SHEET_HEIGHT);
    // The level grid is ~48KB of digits per case and compresses to almost
    // nothing; storing it raw would be 60MB of corpus for no benefit.
    const lvl = gzipSync(Buffer.from(levels, 'latin1'), { level: 9 });

    writeFileSync(join(expectedDir, `${c.id}.png`), png);
    writeFileSync(join(expectedDir, `${c.id}.lvl.gz`), lvl);
    writeFileSync(join(recipesDir, `${c.id}.json`), JSON.stringify({
      v: 1,
      id: c.id,
      note: c.note,
      recipe: c.recipe,
      ...(c.overrides ? { overrides: c.overrides } : {}),
    }, null, 2) + '\n');

    pngBytes += png.length;
    lvlBytes += lvl.length;
    byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1);

    entries.push({
      id: c.id,
      tier: c.tier,
      note: c.note,
      image: `expected/${c.id}.png`,
      levels: `expected/${c.id}.lvl.gz`,
      recipe: `recipes/${c.id}.json`,
      ...(c.overrides ? { overrides: c.overrides } : {}),
      rgbaFnv1a: hex32(fnv1a(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length))),
      levelFnv1a: hex32(fnv1aString(levels)),
      /**
       * Per-channel tolerance this case is allowed to fail by. 0 means exact,
       * which is the only value anything should ship with — an allowance is a
       * recorded concession about one specific libm divergence, with a reason,
       * not a knob to widen when the port is wrong. A boundary flip in the
       * quantiser lands a pixel in a whole different shade, so it clears any
       * sane allowance and still fails.
       */
      maxDelta: 0,
    });
  }

  const manifest = {
    corpusVersion: CORPUS_VERSION,
    generatedBy: 'autotile_mixer/tools/gen-corpus.ts',
    webGitSha: process.env.CORPUS_GIT_SHA ?? null,
    sheet: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      tileSize: SHEET_TILE_SIZE,
      columns: BLOB47_COLS,
      rows: BLOB47_ROWS,
      slots: BLOB47_LAYOUT.length,
      layout: Array.from(BLOB47_LAYOUT),
    },
    hash: {
      algorithm: 'fnv1a-32',
      offsetBasis: hex32(0x811c9dc5),
      prime: hex32(0x01000193),
      note: 'Computed over the raw RGBA bytes of the whole sheet, not over the PNG file.',
    },
    compare: {
      // The rules the verifier enforces, written down where both sides can read
      // them rather than living only in verify.py.
      alphaZeroIgnoresRGB: true,
      note: 'A pixel with alpha 0 is compared on alpha alone: its RGB is unspecified because nothing is drawn there.',
    },
    fuzz: { seed: FUZZ_SEED, count: FUZZ_COUNT },
    counts: Object.fromEntries([...byTier.entries()].sort()),
    total: entries.length,
    cases: entries,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`  by tier: ${[...byTier.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  png ${mb(pngBytes)}, levels ${mb(lvlBytes)}, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main();
