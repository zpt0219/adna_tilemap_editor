# Pattern 烘焙链路：规格与复现

> 日期：2026-08-06
> 性质：长期技术参考 + 复现规格。**烘焙脚本本身不进仓库**，这份文档是它唯一的备份。
> 相关：[`AUTOTILE_SCHEMES.md`](AUTOTILE_SCHEMES.md) §5（距离场推导）
> 产物：`autotile_mixer/src/utils/patterns/generated.ts`

---

## 0. 这份文档解决什么问题

`generated.ts` 是机器产物：10 个 pattern × 47 个 canonical mask × 256 字符的量化距离场，
约 120 000 个字符。生成它的 Python 脚本（`patterns.py` / `fields.py` / `gen.py` /
`emit3.py` / `common.py` / `bluenoise.py`）当时只存在于一个临时 scratchpad 里，**没有进
仓库，也不打算进**。

代价是：想加第 11 个 pattern、想调某个 pattern 的边缘粗糙度、想改 band 结构，就得先把
烘焙链路重建出来。这份文档记录重建它所需的全部信息 —— 算法、常量、验证方法，以及**试过
但走不通的路**（§7，比正向规格更值钱，那些是花掉的时间）。

重建大约是 600 行 Python，无第三方依赖（当时那台机器没有 PIL，PNG 读写是手写的
zlib + struct，约 70 行；换台有 PIL 的机器可以直接省掉）。

---

## 1. 产物契约

### 1.1 `generated.ts` 的格式

```ts
export const GENERATED_FIELDS: Record<string, Record<number, string>> = {
  sharp: { 0: '<256 chars>', 1: '<256 chars>', ... },  // 47 个 canonical mask
  rounded: { ... },
  ...
};
```

每个字符是该像素到 terrain-B 侧的**距离**，不是最终 level：

| 项 | 值 | 说明 |
| --- | --- | --- |
| 量化步长 | `0.25` px | TS 端 `FIELD_STEP` |
| 字母表 | `0-9A-Za-z`（base-62，由小到大） | TS 端 `FIELD_CHARS` |
| 编码 | `floor(d_px / 0.25)`，钳到 `[0, 61]` | `INF`（无边界，纯 A 内部）→ `61` |
| 排列 | row-major，`y * 16 + x` | |

**存场而不是存 level，是三个功能的共同前提**，任何一个都不值得单独再烘一份数据：

- 过渡带**位置**滑杆 —— 运行时拿 `field + offset` 去比 bands；
- **32px 输出** —— 对场做双线性重采样后在更细的网格上取阈值，是真的细节，不是 2 倍放大，
  且零额外数据；
- **3/4/5 级过渡带** —— 只是多几个阈值。

量化必须**向下取整**（floor）。所有 band 值都是 `FIELD_STEP` 的整数倍，所以 floor 不可能
跨过某个 band，`offset = 0` 能逐字节复现原始烘焙结果。这条是硬约束，见 §4.3。

### 1.2 必须与 TS 端保持一致的常量

`emit3.py` 只写 `generated.ts`；下面这些是它**打印到 stdout、由人手工粘贴**进
`blob47Pattern.ts` 的。重建时不要忘了这一步 —— 它是链路里唯一的手工环节。

| TS 常量（`blob47Pattern.ts`） | 来源 |
| --- | --- |
| `FIELD_STEP = 0.25` | `fields.py: STEP` |
| `FIELD_CHARS` | `fields.py: CHARS` |
| `PATTERN_BANDS` | `patterns.py: STYLES[*]['bands']` 原样 |
| `PATTERN_OFFSET_RANGE` | `emit3.py: floor_room() / head_room()` 实测 |
| `PATTERN_GROUPS` 里的中英文名 | `STYLES[*]['zh'] / ['en']` |

`patternPaint.test.ts` 锁的 10 个 sheet hash 由 `sheethashes.py` 算（FNV-1a over RGBA,
row-major）。改任何烘焙参数都会让它们失效 —— 这是特性，不是麻烦。

### 1.3 已经落地、不需要再跑的一次性产物

- `patternNoise.ts` 里那张 **16×16 蓝噪矩阵**（`BLUE`，值 0..255）已经硬编码在仓库里，
  `bluenoise.py` 不必重建。它是 Ulichney void-and-cluster，`SIGMA = 1.5`，`random.Random(1)`
  起始，初始点数 `256 // 10`。16 整除 tile 尺寸，所以它随 tile 重复、接缝连续。
  真要重跑，注意质量判据是"最暗十分位的最近邻平均距离"应显著大于白噪的 ~2.2 px。
