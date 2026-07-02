import { describe, it, expect } from "vitest";
import { HistoryManager, cloneLayers } from "../utils/history";
import { Layer } from "../types";

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

describe("HistoryManager", () => {
  const createMockLayer = (id: string, name: string): Layer => ({
    id,
    name,
    visible: true,
    opacity: 1.0,
    pixels: new ImageData(2, 2),
  });

  it("should deep clone layers correctly", () => {
    const layers = [createMockLayer("l1", "Layer 1")];
    // Modify one pixel in original
    layers[0].pixels.data[0] = 42;

    const cloned = cloneLayers(layers);
    expect(cloned[0].id).toBe("l1");
    expect(cloned[0].pixels.data[0]).toBe(42);

    // Verify it is a deep copy: modifying clone shouldn't change original
    cloned[0].pixels.data[0] = 99;
    expect(layers[0].pixels.data[0]).toBe(42);
  });

  it("should handle pushing state and undoing/redoing", () => {
    const history = new HistoryManager(5);
    const layers1 = [createMockLayer("l1", "Layer 1")];
    
    // Initial state
    history.init(layers1, "l1");
    expect(history.getUndoCount()).toBe(1);
    expect(history.getRedoCount()).toBe(0);

    // Perform action 1: modify pixel and push
    const layers2 = cloneLayers(layers1);
    layers2[0].pixels.data[0] = 10;
    history.pushState(layers2, "l1");

    expect(history.getUndoCount()).toBe(2);
    expect(history.getRedoCount()).toBe(0);

    // Perform action 2: modify pixel and push
    const layers3 = cloneLayers(layers2);
    layers3[0].pixels.data[0] = 20;
    history.pushState(layers3, "l1");

    expect(history.getUndoCount()).toBe(3);

    // Undo action 2
    const undo1 = history.undo();
    expect(undo1).not.toBeNull();
    expect(undo1!.layers[0].pixels.data[0]).toBe(10); // Matches layers2 state
    expect(history.getUndoCount()).toBe(2);
    expect(history.getRedoCount()).toBe(1);

    // Redo action 2
    const redo1 = history.redo();
    expect(redo1).not.toBeNull();
    expect(redo1!.layers[0].pixels.data[0]).toBe(20); // Back to layers3 state
    expect(history.getUndoCount()).toBe(3);
    expect(history.getRedoCount()).toBe(0);
  });

  it("should enforce maximum history depth limit", () => {
    const history = new HistoryManager(3); // Max depth = 3
    const baseLayers = [createMockLayer("l1", "Layer 1")];
    history.init(baseLayers, "l1");

    // Push 5 states
    for (let i = 1; i <= 5; i++) {
      const stateLayers = cloneLayers(baseLayers);
      stateLayers[0].pixels.data[0] = i;
      history.pushState(stateLayers, "l1");
    }

    // Since max depth is 3:
    // Stack should only keep the last 3 states
    expect(history.getUndoCount()).toBe(3);
  });
});
