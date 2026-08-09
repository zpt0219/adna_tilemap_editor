# autotile_mixer 配置持久化 / 预设 / 数据导出：设计

> 日期：2026-08-08
> 性质：**实施前的设计稿，待确认**。批准后再动代码。
> 相关：[`AUTOTILE_PATTERN_BAKE.md`](AUTOTILE_PATTERN_BAKE.md)（花纹数据从哪来）、
> [`AUTOTILE_SCHEMES.md`](AUTOTILE_SCHEMES.md) §5（为什么是 47 块）
> 涉及：`autotile_mixer/src/App.tsx`、新增 `src/utils/recipe.ts`、`src/utils/exportSheet.ts`

---

## 0. 解决什么问题

两件事：

1. **调完就丢。** 现在 `localStorage` 里只有 `adna_lang`（`App.tsx:53`）。
   二十几个旋钮调半天，刷新一下全回默认。
2. **图集出去了，用不上。** 只能导出 PNG，而"哪种邻居组合取哪一格"这张表
   （`blobSlotForMask`）只活在这个 app 里。别人拿到 PNG 不知道怎么用。

第 1 件是每次用都会碰到的；第 2 件成本很低，顺手做掉。

---

## 1. 状态分三类

现有 24 个 `useState`，必须先分清哪些属于"配方"。**这个分类是后面所有设计的基础**：
配方是可以命名、保存、分享、导出的东西；视图偏好不是；瞬时状态什么都不是。

### 1.1 配方（Recipe）——进预设、进导出

| 字段 | 类型 | 合法范围 | 现有 state |
|---|---|---|---|
| `terrainA` `terrainB` `edge` | `#rrggbb` | — | `roleHex` |
| `pattern` | `PatternId` | 10 个之一 | `patternId` |
| `edgeSeed` | int | 0..99999 | `edgeSeed` |
| `bandSteps` | int | 3..5 | `bandSteps` |
| `hardEdgeB` | bool | — | `hardEdgeB` |
| `bandBias` | float | −1..1 | `bandBias` |
| `customShades` | `(string \| null)[] \| null` | 长度必须 `= bandSteps + 2` | `customShadesHex` |
| `noise` | `NoiseId[]` | `white`/`blue`/`clumped`/`ordered` 的子集 | `patternNoise` |
| `noiseSeed` | int | 0..99999 | `patternNoiseSeed` |
| `noiseStrength` | float | 0..2 | `patternNoiseStrength` |
| `noiseTargets` | `NoiseTargetId[]` | `edge`/`terrainA`/`terrainB` 的子集 | `noiseTargets` |
| `customNoise` | `{b?,edge?,a?} \| null` | 每项 `#rrggbb` | `customNoiseHex` |
| `textureAlgoA` `textureAlgoB` | `TextureId` | 10 个之一 | 同名 |
| `textureAmountA` `textureAmountB` | float | 0..1 | 同名 |
| `textureShadesA` `textureShadesB` | int | 1..4 | åŒå |
| `textureSeedA` `textureSeedB` | int | 0..99999 | åŒå |
| `textureColourA` `textureColourB` | `#rrggbb` | — | `texHex` |
| `tileSize` | int | 16 或 32 | `tileSize` |

`tileSize` 算配方而不算视图：它改变的是**输出的像素**，不是显示方式。

### 1.2 视图偏好——单独存，不进预设

`showGrid`、`showCellDots`、`zoom`、`playgroundZoom`。
换预设不应该动这些——你把图集放到 8x 在看细节，切个配色就被拽回 2x 是很烦的。

`lang` 已经单独存在 `adna_lang`，跨 app 共享，不动它。

### 1.3 瞬时——不存

`blobCells`（画板内容）、`isDrawing`、`drawVal`。
画板不持久化是你定的。

---

## 2. 存储

四个独立的 key，互不影响：

```
adna_lang               已存在，跨 app 共享的语言                （不动）
adna_blob47_recipe      自动保存的当前配方                       {v:1, recipe}
adna_blob47_presets     用户预设库                               {v:1, items:[{name, recipe, savedAt}]}
adna_blob47_view        视图偏好                                 {v:1, showGrid, showCellDots, zoom, playgroundZoom}
```

分开而不是塞进一个大对象，是为了**一处坏了不牵连其它**：预设库 JSON 被手改坏了，
自动保存的当前配方还在。

每个 blob 都带 `v`（schema 版本）。现在一律 `v: 1`。

### 写入时机

自动保存挂在配方对象上，**300ms debounce**。
不 debounce 的话拖一次滑杆是每秒 ~40 次同步 `localStorage.setItem` ——
JSON 不到 1KB，但同步写会占主线程，而这个 app 拖滑杆时本来就在重绘 48 张图。

---

## 3. 内置预设

按你"宁可硬编码也别现算"的偏好，内置预设写死在 `recipe.ts` 里一个 `BUILTIN_PRESETS`
常量，只读：能选、能"另存为"复制一份，不能改名不能删。

