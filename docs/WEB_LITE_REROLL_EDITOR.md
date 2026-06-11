# Web Lite Reroll Editor 方案

状态：Draft v2.3（取代 v2.2 / v2.1 / v2 / v1）
日期：2026-06-06
范围：面向 blueprint 飞轮产出的 AI 地图初稿的网页轻量修补器。本方案不移植 desktop ImGui 编辑器，也不复刻完整 TileMap 数据模型。
关联文档：
- `ai_tilemap_pipeline/blueprint_generator/docs/BLUEPRINT_ITERATION_FLYWHEEL.md`（飞轮内环）
- `ai_tilemap_pipeline/blueprint_generator/docs/BLUEPRINT_AUTHORING.md`（schema / fidelity / role→color 调色板真相源）
- `docs/STATE_PERSISTENCE_AND_UNDO.md`（document vs editor context 边界 —— 本方案 §4 的依据）
- `src/serialize/blueprint_importer.cpp` / `src/command/commands_blueprint.cpp`（引擎侧 import+compile：blueprint→Layer 子树→绑 palette）
- `desktop/src/blueprint_palette.h`（引擎侧 role→color，与 overlay 调色板逐位一致）

> **v2.3（本次）**：清空 §16 开放问题，定了 7 条 —— ① web **永不新建地图**，canvas 尺寸 = blueprint 的 width/height（§3.6、§14）；② 产出 `WEB_LITE_SCHEMA.md` 字段清单（待写，§16）；③ 单体 reroll **允许同 kind 改 footprint**（§7.1）；④ 区域 reroll **无 prompt、不走大模型**，纯 preset+seed+规则（§7.2、§12.3）；⑤ 区域 reroll **允许改 locked object 周围 terrain**（§7.2）；⑥ tileset 打包**复用引擎 palette export/import**，随 palette 推迟（§5）；⑦ 生成后端**先做 `claude -p`**（§10.2）。
>
> **v2.2（本次）**：锁定两个工程选型 —— 代码放 **in-repo `web/reroll/`**（§12.2）；**第一刀只做 MVP 0**（overlay 平价）。palette/tileset preset 尚未就绪，故 **MVP 0.5（真实贴图 override）推迟**到 preset 准备好；MVP 0 只需统一的 role→color 表，不依赖 preset，故不阻塞（§13）。
>
> **v2.1 相对 v2 的变化（本次核心）**
> 1. **数据模型统一**（§4 重写）：不再把 web-lite 当"另起炉灶的独立格式"。借用引擎的 **TileMap / TileMapHandler** 分层——**web 的 TileMap 是 desktop TileMap 的一个有文档的 lite 子集（profile）**，二者真正不同的是 **Handler 上下文**（commands/undo/selection/会话态）。这正是 `STATE_PERSISTENCE_AND_UNDO.md` 既有的 "document vs editor context" 边界的延伸。
> 2. **交换单元 = Layer 子树**：blueprint JSON 是独立的 LLM 创作格式，转成一棵 Layer 子树后，desktop 和 web 都能嫁接进各自的 TileMap（引擎 importer 本就这么做）。
> 3. **Terrain 决策：每对象 `Int16Matrix`，不要全局网格** —— 因为要支持 **terrain 堆叠**（全局网格每 cell 只存一个值，叠不了多层）。
> 4. **converter 退化成投影**：desktop→web 丢字段、web→desktop 嫁接+填默认；不再是有损的格式重解释。"双格式分叉"风险（旧 §15）随之大幅降低。
>
> v2 相对 v1 已确立、v2.1 保留：锚定真实飞轮（generator.py→blueprint.json→overlay.png）；overlay 渲染器=查看器 MVP 0，唯一 delta=palette override；真实 tileset 第一方、无版权；用户不能自带 tileset；生成后端走可插拔 CLI + BYOK/订阅凭证解析器（§10）。

---

## 1. 一句话定位

网页版不是"完整 tilemap editor"，而是 **blueprint 飞轮初稿的轻量 reroll / inpaint / 修补工具**。

核心价值链：

```text
AI 飞轮先生成一张大体正确的地图(blueprint JSON + overlay)
        -> 用户在网页里快速检查(真实贴图预览)
        -> 点选物体 reroll
        -> 框选区域 reroll
        -> 拖动物体修正布局
        -> 必要时手动画 terrain
        -> 导出回 AI pipeline 或 desktop editor 继续处理
```

网页端优先追求低学习成本、低维护成本、低部署成本。它可以和 desktop 版本长得很不一样，但**数据层是 desktop TileMap 文档的一个子集**，而不是平行发明的格式。