- `BAYER8` 同理，是常数表。

---

## 2. 需要重建的模块

| 模块 | 职责 | 约 |
| --- | --- | --- |
| `common.py` | mask 位布局、canonical 化、sheet 槽位顺序、PNG 读写 | 120 行 |
| `gen.py` | 距离场本体（`box_dist` / `smin` / `blob_dist_at`） | 60 行 |
| `patterns.py` | **STYLES 参数表**、5 种 tile-periodic 噪声、level 判定、两个验证器 | 280 行 |
| `fields.py` | 量化编码、offset 范围实测、（备用）从美术图反推场 | 160 行 |
| `emit3.py` | 写 `generated.ts`，打印待粘贴的常量 | 90 行 |

依赖方向是单向的：`common ← gen ← patterns ← fields ← emit3`。

---

## 3. 距离场规格（`common.py` + `gen.py`）

### 3.1 位布局

必须与 `autotile_mixer/src/utils/blob47.ts` 完全一致：

```python
N, E, S, W      = 1, 2, 4, 8
NE, SE, SW, NW  = 16, 32, 64, 128
CORNER_DEPS = [(NE, N|E), (SE, S|E), (SW, S|W), (NW, N|W)]

def canonicalize_blob_mask(mask):
    m = mask & 0xFF
    for corner, deps in CORNER_DEPS:
        if (m & deps) != deps:      # 对角邻居只有在两条边都同地形时才算数
            m &= ~corner
    return m & 0xFF

BLOB47_MASKS = sorted({canonicalize_blob_mask(m) for m in range(256)})   # 恰好 47 个
```

`mask` 的 bit 置位 = **该方向的邻居也是 terrain A**。

### 3.2 sheet 槽位顺序

8×6 = 48 格，47 个 mask，**mask 255 占两格，没有纯背景格**。顺序不是 mask 升序，而是
空间连贯排布（相邻槽位的图形互相接得上），当初是从 `assets/test_mixer.png` 逐格反推
出来的：

```python
REFERENCE_ORDER = [
      6,  10,  46,  76,  38, 110,  78,  12,
      7,  14,  31, 175, 127, 255, 205,   5,
     39,  79,  15,  63, 223, 159, 141,   1,
     23, 143,  13,  55, 239, 111,  77,   4,
      3,  11,  47,  95, 191, 255, 207,   9,
      0,   2,  27, 137,  19, 155, 139,   8,
]
```

烘焙数据本身按 mask 存，与这个顺序无关；只有导出 sheet 图和算 sheet hash 时才用到它。
terrain-B 的格子**不画 tile**，playground 另有一张背景图。

### 3.3 场的定义

到"非 A 邻居格并集"的欧氏距离，单位是 **cell**（乘 `TS=16` 得像素）：

```python
def box_dist(px, py, x0, y0, x1, y1):
    dx = max(x0 - px, 0.0, px - x1)
    dy = max(y0 - py, 0.0, py - y1)
    return math.hypot(dx, dy)

def smin(a, b, k):                      # 多项式 smooth-min，用来做圆角
    if k <= 0 or a == INF or b == INF: return min(a, b)
    hh = max(k - abs(a - b), 0.0) / k
    return min(a, b) - hh * hh * k * 0.25

def blob_dist_at(tx, ty, mask, corner_rounding=0.0):
    ortho = [INF]*4
    for i, (dx, dy, bit) in enumerate([(0,-1,N), (1,0,E), (0,1,S), (-1,0,W)]):
        if not (mask & bit):
            ortho[i] = box_dist(tx, ty, dx, dy, dx+1, dy+1)
    d = min(ortho)
    for dx, dy, bit in [(1,-1,NE), (1,1,SE), (-1,1,SW), (-1,-1,NW)]:
        if not (mask & bit):
            d = min(d, box_dist(tx, ty, dx, dy, dx+1, dy+1))
    if corner_rounding > 0:             # 只对相邻的正交对做，即凸角
        for a, b in [(0,1), (1,2), (2,3), (3,0)]:
            if ortho[a] != INF and ortho[b] != INF:
                d = min(d, smin(ortho[a], ortho[b], corner_rounding))
    return d                            # 全部邻居都是 A → INF
```

