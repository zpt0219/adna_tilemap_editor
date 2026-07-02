import { describe, it, expect } from "vitest";
import { getBresenhamLine, getRectPoints, getCirclePoints } from "../utils/drawHelpers";

describe("drawHelpers", () => {
  describe("getBresenhamLine", () => {
    it("should generate a single point if start and end are the same", () => {
      const pts = getBresenhamLine({ x: 5, y: 5 }, { x: 5, y: 5 });
      expect(pts).toEqual([{ x: 5, y: 5 }]);
    });

    it("should generate a straight horizontal line correctly", () => {
      const pts = getBresenhamLine({ x: 2, y: 3 }, { x: 5, y: 3 });
      expect(pts).toEqual([
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
      ]);
    });

    it("should generate a straight vertical line correctly", () => {
      const pts = getBresenhamLine({ x: 4, y: 1 }, { x: 4, y: 4 });
      expect(pts).toEqual([
        { x: 4, y: 1 },
        { x: 4, y: 2 },
        { x: 4, y: 3 },
        { x: 4, y: 4 },
      ]);
    });

    it("should generate a diagonal line correctly", () => {
      const pts = getBresenhamLine({ x: 0, y: 0 }, { x: 2, y: 2 });
      expect(pts).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]);
    });
  });

  describe("getRectPoints", () => {
    it("should generate filled rectangle points correctly", () => {
      const pts = getRectPoints({ x: 1, y: 1 }, { x: 3, y: 2 }, true);
      // Expected: 6 points: (1,1), (1,2), (2,1), (2,2), (3,1), (3,2)
      expect(pts.length).toBe(6);
      expect(pts).toContainEqual({ x: 1, y: 1 });
      expect(pts).toContainEqual({ x: 3, y: 2 });
    });

    it("should generate hollow rectangle outline points correctly", () => {
      const pts = getRectPoints({ x: 0, y: 0 }, { x: 2, y: 2 }, false);
      // Perimeter of a 3x3 square is 8 points
      expect(pts.length).toBe(8);
      // Center (1,1) should NOT be present in hollow rect
      expect(pts).not.toContainEqual({ x: 1, y: 1 });
    });
  });

  describe("getCirclePoints", () => {
    it("should return a single point if box is 0x0", () => {
      const pts = getCirclePoints({ x: 2, y: 2 }, { x: 2, y: 2 }, false);
      expect(pts).toEqual([{ x: 2, y: 2 }]);
    });

    it("should generate symmetric points for filled ellipse", () => {
      const pts = getCirclePoints({ x: 0, y: 0 }, { x: 4, y: 4 }, true);
      expect(pts.length).toBeGreaterThan(0);
      // Center (2, 2) must be inside
      expect(pts).toContainEqual({ x: 2, y: 2 });
    });
  });
});
