# Web Asset Tagger (网页版资产打标器) 计划

状态：**已实现 MVP1–3**（v1，2026-06-03）｜代码 `web/tagger/`
范围：面向 Palette Tagging 流程的独立 Web 辅助工具。该工具专注于为 Palette 数据进行可视化的人工审查与标签修正，与用于修补地图的 Web Lite Reroll Editor 在功能上完全分离。

> **进度 / 换机器如何继续（2026-06-03）**
> - **已实现**：本仓 `web/tagger/`（React + Vite + TS，`fflate` 解 zip，纯静态、零后端/模型）。
>   拖入 `.adnatags` → 按 `manifest.grid` 切图画廊 → role 闭集树级联 + style 多值标签（预制
>   quick-add + 自由输入）+ 多选批量 + 状态边框 + Load 外部 tags merge → 导出 `final_tags.json`；
>   localStorage 自动存草稿。MVP1/2/3 见 §7。
> - **跑起来**（新机器克隆仓库后）：`cd web/tagger && npm install && npm run dev`
>   （`http://localhost:5173`，「试用样例」加载 `public/sample/*.adnatags`）。`npm run build` 出静态包。
>   细节见 `web/tagger/README.md`。
> - **上下游**（引擎侧，本仓 C++）：`export_palette_bundle`（headless / Palette Set Wizard 按钮）
>   出 `.adnatags`；`import_palette_tags` 吃导出的 `final_tags.json`（role 路径 + style 数组）。
> - **整体进度**（这条 web 工具属于「Track 1 打标链路」，已全落地）见
>   `BLUEPRINT_EDITOR_PLAN.md` Phase 6「Tag 系统进度快照」；解析模型见 `TAG_SYSTEM_DESIGN.md`。
> - **剩余可选增强**：见 §7 末尾（IndexedDB、非法 role 高亮、swatch hover 放大、导出再打包 bundle）。

## 1. 核心定位

Web Asset Tagger 是一个**纯静态的前端数据标注工具**。

它的核心价值是：解决 C++ / ImGui 界面中审查海量图块和复杂层级树（Tag Tree）体验不佳的问题。利用现代 Web 前端的优势，提供一个直观、高效的“人工 Review”环节。

**工作流定位**：
```text
C++ / Pipeline 直接导出打包文件 (<name>.adnatags)
        ↓
(可选) 手动解压，订阅制 AI agent (如 Claude) 直接读 folder
        (sheets + manifest + tree) 生成 ai_tags.json  ← 不调 API，走订阅
        ↓
【Web Asset Tagger 介入】用户拖入 .adnatags 打开 document；
        可随时【单独 load 一个 tag 文件 (ai_tags.json) 并 apply/merge 到当前 document】；
        预制 tag 点选 + role 树下拉，人工可视化审查与修改
        ↓
网页导出修改结果 (可导出纯 final_tags.json 或重新打包一个新 .adnatags 进度包)
        ↓
C++ Headless 注入回项目 (Import Tags)
```

> **AI 打标解耦说明**：本项目走订阅、不直接调 API。AI 打标这一可选步骤的做法是：把
> `.adnatags` 解压成 folder，让订阅制 agent 读 folder 里的联系表 + manifest + tree，按
> `PALETTE_TAGGING.md §5` 的任务生成一个 tag JSON。Web 工具**不内置任何模型调用**，它只
> 负责把这个外部 tag 文件**叠加**到当前打开的 document 上（见 §3.1 二次输入）。

## 2. 为什么需要独立 Web 工具？

1. **GUI 优势**：打标签需要反复对比图块和标签，Web 前端能轻松实现网格布局、图片裁剪、悬浮放大、复杂树状下拉框（Role 树）和多选标签输入（Style 词）。
2. **轻量与隔离**：处理 JSON 资产元数据（Metadata）不需要引入 Tilemap 的渲染管线，纯 DOM 渲染即可满足需求。
3. **协作便利**：编译 C++ 引擎门槛较高。Web 版可以静态部署（如 GitHub Pages），发给美术或策划直接在浏览器里完成标注工作。