采样在**像素中心**：`tx = (x + 0.5) / 16`。

---

## 4. 烘焙规格（`patterns.py` + `fields.py`）

### 4.1 STYLES 参数表（这就是 10 个 pattern 的全部定义）

`bands` 是四个 level 边界，单位是**距离格子边缘的像素数**：

```
level0 terrainB │ level1 B-shade │ level2 outline │ level3 A-shade │ level4 terrainA
```

相邻两值相等 = 该 level 塌陷消失（`sharp` 就是这么做到 1px 细描边的）。

| id | cr | bands | 噪声 | scale | seed | 名称 |
| --- | --- | --- | --- | --- | --- | --- |
| `sharp` | 0.00 | 3.5, 3.5, 4.5, 4.5 | — | | | 硬边 · 直角细描边 |
| `rounded` | 0.55 | 3.5, 4.5, 5.5, 6.5 | — | | | 圆润 · 全四级过渡 |
| `bold` | 0.35 | 2.5, 3.5, 5.5, 6.5 | — | | | 粗描边 · 2px 轮廓 |
| `jagged` | 0.15 | 3.5, 4.5, 5.5, 6.5 | value 1.9 | 4 | 7 | 粗糙 · 岩石碎边 |
| `gravel` | 0.05 | 3.5, 4.5, 5.5, 6.5 | value 1.4 | 8 | 23 | 砂砾 · 细碎颗粒边 |
| `boulder` | 0.50 | 4.0, 5.0, 6.0, 7.0 | value 2.1 | 2 | 11 | 巨砾 · 大块起伏 |
| `thorn` | 0.00 | 3.75, 4.5, 5.0, 6.0 | ridged 2.0 | 5 | 31 | 荆棘 · 尖刺边 |
| `coast` | 0.25 | 3.75, 4.75, 5.75, 6.75 | fbm 2.0 | 3 | 5 | 海岸 · 多层碎屑 |
| `moss` | 0.30 | 3.5, 4.5, 5.5, 6.5 | worley 1.8 | 4 | 19 | 苔藓 · 团簇细胞 |
| `billow` | 0.45 | 3.5, 4.5, 5.5, 6.5 | billow 1.9 | 3 | 13 | 云絮 · 扇贝鼓边 |

菜单分两组：前 3 个"规整边缘"（直接取阈值），后 7 个"不规则边缘"（先用噪声位移场）。
菜单里的展示顺序与此表不同，见 `PATTERN_GROUPS`。

### 4.2 噪声（bake-time only，与 `patternNoise.ts` 无关）

全部以 tile 为周期，所以接缝天然连续。基础 hash：

```python
def _hash(ix, iy, per, seed):
    n = (ix % per) * 374761393 + (iy % per) * 668265263 + seed * 1442695040
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF * 2 - 1
```

> ⚠ **这个 hash 依赖 Python 的任意精度整数**，中间结果远超 64 位且不回绕。用 JS 的
> `Math.imul`（32 位）或任何定宽整数重写，会得到**完全不同的噪声**，10 个 pattern 全变。
> 要么在 Python 里重建，要么在别的语言里显式模拟 bignum。
>
> 另注：早期 `gen.py` 里有个占位版 `_noise`，seed 常量是 `1442695040888963407`（多了尾巴）。
> **那个不是烘焙用的**，以上面 `patterns.py` 的版本为准。

`value_at(gx, gy, per, seed)`：`per` 个格子的晶格铺满一个 tile，`fx = gx/16*per`，双线性
插值，权重用 smoothstep `u*u*(3-2u)`。四角取 `_hash`。

在它之上的四个变体：

| kind | 定义 | 观感 |
| --- | --- | --- |
| `value` | 直接用 | 一般起伏 |
| `fbm` | 3 个八度，每层 `per *= 2`、`amp *= 0.5`、`seed += 101*o`，除以权重和。每层都是 tile 周期，所以和也是 | 多尺度碎屑 |
| `ridged` | `1 - 2*abs(value)` | 过零处成尖脊 → 尖刺 |
| `billow` | `2*abs(value) - 1` | 反向折叠 → 圆鼓 |
| `worley` | 每个晶格格子一个抖动特征点（`jx`/`jy` 由 `_hash(.., seed)` 和 `_hash(.., seed+977)` 给），取 3×3 邻域最近距离，`min(1, best*1.6)*2-1`，索引取模 → 随 tile 重复 | 团簇细胞 |

