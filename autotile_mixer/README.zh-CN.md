# Adna 自动地块混合器

[English](README.md) · [简体中文](README.zh-CN.md)

`autotile_mixer` 是一个纯浏览器运行的 React + TypeScript 工具，用于设计
和预览无缝的 32px Blob47 地形 Tileset。你可以选择配色、调整边界过渡、
添加描边花纹和地形材质，然后在实时画板中检查拼接效果，最后导出图集。

项目没有后端，也不需要账号。所有渲染都在浏览器中完成；当前配方和用户
预设会保存在浏览器的 `localStorage` 中。

## 功能

- 生成完整 Blob47 图集：47 个标准瓦片，排布为 8 × 6，固定 32px 瓦片时
  输出尺寸为 192 × 256px。
- 三种角色配色：地形 A、地形 B 和边界描边。
- 10 种内置边缘花纹：
  `square`、`rounded`、`sharp`、`jagged`、`gravel`、`boulder`、
  `thorn`、`coast`、`moss`、`billow`。
- 可调过渡带：3–5 级色阶、过渡带位置、描边宽度、地形 B 硬边，以及地形
  B 全透明模式。
- 多种描边花纹：倒角、虚线、齿纹、珠链、缆绳、波浪、颗粒、沿边砖石等。
- 多种地形纹理：草地颗粒、水面波纹、Voronoi 细胞、几何铺装、砖石、石板、
  水面边线和噪点纹理。
- 16 × 10 实时拼接画板，根据相邻单元格自动选择 Blob47 瓦片。
- 画板使用统一的 Pointer Events，同时支持鼠标、触控笔和触摸屏。
- 画板工具：
  - **画笔**：绘制地形 A。
  - **橡皮擦**：擦除地形 A，恢复为地形 B。
  - 支持一键全铺 A 和清空/全铺 B。
- 内置预设、用户预设、自动保存，以及基于版本化配方编码器的短链接分享。
- 支持单独导出和导入配方 JSON。
- 一键下载 ZIP，内含生成的 PNG 和 Tileset 映射 JSON；配方文件单独管理。

## 本地运行

在当前目录执行：

```bash
npm install
npm run dev
```

打开终端显示的 Vite 地址，通常是：

```text
http://localhost:5173/
```

如果要运行仓库首页和所有已构建的子应用，可以使用仓库根目录的统一启动器：

```bash
cd ..
node start-local.mjs
```

然后访问：

```text
http://localhost:3000/autotile_mixer/
```

## 构建与测试

```bash
npm run build   # TypeScript 类型检查 + Vite 生产构建
npm test        # Vitest 单元测试
npm run lint    # ESLint
npm run preview # 本地预览生产构建
```

测试覆盖 Blob47 规范化、距离场、无缝花纹、噪点、描边、纹理、配方校验、
URL 编解码、国际化，以及画板连续拖动到单元格的栅格化逻辑。

## 使用实时画板

画板内部保存一个二值单元格地图：`1` 代表地形 A，`0` 代表地形 B。每个
单元格根据周围八个邻居计算 Blob47 mask，再从 47 张瓦片中选择对应图块。

1. 选择 **画笔** 或 **橡皮擦**。
2. 使用鼠标、触控笔或手指在画布上拖动。
3. 使用缩放按钮放大预览。
4. 判断最终素材时，可以关闭 **标记点**。

画布设置了 `touch-action: none`，拖动时不会被浏览器当作页面滚动。Pointer
capture 会保持连续笔画，即使指针移动很快或短暂离开画布也不会中断。

## 导出格式

### Tileset ZIP

点击 **下载 PNG + JSON** 会生成一个 ZIP，内容为：

```text
tileset_blob47_<pattern>_32px.png
tileset_blob47_<pattern>_32px.json
```

JSON 包含：

- 格式/应用版本；
- 瓦片尺寸、图集尺寸和瓦片数量；
- 八个邻居 bit 值（`N`、`E`、`S`、`W`、`NE`、`SE`、`SW`、`NW`）；
- 图集排布表；
- 256 项原始 mask 到图集槽位的查找表；
- 生成该图集时使用的完整配方。

PNG 来自不带辅助线的离屏画布，因此预览网格和画板标记点不会被写入导出
文件。

### 配方 JSON

点击 **导出配方** 会写出包含完整渲染配方的版本化 JSON。**导入配方**既能
读取该包装格式 `{ v, recipe }`，也能读取直接的配方对象。导入时会进行字段
校验和范围限制，异常值会回退到安全默认值。

### 分享链接

点击 **复制分享链接** 会把配方编码为 URL hash：`#r=<payload>`。编码器带有
版本号，未来增加字段时可以继续兼容旧链接。

## Blob47 约定

Blob47 是基于单元格的自动地块方案。四个正交 bit 描述相邻单元格是否连通，
四个对角 bit 只有在对应的两个正交边都连通时才有意义。256 种原始 mask 经过
规范化后，恰好得到 47 种不同的瓦片状态。

导出使用以下 bit 约定：

```text
N  = 1    E  = 2    S  = 4    W  = 8
NE = 16   SE = 32   SW = 64   NW = 128
```

所有花纹、噪点、描边和材质都遵守瓦片周期性和接缝安全规则，相邻瓦片拼接时
不会出现由局部采样造成的断缝。

## 项目结构

```text
src/
  App.tsx                   页面 UI、配方状态、画布渲染和交互
  App.css                   页面布局和控件样式
  shared/i18n.ts            中英文文案
  utils/blob47.ts           mask 规范化、47 槽位布局
  utils/blob47Pattern.ts    边缘距离场和花纹元数据
  utils/patternPaint.ts     像素绘制、角色和色阶合成
  utils/patternNoise.ts     过渡带噪点算法
  utils/patternRibbon.ts    描边/带状花纹
  utils/patternTexture.ts   实心地形纹理
  utils/patterns/generated.ts
                            生成的距离场花纹数据
  utils/recipe.ts           配方模型、默认值、校验和预设
  utils/recipeCodec.ts      短链接配方编解码器
  utils/exportSheet.ts      PNG、JSON、ZIP 导出工具
  utils/playgroundPaint.ts  连续拖动到单元格的栅格化
```

## 当前边界

- 输出瓦片尺寸固定为 32px。
- 当前界面只生成 Blob47；2-corner 和 2-edge Wang 方案在仓库文档中有说明，
  但尚未作为界面选项提供。
- 地形 A/B 是生成 Tileset 中的两个角色，不是导入的两张图片图层。画板橡皮擦
  只改变测试地图中的单元格，不会修改生成的 Tileset 素材。
- 当前没有用户上传 Tileset 流程，也没有服务端渲染。

## 相关文档

仓库级设计说明：

- [`../docs/AUTOTILE_SCHEMES.md`](../docs/AUTOTILE_SCHEMES.md)
- [`../docs/AUTOTILE_PATTERN_BAKE.md`](../docs/AUTOTILE_PATTERN_BAKE.md)
- [`../docs/AUTOTILE_MIXER_PRESETS.md`](../docs/AUTOTILE_MIXER_PRESETS.md)
- [`../docs/autotile_pattern_extension.md`](../docs/autotile_pattern_extension.md)
