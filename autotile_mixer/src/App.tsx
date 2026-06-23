import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { TRANSLATIONS, type Lang } from './shared/i18n';
import { blendTilePixels, type RenderParams, EASING_FUNCTIONS } from './utils/tiles';

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
  3,  // 11: Inner BR
  4,  // 12: Inner BL
  13  // 13: Background
];

// Map each of the 16 Wang corner configurations to the corresponding 14 Blob tile index
const WANG_TO_BLOB = [
  13, // 0:  [0,0,0,0] -> Background
  7,  // 1:  [0,0,0,1] -> Outer BL
  5,  // 2:  [0,0,1,0] -> Outer TL
  3,  // 3:  [0,0,1,1] -> Edge Left
  6,  // 4:  [0,1,0,0] -> Outer TR
  0,  // 5:  [0,1,0,1] -> Diagonal NE+SW (fallback to Center)
  1,  // 6:  [0,1,1,0] -> Edge Top
  9,  // 7:  [0,1,1,1] -> Inner TL
  8,  // 8:  [1,0,0,0] -> Outer BR
  2,  // 9:  [1,0,0,1] -> Edge Bottom
  0,  // 10: [1,0,1,0] -> Diagonal NW+SE (fallback to Center)
  12, // 11: [1,0,1,1] -> Inner BL
  4,  // 12: [1,1,0,0] -> Edge Right
  11, // 13: [1,1,0,1] -> Inner BR
  10, // 14: [1,1,1,0] -> Inner TR
  0   // 15: [1,1,1,1] -> Center
];

function imageDataToURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  }
  return '';
}

