export const TRANSLATIONS = {
  zh: {
    title: "Terrain Autotile Previewer",
    subtitle: "用于 2-Corner Wang (16 瓦片) 与 Blob (14 瓦片) 地形蒙版拼接预览器",
    tilesetType: "图集设置与选项",
    wang16: "2-Corner Wang 图集 (16 瓦片)",
    blob14: "简化 Blob 地形 (13+1 瓦片)",
    tileSize: "单瓦片大小 (像素)",
    tilesetPreview: "Tileset 预览图集",
    playgroundTitle: "实时拼接测试画板 (Playground)",
    playgroundTip: "鼠标左键绘制地形 A，右键擦除为地形 B。瓦片会根据相邻连接自动生成，测试是否无缝！",
    clearPlayground: "清空画板",
    downloadPng: "导出 Tileset PNG",
    langBtn: "🌐 English",
    showGrid: "显示网格辅助线"
  },
  en: {
    title: "Terrain Autotile Previewer",
    subtitle: "Previewer for 2-Corner Wang (16 tiles) and Blob (14 tiles) terrain mask layouts",
    tilesetType: "Tileset Configuration & Options",
    wang16: "2-Corner Wang Tileset (16 tiles)",
    blob14: "Simplified Blob Terrain (13+1 tiles)",
    tileSize: "Tile Size (px)",
    tilesetPreview: "Generated Tileset Sheet",
    playgroundTitle: "Interactive Tilemap Playground (Painter)",
    playgroundTip: "Left-click to paint Terrain A, Right-click to paint Terrain B. Tiles auto-connect live to check seamless borders!",
    clearPlayground: "Clear Canvas",
    downloadPng: "Export Tileset PNG",
    langBtn: "🌐 简体中文",
    showGrid: "Show Grid Lines"
  }
};

export type Lang = "zh" | "en";
