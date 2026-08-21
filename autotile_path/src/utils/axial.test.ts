import { describe, it, expect } from 'vitest';
import {
  AXIAL_PERIODS, snapPeriod, isJunction, axialHash, crumbleTone,
} from './axial';
import { TILE_SIZE } from './pathField';
import { N, E, S, W } from './twoEdge';

describe('periods divide the tile, which is the whole seam argument', () => {
  it('every offered period is a divisor of 32', () => {
    for (const p of AXIAL_PERIODS) expect(TILE_SIZE % p).toBe(0);
  });

  it('snapPeriod never lets a non-divisor through', () => {
    for (const v of [0, 1, 3, 5, 12, 20, 33, 999]) {
      expect(AXIAL_PERIODS).toContain(snapPeriod(v));
    }
  });
});


describe('junctions', () => {
  it('is three arms or more, which is where the along-road axis stops meaning one thing', () => {
    expect(isJunction(0)).toBe(false);
    expect(isJunction(N)).toBe(false);
    expect(isJunction(N | S)).toBe(false);
    expect(isJunction(N | E)).toBe(false);
    expect(isJunction(N | E | S)).toBe(true);
    expect(isJunction(N | E | S | W)).toBe(true);
  });
});

describe('the dice are TILE-PERIODIC, which is what makes them usable at all', () => {
  it('the pixel hash repeats with the tile in both axes', () => {
    for (const seed of [1, 7, 99]) {
      for (const [x, y] of [[0, 0], [3, 11], [31, 5], [17, 30]] as const) {
        expect(axialHash(x + TILE_SIZE, y, seed)).toBe(axialHash(x, y, seed));
        expect(axialHash(x, y + TILE_SIZE, seed)).toBe(axialHash(x, y, seed));
        expect(axialHash(x - TILE_SIZE, y, seed)).toBe(axialHash(x, y, seed));
      }
    }
  });

  it('...and it moves when the seed does', () => {
    let same = 0;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) {
      if (axialHash(x, y, 1) === axialHash(x, y, 2)) same++;
    }
    expect(same).toBe(0);
  });

  it('the kerb dither hits about the coverage it is asked for', () => {
    for (const coverage of [0.2, 0.43, 0.8]) {
      let on = 0;
      for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) {
        if (crumbleTone(x, y, { coverage, seed: 1 }) !== 0) on++;
      }
      expect(on / 1024, `${coverage}`).toBeGreaterThan(coverage - 0.06);
      expect(on / 1024, `${coverage}`).toBeLessThan(coverage + 0.06);
    }
  });

  it('...and splits what it covers into the two tones it measured as', () => {
    // 29% of the ring the kerb colour and 14% its second tone: a 0.67 split of
    // whatever the coverage is. That ratio is the drawing's, not a choice.
    let one = 0, two = 0;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) {
      const tone = crumbleTone(x, y, { coverage: 1, seed: 3 });
      if (tone === 1) one++;
      else if (tone === 2) two++;
    }
    expect(one / (one + two)).toBeGreaterThan(0.6);
    expect(one / (one + two)).toBeLessThan(0.74);
  });
});
