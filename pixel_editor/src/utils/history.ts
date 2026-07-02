import { Layer } from "../types";

export interface HistoryState {
  layers: Layer[];
  activeLayerId: string;
}

/**
 * Deep clones the Layer list, including duplicating the raw ImageData.
 */
export function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    pixels: new ImageData(
      new Uint8ClampedArray(layer.pixels.data),
      layer.pixels.width,
      layer.pixels.height
    ),
  }));
}

/**
 * A helper class to manage history states.
 */
export class HistoryManager {
  private undoStack: HistoryState[] = [];
  private redoStack: HistoryState[] = [];
  private maxDepth: number;

  constructor(maxDepth = 50) {
    this.maxDepth = maxDepth;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * Pushes a new state onto the undo stack and clears the redo stack.
   */
  public pushState(layers: Layer[], activeLayerId: string): void {
    // Clear redo stack on new actions
    this.redoStack = [];

    const state: HistoryState = {
      layers: cloneLayers(layers),
      activeLayerId,
    };

    this.undoStack.push(state);

    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
  }

  /**
   * Resets history to a single starting state.
   */
  public init(layers: Layer[], activeLayerId: string): void {
    this.undoStack = [{
      layers: cloneLayers(layers),
      activeLayerId,
    }];
    this.redoStack = [];
  }

  /**
   * Moves backwards in history. Returns the previous state if available.
   */
  public undo(): HistoryState | null {
    if (this.undoStack.length <= 1) {
      // Must keep at least the initial state
      return null;
    }

    // Pop the current state and move it to the redo stack
    const currentState = this.undoStack.pop();
    if (currentState) {
      this.redoStack.push(currentState);
    }

    // Peek at the previous state
    const prevState = this.undoStack[this.undoStack.length - 1];
    return {
      layers: cloneLayers(prevState.layers),
      activeLayerId: prevState.activeLayerId,
    };
  }

  /**
   * Moves forwards in history. Returns the next state if available.
   */
  public redo(): HistoryState | null {
    if (this.redoStack.length === 0) {
      return null;
    }

    const nextState = this.redoStack.pop();
    if (!nextState) {
      return null;
    }

    this.undoStack.push(nextState);

    return {
      layers: cloneLayers(nextState.layers),
      activeLayerId: nextState.activeLayerId,
    };
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