烘焙一个 tile：

```python
d = blob_dist_at((x+0.5)/16, (y+0.5)/16, mask, st['cr'])
d_px = INF if d == INF else d * 16
if st['noise'] and d_px != INF:
    d_px += st['noise'] * noise_at(x, y, st['noise_scale'], st['seed'], st['noise_kind'])
    d_px = max(0.0, d_px)          # 仅 fields.py 的场版本做这个钳位
level = 0
for b in st['bands']:
    if d_px >= b: level += 1
    else: break
```

**噪声幅度必须显著小于 `bands[0]`**，否则边界会顶到格子边缘、被切成一条直线，§5.2 的
验证器会把这种情况抓出来。

### 4.3 量化

```python
STEP  = 0.25
CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'   # 62
MAXQ  = 61

def enc(d_px):
    if d_px == INF: return MAXQ
    return max(0, min(MAXQ, int(math.floor(d_px / STEP))))
```

上限 61 × 0.25 = 15.25 px，对 16px tile 足够。

### 4.4 offset 范围实测（`emit3.py`）

两端都是量出来的，不是拍的：

**正向上限（band 往格子边缘挪）** —— 走到边缘就会被邻居切平：

```python
mx = max(enc(f[i]) * STEP
         for mask, f in fields[name].items()
         for bit, idxs in ((N, 顶行), (S, 底行), (W, 左列), (E, 右列))
         if not (mask & bit)
         for i in idxs)
head = math.floor((bands[name][0] - mx - STEP) / STEP) * STEP
```

**负向下限（band 往格子中心挪）** —— 从 0 每次减 `STEP`，直到最小的孤岛（mask 0）一个
像素都不剩：

```python
while o > -8.0:
    if sum(1 for d in fields[name][0] if enc(d)*STEP + o >= bands[name][0]) < 1:
        break
    lim, o = o, o - STEP
```

孤岛**变细**是合法风格，只有**整格画了却什么都不显示**才是硬停。

> 注意：`fields.py` 的 `__main__` 里印了一个更保守的版本（判据是 `< 6` 个像素、比的是
> `bands[1]`），那是探索时的打印，**不是产物**。落进 `PATTERN_OFFSET_RANGE` 的是
> `emit3.py` 的版本。重建时以 `emit3.py` 为准，否则 10 个范围会集体收窄。

当前实测值（可用来核对重建是否成功）：

| pattern | offset 范围 | | pattern | offset 范围 |
| --- | --- | --- | --- | --- |
| `sharp` | −4, +2.75 | | `boulder` | −2.25, +1.25 |
| `rounded` | −1.75, +2.75 | | `thorn` | −4.5, +1.25 |
| `bold` | −3.5, +1.75 | | `coast` | −2.75, +2.25 |
| `jagged` | −5, +1 | | `moss` | −4.5, +1 |
| `gravel` | −5, +1.5 | | `billow` | −1.5, +1 |

噪声幅度大或圆角重的 pattern 余量小 —— 这就是范围**按 pattern 存**而不是取全局最小值的
原因。

### 4.5 band 结构：额外的过渡级只加在 A 侧

`bandsFor()` 把 4/5 级的额外阈值追加在 **terrain-A 一侧**（每级 `BAND_STEP_PX = 1`）。
这不是审美选择：上面两个 offset 端点都是从 `bands[0]` 量出来的，只要 band 的外沿不动，
`PATTERN_OFFSET_RANGE` 对每种级数都仍然成立，不需要一张按级数索引的表。
`hardEdgeB` 同理 —— 塌掉 B 的 shade 级（`w = bands[1] - bands[0]`），其余各级整体
**外移** `w`（`bands[0]` 原地不动），让轮廓保持它被设计时的粗细，而不是把省下的宽度吸收掉。

对称地往 B 侧长看着更舒服，但会吃掉 `bands[0]`，`jagged` / `moss` / `billow` 的正向
offset 余量会**整个消失**。别做。

---

## 5. 验证（重建之后必须全绿才算复现成功）

### 5.1 接缝：两种渲染必须逐像素相同

这是整条链路的核心保证 —— **接缝正确性在烘焙期证明，运行时因此完全不需要看邻居**。

随机地图（`rows=7, cols=9, seed=3`，密度 0.55）渲染两遍：

