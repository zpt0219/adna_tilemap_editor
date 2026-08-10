# autotile_mixer 配置持久化 / 预设 / 数据导出 / URL分享：设计

> 日期：2026-08-08 (更新于 2026-08-10，按最新代码库及纯 URL 分享方案简化)
> 性质：**实施前的设计稿，已更新**。批准后再动代码。
> 相关：[`AUTOTILE_PATTERN_BAKE.md`](AUTOTILE_PATTERN_BAKE.md)（花纹数据从哪来）、
> [`AUTOTILE_SCHEMES.md`](AUTOTILE_SCHEMES.md) §5（为什么是 47 块）
> 涉及：`autotile_mixer/src/App.tsx`、新增 `src/utils/recipe.ts`、`src/utils/recipeCodec.ts`、`src/utils/exportSheet.ts`

---

## 0. 解决什么问题

两件事：

1. **调完就丢。** 现在 `localStorage` 里只有 `adna_lang`（`App.tsx:156`）。
   三十几个旋钮调半天，刷新一下全回默认。
2. **快捷分享/复现。** 调出一个好看的图集无法直接发给队友。
   通过二进制 Bit-Packing 编码生成极致短小的 URL（~50-60字符），他人直接点击链接即可 100% 原样复现图集，无需繁琐的 JSON 文件导入导出。

---

## 1. 状态分三类

根据最新 `App.tsx` 的状态定义，必须先分清哪些属于"配方"。**这个分类是后面所有设计的基础**：
配方是可以命名、保存、分享、导出的东西；视图偏好不是；瞬时状态什么都不是。

### 1.1 配方（Recipe）——进预设、进 URL

包含最新代码库中影响图集渲染的全部 28+ 个具体参数：

| 字段 | 类型 | 合法范围 | 现有 state / 代码出处 |
|---|---|---|---|
| `terrainA` `terrainB` `edge` | `#rrggbb` | — | `roleHex.terrainA/B/edge` |
| `pattern` | `PatternId` | 10 个之一 | `patternId` |
| `edgeSeed` | int | 0..99999 | `edgeSeed` |
| `outlineWidth` | int | 1..4 (px) | `outlineWidth` |
| `bandSteps` | int | 3..5 | `bandSteps` |
| `hardEdgeB` | bool | — | `hardEdgeB` |
| `transparentB` | bool | — | `transparentB` |
| `bandBias` | float | −1..1 | `bandBias` |
| `customShades` | `(string \| null)[] \| null` | 长度 `= bandSteps + 2` | `customShadesHex` |
| `noise` | `NoiseId[]` | `white`/`blue`/`ordered` 的子集 | `patternNoise` |
| `noiseSeed` | int | 0..99999 | `patternNoiseSeed` |
| `noiseStrength` | float | 0..2 | `patternNoiseStrength` |
| `ribbonAlgo` | `RibbonId` | 4 个之一 (none/ring...) | `ribbonAlgo` |
| `ribbonAmount` | float | 0..1 | `ribbonAmount` |
| `ribbonPeriod` | int | 1..8 | `ribbonPeriod` |
| `ribbonShades` | int | 1..4 | `ribbonShades` |
| `ribbonInvert` | bool | — | `ribbonInvert` |
| `customRibbon` | `(string \| null)[] \| null` | 长度 `= ribbonShades + 1` | `customRibbonHex` |
| `textureAlgoA` `textureAlgoB` | `TextureId` | 10 个之一 | `textureAlgoA/B` |
| `textureAmountA` `textureAmountB` | float | 0..1 | `textureAmountA/B` |
| `textureShadesA` `textureShadesB` | int | 1..4 | `textureShadesA/B` |
| `textureSeedA` `textureSeedB` | int | 0..99999 | `textureSeedA/B` |
| `cellScaleA` `cellScaleB` | float | 0.5..2.0 | `cellScaleA/B` |
| `rippleScaleA` `rippleScaleB` | float | 0.5..2.0 | `rippleScaleA/B` |
| `geoScaleA` `geoScaleB` | float | 0.5..2.0 | `geoScaleA/B` |
| `customTexA` `customTexB` | `(string \| null)[] \| null` | 长度 `= shades + 1` | `customTexHex.terrainA/B` |
| `tileSize` | int | 锁定 32 | `TILE_SIZE` |