---

## 2. 与 blueprint 飞轮的关系（本方案的锚点）

### 2.1 飞轮现状

飞轮内环（见 `BLUEPRINT_ITERATION_FLYWHEEL.md`）：

```text
模型写生成器 -> workspace/current_generate.py
  -> python current_generate.py            产出 workspace/current_blueprint.json
  -> scripts/validate_schema.py            schema / 质量门
  -> scripts/render_overlay.py             无引擎几何预览 -> current_overlay.png
  -> 用户看 overlay 批评密度/布局/连通性/结构
  -> 模型改生成器，重复
  -> 满意 -> scripts/approve_iteration.py <name>
     归档到 curated_dataset/<TS>_<name>/  (generator.py / blueprint.json / overlay.png / manifest.json)
```

产物 **blueprint JSON** 的对象用 `role` + 几何描述（`rect` / `cells` / `points`(+`width`) / FRG scatter 的 `cells`），根上有 `width`/`height`/`fidelity`/`source_image`。`render_overlay.py`（Pillow）把每个对象按 role→color 画成色块，统一处理 terrain-cells 和 object-rects。

### 2.2 收敛洞察：overlay 渲染器 = 网页查看器的 MVP 0

`render_overlay.py` 现在做的事——"读 blueprint JSON，按 role 上色，画 terrain 和 objects"——**正是本文档 §13 的 MVP 0（静态查看器）**，只不过它跑在 Python/PIL 里、输出静态 PNG。

把它搬进浏览器(TS + Canvas 2D)后，overlay 与"最终效果图"的**唯一区别就是 palette override**：

```text
overlay 模式:  appearance(role) = role -> 纯色            (现在的 render_overlay)
真实贴图模式:  appearance(role,variant) = role/variant -> 真实 tile/sprite
```

同一个渲染器、同一份 blueprint，切换一个 appearance 策略即可。这是整个方案能"先小步起步"的关键：**先复刻 overlay 进浏览器，再加 palette override，就得到接近最终效果的预览**，全程不碰编辑/数据子集的复杂度。

### 2.3 引擎 import 才是 role→真实贴图的权威路径

引擎侧 import 分两步（`blueprint_importer.cpp` + `commands_blueprint.cpp`），核心思想是
**"a blueprint object IS a real object missing only its tiles"**：

1. **import（`blueprintToLayerJson`）**：把 blueprint payload 转成正常的 **Layer 子树**——按 `type`/`role` 定真实对象 TYPE（`objectTypeFor`），读 rect/points/cells、栅格化路径，把 role/style/label 等塞进 `blueprint.*` tags。产物是类型+几何都对、**但还没贴图**的真实对象。
2. **compile（`CompileBlueprintCommand`）**：对每个带 role 的对象 `setPalette(findPaletteByRole(role, style))`，把真实 palette 挂上去。`render_mode=REAL` 后才可见真实贴图。

所以**真正的 role→tile 解析发生在引擎里**；网页的 palette override 是用网页自有 preset 对它的**近似预览**。像素级最终以 desktop 引擎为准（§5）。

### 2.4 统一的 role→color 调色板

overlay 的 role→color 是**三处逐位一致**的同一份（改一处改三处）：`desktop/src/blueprint_palette.h`（引擎真相源）、`scripts/render_overlay.py`（无引擎预览）、文档 `BLUEPRINT_AUTHORING.md §4`。子串匹配、**首个命中生效、顺序敏感**。网页端作为第四个消费方，应从该真相源**构建期生成 TS 常量**，不要手抄第四份副本（避免漂移）。

---

## 3. 核心决策

### 3.1 不移植 ImGui / C++ / WebGL

第一版用 TypeScript + Canvas 2D 做原生网页应用。repo 内已有 `web/tagger/`（Vite + React + TS + Canvas）作为脚手架范式，照其结构起步。

原因：目标功能远小于 desktop editor，移植 ImGui 带来不必要复杂度；Canvas 2D 足够支持 tile map、terrain brush、对象拖拽、框选、overlay；网页 UI 围绕 AI 结果修补设计，而非复刻 desktop 的 panel/tree/palette editor；静态部署简单。

### 3.2 Palette 固定 = 本项目自有真实 tileset，只读

网页内置一份 palette preset。用户**不能创建、删除、编辑 palette，也不能自带 tileset 集合**。预览用的就是**本项目自有的真实 tileset**——全部第一方、**无版权问题**，因此真实贴图从第一天可用，公开/私有部署变成产品选择而非法律约束（§12）。坚持"用户不能自带 tileset"让网页端是一个**受控的结果修补器**，不退化成第二套完整编辑器。

