# Tilemap 方向聚焦评审

> 日期：2026-08-02
> 起因：讨论「如果专注 tilemap 相关功能开发，有哪些建议」
> 性质：现状诊断 + 优先级建议。结论基于当时代码库的实际检查，不是设计决策——决策权在你。
> 后续：autotile 方案的技术推导另见 [`AUTOTILE_SCHEMES.md`](AUTOTILE_SCHEMES.md)。

---

## 0. 一句话结论

要专注 tilemap，难点不在加什么，在**砍什么**。真正不可替代的只有 `reroll` 的编辑闭环和
`autotile_mixer` 的图集生成两块；`pixel_editor` / `refiner` 的大部分是通用图像工具，
可替代性高。而且**合闭环应当优先于加任何新功能**——当前导出链路是断的。

---

## 1. 诊断

### 1.1 `reroll` 里没有 reroll ⚠️ 最需要决策

设计文档 [`WEB_LITE_REROLL_EDITOR.md`](WEB_LITE_REROLL_EDITOR.md) §3.5 明确写着
「Reroll 是第一等功能」，§13 把它切成 MVP 1（单体 reroll）和 MVP 3（区域 reroll）。

**实际情况**：`reroll/src` 下 13 处 "reroll" 字样，全部是

- `localStorage` key（`reroll_layers_w` / `reroll_props_w` / `reroll_draft_`）
- 文档引用注释（`WEB_LITE_REROLL_EDITOR.md §x`）
- UI 标题字符串（`<strong>Adna Web Lite Reroll</strong>`）
- 一个后端路径 `/api/reroll-pack`

**没有任何一行 reroll 逻辑。** 单体 reroll 和区域 reroll 都未实现。

与此同时，文档 §14「第一阶段明确不做」的清单里的条目——**layer tree 编辑、
多 layer visibility/reorder UI、object 创建**——都已经实现了，另外还多做了多选、
剪贴板、bitwise 对象模态框、i18n。

> **范围漂移**：应用正在朝着它自己声明的非目标（§14「在线完整 desktop editor」）
> 生长，而立身之本没动。这是最需要你拍板的一件事：是补回 reroll，还是正式承认
> 定位已变、改写设计文档？

附带一个好消息：文档说单体 reroll 卡在「blueprint schema 没有 `variant` 字段，
等 palette preset」。但 palette pack 加载（原计划的 MVP 0.5，文档标注为"推迟"）
其实**已经做完了**（`src/pack/` 整套：loadPack / decode / compile / slice / blit /
autotile / frg）。所以这个前置条件可能已经解除，值得重新评估。

### 1.2 导出是断头路

`reroll/src/saveFormat.ts` 写出 `adna-web-lite` v3 格式，文件头注释：

> a desktop loader (future pass) reads it and opens it as a new map per the doc's §4 mapping

在引擎仓 `../tile_map_editor_imgui` 的 `desktop/src` 与 `src` 下检索
`web.lite` / `weblite` / `adna_web`，**无任何匹配**。

即：现在编辑完导出的存档，没有任何程序能打开它。链路没合上，上游所有编辑功能的
价值都要打折。

### 1.3 但 mixer → engine 的通路其实已经对齐了 ✅

`autotile_mixer/src/App.tsx`：

```js
const WANG_LAYOUT = [4, 3, 14, 6, 10, 7, 15, 13, 1, 9, 11, 12, 0, 2, 5, 8];
```

`reroll/src/pack/autotile.ts`（从引擎 `src/core/palette.cpp` 移植）：

```js
const TWO_CORNER_MATRIX = [
  [4,  3, 14,  6],
  [10, 7, 15, 13],
  [1,  9, 11, 12],
  [0,  2,  5,  8],
];
```

展平后**逐字节相同**。也就是说 autotile_mixer 生成的 16 图块 2-corner Wang 图集，
布局本来就是引擎能直接吃的——集成比看起来近得多。

**但**这靠的是两处独立手抄的常量表，**没有任何测试锁住**。哪天谁改了一处，
结果是静默的错位渲染，不会有任何报错。这是个应当尽快消除的雷。

---

## 2. 建议

### 2.1 先收缩

| 子应用 | 建议 | 理由 |
| --- | --- | --- |
| `pixel_editor` | **冻结**在当前可用水平 | 通用精灵编辑器，正面竞品 Aseprite / Piskel。刚落地，正处在"每加一个功能都很爽"的阶段——这是最危险的时候。不要再加选区、动画帧、洋葱皮。 |
| `refiner` | 保留「无缝瓦片工坊」，其余冻结 | 无缝瓦片是 tilemap-specific 的；去锯齿/去背/色板限制是通用图像处理。 |
| `tagger` | 维持 | 已完成其职能，无需投入。 |
| `reroll` | **主战场** | web 端唯一不可替代的价值所在。 |
| `autotile_mixer` | **主战场** | 真正 tilemap-specific 的生成能力。 |

### 2.2 再按此顺序推进

1. **合闭环，优先于加任何功能。**
   让 `adna-web-lite` 能被打开。两条路线：
   - (a) 在引擎仓写 C++ loader；
   - (b) 反过来，让 reroll 直接读写 desktop 原生 save 格式，省掉中间格式。

   倾向 (b) 如果不想频繁动 C++；代价是 web 侧要吃全保真 schema。
   **这一步不做，后面全是空转。**

2. **把 reroll 做出来。**
   desktop 已经能编辑地图了，web 端的差异化只能是 reroll——快速试错、区域重掷、
   seed 可复现。先 MVP 1 单体（重新评估 §1.1 的前置条件），再 MVP 3 区域。

3. **打通 mixer → reroll。**
   让 `autotile_mixer` 直接导出 `.adnapalettepack`（而不是导出 PNG 再手工搬运），
   reroll 直接加载。基于 §1.3，布局已对齐，改动比预期小。

4. **抽公共层 + 上 golden test。**
   把 autotile 规则表、terrain matrix、pack 解码挪到 `libs/`（已有 `noise.ts` /
   `rng.ts` 先例和 `@lib` alias），配一个锁住 16 / 13+1 布局的快照测试。

### 2.3 第一刀推荐

**推荐 #4。** 半天到一天，零风险，立刻消除 §1.3 的静默雷，而且它是 #3 的前置——
做完后 mixer 和 reroll 共享同一张表，通路自然就通。

#1 和 #2 是大工程，值得单独规划一轮。

---

## 附录：本文结论的复核方法

```bash
# 1.1 — reroll 逻辑是否存在
grep -rni "reroll" reroll/src | grep -v "adna-web-reroll"

# 1.2 — 引擎侧是否有 adna-web-lite loader
grep -rli "web.lite\|weblite\|adna_web" \
  ../tile_map_editor_imgui/desktop/src ../tile_map_editor_imgui/src

# 1.3 — 两处布局表是否仍然一致
grep -n "WANG_LAYOUT" autotile_mixer/src/App.tsx
grep -n -A5 "TWO_CORNER_MATRIX" reroll/src/pack/autotile.ts
```