`tileSize` 算配方而不算视图：它改变的是**输出的像素**。

### 1.2 视图偏好——单独存，不进预设/URL

`showGrid`、`showCellDots`、`zoom`、`playgroundZoom`。
换预设或打开分享链接不应该动这些。

`lang` 已经单独存在 `adna_lang`，跨 app 共享，不动它。

### 1.3 瞬时——不存

`blobCells`（画板内容）、`isDrawing`、`drawVal`。

---

## 2. 存储与 URL

四个独立的存储/传输介质，互不影响：

```
adna_lang               已存在，跨 app 共享的语言                （不动）
adna_blob47_recipe      自动保存的当前配方                       {v:1, recipe}
adna_blob47_presets     用户预设库                               {v:1, items:[{name, recipe, savedAt}]}
adna_blob47_view        视图偏好                                 {v:1, showGrid, showCellDots, zoom, playgroundZoom}
URL Hash (#r=...)       二进制打包的分享链接                      V1 Bit-Packing Base64URL
```

每个 blob 和二进制包都带版本号。现在一律 `v: 1`。

### 写入与读取时机

- 自动保存挂在配方对象上，**300ms debounce** 写入 `localStorage`。
- 打开带有 `#r=...` 的 URL 时，优先解码 URL 的 Recipe 并恢复应用，随后清掉 hash 或更新为当前应用状态。

---

## 3. 内置预设

内置预设写死在 `recipe.ts` 里一个 `BUILTIN_PRESETS` 常量，只读。

| 名字 | terrainA（绘制区） | terrainB（空白） | edge（描边） | 花纹 | 纹理 |
|---|---|---|---|---|---|
| 水岸（默认） | `#3a7fc9` 水 | `#5da832` 草 | `#e8d5a0` 沙 | rounded | 无 |
| 海岸线 | `#2f6fb5` 深水 | `#6bb03a` 草 | `#e8d5a0` 沙 | coast | A=ripple B=clumped |
| 岩浆 | `#d94a1f` 熔岩 | `#3a3540` 岩 | `#f2b33d` 焦边 | jagged | A=clumped B=white |
| 雪原 | `#dfe8f0` 雪 | `#5a6b7d` 石 | `#9fb4c9` 冰 | billow | B=blue |

---

## 4. 读取时的校验：逐字段降级，绝不整体丢弃

写一个纯函数：

```ts
export function sanitizeRecipe(raw: unknown): Recipe
```

规则：逐字段校验，任何字段损坏或缺失均回退到 `DEFAULT_RECIPE` 的默认值，数值超界则 clamp。

---

## 5. UI

左栏最上面新增一张 `panel-card`「预设」，放在「地形与配色」之前：

```
┌─ 预设 ───────────────────────────┐
│ [ 水岸（内置）          ▾ ] ●    │   ● = 当前配置已偏离所选预设
│ ┌─────────┬─────────┬─────────┐ │
│ │ 另存为… │  重命名  │  删除   │ │   后两个对内置预设禁用
│ └─────────┴─────────┴─────────┘ │
│ ┌─────────────────────────────┐ │
│ │        复制分享链接         │ │   生成 #r=... 并复制到剪贴板
│ └─────────────────────────────┘ │
└──────────────────────────────────┘
```

- 点击「复制分享链接」：将当前配方经过 **Bit-Packing 二进制打包 + Base64URL** 生成 URL（`#r=...`）并复制到剪贴板，弹出 Toast 提示。

---

## 6. URL 紧凑二进制编码 (Bit-Packing Codec + Version Byte)

为实现**确定性、唯一性、字符最短**的 URL 分享，直接按 Bit 打包为二进制 Buffer，生成 ~50-60 字符的 Base64URL。

### 向后兼容：机制 1（头部 4 bits 版本号 V1）为核心保障
在二进制 Payload 的前 4 个 bits 写入 `version = 1`。未来若升级到 `V2` 新增参数，`V1` 解码器仍准确提取前 46 字节内容，缺失的新参数由 `sanitizeRecipe` 自动使用默认值补全，**保证历史生成的 URL 链接永久有效**。