### 3.3 双渲染模式（同一渲染器，appearance 策略切换）

- **overlay 模式**：role→纯色，复刻 `render_overlay.py`。用于结构检查、低成本、与飞轮 overlay 像素可对照。
- **真实贴图模式**：role/variant→真实 tile/sprite。用于看接近最终的效果。

二者只是 §2.2 的 appearance 策略不同，UI 一个开关切换。

### 3.4 Terrain 可编辑，其余对象只允许有限编辑

| 类型 | 网页端能力 |
|---|---|
| Terrain | 刷、擦、改类型、区域 reroll（作用在**每对象矩阵**上，见 §4.3） |
| 非 terrain object | 选择、拖动、lock、单体 reroll、区域 reroll |

第一版不做：palette 编辑、layer tree UI、pass/distributor 编辑、对象内部 tile 级编辑、完整属性面板、desktop 全保真字段的编辑。

### 3.5 Reroll 是第一等功能

主要交互不是"画完整地图"，而是"对 AI 初稿做局部再生成"：**单体 reroll**（点物体换合法 variant）、**区域 reroll**（框选区域重生成 terrain/object）。

### 3.6 永不新建地图；canvas 尺寸 = blueprint 尺寸

web 是查看器 + 简单编辑器，**永远没有"新建地图"功能**。canvas 宽高直接取自加载的 blueprint 根 `width`/`height`（无则按内容 AABB 推断）；用户**不能改地图尺寸**。要换尺寸就回飞轮重生成 blueprint。

---

## 4. 数据模型：统一的 TileMap 文档 + 不同的 Handler 上下文

> 取代 v2 把 web-lite 当独立格式的写法。结论：**web 不发明新格式，而是用 desktop TileMap 文档的一个 lite 子集**。

### 4.1 模型（借用引擎的 TileMap / TileMapHandler 分层）

```text
TileMapHandler  = 上下文(commands / undo / selection / callbacks / 编辑器会话态)
                  ├── desktop handler:全命令集、全 undo、palette 编辑
                  └── web handler   :lite 命令集(move/reroll/paint/lock)、简化 undo
                          │ 操作于
                          ▼
TileMap         = 文档(Layer 树 + objects + palettes)
                  ├── desktop TileMap:全保真(distributor/pass/矩阵/全对象类型)
                  └── web TileMap    :一个**子集 profile**(lite 对象类型、简化 palette 引用)
                          ▲ 嫁接进来(一棵 Layer 子树)
                          │
blueprint JSON  = 独立的、为 LLM 服务的创作格式;转成 Layer 子树后两边都能吃
```

两个关系是**不同性质**的：

- **TileMap 是子集关系**：web = desktop 的精简档。同一套 schema、一个真相源；web 只认/只改子集字段。
- **Handler 是"genuinely 不同"关系**：handler 持有 UI 会话态（选中、工具、视图、临时高亮），本就该 web/desktop 各异，不是子集。

这正是 `STATE_PERSISTENCE_AND_UNDO.md` 既有的 **"document（进 save root）vs editor context（handler 级）"** 边界——"网页和 desktop 的区别在 handler 上下文"是这条边界的自然延伸。

**直接后果**：web 的存档 = desktop save schema 的一个**有文档的 lite profile（子集）**。converter 退化成**投影**：

```text
desktop -> web :  丢掉 web 不用的重字段(投影)
web -> desktop :  把子集嫁接回全文档、其余填默认
```

不再是有损的"格式重解释"，"双格式分叉"风险大幅降低。

### 4.2 交换单元是 Layer 子树

引擎 import 的产物本来就是一棵 Layer 子树（`blueprintToLayerJson` → `importLayerInto`）。所以 **Layer 子树是 blueprint / web / desktop 三者之间的公共货币**：

- blueprint JSON（独立 LLM 创作格式）→ 转成 Layer 子树 → desktop 或 web 各自嫁接进 TileMap。
- web 编辑后导出的，仍是同一文档的 lite 子集（也就是若干 Layer 子树）。

### 4.3 Terrain：每对象矩阵（已决策），因为要支持 terrain 堆叠

这是统一模型里**唯一会破坏子集关系**的点。**决策：每个 terrain 对象各自一个 `Int16Matrix`，不要全局 terrain 网格。**

理由 —— **terrain 堆叠**：

