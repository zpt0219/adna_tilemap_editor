import { describe, it, expect } from "vitest";
import { floodFill } from "../utils/floodFill";

// Mock ImageData in Node test environment if not defined
class MockImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(arg1: any, arg2?: any, arg3?: any) {
    if (arg1 instanceof Uint8ClampedArray || ArrayBuffer.isView(arg1)) {
      this.data = arg1 as Uint8ClampedArray;
      this.width = arg2;
      this.height = arg3;
    } else {
      this.width = arg1;
      this.height = arg2;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

globalThis.ImageData = MockImageData as any;
if (typeof window !== "undefined") {
  (window as any).ImageData = MockImageData;
}

describe("floodFill", () => {
  it("should fill a blank 4x4 image with color completely", () => {
    const img = new ImageData(4, 4);

    // Flood fill from (0,0) with red color
    floodFill(img, { x: 0, y: 0 }, { r: 255, g: 0, b: 0, a: 1.0 });

    // Expect all pixels to be set to red RGBA (255, 0, 0, 255)
    for (let i = 0; i < 16; i++) {
      expect(img.data[i * 4]).toBe(255);
      expect(img.data[i * 4 + 1]).toBe(0);
      expect(img.data[i * 4 + 2]).toBe(0);
      expect(img.data[i * 4 + 3]).toBe(255); // Alpha mapped to 255
    }
  });

  it("should not cross borders of a different color partition", () => {
    const img = new ImageData(3, 3);

    // Set middle row (y=1) to green (0, 255, 0, 255) as a divider partition
    for (let x = 0; x < 3; x++) {
      const idx = (1 * 3 + x) * 4;
      img.data[idx + 0] = 0;
      img.data[idx + 1] = 255;
      img.data[idx + 2] = 0;
      img.data[idx + 3] = 255;
    }

    // Fill top-left (0,0) with blue (0, 0, 255, 255)
    floodFill(img, { x: 0, y: 0 }, { r: 0, g: 0, b: 255, a: 1.0 });

    // Top row (y=0) should be colored blue
    for (let x = 0; x < 3; x++) {
      const idx = (0 * 3 + x) * 4;
      expect(img.data[idx + 0]).toBe(0);
      expect(img.data[idx + 2]).toBe(255);
      expect(img.data[idx + 3]).toBe(255);
    }

    // Middle row (y=1) should remain green
    for (let x = 0; x < 3; x++) {
      const idx = (1 * 3 + x) * 4;
      expect(img.data[idx + 0]).toBe(0);
      expect(img.data[idx + 1]).toBe(255);
      expect(img.data[idx + 2]).toBe(0);
      expect(img.data[idx + 3]).toBe(255);
    }

    // Bottom row (y=2) should remain transparent (0, 0, 0, 0)
    for (let x = 0; x < 3; x++) {
      const idx = (2 * 3 + x) * 4;
      expect(img.data[idx + 0]).toBe(0);
      expect(img.data[idx + 1]).toBe(0);
      expect(img.data[idx + 2]).toBe(0);
      expect(img.data[idx + 3]).toBe(0);
    }
  });
});
