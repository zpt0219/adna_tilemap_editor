import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { TRANSLATIONS, type Lang } from './shared/i18n';
import { blendTilePixels, type RenderParams } from './utils/tiles';

const COLS = 16;
const ROWS = 10;

// Standard Brigid's Cross layout indices (0-15 mapped to grid slots in row-major order)
// e.g. Row 0: [4, 3, 14, 6], Row 1: [10, 7, 15, 13], ...
const WANG_LAYOUT = [4, 3, 14, 6, 10, 7, 15, 13, 1, 9, 11, 12, 0, 2, 5, 8];

// Inverse layout mapping (gives the 0-15 grid position of each 0-15 tile Index)
const WANG_INVERSE_LAYOUT = [12, 8, 13, 1, 0, 14, 3, 5, 15, 9, 4, 10, 11, 7, 2, 6];

// Blob layout mapping in a 5x3 grid (3x3 outer/edges + 2x2 inner corners + background + empty)
const BLOB_LAYOUT = [
  5, 1, 6, 11, 12,  // Row 0
  3, 0, 4, 10, 9,   // Row 1
  7, 2, 8, 13, -1   // Row 2 (slot 14 is empty / -1)
];

// Inverse layout mapping (gives the 0-14 grid position of each 0-13 Blob tile Index)
const BLOB_INVERSE_LAYOUT = [
  6,  // 0: Center
  1,  // 1: Edge Top
  11, // 2: Edge Bottom
  5,  // 3: Edge Left
  7,  // 4: Edge Right
  0,  // 5: Outer TL
  2,  // 6: Outer TR
  10, // 7: Outer BL
  12, // 8: Outer BR
  9,  // 9: Inner TL
  8,  // 10: Inner TR
  3,  // 11: Inner BL
  4,  // 12: Inner BR
  13  // 13: Background
];

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('adna_lang') as Lang) || 'zh';
  });

  const t = TRANSLATIONS[lang];

  // Tileset Type: true = Wang 16, false = Blob 14
  const [isWang, setIsWang] = useState(true);

  // Grid helper
  const [showGrid, setShowGrid] = useState(true);

  // Tile size config
  const [tileSize, setTileSize] = useState(32);

  // Interactive playground state
  const [blobCells, setBlobCells] = useState<number[][]>(() =>
    Array(ROWS).fill(null).map(() => Array(COLS).fill(0))
  );
  
  // For Wang tileset, vertices are (ROWS+1) x (COLS+1)
  const [wangVertices, setWangVertices] = useState<number[][]>(() =>
    Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0))
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawVal, setDrawVal] = useState<number>(1); // 1 = paint A, 0 = paint B (erase)

  // Canvas refs
  const tilesetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanSheetCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Handle language toggle
  const toggleLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    localStorage.setItem('adna_lang', next);
  };

  // Re-generate tileset sheet on state changes
  useEffect(() => {
    const canvas = tilesetCanvasRef.current;
    if (!canvas) return;

    const params: RenderParams = {
      tileSize,
    };

    const cols = isWang ? 4 : 5;
    const rows = isWang ? 4 : 3;

    // Maintain an offscreen canvas with clean tileset pixels (without grid lines)
    if (!cleanSheetCanvasRef.current) {
      cleanSheetCanvasRef.current = document.createElement('canvas');
    }
    const cleanCanvas = cleanSheetCanvasRef.current;
    cleanCanvas.width = cols * tileSize;
    cleanCanvas.height = rows * tileSize;

    const cleanCtx = cleanCanvas.getContext('2d');
    if (!cleanCtx) return;
    cleanCtx.clearRect(0, 0, cleanCanvas.width, cleanCanvas.height);

    const totalTiles = isWang ? 16 : 15;
    for (let i = 0; i < totalTiles; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tileIdx = isWang ? WANG_LAYOUT[i] : BLOB_LAYOUT[i];
      if (tileIdx === -1) {
        continue;
      }
      const tileData = blendTilePixels(
        tileIdx,
        isWang,
        params
      );
      cleanCtx.putImageData(tileData, col * tileSize, row * tileSize);
    }

    // Render to on-screen preview canvas
    canvas.width = cols * tileSize;
    canvas.height = rows * tileSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cleanCanvas, 0, 0);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      // Horizontal lines
      for (let r = 1; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * tileSize);
        ctx.lineTo(canvas.width, r * tileSize);
        ctx.stroke();
      }
      // Vertical lines
      for (let c = 1; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * tileSize, 0);
        ctx.lineTo(c * tileSize, canvas.height);
        ctx.stroke();
      }
    }
  }, [isWang, tileSize, showGrid]);

  // Re-draw playground
  useEffect(() => {
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = COLS * tileSize;
    canvas.height = ROWS * tileSize;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawTileFromSheet = (tileIndex: number, destCol: number, destRow: number) => {
      const sheetCols = isWang ? 4 : 5;
      let sheetIndex = tileIndex;
      if (isWang) {
        sheetIndex = WANG_INVERSE_LAYOUT[tileIndex];
      } else {
        sheetIndex = BLOB_INVERSE_LAYOUT[tileIndex];
      }
      const srcCol = sheetIndex % sheetCols;
      const srcRow = Math.floor(sheetIndex / sheetCols);
      const sourceCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
      if (sourceCanvas) {
        ctx.drawImage(
          sourceCanvas,
          srcCol * tileSize, srcRow * tileSize, tileSize, tileSize,
          destCol * tileSize, destRow * tileSize, tileSize, tileSize
        );
      }
    };

    if (isWang) {
      // Wang rendering
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const nw = wangVertices[r]?.[c] ?? 0;
          const ne = wangVertices[r]?.[c + 1] ?? 0;
          const se = wangVertices[r + 1]?.[c + 1] ?? 0;
          const sw = wangVertices[r + 1]?.[c] ?? 0;
          const tileIdx = (nw << 3) | (sw << 2) | (se << 1) | ne;
          drawTileFromSheet(tileIdx, c, r);
        }
      }

      // Overlap vertices dots
      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
          const val = wangVertices[r]?.[c] ?? 0;
          ctx.beginPath();
          ctx.arc(c * tileSize, r * tileSize, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = val === 1 ? '#22c55e' : '#78350f';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
        }
      }
    } else {
      // Blob rendering
      const getCellVal = (c: number, r: number) => {
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return 0;
        return blobCells[r][c];
      };

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const selfState = getCellVal(c, r);
          if (selfState === 0) {
            drawTileFromSheet(13, c, r); // Background tile
          } else {
            const t = getCellVal(c, r - 1) === 1;
            const b = getCellVal(c, r + 1) === 1;
            const l = getCellVal(c - 1, r) === 1;
            const right = getCellVal(c + 1, r) === 1;
            const tl = getCellVal(c - 1, r - 1) === 1;
            const tr = getCellVal(c + 1, r - 1) === 1;
            const bl = getCellVal(c - 1, r + 1) === 1;
            const br = getCellVal(c + 1, r + 1) === 1;

            let tileIdx = 0;

            if (!t && !l && b && right) {
              tileIdx = 5;
            } else if (!t && !right && b && l) {
              tileIdx = 6;
            } else if (!b && !l && t && right) {
              tileIdx = 7;
            } else if (!b && !right && t && l) {
              tileIdx = 8;
            } else if (!t && l && right && b) {
              tileIdx = 1;
            } else if (!b && l && right && t) {
              tileIdx = 2;
            } else if (!l && t && b && right) {
              tileIdx = 3;
            } else if (!right && t && b && l) {
              tileIdx = 4;
            } else if (t && b && l && right) {
              if (!tl) tileIdx = 9;
              else if (!tr) tileIdx = 10;
              else if (!bl) tileIdx = 11;
              else if (!br) tileIdx = 12;
              else tileIdx = 0; // Center
            } else {
              tileIdx = 0; // fallback to center
            }
            drawTileFromSheet(tileIdx, c, r);
          }
        }
      }
    }
  }, [blobCells, wangVertices, isWang, tileSize, showGrid]);

  // Painting interaction logic
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const val = e.button === 0 ? 1 : 0; // Left = 1 (A), Right = 0 (B)
    setDrawVal(val);
    setIsDrawing(true);

    paintPixel(x * scaleX, y * scaleY, val);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = playgroundCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    paintPixel(x * scaleX, y * scaleY, drawVal);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const paintPixel = (px: number, py: number, val: number) => {
    if (isWang) {
      // Paint nearest vertex
      const vx = Math.round(px / tileSize);
      const vy = Math.round(py / tileSize);
      if (vx >= 0 && vx <= COLS && vy >= 0 && vy <= ROWS) {
        setWangVertices(prev => {
          const next = prev.map(row => [...row]);
          next[vy][vx] = val;
          return next;
        });
      }
    } else {
      // Paint cell
      const cx = Math.floor(px / tileSize);
      const cy = Math.floor(py / tileSize);
      if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
        setBlobCells(prev => {
          const next = prev.map(row => [...row]);
          next[cy][cx] = val;
          return next;
        });
      }
    }
  };

  const clearPlayground = () => {
    if (isWang) {
      setWangVertices(Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0)));
    } else {
      setBlobCells(Array(ROWS).fill(null).map(() => Array(COLS).fill(0)));
    }
  };

  const downloadTileset = () => {
    const cleanCanvas = cleanSheetCanvasRef.current || tilesetCanvasRef.current;
    if (!cleanCanvas) return;
    const link = document.createElement('a');
    link.download = `tileset_${isWang ? 'wang16' : 'blob14'}_${tileSize}px.png`;
    link.href = cleanCanvas.toDataURL();
    link.click();
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <a href="/" className="back-btn">
            <span>←</span> Back to Home
          </a>
          <div className="app-title-group">
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <div className="header-right">
          <button className="btn-lang" onClick={toggleLang}>
            {t.langBtn}
          </button>
        </div>
      </header>

      <main className="main-grid">
        {/* Sidebar Controls */}
        <aside className="sidebar">
          {/* Section: Type & Options */}
          <section className="panel-card">
            <h2 className="panel-title">{t.tilesetType}</h2>
            <div className="type-tabs" style={{ marginBottom: '16px' }}>
              <button 
                className={`tab-btn ${isWang ? 'active' : ''}`}
                onClick={() => setIsWang(true)}
              >
                {t.wang16}
              </button>
              <button 
                className={`tab-btn ${!isWang ? 'active' : ''}`}
                onClick={() => setIsWang(false)}
              >
                {t.blob14}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label className="checkbox-group">
                <input 
                  type="checkbox" 
                  checked={showGrid} 
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="checkbox-input"
                />
                <span className="checkbox-label">{t.showGrid}</span>
              </label>

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.tileSize}</span>
                  <span className="slider-val">{tileSize} px</span>
                </div>
                <select 
                  className="text-input"
                  value={tileSize}
                  onChange={(e) => setTileSize(parseInt(e.target.value))}
                >
                  <option value={16}>16 x 16</option>
                  <option value={32}>32 x 32</option>
                  <option value={48}>48 x 48</option>
                  <option value={64}>64 x 64</option>
                  <option value={128}>128 x 128</option>
                </select>
              </div>
            </div>
          </section>
        </aside>

        {/* Previews and Painter Playground */}
        <div className="content-area">
          {/* Tileset Sheet Preview */}
          <section className="panel-card preview-card">
            <h2 className="panel-title" style={{ alignSelf: 'flex-start' }}>{t.tilesetPreview}</h2>
            <div className="canvas-container">
              <canvas ref={tilesetCanvasRef} className="tileset-canvas" />
            </div>
            <div className="action-bar">
              <button className="btn-action" onClick={downloadTileset}>
                💾 {t.downloadPng}
              </button>
            </div>
          </section>

          {/* Interactive Playground Painter */}
          <section className="panel-card playground-panel">
            <h2 className="panel-title">{t.playgroundTitle}</h2>
            <p className="playground-tip">
              <span className="tip-badge">Tip</span>
              {t.playgroundTip}
            </p>
            <div className="playground-canvas-wrapper">
              <canvas 
                ref={playgroundCanvasRef} 
                className="playground-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onContextMenu={(e) => e.preventDefault()}
              />
            </div>
            <div className="action-bar" style={{ marginTop: '16px' }}>
              <button className="btn-action btn-secondary" onClick={clearPlayground}>
                🗑️ {t.clearPlayground}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