- 全局网格是"**每 cell 一个 terrain 值**"，**无法表示同一格上叠多层 terrain**。
- desktop terrain 本就是**每对象一个 `Int16Matrix`**（见 importer 的 `makeFrgTerrain`，按对象 rect 建矩阵）。多个 terrain 对象可以**重叠同一 cell**，由 Layer 树 / z 序决定渲染层次。例如**土路画在草地之上**：该 cell 同时存在 grass 和 path 两层 terrain，path 按 z 盖在上面；autotile 的边界融合也依赖这种分层。
- 全局网格会把这个 stack **拍平成一个值，堆叠就没了**，边界/自动贴图也受损。

所以 web 必须编辑**每个 terrain 对象自己的矩阵**（保留 stack），而不是一张拍平的网格。这也让子集关系在 terrain 上**真正成立、能无损往返 desktop**。

代价（可接受）—— terrain brush 要多懂一点：

- 笔刷锁定一个"**活动 terrain 对象/类型**"：选 swatch → 解析到（或新建）覆盖涂抹区的该类型 terrain 对象 → 写它的矩阵。
- 跨类型涂（grass 盖 ocean）= 在相关 terrain 对象的矩阵间挪 cell，**默认尊重 stack**（不无意中清掉下层），需要时才显式覆盖/打洞。
- 一次 drag 合成一个 undo（§9）。

### 4.4 两阶段（保留）

- **Phase A**：查看器直接吃 blueprint JSON（§2.2），零转换、不碰子集 profile。
- **Phase B**：reroll/编辑作用在 **TileMap 的 lite 子集**上（不是发明新格式），导出仍是该子集 profile；转 desktop 是投影+填默认。

| 阶段 | 输入 | 需要 converter | 解锁能力 |
|---|---|---|---|
| **Phase A** | blueprint JSON | 否 | 查看器（overlay 平价）+ palette override 预览 |
| **Phase B** | TileMap lite 子集 | 投影（轻量） | 单体/区域 reroll、拖动、terrain brush、lock |

### 4.5 Lite profile：web 读写哪些字段

web 读写的是 desktop TileMap 文档的一个 lite 子集；同一套 schema，web 只认下面这些，**不认识的重字段（distributor / pass / base64 矩阵 / hash）原样保留**（forward-compat），保证往返 desktop 无损。

```ts
// 与 desktop 同构，web 只用其子集
Layer {
  name, enabled, color, tags
  objects: LiteObject[]
  children: Layer[]
}

LiteObject {
  // type 必须是 desktop 类型的子集：
  //   TERRAIN_2_CORNER / TERRAIN_2_EDGE | FIXED_RECT | FIXED_RECT_GROUP | DUNGEON
  type
  rect            // [x, y, w, h]，tile 坐标
  enabled
  tags            // 携带 blueprint.role / blueprint.style / blueprint.variant
  terrain?        // 每对象 Int16Matrix(terrain / FRG 类型) —— 不是全局网格(§4.3)
  // 身份：复用既有 hash / layer-hash+index，不另发明 id
  // palette：role/style 标签 + 已绑定 palette 的 hash 引用，不内联 palette 详情
}
```

reroll 所需概念到既有模型的映射（尽量不发明新字段）：

- **variant** ≈ "绑了哪个 palette"（role→palette 的具体选择），存为 tag 或 palette-hash 引用。
- **id / 稳定身份** ≈ 复用引擎既有身份：`IHashed` 的 hash（Palette/Layer），TiledObject 的 layer-hash + index。
- **lock** ≈ web handler 的会话态，或一个 `web.lock` tag。
- **seed** ≈ 记录在区域/对象 tag 上，保证可复现（§7.7）。

---

## 5. Palette / Tileset

Palette preset 是网站随包发布的**只读**配置，放在 `web/<app>/src/preset/` 或构建后的静态资源。它承载两件事：overlay 的 role→color，和真实贴图模式的 role/variant→tile/sprite。

```ts
type PalettePreset = {
  id: string
  name: string
  terrain: TerrainDef[]
  objectKinds: Record<string, ObjectKindDef>
}
type TerrainDef   = { id: number; key: string; label: string; color: string; tileset?: string; edgeMode?: "none" | "simple-autotile" | "wfc" }
type ObjectKindDef = { key: string; variants: ObjectVariant[]; placement?: PlacementRule }
type ObjectVariant = { key: string; label: string; w: number; h: number; sprite?: string; color?: string; weight?: number; tags?: Record<string, string> }
type PlacementRule = { allowedTerrain?: string[]; blockedTerrain?: string[]; avoidKinds?: string[]; allowOverlapKinds?: string[]; margin?: number }
```

appearance 策略：