**⚠ 下面这几组配色是我配的，不是从你的参考图来的。** 除了第一组（就是现在的默认值），
其余都可以直接改 hex，或者告诉我砍掉。

| 名字 | terrainA（绘制区） | terrainB（空白） | edge（描边） | 花纹 | 纹理 |
|---|---|---|---|---|---|
| 水岸（默认） | `#3a7fc9` 水 | `#5da832` 草 | `#e8d5a0` 沙 | rounded | 无 |
| 海岸线 | `#2f6fb5` 深水 | `#6bb03a` 草 | `#e8d5a0` 沙 | coast | A=ripple B=clumped |
| 岩浆 | `#d94a1f` 熔岩 | `#3a3540` 岩 | `#f2b33d` 焦边 | jagged | A=clumped B=white |
| 雪原 | `#dfe8f0` 雪 | `#5a6b7d` 石 | `#9fb4c9` 冰 | billow | B=blue |

**配内置预设时必须知道的一个约束**（见 memory `shade-recipe-semantics`）：
`terrainA` 的明度不能顶到 1.0、饱和度要留余量。`SHADE_RECIPES.terrainA` 只**加**饱和度
（`sat: +0.129`），底色如果已经 `s=1`，过渡带靠内的几级会全部塌回本色，只剩一条描边。
默认的水蓝 `#3a7fc9` 是 `s≈0.71`，特意留了到 0.87 的余量。上表每一组都照这个来配的。

---

## 4. 读取时的校验：逐字段降级，绝不整体丢弃

这是整个设计里最要紧的一段。存进去的配方可能来自更旧的构建，可能被手改过，
可能引用了已经删掉的 `patternId`（2corner 就删过一次）。

写一个纯函数：

```ts
export function sanitizeRecipe(raw: unknown): Recipe
```

规则，**逐字段**，任何一个字段坏掉都不影响其它字段：

| 情况 | 处理 |
|---|---|
| 不是对象 / `null` | 整体返回 `DEFAULT_RECIPE` |
| 字段缺失 | 用该字段的默认值 |
| 枚举值不在白名单（比如被删掉的 pattern） | 用该字段的默认值 |
| 数值越界 | clamp 到范围，不是丢弃 |
| 数组含非法项 | 过滤掉非法项，保留合法的 |
| hex 格式不对 | 该字段用默认值 |
| `customShades` 长度 ≠ `bandSteps + 2` | 整个置 `null` |
| `customShades` 某一项 hex 非法 | 该项置 `null`，其余保留 |

最后一条对齐了运行时已有的行为：`paintPatternTileRGBA` 在 `customRamp.length !== derived.length`
时就是整体回退（`patternPaint.ts:211`）。校验和运行时用同一条规则，不会出现
"存进去了但画不出来"。

**这是这次改动里唯一需要新单测的地方**，因为它是纯函数、分支多、坏了会白屏。
其余都是 UI 接线。

### 应用预设 = 整体替换，不是逐字段 merge

`customShades` 的长度绑死在 `bandSteps` 上。逐字段 merge 会出现
"新的 bandSteps + 旧的 customShades"，长度对不上、静默回退，用户看到的是"换了预设但颜色没跟着换"。
所以 `applyRecipe` 一次性 set 全部字段。

---

## 5. UI

左栏最上面新增一张 `panel-card`「预设」，放在「地形与配色」之前——它是入口，
应该在你调任何旋钮之前就看到。

```
┌─ 预设 ───────────────────────────┐
│ [ 水岸（内置）          ▾ ] ●    │   ● = 当前配置已偏离所选预设
│ ┌─────────┬─────────┬─────────┐ │
│ │ 另存为… │  重命名  │  删除   │ │   后两个对内置预设禁用
│ └─────────┴─────────┴─────────┘ │
│ ┌───────────────┬──────────────┐│
│ │   导入 JSON   │   导出 JSON  ││
│ └───────────────┴──────────────┘│
└──────────────────────────────────┘
```

- 下拉用 `<optgroup>` 分「内置」/「我的预设」，和现有的花纹选择器一致。
- 选中即应用，没有"确认"按钮。
- **`●` 脏标记**：当前配方与所选预设不逐字段相等时显示。没有它，
  用户分不清"我现在看到的到底是不是这个预设"。
- 「另存为…」用 `prompt()` 要名字。重名追加 `(2)`。
  （不做自定义弹窗——为一个取名框写 modal 不划算。）
- 现有的「恢复默认配色」按钮保留在原处，它只重置 3 个颜色，和预设是两码事。

备选方案：把预设条放进 header。我不推荐——header 已经是三栏 grid，
再塞会挤掉标题居中；而且左栏最上方符合"从上往下调"的既有顺序。

所有新文案都要在 `shared/i18n.ts` 里补 zh + en 两份。

---

## 6. 导入 / 导出 JSON（预设文件）

