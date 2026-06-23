export const translations = {
  zh: {
    // Header & Navigation
    globalProcessor: "🎨 全局优化",
    tileWorkshop: "🧱 瓦片工坊",
    backHome: "← 返回主页",
    rerollEditor: "Reroll 编辑器",
    taggerTool: "资源标注工具",

    // Presets
    presetsTitle: "预设配置 presets",
    deletePreset: "删除",
    saveNewPreset: "保存为新预设",
    presetNamePlaceholder: "输入新预设名...",
    enterPresetName: "请输入新预设的名称：",

    // Session list / Files Area
    uploadBtn: "📤 上传图片 Load Image",
    clearAll: "🗑️ 清空",
    noFilesYet: "暂无处理文件",

    // Sidebar settings
    bgRemovalTitle: "1. 背景去除 Background Removal",
    preRemoveBg: "前置自动去色 (Auto BG)",
    postRemoveBg: "后置强力去色 (Strong BG)",
    removeIslands: "清除碎块杂点 (Remove Islands)",
    islandThreshold: "碎块判定阈值 (Max Pixels)",

    downsampleTitle: "2. 像素下采样 Downsample",
    gridDetection: "网格检测模式 (Grid Mode)",
    gridAuto: "自动推算 (Auto)",
    gridManual: "手动指定 (Manual)",
    gridStepWidth: "列宽 (Grid Width)",
    gridStepHeight: "行高 (Grid Height)",
    gridOffsetX: "X偏移 (Offset X)",
    gridOffsetY: "Y偏移 (Offset Y)",
    pixelRatio: "合并像素 (Pixel Ratio)",

    colorLimitTitle: "3. 色彩限制 Color Limit",
    colorReduction: "限制色板 (Reduce Colors)",
    colorMode: "色板模式 (Palette Mode)",
    colorCount: "最大颜色数 (Max Colors)",
    ditherMode: "抖动模式 (Dither Mode)",
    ditherStrength: "抖动强度 (Dither Strength)",

    outlineTitle: "4. 描边与画布 Outline & Canvas",
    outlineStyle: "描边风格 (Outline Style)",
    outlineColor: "描边颜色 (Outline Color)",
    makeSquare: "强转正方形 (Make Square)",
    keepAspectRatio: "保留宽高比 (Keep Aspect)",

    // Viewport toolbar
    sliderView: "滑块对比",
    sideView: "左右分屏",
    processedView: "效果图",
    originalView: "原图",
    cropBtn: "✂️ 裁剪原图 (Crop)",
    resetCrop: "↩️ 重置裁剪",
    fitZoom: "自适应",
    referenceGrid: "参考网格",
    pixelGrid: "像素网格",

    // Viewport dropzone & status
    dropzoneTitle: "拖拽图片到这里，或点击选择",
    dropzoneSub: "支持 PNG / JPG / WebP 等格式，处理完全在浏览器本地完成，不传输服务器",
    processing: "正在处理像素图 Processing...",
    processError: "处理出错",

    // Swatches panel
    extractedColors: "提取色表",
    copyHex: "复制Hex",
    exportGpl: "导出 .GPL 色板",
    copiedToast: "已复制色彩Hex列表到剪贴板！",
    downloadGplToast: "已导出 .GPL 色板文件",

    // Tile Workshop
    tileWidth: "瓦片宽度 (Tile Width)",
    tileHeight: "瓦片高度 (Tile Height)",
    shiftX: "水平漂移 (Shift X)",
    shiftY: "垂直漂移 (Shift Y)",
    seamlessBorder: "生成无缝边缘 (Make Seamless)",
    seamlessPreview: "3x3 拼接预览 (3x3 Preview)",
    showTilingGrid: "拼缝参考线",
    extractedTile: "已裁剪瓦片 (Extracted Tile)",
    addToSession: "把此瓦片载入处理会话",
    downloadTile: "下载当前瓦片",
    download3x3: "下载3x3拼接图",
    downloadAll: "打包下载全部",
    workshopPickerTip: "从右侧选择一块大小为 {tileSize}x{tileSize} 的区域裁剪为瓦片",
    copiedTileToast: "已截取 {tileSize}x{tileSize} 瓦片！"
  },
  en: {
    // Header & Navigation
    globalProcessor: "🎨 Refiner App",
    tileWorkshop: "🧱 Tile Workshop",
    backHome: "← Main Page",
    rerollEditor: "Reroll Editor",
    taggerTool: "Tagger Tool",

    // Presets
    presetsTitle: "Presets Config",
    deletePreset: "Delete",
    saveNewPreset: "Save New Preset",
    presetNamePlaceholder: "Preset name...",
    enterPresetName: "Please enter a name for the preset:",

    // Session list / Files Area
    uploadBtn: "📤 Upload Image",
    clearAll: "🗑️ Clear All",
    noFilesYet: "No images loaded",

    // Sidebar settings
    bgRemovalTitle: "1. Background Removal",
    preRemoveBg: "Auto BG (Pre)",
    postRemoveBg: "Strong BG (Post)",
    removeIslands: "Remove Floating Islands",
    islandThreshold: "Island Size (Max Pixels)",

    downsampleTitle: "2. Downsample & Grid",
    gridDetection: "Grid Detection Mode",
    gridAuto: "Auto Estimate",
    gridManual: "Manual Grid",
    gridStepWidth: "Grid Width",
    gridStepHeight: "Grid Height",
    gridOffsetX: "Offset X",
    gridOffsetY: "Y Offset Y",
    pixelRatio: "Pixel Ratio (1->N)",

    colorLimitTitle: "3. Color Limit",
    colorReduction: "Reduce Colors",
    colorMode: "Palette Mode",
    colorCount: "Max Colors",
    ditherMode: "Dither Mode",
    ditherStrength: "Dither Strength",

    outlineTitle: "4. Outline & Canvas",
    outlineStyle: "Outline Style",
    outlineColor: "Outline Color",
    makeSquare: "Make Square",
    keepAspectRatio: "Keep Aspect Ratio",

    // Viewport toolbar
    sliderView: "Slider Compare",
    sideView: "Side-by-Side",
    processedView: "Refined",
    originalView: "Original",
    cropBtn: "✂️ Crop Image",
    resetCrop: "↩️ Reset Crop",
    fitZoom: "Auto Fit",
    referenceGrid: "Cell Grid",
    pixelGrid: "Pixel Grid",

    // Viewport dropzone & status
    dropzoneTitle: "Drag images here or click to select",
    dropzoneSub: "Supports PNG / JPG / WebP. Processed locally in browser, no server upload.",
    processing: "Processing sprites...",
    processError: "Processing Error",

    // Swatches panel
    extractedColors: "Extracted Colors",
    copyHex: "Copy Hex",
    exportGpl: "Export .GPL",
    copiedToast: "Hex color list copied to clipboard!",
    downloadGplToast: "Exported .GPL palette file",

    // Tile Workshop
    tileWidth: "Tile Width",
    tileHeight: "Tile Height",
    shiftX: "Shift X",
    shiftY: "Shift Y",
    seamlessBorder: "Make Seamless Edge",
    seamlessPreview: "3x3 Seamless Preview",
    showTilingGrid: "Tiling Grid Lines",
    extractedTile: "Extracted Tile",
    addToSession: "Load Tile into Session",
    downloadTile: "Download Tile",
    download3x3: "Download 3x3 Tiling",
    downloadAll: "Download All (ZIP)",
    workshopPickerTip: "Click on the right refined image to extract a {tileSize}x{tileSize} tile",
    copiedTileToast: "Extracted {tileSize}x{tileSize} tile!"
  }
};
