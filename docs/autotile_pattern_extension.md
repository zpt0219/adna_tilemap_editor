# 纹理参数扩展分析：哪些纹理可加入 Scale / Density Slider

## 背景

已完成 `cells` 的 `cellScale` 参数（2×2 ~ 6×6 Voronoi 网格密度）。现在分析所有 22 个纹理算法，看哪些还能通过引入一个新参数来扩展其表现力。

---

## 纹理分类与参数化可行性分析

### ✅ 可参数化的纹理（推荐加入 Slider）

#### 1. `ripple` — 水面波纹 · 横向短划

- **当前实现**：[rippleField](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/utils/patternTexture.ts#L143-L152) 使用 `perX = 4`（4 个水平单元跨 32px → 每条约 8px 宽的横向相关性）和 `perY = 32`（每行独立）。
- **参数化方案**：`rippleScale` slider 控制 `perX`，范围 **2 ~ 8**。
  - `perX = 2` → 每条波纹约 16px 宽，非常稀疏宽大的波浪
  - `perX = 4` → 当前默认，中等密度
  - `perX = 8` → 每条仅 4px，非常稠密的细波纹
- **可行性**：⭐⭐⭐⭐⭐ 极简改动，只需将 hardcoded `perX = 4` 改为参数传入
- **语义**：`波纹密度 / Ripple density`

#### 2. `water` — 水面边线

- **当前实现**：[WATER baked table](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/utils/patternTexture.ts#L690-L722) 是一个固定的 32×32 像素表，边线位置已经写死。
- **参数化方案**：不能简单缩放 baked table。但可以改为**程序化生成**：用 Voronoi 边界来画水面边线（类似 cells 但只画边界线不填充），`waterScale` 控制边线之间的间距。
  - 或者更简单的方案：保留 baked table，但用一个 `lineSpacing` 参数控制 **amount 阈值的非均匀采样** — 即稀疏时只保留部分边线。
- **可行性**：⭐⭐⭐ 如果改为程序化 Voronoi 边线则高度可行但工作量大；如果只是控制密度则效果有限
- **语义**：`边线间距 / Line spacing`

> [!IMPORTANT]
> `water` 使用的是 baked 32×32 pixel art table，无法像 `cells` 那样简单地改变一个 `per` 参数来缩放。要真正控制"边线之间空间的大小"，有两条路：
> 
> **方案 A（推荐）**：将 `water` 改为程序化 Voronoi 边界线 + 随机散点，用 `waterScale` 控制 Voronoi cell 数量（类似 cells 但只画 grout 线不填充 interior）。这样边线间距直接由 cell 密度决定。
> 
> **方案 B**：保留 baked table 不变，只用 slider 控制 amount/阈值。这仅控制"有多少边线可见"，无法真正改变边线之间的物理间距。

#### 3. `cells` — 多边形细胞 ✅ 已完成

- 已有 `cellScale` slider（2 ~ 6），控制 Voronoi 网格密度。

---

### ⚠️ 理论上可参数化但改动较大的纹理

#### 4. `nonslip` — 交叉防滑纹

- **当前实现**：[NONSLIP baked table](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/utils/patternTexture.ts#L797-L829)，32×32 但实际是 8×8 的重复图案。
- **参数化方案**：如果改为程序化生成（交叉对角线网格），可控制网格间距。但 baked table 改程序化开销大。
- **可行性**：⭐⭐ baked table 限制了参数化

#### 5. `brick_wall` / `cobbles2` / `brick_floor` — 各种砖

- **当前实现**：全部是 baked pixel art tables。
- **参数化方案**：如果改为程序化（running bond 算法），可控制砖块大小。但这些纹理的像素级细节（砖面上的明暗变化、风化痕迹）是 baked art 的核心价值，程序化很难还原。
- **可行性**：⭐ 不建议改动，baked art 的质感是手绘的

#### 6. `hexagon` / `isometric` / `octagonal` — 几何铺装

- **当前实现**：baked 32×32 tables。
- **参数化方案**：这三个的几何结构理论上可以程序化生成（六边形网格、菱形网格、八边形网格），然后用 scale 参数控制大小。
- **可行性**：⭐⭐⭐ 程序化生成这些几何图案并不复杂，但需要从零重写

---

### ❌ 不适合参数化的纹理

| 纹理 | 原因 |
|------|------|
| `weave` | 16×16 baked art，菱格编织图案的像素级细节无法缩放 |
| `paving` / `paving3` / `paving5` | 32×32 baked art，乱砌石板的不规则排列是手绘的核心价值 |
| `stone_floor` | 32×32 baked art，不规则石板间缝的位置和形状是手绘的 |
| `breeze_block` | 32×32 baked art，镂空砖的孔洞位置是固定的 |
| `field` / `rubble` | 32×32 baked art，草地/碎石的分布是手绘有机形态 |
| `white` / `blue` / `ordered` | 这三个共用 `patternNoise` 模块的 `sample()` 函数，其密度已经由 `amount` 参数控制 |

---

## 推荐实施方案

> [!TIP]
> 按投入产出比排序，**ripple 第一优先**（改动极小，效果明显），**water 第二优先**（需要较大重构但用户明确要求）。

### Phase 1：`ripple` — rippleScale slider（⭐ 极简）

| 项目 | 详情 |
|------|------|
| 参数名 | `rippleScale` |
| 范围 | 2 ~ 8（step 1） |
| 默认值 | 4（当前行为不变） |
| 语义 | 水平单元数：值越大波纹越密，值越小波纹越宽 |
| 改动量 | ~20 行 |

**改动文件**：
- [patternTexture.ts](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/utils/patternTexture.ts)：`rippleField` 的 `perX` 改为参数；导出常量 `DEFAULT_RIPPLE_SCALE`, `MIN_RIPPLE_SCALE`, `MAX_RIPPLE_SCALE`；`textureShadeAt` 和 `usedTextureShades` 增加 `rippleScale` 参数
- [patternPaint.ts](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/utils/patternPaint.ts)：`TextureOptions` 增加 `rippleScaleA/B`
- [App.tsx](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/App.tsx)：在 `ripple` 选中时显示 slider
- [i18n.ts](file:///d:/godot_exe/adna_tilemap_editor/autotile_mixer/src/shared/i18n.ts)：增加翻译

### Phase 2：`water` — 程序化水面边线（⭐⭐⭐ 中等工作量）

将 `water` 从 baked table 改为程序化 Voronoi 边界线生成：

| 项目 | 详情 |
|------|------|
| 参数名 | `waterScale` |
| 范围 | 2 ~ 6（step 1） |
| 默认值 | 3（近似当前 baked table 的视觉密度） |
| 语义 | Voronoi cell 数量：值越大边线越密越细碎，值越小边线越稀疏越宽阔 |
| 改动量 | ~80 行 |

**实现思路**：
1. 复用 `cellsAt()` 得到 F1/F2 距离
2. 只在 Voronoi 边界处（`f2 - f1 < threshold`）画线（shade = 2，即边线色）
3. 在少量随机位置（`hash01 < dotDensity`）画亮点（shade = 4，即 pale dot）
4. 其余区域为 shade 0（跟随地形色）
5. `waterScale` 直接控制 `per` 参数

这样用户就能真正控制"边线之间空间的大小"。

---

## Open Questions

1. **ripple 是否也需要竖向密度参数**？当前 `perY = 32`（每行独立），如果加入 `perY` 参数可以做竖向相关的波纹，但这会改变 ripple 的本质特征（横向短划）。建议只控制水平密度 `perX`。

2. **water 程序化后是否保留 baked table 作为默认**？如果改为纯程序化，默认 `waterScale=3` 的外观会与当前 baked art 略有不同。是否可以接受视觉差异？

3. **是否要一次性实施两个 Phase，还是先做 ripple 看效果再决定 water？**
