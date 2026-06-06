// =============================================================================
// blueprint_palette.h — Blueprint role → 颜色映射（共享）
// =============================================================================
//
// Blueprint overlay（tilemap_view）和 Blueprint 管理面板（blueprint_panel）共用
// 同一套 role 配色，避免两处颜色表漂移。
//
// ⚠️ 这套配色是「真相源」，须与三处保持一致：本文件、无引擎预览
// `ai_tilemap_pipeline/blueprint_generator/scripts/render_overlay.py`，以及文档
// `BLUEPRINT_AUTHORING.md §4` / `BLUEPRINT_EDITOR_PLAN.md §7`。改色请同步全部。

#pragma once

#include <imgui.h>

#include <string>

namespace adna_desktop {

inline bool blueprint_role_has(const std::string& role, const char* token) {
    return role.find(token) != std::string::npos;
}

// role 为空时返回 fallback 紫色；alpha 由调用方决定（overlay 用低 alpha 填充、
// 高 alpha 描边；列表用不透明小圆点）。
//
// 配色真相源 = 本表；预览端 scripts/render_overlay.py 与文档色表须保持一致。
// 子串匹配、首个命中为准——顺序有讲究：
//   · 砖/铺装路在土路之前（"brick_road" 也含 "road"），否则会落成土路褐；
//   · 路/墙在山之前，否则 "bridge"/"stone wall" 会被山命中；
//   · field/crop = 耕地（橄榄绿），dirt/soil = 裸土（棕），分两档；
//   · "farm" 不算土词（否则会吃掉 "farmhouse"）；建筑仍靠 house/building 命中。
inline ImU32 blueprint_color_for_role(const std::string& role, int alpha) {
    auto has = [&](const char* t) { return blueprint_role_has(role, t); };
    // —— 离散 / 建造 / 线类 ——
    if (has("door") || has("entrance") || has("gate"))
        return IM_COL32(250, 170, 45, alpha);    // 橙    — 门 / 闸（marker）
    if (has("cobble") || has("paved") || has("pavement") || has("flagstone")
        || has("brick_road") || has("brick_path") || has("stone_road") || has("stone_path"))
        return IM_COL32(180, 175, 165, alpha);   // 灰    — 砖 / 铺装路
    if (has("road") || has("path") || has("corridor") || has("bridge") || has("street") || has("lane"))
        return IM_COL32(135, 95, 55, alpha);     // 褐    — 土路
    if (has("wall") || has("fence") || has("border") || has("hedge"))
        return IM_COL32(225, 95, 85, alpha);     // 红    — 墙 / 围栏
    if (has("room") || has("bedroom") || has("kitchen") || has("hall"))
        return IM_COL32(125, 125, 225, alpha);   // 靛蓝  — 内景房间
    // —— TERRAIN 子类（区别明显）——
    if (has("water") || has("river") || has("pond") || has("lake") || has("sea") || has("ocean") || has("pool") || has("stream"))
        return IM_COL32(70, 135, 240, alpha);    // 蓝    — 水
    if (has("sand") || has("beach") || has("dune") || has("shore"))
        return IM_COL32(246, 223, 88, alpha);    // 亮黄  — 沙滩 / 沙
    if (has("snow") || has("snowfield") || has("frost") || has("glacier") || has("icy"))
        return IM_COL32(238, 236, 224, alpha);   // 奶白  — 雪 / 冰
    if (has("tree") || has("forest") || has("wood") || has("orchard") || has("grove") || has("jungle") || has("bush") || has("shrub"))
        return IM_COL32(38, 115, 58, alpha);     // 深绿  — 树 / 林
    if (has("grass") || has("meadow") || has("pasture") || has("lawn") || has("vegetation") || has("garden") || has("park"))
        return IM_COL32(155, 215, 120, alpha);   // 浅绿  — 草地 / 牧场
    if (has("field") || has("crop") || has("wheat") || has("plot") || has("farmland") || has("paddy"))
        return IM_COL32(150, 158, 90, alpha);    // 橄榄绿 — 耕地 / 作物
    if (has("dirt") || has("soil") || has("ground") || has("mud") || has("tilled"))
        return IM_COL32(200, 160, 105, alpha);   // 浅棕  — 裸土
    if (has("mountain") || has("rock") || has("hill") || has("cliff") || has("stone") || has("boulder"))
        return IM_COL32(155, 50, 45, alpha);     // 深红  — 山 / 岩
    // —— 建筑 + fallback ——
    if (has("house") || has("building") || has("barn") || has("shop") || has("tower") || has("hut")
        || has("cabin") || has("cottage") || has("manor") || has("mill") || has("shed") || has("stable"))
        return IM_COL32(70, 95, 142, alpha);     // 蓝灰  — 建筑物
    return IM_COL32(170, 120, 235, alpha);       // 紫    — fallback（stall/well/dock/prop）
}

} // namespace adna_desktop