文件里**永远是数组**，即使只有一条：

```jsonc
{
  "app": "autotile_blob47",
  "version": 1,
  "presets": [
    { "name": "我的岩浆", "recipe": { /* §1.1 的字段 */ }, "savedAt": "2026-08-08T..." }
  ]
}
```

- 「导出 JSON」导出**当前配方**（数组长度 1），文件名 `blob47_<预设名或 custom>.json`。
- 想整库备份的话，另存为按钮旁边再放一个「导出全部」——这个我建议**先不做**，
  等你确实需要跨机器搬的时候再说。
- 「导入 JSON」走 `<input type="file">`，每条都过 `sanitizeRecipe`，
  重名追加 `(2)`。`app` 字段对不上就拒绝并提示，不猜。

---

## 7. 图集数据导出

你说"只要图就行"，所以**主按钮「导出 Tileset PNG」一个字都不改**。
旁边加一个次要按钮「导出数据 (JSON)」，只下 JSON，不重复下 PNG。
不需要的人永远不用碰它。

```jsonc
{
  "app": "autotile_blob47",
  "version": 1,
  "sheet": {
    "file": "tileset_blob47_rounded_32px.png",   // 和 PNG 的默认文件名一致
    "tileSize": 32, "columns": 8, "rows": 6, "slots": 48
  },

  // 位的含义：置 1 = 那个邻居也是地形 A。和引擎的 Dir4/Corner4 同序（blob47.ts:13）
  "bits": { "N": 1, "E": 2, "S": 4, "W": 8, "NE": 16, "SE": 32, "SW": 64, "NW": 128 },

  // 槽位下标 -> 这一格画的是哪个 canonical mask。255 出现两次（布局有两个富余槽）
  "layout": [6, 10, 46, /* ...48 项... */],

  // 8 邻居原始 bitmask (0..255) -> 槽位下标。查表前不需要自己做 canonicalize
  "maskToSlot": [/* 256 项 */],

  "background": {
    "note": "未绘制的格子不取图集，改画这张纯地形 B 瓦片",
    "png": "data:image/png;base64,..."
  },

  "recipe": { /* §1.1，好让这张图以后能一模一样地重新生成 */ }
}
```

两个必须写进 JSON 的坑：

1. **图集里没有背景格。** `BLOB47_LAYOUT` 是 48 槽 47 masks，
   `BLOB47_BACKGROUND = -1`，空白格子是"什么都不画"（`blob47.ts:71`）。
   而地形 B 一旦开了纹理就不是纯色，光给个 RGB 不够。
   所以把那张 16/32px 的背景瓦片以 data URI 塞进 JSON——几百字节，
   代价是 JSON 自足，按钮不用多一个。
2. **`maskToSlot` 已经做过 canonicalize。** 使用者直接拿 8 位邻居掩码查表就行，
   不用重新实现"角位只在两条邻边都连上时才算数"那套规则。

---

## 8. 明确不做

| | 理由 |
|---|---|
| URL hash 分享 | 和导入导出功能重复，还要另写一套紧凑编码，收益不成正比 |
| 画板布局持久化 / 撤销 | 你说了不做 |
| 预设缩略图 | 要在后台渲染 48 张图再缩，为一个下拉列表不值 |
| 多地形（3+ terrain） | 伤筋动骨，不在这轮 |

---

## 9. 实施顺序

每一步都能单独跑起来验证：

1. `src/utils/recipe.ts`：`Recipe` 类型、`DEFAULT_RECIPE`、`sanitizeRecipe`、
   `BUILTIN_PRESETS` + `recipe.test.ts`（纯函数，先有测试）
2. App 接线：`useRecipe` 把 17 个 state 收成一个对象 + 自动保存/恢复 + 视图偏好
3. 预设库 + UI 面板 + i18n
4. 导入 / 导出 JSON
5. 图集数据导出

第 2 步会顺带把 B 组里"手工维护的 dep key"那个问题彻底解决——
配方本来就是一个对象，两个 `useEffect` 直接依赖它即可，
不用再拼 `roleHexKey / textureKey / customShadesKey / ...` 六个字符串。

### 验证口径

- `npm test`：现在 483 个，预期只增不减（新增 `recipe.test.ts`）
- `npm run lint`：基线是 1 warning（`App.tsx` 的 exhaustive-deps，刻意保留）
- 10 个 pattern 的锁定哈希**一个都不许动**——这轮不碰任何画像素的代码
- 手动过一遍：调一堆参数 → 刷新 → 应该原样回来；存预设 → 切走 → 切回来；
  导出 JSON → 手改坏一个字段 → 导入 → 应该只有那个字段回默认，别的都在

---

## 10. 待你拍板

1. §3 那四组内置预设的配色，收还是改？（第一组是现有默认，肯定留）
2. §6「导出全部预设」现在做还是先不做？（我倾向先不做）
3. §5 预设面板放左栏最上方，可以吗？
