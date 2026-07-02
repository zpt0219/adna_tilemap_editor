export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0.0 to 1.0
  pixels: ImageData;
}

export type ToolType = 'pen' | 'eraser' | 'bucket' | 'line' | 'rect' | 'circle' | 'picker';

export interface Point {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}