function generateDefaultTexture(type: 'grass' | 'dirt', size: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(size, size);
  
  if (type === 'grass') {
    ctx.fillStyle = '#16a34a'; // Grass base green
    ctx.fillRect(0, 0, size, size);
    
    // Add texture detail pixels
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rand = Math.random();
        if (rand < 0.15) {
          ctx.fillStyle = '#15803d'; // darker
          ctx.fillRect(x, y, 1, 1);
        } else if (rand > 0.85) {
          ctx.fillStyle = '#22c55e'; // lighter
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    
    // Add small pixel grass clumps
    ctx.fillStyle = '#4ade80';
    const clumps = Math.floor(size * size * 0.015);
    for (let i = 0; i < clumps; i++) {
      const gx = Math.floor(Math.random() * (size - 2));
      const gy = Math.floor(Math.random() * (size - 3)) + 2;
      ctx.fillRect(gx, gy, 1, 1);
      ctx.fillRect(gx + 1, gy - 1, 1, 2);
    }
  } else {
    ctx.fillStyle = '#78350f'; // Dirt base brown
    ctx.fillRect(0, 0, size, size);
    
    // Add texture details
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const rand = Math.random();
        if (rand < 0.2) {
          ctx.fillStyle = '#451a03'; // dark brown
          ctx.fillRect(x, y, 1, 1);
        } else if (rand > 0.8) {
          ctx.fillStyle = '#9a3412'; // light brown
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    
    // Add pixel stones
    ctx.fillStyle = '#a16207';
    const stones = Math.floor(size * size * 0.008);
    for (let i = 0; i < stones; i++) {
      const sx = Math.floor(Math.random() * (size - 1));
      const sy = Math.floor(Math.random() * (size - 1));
      ctx.fillRect(sx, sy, 2, 1);
      ctx.fillRect(sx, sy + 1, 1, 1);
    }
  }
  
  return ctx.getImageData(0, 0, size, size);
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem('adna_lang') as Lang) || 'zh';
  });

  const t = TRANSLATIONS[lang];

  // Tileset Type: true = Wang 16, false = Blob 14
  const [isWang, setIsWang] = useState(true);

  // Textures state
  const [imgAData, setImgAData] = useState<ImageData | null>(null);
  const [imgBData, setImgBData] = useState<ImageData | null>(null);
  const [imgAUrl, setImgAUrl] = useState<string>('');
  const [imgBUrl, setImgBUrl] = useState<string>('');
  const [hasUploadedA, setHasUploadedA] = useState(false);
  const [hasUploadedB, setHasUploadedB] = useState(false);

  // Grid helper
  const [showGrid, setShowGrid] = useState(true);

  // Tile size config
  const [tileSize, setTileSize] = useState(32);

  // Smoothness (gradient transition width) config
  const [smoothness, setSmoothness] = useState(0.15);

  // Easing function configuration (defaults to 'linear')
  const [easing, setEasing] = useState<string>('linear');

  // Zoom config (integer scale factor for visual canvas sizes)
  const [zoom, setZoom] = useState(2);

  // Interactive playground state (both Wang & Blob share corner-based vertices)
  const [wangVertices, setWangVertices] = useState<number[][]>(() =>
    Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0))
  );

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawVal, setDrawVal] = useState<number>(1); // 1 = paint A, 0 = paint B (erase)

  // Canvas refs
  const tilesetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanSheetCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Input file refs
  const fileInputARef = useRef<HTMLInputElement | null>(null);
  const fileInputBRef = useRef<HTMLInputElement | null>(null);

  // Handle language toggle
  const toggleLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    localStorage.setItem('adna_lang', next);
  };

  // Generate presets on start or when tileSize changes (if not uploaded)
  useEffect(() => {
    if (!hasUploadedA) {
      const defaultA = generateDefaultTexture('grass', tileSize);
      setImgAData(defaultA);
      setImgAUrl(imageDataToURL(defaultA));
    }
  }, [tileSize, hasUploadedA]);

  useEffect(() => {
    if (!hasUploadedB) {
      const defaultB = generateDefaultTexture('dirt', tileSize);
      setImgBData(defaultB);
      setImgBUrl(imageDataToURL(defaultB));
    }
  }, [tileSize, hasUploadedB]);

  // Read uploaded images
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, target: 'A' | 'B') => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadImgFile(file, target);
  };

  const loadImgFile = (file: File, target: 'A' | 'B') => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        if (target === 'A') {
          setImgAData(data);
          setImgAUrl(url);
          setHasUploadedA(true);
        } else {
          setImgBData(data);
          setImgBUrl(url);
          setHasUploadedB(true);
        }
      }
    };
    img.src = url;
  };

  const usePreset = (target: 'A' | 'B') => {
    if (target === 'A') {
      setHasUploadedA(false);
      const defaultA = generateDefaultTexture('grass', tileSize);
      setImgAData(defaultA);
      setImgAUrl(imageDataToURL(defaultA));
    } else {
      setHasUploadedB(false);
      const defaultB = generateDefaultTexture('dirt', tileSize);
      setImgBData(defaultB);
      setImgBUrl(imageDataToURL(defaultB));
    }
  };

  const swapTextures = () => {
    setImgAData(imgBData);
    setImgBData(imgAData);

    setImgAUrl(imgBUrl);
    setImgBUrl(imgAUrl);

    const tempHasUploaded = hasUploadedA;
    setHasUploadedA(hasUploadedB);
    setHasUploadedB(tempHasUploaded);
  };

  // Re-generate tileset sheet on state changes
  useEffect(() => {
    const canvas = tilesetCanvasRef.current;
    if (!canvas) return;

    const params: RenderParams = {
      tileSize,
      smoothness,
      easing,
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
        imgAData,
        imgBData,
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
  }, [isWang, tileSize, showGrid, imgAData, imgBData, smoothness, easing]);

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

    // Both modes use corner-based (vertex) rendering
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const nw = wangVertices[r]?.[c] ?? 0;
        const ne = wangVertices[r]?.[c + 1] ?? 0;
        const se = wangVertices[r + 1]?.[c + 1] ?? 0;
        const sw = wangVertices[r + 1]?.[c] ?? 0;
        const wangTileIdx = (nw << 3) | (sw << 2) | (se << 1) | ne;
        
        const finalTileIdx = isWang ? wangTileIdx : WANG_TO_BLOB[wangTileIdx];
        drawTileFromSheet(finalTileIdx, c, r);
      }
    }

    // Overlap vertices dots for painting guide
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
  }, [wangVertices, isWang, tileSize, showGrid, imgAData, imgBData, smoothness, easing]);

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
    // Both modes paint on vertices
    const vx = Math.round(px / tileSize);
    const vy = Math.round(py / tileSize);
    if (vx >= 0 && vx <= COLS && vy >= 0 && vy <= ROWS) {
      setWangVertices(prev => {
        const next = prev.map(row => [...row]);
        next[vy][vx] = val;
        return next;
      });
    }
  };

  const clearPlayground = () => {
    setWangVertices(Array(ROWS + 1).fill(null).map(() => Array(COLS + 1).fill(0)));
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
          {/* Section: Textures */}
          <section className="panel-card">
            <h2 className="panel-title">{t.terrainA} / {t.terrainB}</h2>
            <div className="textures-grid">
              <div className="texture-box">
                <span className="texture-label">Terrain A (Grass)</span>
                <div 
                  className="dropzone" 
                  onClick={() => fileInputARef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputARef} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'A')}
                  />
                  {imgAUrl ? (
                    <img src={imgAUrl} alt="Terrain A" className="preview-thumb" />
                  ) : (
                    <div style={{ fontSize: '20px' }}>🌱</div>
                  )}
                  <span className="dropzone-text">{t.dropzoneA}</span>
                </div>
                {hasUploadedA && (
                  <button className="btn-preset" onClick={() => usePreset('A')}>
                    {t.placeholderA}
                  </button>
                )}
              </div>

              <button className="btn-swap" onClick={swapTextures} title="Swap Terrains">
                ⇄
              </button>

              <div className="texture-box">
                <span className="texture-label">Terrain B (Dirt)</span>
                <div 
                  className="dropzone" 
                  onClick={() => fileInputBRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputBRef} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, 'B')}
                  />
                  {imgBUrl ? (
                    <img src={imgBUrl} alt="Terrain B" className="preview-thumb" />
                  ) : (
                    <div style={{ fontSize: '20px' }}>🧱</div>
                  )}
                  <span className="dropzone-text">{t.dropzoneB}</span>
                </div>
                {hasUploadedB && (
                  <button className="btn-preset" onClick={() => usePreset('B')}>
                    {t.placeholderB}
                  </button>
                )}
              </div>
            </div>
            <p style={{ margin: '12px 0 0 0', fontSize: '11px', color: 'var(--muted)' }}>
              {t.recommendSize}
            </p>
          </section>

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
                  <span className="slider-name">{t.smoothness}</span>
                  <span className="slider-val">{smoothness.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0.0" max="1.0" step="0.01" 
                  value={smoothness} 
                  onChange={(e) => setSmoothness(parseFloat(e.target.value))}
                  className="slider-input"
                />
              </div>

              <div className="slider-group" style={{ marginTop: '4px' }}>
                <div className="slider-header" style={{ marginBottom: '6px' }}>
                  <span className="slider-name">{t.easingFunc}</span>
                </div>
                <select 
                  className="text-input"
                  value={easing}
                  onChange={(e) => setEasing(e.target.value)}
                >
                  {Object.keys(EASING_FUNCTIONS).map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>{t.tilesetPreview}</h2>
              <div className="scale-selector">
                <span className="scale-label" style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>SCALE:</span>
                <div className="scale-tabs">
                  {[1, 2, 3, 4, 6, 8].map((s) => (
                    <button
                      key={s}
                      className={`scale-tab-btn ${zoom === s ? 'active' : ''}`}
                      onClick={() => setZoom(s)}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="canvas-container">
              <canvas 
                ref={tilesetCanvasRef} 
                className="tileset-canvas" 
                style={{
                  width: `${(isWang ? 4 : 5) * tileSize * zoom}px`,
                  height: `${(isWang ? 4 : 3) * tileSize * zoom}px`
                }}
              />
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
                style={{
                  width: `${COLS * tileSize * zoom}px`,
                  height: `${ROWS * tileSize * zoom}px`
                }}
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