### 二进制比特布局规范 (V1 Spec, 约 46 字节)

```
[Byte 0]      ├─ version (4 bits: V1=1) ├─ pattern (4 bits: 0..9)
[Byte 1..3]   ├─ terrainA RGB (24 bits)
[Byte 4..6]   ├─ terrainB RGB (24 bits)
[Byte 7..9]   ├─ edge RGB (24 bits)
[Byte 10..12] ├─ edgeSeed (24 bits)
[Byte 13]     ├─ outlineWidth (2b) ├─ bandSteps (2b) ├─ hardEdgeB (1b) ├─ transparentB (1b) ├─ tileSize (1b) ├─ reserved (1b)
[Byte 14]     ├─ bandBias (Int8: 8 bits, -100..100)
[Byte 15]     ├─ noiseMask (3b) ├─ ribbonAlgo (3b) ├─ ribbonInvert (1b) ├─ hasCustomShades (1b)
[Byte 16..18] ├─ noiseSeed (24 bits)
[Byte 19]     ├─ noiseStrength (Uint8: 8 bits)
[Byte 20..21] ├─ ribbonAmount (8b) ├─ ribbonPeriod (4b) ├─ ribbonShades (4b)
[Byte 22..29] ├─ Texture A 完整包 (64 bits: Algo 4b, Amount 8b, Shades 2b, Seed 24b, RGB 24b, Scale 2b)
[Byte 30..37] ├─ Texture B 完整包 (64 bits: Algo 4b, Amount 8b, Shades 2b, Seed 24b, RGB 24b, Scale 2b)
[Byte 38..43] ├─ Fine Scales (cellScaleA/B, rippleScaleA/B, geoScaleA/B 各 8b)
[Byte 44]     ├─ customTexMask (2b: A/B) ├─ hasCustomRibbon (1b) ├─ reserved (5b)
─── (静态部分 45 字节) ───
[Byte 45..N]  └─ (动态追加) 仅当 bitmask 为 1 时追加自定义色盘 RGB
```

---

## 7. 图集数据导出

主按钮「导出 Tileset PNG」维持原样，次要按钮「导出数据 (JSON)」包含全量 `sheet` 布局与 `maskToSlot` 查表（供游戏引擎自动寻路/铺路使用）。

---

## 8. 明确不做

| | 理由 |
|---|---|
| 预设 JSON 文件导入/导出 | 有了二进制 URL 短链接，无需离线文件传输，直接点开网址复现，更简洁 |
| URL 使用 JSON Base64 | JSON 键名占据 70% 无用体积，改用更高效的 V1 二进制 Bit-Packing |
| 画板布局持久化 / 撤销 | 保持轻量 |
| 预设缩略图 | 要在后台渲染 48 张图再缩，为一个下拉列表不值 |
| 多地形（3+ terrain） | 伤筋动骨，不在这轮 |

---

## 9. 实施顺序

1. `src/utils/recipe.ts`：`Recipe` 类型定义、`DEFAULT_RECIPE`、`sanitizeRecipe`、`BUILTIN_PRESETS` + `recipe.test.ts`
2. `src/utils/recipeCodec.ts`：V1 二进制 Bit-Packing 编解码器（Encode / Decode）+ `recipeCodec.test.ts`
3. App 接线：`useRecipe` 管理全部配方 state，连接 `localStorage` 自动保存与 URL Hash (`#r=...`) 解析
4. 预设面板 UI + 「复制分享链接」Toast 提示 + i18n
5. 图集 PNG & 引擎数据 JSON 导出

### 验证口径

- `npm test`：新增 `recipe.test.ts` 与 `recipeCodec.test.ts`，保证二进制 Pack 编解码双向无损。
- 二进制 URL 编码验证：任意调一组参数 $\rightarrow$ 点击「复制分享链接」 $\rightarrow$ 新标签打开 $\rightarrow$ 页面 100% 完全复现。

---

## 10. 待你拍板

1. §3 内置预设配色确认。
2. 预设面板放左栏最上方可否。