```ts
appearance(role)          -> { type: "color", value }            // overlay 模式（统一 role→color 表）
appearance(role, variant) -> { type: "tile", img, srcRect }      // 真实贴图模式（preset 解析）
```

真实 tileset 全部第一方，预览可像素接近引擎。注意：要与 desktop 引擎**完全一致**，preset 必须用与引擎相同的 tile 源与解析规则（role→palette 的解析在引擎 `findPaletteByRole`，§2.3）；若两边解析不同仍可能有差异——**像素级最终以 desktop 引擎为准**，网页是接近的预览。

**打包方式（已定，推迟）**：web 的 tileset preset **复用引擎现有的 palette export / import 格式**，与引擎同源以保证一致。但 palette 目前未做好，故该 preset 与真实贴图模式（MVP 0.5）一并**推迟**，MVP 0 先行（MVP 0 只用 role→color 表，不依赖 preset）。

---

## 6. 渲染

第一版使用 Canvas 2D，分层：

```text
terrain canvas       静态/半静态，terrain 改了才重绘；按 terrain 对象的 z 序渲染，
                     支持多层 terrain 对象在同一 cell 堆叠(§4.3)
object canvas        object 改了才重绘
overlay canvas       selection / hover / drag ghost / box select，每帧可重绘
```

两种渲染模式（§3.3）作用在 terrain + object 两层；overlay 交互层不变。地图尺寸初期建议 128x128 或 256x256；更大再考虑 dirty rect、chunk canvas 或 Web Worker。

---

## 7. Reroll 规则

第一版 object 收敛到四类（均为 desktop 类型的子集）：

| Web 类型 | desktop TYPE | 第一版能力 |
|---|---|---|
| `terrain` | `TERRAIN_2_CORNER` / `_EDGE` | 画、擦、区域 reroll、边界修复（每对象矩阵，§4.3） |
| `fixed_rect` | `FIXED_RECT` | 拖动、单体 reroll、lock |
| `stretch` | `FIXED_RECT`（可 resize 的子用法） | 拖动、resize、reroll variant |
| `scatter` | `FIXED_RECT_GROUP` | 区域 reroll、密度、seed、lock |

不做 chain、contour、cliff、wall special evaluator、dungeon 复杂规则、segment set，也不暴露 desktop 的 FRG cell/weight editor。

### 7.1 单体 Reroll

`rerollObject(map, preset, objectId, seed)`：找到 object（`locked` 拒绝）→ 按 kind 取 variant 列表，排除/降权当前 variant → 按 terrain/overlap/margin 过滤 → seed 抽样 → 替换 variant，**同 kind 内允许改 footprint（w/h 可变），围绕中心点重锚** → 放不下则继续抽样、超次数保持原样并提示 → 记 undo。

### 7.2 区域 Reroll

`rerollRegion(map, preset, rect, options)`，推荐顺序：

```text
Region Reroll
  -> preserve locked objects（作为障碍/锚点）
  -> 删除区域内未 locked object
  -> terrain backend: 在区域覆盖的**各 terrain 对象矩阵**上重画(保留堆叠) / autotile / constrained WFC
  -> object backend: fixed_rect 加权随机 / stretch variant&resize / scatter density
  -> boundary repair: 读区域外一圈邻居，autotile 或 constrained WFC 衔接
  -> 记为一个 composite undo
```

选项：`{ seed, rerollTerrain, rerollObjects, preserveLocked, terrainBackend?: "rules"|"autotile"|"wfc", style? }`。

- **无 prompt、不走大模型**：区域 reroll 是纯客户端确定性流程（preset + seed + 规则 / WFC），不调用任何后端或模型。`style` 只是 preset 里的样式 key，不是自然语言 prompt。
- **locked object**：其本体被保留作锚点，但**允许重画它周围的 terrain**（在各 terrain 对象矩阵上，尊重堆叠）。

### 7.3 Scatter Group / FRG-lite

不复刻 desktop 完整 `TYPE_FIXED_RECT_GROUP` 的 cell/weight editor；用产品化的 `scatter`：用户只看到一个可 reroll 的区域（`density`/`seed`/`variants`）。locked scatter 不被区域 reroll 删除，但可作障碍/上下文。

### 7.4 WFC 的定位

WFC 只作局部 backend，不作主生成系统。主系统是语义对象规则。**推荐**用于 terrain reroll（草/水/路/泥地/岸线 tile 级拼接）和选区边界修复；**可选**用于 stretch 内部纹理、fixed rect 内部细节；**不用**于 scatter 和房子/大物体布局（WFC 不保留 object 语义）。一句话：**WFC 负责 tile-level 自然拼接；object-level reroll 由语义规则负责。**

