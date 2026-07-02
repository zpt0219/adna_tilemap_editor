import { Point, RGBA } from "../types";

/**
 * Queue-based Flood Fill Algorithm
 * Modifies the provided ImageData object in-place.
 */
export function floodFill(
  imageData: ImageData,
  start: Point,
  fillColor: RGBA
): void {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const startX = Math.floor(start.x);
  const startY = Math.floor(start.y);

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return;
  }

  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  const fillR = fillColor.r;
  const fillG = fillColor.g;
  const fillB = fillColor.b;
  const fillA = Math.round(fillColor.a * 255);

  // If target color matches the fill color, return immediately to prevent infinite loops
  if (
    targetR === fillR &&
    targetG === fillG &&
    targetB === fillB &&
    targetA === fillA
  ) {
    return;
  }

  // Queue stores flat coordinates [x, y, x, y, ...]
  const queue: number[] = [startX, startY];

  const matchColor = (idx: number): boolean => {
    return (
      data[idx] === targetR &&
      data[idx + 1] === targetG &&
      data[idx + 2] === targetB &&
      data[idx + 3] === targetA
    );
  };

  const setColor = (idx: number): void => {
    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = fillA;
  };

  // We keep track of visited coordinates in a quick-lookup array or set to avoid duplicate queuing.
  // Using a boolean array representing pixel grid.
  const visited = new Uint8Array(width * height);
  visited[startY * width + startX] = 1;

  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];

    const idx = (cy * width + cx) * 4;
    if (matchColor(idx)) {
      setColor(idx);

      // Check 4-way neighbors
      // West
      if (cx > 0) {
        const nIndex = cy * width + (cx - 1);
        if (visited[nIndex] === 0) {
          visited[nIndex] = 1;
          queue.push(cx - 1, cy);
        }
      }
      // East
      if (cx < width - 1) {
        const nIndex = cy * width + (cx + 1);
        if (visited[nIndex] === 0) {
          visited[nIndex] = 1;
          queue.push(cx + 1, cy);
        }
      }
      // North
      if (cy > 0) {
        const nIndex = (cy - 1) * width + cx;
        if (visited[nIndex] === 0) {
          visited[nIndex] = 1;
          queue.push(cx, cy - 1);
        }
      }
      // South
      if (cy < height - 1) {
        const nIndex = (cy + 1) * width + cx;
        if (visited[nIndex] === 0) {
          visited[nIndex] = 1;
          queue.push(cx, cy + 1);
        }
      }
    }
  }
}
export default floodFill;