- **(a) 按 tile 查表**：算每格的 8 邻居 mask → canonical 化 → 贴烘好的 tile；
- **(b) 单一全局场**：对整张地图的每个像素，直接对**所有**非 A 邻居格求 `box_dist`
  （含圆角 smin），噪声用**全局坐标** `(gx, gy)` 取值，再取阈值。

两者必须 0 像素不一致。任何"读邻居像素"的后处理都会让这个检查挂掉，这也是为什么
`patternNoise.ts` 里的所有算法都必须是 `(x mod 16, y mod 16)` 的纯函数。

### 5.2 内缩：开放边上的边界像素必须是 level 0

接缝检查抓不到这一类问题 —— 边界被切平时，**两种渲染会以同样的方式切平**，结果一致但
图形是错的（一条直线）。所以要单独查：

```python
for mask, grid in stencil.items():
    for bit, 取边 in ((N, 顶行), (S, 底行), (W, 左列), (E, 右列)):
        if mask & bit: continue        # 该方向邻居是 A，这条边不是开放边
        assert 该边所有 16 个像素 == 0
```

开放边的邻居格画的是纯 terrain B，所以本格的边界像素也必须是 level 0。

### 5.3 offset-0 保真：量化后的场必须复现原始 level

```python
levels_from_field(field, bands, offset=0) == bake_levels(style)[mask]   # 47/47
```

`floor` 量化 + band 全是 `STEP` 整数倍，这一条应该恒成立。挂了说明有 band 值没落在
0.25 网格上 —— 当初 `thorn` / `coast` / `billow` 就是这样被 snap 过的（它们的 hash 因此
变了，另外 7 个没变，这正好反证了"改存场"这次重构本身没有改变任何图形）。

### 5.4 与浏览器交叉核对

Python 侧按 `patternPaint.ts` 的算法重算一遍 sheet，取 FNV-1a hash，和浏览器里的值比。
两个坑：

- **JS 的 `Math.round` 是"四舍五入到远离零"，Python 的 `round` 是银行家舍入。** Python
  侧必须写 `math.floor(x + 0.5)`。
- HSV 转换的浮点路径要一致（Python 用 `colorsys`，与 TS 实现对齐过）。

对上之后，Python 就可以放心用来出预览图（`style_*.png` / `steps_*.png` / `tex_*.png`
都是这么来的），不用每次都开浏览器。

---

## 6. 备用：从美术图反推场

如果将来又要把一张**手绘**的 47 图集接进来（它没有场，只有 level），`fields.py` 里的
`derived_field()` 是做法：用带内距离变换给每个像素挑一个场值，只要求落在"能复现它原本
level"的那条 band 里。

```python
lv = [int(c) for c in flat_levels]
to_lower[k] = 到最近的 level < k 的像素的欧氏距离
to_upper[k] = 到最近的 level > k 的像素的欧氏距离

L == 0:  d = max(0, bands[0] - to_upper[0][i])              # 深处 B，离边界远 → d 小
L == 4:  d = bands[3] + max(0, to_lower[4][i] - 1.0)        # 紧贴 level3 的正好落在 bands[3]
其他:    lo, hi = bands[L-1], bands[L]
         t = to_lower[L][i] / (to_lower[L][i] + to_upper[L][i])   # 退化时取 0.5
         d = clamp(lo + (hi-lo)*t, lo, hi - STEP)
```

`offset = 0` 因此逐像素复现原画，非零 offset 也能像真场一样推动边界。
配套的 band 值当时是 `(3.5, 4.5, 5.5, 6.5)`。

---

## 7. 走不通的路（不要重做）

### 7.1 ✗ 用距离场复刻手绘图

目标是让生成器对 `assets/test_mixer.png`（128×96，5 色 ramp）**逐字节相同**。

| 尝试 | 不匹配像素 / 12288 | 准确率 |
| --- | --- | --- |
| baseline（bands 0.5/1.5/2.5/3.5，无圆角） | 5272 | 57.10% |
| 最优平滑拟合（bands 4.0/4.0/4.625/5.0，cr 0.25） | 1371 | 88.84% |

两个 mask-255 的格子都是 0 不匹配，说明 **mask 模型和 5 色 ramp 都是对的**，残差全在轮廓上。

然后是决定性的探针：找**同一像素位置、场值完全相同、但目标颜色不同**的 mask 对。
**存在 771 对。** 例如像素 (5,0) 处 mask 1 和 mask 5 的场值都是 0.344 cell，但目标一个是
B 一个是 W；这两个 mask 只差一个 S 位，距离该像素整整一格，没有任何局部场能解释。