## 3. 工具输入与输出

Web 工具不直接读取或修改庞大的 `converted_save.json`。它基于轻量的中间格式工作。

### 3.1 输入 (Inputs)：单一 Tag Bundle (`.adnatags`)
为了极致的用户体验和工作区整洁，Web 工具不再接收零散的图片和 JSON 文件。
用户在网页上**只需拖入一个由引擎或 AI 流水线生成的 `.adnatags` 文件（实质为 ZIP 压缩包）**。

包内结构约定如下：
```text
<tileset_name>.adnatags
 ├── manifest.json          # 记录图块网格划分规则、Palette Hash 清单
 ├── palette_tag_tree.json  # 当前项目强制使用的 Role 树（随包打包以保证版本解耦）
 ├── tags.json              # 该 palette 集合的【当前 role/style 标注】，从引擎现有 palette tag 导出
 │                          #   (可续作:导出时带上次结果,改完再导回;未必来自 AI,故不叫 ai_tags)
 └── sheets/                # 存放渲染出的联系表图片
      ├── pal_sheet_0.png
      └── pal_sheet_1.png
```
> `tags.json` 用与导出 `final_tags.json` 相同的 schema（`{palette_set, palette_tags:[{index, role, style[]}]}`，
> style 已是数组）。它由引擎 `export_palette_bundle` 自动从当前 palette 的
> `blueprint.role`/`blueprint.style` 生成；未标注的 palette 不列入（保持空白待标）。
*   **无感解压**：Web 端使用 `JSZip` 或 `fflate` 纯前端解压并读取内存数据，瞬间渲染工作区。
*   **版本隔离**：将 `palette_tag_tree.json` 随包分发，意味着 Web 端是纯数据驱动的。如果后端修改了树结构，Web 端无需重新部署即可自适应新的分类下拉框。

### 3.1.1 二次输入：单独 load 一个 tag 文件，apply 到当前 document
打开 `.adnatags` 后，工具必须支持**在任意时刻再 load 一个独立的 tag JSON**（如订阅制 AI
读 folder 生成的 `ai_tags.json`，或上次导出的 `final_tags.json`），按 **index / hash** 把其中
的 role/style **merge 到当前 document** 的对应 palette 上（覆盖或合并由用户选），不重开工作区。
这把「AI 打标」与「调 API」彻底解耦：AI 只是离线读 folder 写个 json，叠加由 Web 负责。
合并后该 palette 状态置为 `ai_suggested`（见 §4），等人工确认转 `human_verified`。

### 3.2 输出 (Output)
用户完成修正后，点击导出：
*   **最终标签 (`final_tags.json`)**：包含所有 Palette 对应 Hash 的最终 `role` 和 `style` 数据的 JSON 文件。此文件可直接喂给引擎的 `import_palette_tags` 命令。

## 4. UI 界面设计草案

推荐采用经典的“左侧画廊 + 右侧检查器”布局，适合宽屏操作。

```text
┌─────────────────────────────────────────────────────────┐
│ Header: 导入文件按钮区 | 进度统计 (已打标/总数) | 导出 JSON  │
├──────────────────────┬──────────────────────────────────┤
│                      │                                  │
│ [Contact Sheet 画廊] │ [检查器 Inspector]               │
│                      │                                  │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ 选中的 Palette: ID 12 / Hash xyz │
│ │01│ │02│ │03│ │04│  │ 引擎 Mode: FIXED_RECT            │
│ └──┘ └──┘ └──┘ └──┘  │                                  │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐  │ -------------------------------- │
│ │05│ │06│ │07│ │08│  │ Role (单选分类树):               │
│ └──┘ └──┘ └──┘ └──┘  │ [ building / house           ▼ ] │
│                      │                                  │
│ (按住 Shift 可多选)  │ Style (自由输入标签云):          │
│ (不同状态显示边框色) │ [ wooden × ] [ snowy × ]       │
│                      │ + Add style...                   │
│                      │                                  │
└──────────────────────┴──────────────────────────────────┘
```

