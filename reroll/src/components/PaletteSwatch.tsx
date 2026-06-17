import { useEffect, useRef } from "react";
import { mappingCell, type Palette, type PackRuntime } from "../pack/types";

// Cropped preview of one palette from the shared atlas.
export function PaletteSwatch({ pack, palette, px = 40 }: { pack: PackRuntime; palette: Palette; px?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const [bx, by] = mappingCell(palette.mapping, 0, 0);
    const tr = palette.tileResolution;
    const sw = palette.size[0] * tr;
    const sh = palette.size[1] * tr;
    const f = Math.min(px / sw, px / sh);
    const dw = Math.max(1, Math.round(sw * f));
    const dh = Math.max(1, Math.round(sh * f));
    ctx.clearRect(0, 0, px, px);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pack.atlas, bx, by, sw, sh, Math.floor((px - dw) / 2), Math.floor((px - dh) / 2), dw, dh);
  }, [pack, palette, px]);
  return <canvas ref={ref} width={px} height={px} className="pal-sw" />;
}