### 7.5 小选区 reroll 与外部自然连接

```text
selected rect            可修改
context margin 1-3 tiles 只读约束
outside area             完全不动
```

读取选区外 `contextMargin` 的 terrain/object-edge → 转固定边界约束 → 选区内部对 terrain/tile 用 constrained WFC 或 autotile、对 fixed_rect/stretch/scatter 用语义规则。WFC 输入是 tile-level constraints，不是完整 object 语义（locked house footprint→blocked tiles；entrance→road-compatible；water edge→shore-compatible；road→road-continuation）。

### 7.6 WFC 失败策略

```text
1. constrained WFC
2. 失败换 seed 重试 N 次
3. 放宽内部约束，但不放宽外部固定边界
4. fallback 到 autotile / simple rules
5. 仍失败则保持原区域并给出失败状态
```

不要让用户点 reroll 后得到空白区域或破坏外部地图。

### 7.7 随机必须可复现

所有 reroll 接收显式 seed：用户能重现、AI pipeline 能记录"区域用 seed X 生成"、bug 易复现、后续可做"上一版/下一版"探索。

---

## 8. 交互（选择 / 拖动 / terrain brush）

- **选择/拖动**：点击选中→拖动→松开 snap 到 tile grid；拖动期间 ghost preview；违反规则显示 invalid outline 并回弹；locked 不可拖；拖动结束才写 undo。
- **terrain brush**：选 terrain type（swatch）→ 锁定活动 terrain 对象/类型 → 拖动绘制，**写该对象的矩阵**（§4.3，跨类型涂时默认尊重堆叠）；笔刷 1/3/5；模式 paint/erase/randomize；一次 drag 一个 undo。
- 选中对象显示小浮层（kind / variant / Reroll / Lock）；terrain 工具显示小浮层（terrain swatches / brush size / paint·erase·randomize）。
- 暂不做固定左侧 layer tree；层级如需表达只存数据，不暴露给用户。

推荐 UI：

```text
┌──────────────────────────────────────────────────────────────┐
│ Top: Select | Terrain | Box Reroll | 模式切换 | Undo | Export │
├──────────────────────────────────────────────────────────────┤
│                         Canvas Map                            │
├──────────────────────────────────────────────────────────────┤
│ Status: selected object / brush / seed / invalid reason       │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Undo / Redo

简化 command 模型 `type Command = { label; do(); undo() }`：

| Command | 粒度 |
|---|---|
| `MoveObjectCommand` | 单个对象拖动完成 |
| `RerollObjectCommand` | 单个对象替换 |
| `PaintTerrainCommand` | 一次 pointer drag（可能跨多个 terrain 对象矩阵） |
| `RerollRegionCommand` | 一次区域重生成 |
| `ToggleObjectLockCommand` | 单个对象 |

拖动/绘制在 pointer down 开始记录、pointer up 合并成一个命令，不把每帧塞进 undo。

---

## 10. 生成后端：客户端零 LLM + 可选可插拔生成

### 10.1 责任切分

- **编辑 / reroll / terrain brush / 导入导出**：全部客户端确定性逻辑，**零 LLM、零后端、零成本**，可纯静态托管。
- **唯一需要 LLM 的步骤**：从概念图生成初稿 blueprint（"图→blueprint JSON"）。这是**可选后端**，不影响编辑器本体独立运行。不接它，就在 Claude Code 里离线生成 blueprint.json 再导入。

### 10.2 生成走可插拔 CLI（不用计费 API 也能跑）

订阅用量只能通过各家 CLI 这个"壳"消费，不能用裸 API key 直连。因此生成后端 **shell out 到 headless CLI**：

| CLI | headless 命令 | 走订阅/免费登录 | 备注 |
|---|---|---|---|
| Claude Code | `claude -p "..."` | Pro/Max 订阅登录 | 2026-06-15 起 headless 走独立月度 Agent SDK 额度（Max ~$100–200/月） |
| Codex CLI | `codex exec "..."` | ChatGPT Plus/Pro 登录 | `auth.json` 不绑主机，可拷无头机；当密码保管 |
| Gemini CLI | `gemini -p "..."`（或非 TTY 自动 headless） | 个人 Google 账号免费层 / AI Pro/Ultra | 免费层 60 req/min、1000 req/day，门槛最低 |

做成**可插拔**：`GENERATOR_CLI ∈ {claude -p, codex exec, gemini -p}`，下游 validate→render→approve 与用哪家无关。好处：不锁定、可对比、可降级。**已定：第一家先做 `claude -p`**（你已有 Claude Max，走订阅零 API），其余作为可插拔后备。

### 10.3 凭证解析器：自己用走订阅，别人用走 BYOK

利用"API key 环境变量盖过订阅态"作为开关：

```text
你自己跑:  claude -p  (不设任何 key)                 -> 走你的订阅，零 API 计费
别人跑:    ANTHROPIC_API_KEY=<他的key> claude -p      -> 走他自己的 BYOK，计费归他
           (Codex 用 OPENAI_API_KEY，Gemini 用 GEMINI_API_KEY)