**关键交互特性**：
*   **状态可视化**：未打标的格子灰色，AI 打标的格子黄色，人工确认/修改过的格子绿色。
*   **批量操作**：支持按住 Shift 框选多个相同材质的图块（比如一片草地），在右侧批量设置 Role 和 Style。
*   **受控的 Role 选择**：Role 输入框是一个严格绑定 `palette_tag_tree.json` 的级联下拉列表（或搜索过滤框），防止人工输入错别字导致 C++ 编译阶段找不到素材。
*   **自由的 Style 输入**：Style 输入框类似文章标签（Tag Input），允许自由输入自然语言词汇，以支持后续的 Embedding 向量匹配。

## 5. 数据结构约定

### 5.1 网页内部状态模型
网页不需要复杂的 Redux，简单的 React/Vue 状态即可。

```typescript
type AppState = {
  manifest: PaletteManifest;
  tagTree: TagTreeNode[];
  tagData: Record<number, PaletteTags>; // Key is grid index
}

type PaletteTags = {
  role: string; // 必须是 Tag Tree 中的合法路径，如 "terrain_decoration/path/bridge"
  style: string[]; // 自由字符串数组，如 ["wood", "broken"]
  status: "empty" | "ai_suggested" | "human_verified";
}
```

### 5.3 浏览器状态持久化 (Auto-Save)
作为一个纯前端工具，必须防止用户误关网页导致打标进度丢失。
*   **实时自动保存**：用户的每次操作（修改 Role/Style）都会实时序列化当前的 `tagData` 并保存到浏览器的 **IndexedDB**（或 LocalStorage）。
*   **草稿恢复**：用户重新打开网页时，页面会检查是否存在未导出的本地草稿。如果有，提示用户“是否恢复上次中断的打标进度？”
*   **清理机制**：一旦用户点击导出（无论是导出 `final_tags.json` 还是新的 `.adnatags` 进度包），且确认导出成功后，可以选择清理本地草稿缓存。

## 6. 与 Web Lite Reroll Editor 的关系

1. **项目结构**：建议与 Reroll Editor 存放在同一个 Public Repo 中（例如 `adna-web-tools`），但配置不同的页面路由（如 `/tagger` 和 `/reroll`）。
2. **代码复用**：两者不共享核心逻辑，但可以共享基础的 UI 组件库（按钮、下拉框）和部分 JSON Schema 解析定义。
3. **安全隔离**：Tagger 完全是一个本地纯前端工具。用户把本地的图片和 JSON 拖进去，纯浏览器端处理后下载 JSON，不涉及任何后端存储，无安全泄露风险。

## 7. 实施路径 (MVP 划分)

> **落地状态（2026-06-03）**：已实现于本仓 `web/tagger/`（React + Vite + TS，`fflate`
> 解 zip，纯静态）。MVP1 + MVP2 + MVP3 的多选/批量/状态高亮已完成；实测拖入引擎导出的
> `.adnatags`（171 palette）→ 画廊按 `manifest.grid` 切图 → role 树级联 + style 多值 →
> 导出 `final_tags.json` 全链路通；进度 autosave 到 localStorage。剩余可选增强见下。

*   **MVP 1 (核心查看与编辑)** ✅：拖入 `.adnatags`（含 manifest + sheets）。画廊按 grid 切割渲染每个图块。右侧 Inspector 编辑 Role/Style 并导出 `final_tags.json`。
*   **MVP 2 (受控输入与 AI 导入)** ✅：接入包内 `palette_tag_tree.json`，Role 走闭集树（可过滤的级联列表）；Style 多值标签 + 已用词 quick-add（非闭集，自由输入）。**单独 load 一个 tag 文件 apply/merge 到当前 document**（§3.1.1）。
*   **MVP 3 (批量与效率)** ✅（基础）：Cmd/Ctrl/Shift 多选、批量设 Role/Style；状态边框（grey/yellow/green）+「只看未标注」过滤。
*   **剩余可选增强**：autosave 改 IndexedDB（现用 localStorage）；高亮「Role 不在分类树中」的非法项；swatch 放大 hover；导出再打包成新 `.adnatags` 进度包。