因为 `colour = ramp[level(field(mask,x,y) + noise(x,y))]` 对每组 `(field, x, y)` 只能给出
一个值（噪声只是 `(x,y)` 的函数，加不加、怎么加都一样），**这 771 对里每一对都至少有一个
像素是它证明性地做不对的**。原图的形状是逐 tile 手工设计的（细的地方掐尖、块的地方抹圆），
不是从场里长出来的。

结论：0 不匹配在程序上不可达；可达的路是把轮廓当作 5 级 stencil 直接烘（48×16×16，
deflate 后 **799 字节**），让 3 个选色去索引它。—— 这条路走通了，但那个手绘 pattern 后来
**应用户要求从 app 里删掉了**，参考图也不在仓库里。§6 是它留下的方法。

### 7.2 ✗ 在场域施加 band 颗粒

很诱人：在场上加噪声能一次性抖动所有阈值。但它会**移动边界像素**，从而破坏 §5.2 的内缩
不变量。放在 level 域（对 level 1..3 做逐像素的 ±1 推挤）则天然安全 —— level 0 和 4 不参与，
边界像素永远保持 level 0。

### 7.3 ✗ 用形态学（腐蚀/膨胀）做 band 位置控制

要读邻居像素 → 1px 接缝瑕疵。"把场存下来、改阈值"这个方案存在的全部理由就是为了避开它。

### 7.4 ✗ 在 B 侧对称地长出额外 band

见 §4.5。会吃掉 `bands[0]`，三个 pattern 的正向 offset 余量归零。

### 7.5 ✗ 存 level 而不是存场（早期的 `emit.py` / `emit2.py` 路线）

能跑，但 band 位置滑杆、32px 真细节、3/4/5 级过渡带**三个功能全部做不了**，除非每种组合
各烘一份数据。改存场之后数据量没变（还是每像素一字符），三个功能一起掉了出来。

### 7.6 ✗ 用"邻居同色率"判断像素画纹理的性质

第一遍测 `assets/test2.png` 的 terrain-A 纹理，邻居同色率很低，于是判定为白噪散点。
**用错了尺子** —— 细而弯的笔触和随机散点的邻居同色率一样低。改测**连通分量形状**才分得开：
散点给出大量 1–2 px 的团，笔触给出细长的团。

同一天还犯了第二次同类错误：没有测量具体量就断言某个功能"没生效"。教训写在
`measure-before-assuming-texture` 里 —— **先想清楚这把尺子能不能区分这两个假设**。

### 7.7 ✗ shade recipe 用单一 `hue` 字段

`SHADE_RECIPES` 的 hue 曾经一个字段两种含义：`terrainA` 是从**白色**解出来的（白色没有
色相，它的 +195° 只能当**绝对**色相理解），`terrainB` 是从**绿色**解出来的（+4.33° 是真正
的**增量**）。一个 `s0 < 1e-6 ? 绝对 : 相加` 的分支恰好在默认调色板上选对、在别处选错：
对饱和底色做加法会**旋转**色相，把深蓝的水 `#0018a0` 变成品红和橄榄。

现在拆成两个显式字段：`hue`（增量，永远生效）和 `greyHue`（绝对，仅当底色无彩时用）。
教训：**对着单一样本拟合出来的常量，会连同那个样本的假设一起被带走**；把假设写下来，
否则下一组输入会悄悄违反它。

### 7.8 ⚠ 改完 deps 数组后控制台的 "useEffect changed size between renders"

几乎一定是 Vite HMR，不是 bug。在真正全新的标签页里确认之后再去查。

---

## 8. 已知的未决项

- **`SHADE_RECIPES.terrainA.val` 恰好是 `1.0`** —— 它只加饱和度，因此对已经完全饱和的
  颜色**毫无作用**：深蓝的水会让过渡带 A 侧那几级塌进地形色，只剩轮廓。这个 1.0 是为了
  复刻那张已经被删掉的手绘图解出来的，约束的理由已经不存在了。修法是让 A 侧的 shade
  **朝轮廓色插值**（"轮廓向内渗"），任何调色板都成立。没做，是因为它会肉眼改变默认调色板
  下全部 10 个 pattern 并需要重锁 hash —— 这是产品决策，不是技术决策。