```

请求带用户 key 就注入子进程 env（算他的账），不带就用本机订阅（算你的）。一份代码，两种身份，**你的订阅永不暴露给别人**。

### 10.4 硬约束

- **别用 Agent SDK 库做生成**：SDK 强制要 API key、不吃订阅；要订阅就 shell out `claude -p`。
- **env 优先级坑**：设了对应 API key 变量会盖过订阅 → 被计费；走订阅就别设。
- **ToS 红线**：个人/内部用允许；拿个人订阅**对外给别人当托管服务**违规（且订阅 OAuth token ~8–12h 过期）。对外多用户**只能走 BYOK API key**。
- **部署形态定能力**：本地工具（每人自己机器跑）→ 用户可用自己的订阅或 key；托管服务（你架服务器）→ 远端用户**只能填 BYOK key**，此时用官方 SDK/API + 用户 key 反而最正。

---

## 11. 与 Desktop Editor 的关系

按 §4 的统一模型，web 编辑的是**同一份 TileMap 文档的 lite 子集**，不是另一种格式：

```text
AI generator -> blueprint JSON -> (importer) Layer 子树
   -> 嫁接进 web TileMap(lite 子集)
   -> Web Lite Reroll Editor 编辑
   -> 导出 lite 子集 / patch
   -> 投影/填默认 -> desktop 全保真 TileMap
```

网页端**不需要懂**的，作为不认识的字段**原样保留**（forward-compat）：`Layer` 树全部规则、`Palette`/`Distributor`/pass 内部结构、base64 矩阵、desktop undo command、`TileMapHandler` 全量上下文。投影/嫁接（converter）是格式边界的**轻量投影**而非有损翻译，可用 TS / Python / C++ 实现。

> 范围提醒：AI 生成的地图"天生就是 lite"（blueprint import 出来本就没有 distributor 那套），web 原生舒服；**任意 desktop 全保真地图**在 web 里编辑（保留重字段 + 渲染真实贴图）是 stretch goal，不进 MVP。

---

## 12. 仓库与部署

### 12.1 资产第一方 → 公开/私有是产品选择

tileset 全部自有、无版权问题，所以可 public（GitHub Pages 公开 demo）也可私有/自托管，纯产品决策。仍需注意**非素材的泄露面**：private prompt、internal path、未清理 metadata、真实项目结构——public 前清理即可。

### 12.2 两种放法

| 放法 | 优点 | 适合 |
|---|---|---|
| in-repo `web/reroll/`（与 `web/tagger/` 并列） | 起步最快，共享 repo 与 CI | 早期 MVP、自己用 |
| 独立 repo（如 `tilemap-reroll-web`） | demo 干净、可独立 build/deploy、Pages 稳定 | 对外公开 demo |

> **已定：in-repo `web/reroll/`**（与 `web/tagger/` 并列，照其 Vite + TS 结构起步）。独立 public repo 留作日后对外 demo 的可选项；届时按"前端可独立 build/deploy、只依赖 lite-profile schema 文档与导出的 demo JSON"迁出即可。

无论哪种，前端应可独立 build/test/deploy，只依赖公开的 lite-profile schema 文档与导出的 demo blueprint / lite-子集 JSON，不依赖 private repo 的 include/source 路径或 desktop 全量类型名。

### 12.3 静态前端 + 可选生成后端

```text
GitHub Pages / CDN     -> 静态 web 编辑器（编辑 + 区域 reroll 全在客户端，零 LLM）
可选后端（自托管）       -> /api/generate（图->blueprint，可插拔 CLI + 凭证解析器，§10）
                       -> /api/save（可选，云端保存）
