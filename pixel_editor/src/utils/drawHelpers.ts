import { Point } from "../types";

/**
 * Bresenham's Line Algorithm
 * Generates all grid points between p1 and p2 inclusive.
 */
export function getBresenhamLine(p1: Point, p2: Point): Point[] {
  const points: Point[] = [];
  const x1 = Math.round(p1.x);
  const y1 = Math.round(p1.y);
  const x2 = Math.round(p2.x);
  const y2 = Math.round(p2.y);

  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  let x = x1;
  let y = y1;

  while (true) {
    points.push({ x, y });
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}

/**
 * Generates all grid points for a rectangle between p1 and p2.
 */
export function getRectPoints(p1: Point, p2: Point, fill: boolean): Point[] {
  const points: Point[] = [];
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (fill) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        points.push({ x, y });
      }
    }
  } else {
    // Top & Bottom edges
    for (let x = minX; x <= maxX; x++) {
      points.push({ x, y: minY });
      if (minY !== maxY) {
        points.push({ x, y: maxY });
      }
    }
    // Left & Right edges (excluding corners)
    for (let y = minY + 1; y < maxY; y++) {
      points.push({ x: minX, y });
      if (minX !== maxX) {
        points.push({ x: maxX, y });
      }
    }
  }
  return points;
}

/**
 * Generates all grid points for an ellipse/circle contained within p1 and p2.
 */
export function getCirclePoints(p1: Point, p2: Point, fill: boolean): Point[] {
  const points: Point[] = [];
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const xc = (minX + maxX) / 2;
  const yc = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;

  if (rx <= 0 || ry <= 0) {
    if (rx === 0 && ry === 0) {
      return [{ x: minX, y: minY }];
    }
    return getRectPoints(p1, p2, fill);
  }

  if (fill) {
    // Scanline-based fill
    for (let y = minY; y <= maxY; y++) {
      const dy = y - yc;
      const val = 1 - (dy * dy) / (ry * ry);
      if (val >= 0) {
        const dx = Math.sqrt(rx * rx * val);
        const xStart = Math.ceil(xc - dx);
        const xEnd = Math.floor(xc + dx);
        for (let x = xStart; x <= xEnd; x++) {
          points.push({ x, y });
        }
      }
    }
  } else {
    // Outline - sample horizontally and vertically to guarantee a fully connected, single-pixel shell
    // Vertical scanline edge map
    const borderMap = new Map<number, { min: number; max: number }>();
    for (let y = minY; y <= maxY; y++) {
      const dy = y - yc;
      const val = 1 - (dy * dy) / (ry * ry);
      if (val >= 0) {
        const dx = Math.sqrt(rx * rx * val);
        const xStart = Math.round(xc - dx);
        const xEnd = Math.round(xc + dx);
        borderMap.set(y, { min: xStart, max: xEnd });
      }
    }

    borderMap.forEach((bounds, y) => {
      points.push({ x: bounds.min, y });
      if (bounds.min !== bounds.max) {
        points.push({ x: bounds.max, y });
      }
    });

    // Horizontal column edge map
    const xBorderMap = new Map<number, { min: number; max: number }>();
    for (let x = minX; x <= maxX; x++) {
      const dx = x - xc;
      const val = 1 - (dx * dx) / (rx * rx);
      if (val >= 0) {
        const dy = Math.sqrt(ry * ry * val);
        const yStart = Math.round(yc - dy);
        const yEnd = Math.round(yc + dy);
        xBorderMap.set(x, { min: yStart, max: yEnd });
      }
    }

    xBorderMap.forEach((bounds, x) => {
      points.push({ x, y: bounds.min });
      if (bounds.min !== bounds.max) {
        points.push({ x, y: bounds.max });
      }
    });
  }

  // Deduplicate points
  const seen = new Set<string>();
  return points.filter((p) => {
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