```

区域 reroll **不**走后端/模型（§7.2），所以没有 `/api/reroll`。编辑器本体不需要后端即可运行；后端只在要"图→初稿"或云端保存时才接。

---

## 13. MVP 切分（围绕收敛洞察重排）

### MVP 0：blueprint JSON → Canvas 查看器（复刻 overlay）  ← **第一刀**
直接加载飞轮产物 blueprint JSON（如 `curated_dataset/<TS>_beach_village/blueprint.json`，**浏览器读，不进模型上下文**）→ Canvas 2D 按统一 role→color 渲染 terrain+objects → pan/zoom、hover。
**只依赖统一 role→color 表，不依赖 tileset preset**，故现在就能做。
**里程碑：浏览器里渲染出与 `overlay.png` 一致的图（overlay 平价）。**

### MVP 0.5：palette override（真实贴图模式）  ← **推迟（待 palette/tileset preset 就绪）**
加 `appearance(role, mode)` 策略 + 模式开关，preset 提供 role/variant→真实 tile/sprite。
**里程碑：一键从 overlay 切到接近最终效果的预览。**

### MVP 1：选择 / 拖动 / 单体 reroll（引入 lite 子集 + 投影）
blueprint→Layer 子树→嫁接进 web TileMap(lite 子集)；Select 工具、点击选中、拖动 grid snap、单体 reroll、lock/unlock、undo/redo。

### MVP 2：Terrain Brush
terrain swatches、brush size、paint/erase，**写每对象矩阵、尊重堆叠**（§4.3）；一次 drag 一个 undo。

### MVP 3：区域 Reroll
Box Reroll、区域 preview、删除并重生成未 locked objects、可选重画 terrain（各对象矩阵）、边界修复、一个 undo 单位。

### MVP 4：导入 / 导出 / 生成后端接入
导入导出 lite 子集 JSON、可选 patch、投影到 desktop；可选接入 §10 生成后端。

---

## 14. 非目标（第一阶段明确不做）

**新建地图 / 改地图尺寸**（canvas 尺寸恒等于 blueprint 的 width/height，§3.6）、在线完整 desktop editor、WebGL/wasm 移植、palette 编辑、用户自带 tileset、layer tree 编辑、多 layer visibility/reorder UI、object 内部 tile 编辑、desktop 全保真字段直接编辑、多用户协作、服务端账号系统。

---

## 15. 主要风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| lite profile 偏离 desktop schema | web 子集与 desktop 全集随演进失去子集关系 | profile 是 desktop schema 的**有文档子集**；不认识的字段原样保留；加往返测试（desktop→web→desktop 无损） |
| role→color 调色板四处漂移 | 网页成为第四个副本 | 从单一真相源构建期生成，禁手抄（§2.4） |
| terrain 堆叠在 brush 中被破坏 | 跨类型涂时误清下层 terrain | 默认尊重堆叠、每对象矩阵编辑、显式才打洞（§4.3） |
| 网页贴图与引擎渲染不一致 | preset 解析与引擎不同 | preset 复用引擎 tile 源/规则；像素级最终以 desktop 为准（§2.3/§5） |
| reroll 结果不可控 | 用户点随机破坏布局 | locked object、placement rule、seed、undo |
| 区域边界断裂 | reroll 区域与外部不连续 | 读一圈外部邻居作约束（§7.5） |
| 性能退化 | 大地图 Canvas 全量重绘慢 | 分层 canvas、dirty rect、限制 MVP 地图尺寸 |
| 生成后端凭证误计费 | API key env 盖过订阅 | 凭证解析器显式管理 env（§10.3/10.4） |

---

## 16. 决策记录

所有开放问题已定。

**架构（v2.1 / v2.2）**：数据模型 = TileMap lite 子集 + 不同 Handler 上下文（§4）；terrain = 每对象矩阵以支持堆叠（§4.3）；Phase A 直吃 blueprint JSON；真实第一方 tileset、用户不能自带；代码放 in-repo `web/reroll/`（§12.2）；第一刀只做 MVP 0，MVP 0.5 推迟（§13）。

**范围与交互（v2.3）**：
- web **永不新建地图**，canvas 尺寸 = blueprint 的 width/height（§3.6、§14）。
- 单体 reroll **允许同 kind 改 footprint**（§7.1）。
- 区域 reroll **无 prompt、不走大模型**，纯 preset + seed + 规则（§7.2、§12.3）。
- 区域 reroll **允许改 locked object 周围的 terrain**（本体保留）（§7.2）。
- tileset preset **复用引擎 palette export/import 格式**，随 palette 推迟（§5）。
- 生成后端**先做 `claude -p`**（§10.2）。

**待产出文档**：`WEB_LITE_SCHEMA.md` —— lite profile 精确字段清单与 desktop schema 的对照（§4.5）。建议在 MVP 0 之后、引入 lite 子集编辑（MVP 1）之前补。
