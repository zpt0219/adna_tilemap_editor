import type { Layer, LiteObject, LiteTileMap } from "./model";
import { cloneObjectDeep } from "./model";
import { roleRoot, stratumForRole, topRoleNode, topRoleOrder } from "./roleTree";

function layerForRoot(root: string, id: number, objects: LiteObject[]): Layer {
  const node = topRoleNode(root);
  const stratum = node?.stratum ?? stratumForRole(root);
  return {
    id,
    name: root,
    enabled: true,
    vertical: stratum === "vertical",
    tags: {
      "role.root": root,
      ...(node?.label ? { "role.label": node.label } : {}),
      ...(node?.object_type ? { "role.object_type": node.object_type } : {}),
      ...(stratum ? { "role.stratum": stratum } : {}),
    },
    objects,
  };
}

export function normalizeToCategories(map: LiteTileMap): LiteTileMap {
  let nextObj = 0;
  let nextLayer = 0;
  const byRoot = new Map<string, LiteObject[]>();
  for (const root of topRoleOrder) byRoot.set(root, []);

  for (const layer of map.layers) {
    for (const o of layer.objects) {
      const role = o.tags["blueprint.role"] ?? "";
      const root = roleRoot(role);
      if (!root || !byRoot.has(root)) continue;
      byRoot.get(root)!.push(cloneObjectDeep(o, nextObj++));
    }
  }

  const layers: Layer[] = [];
  for (const root of topRoleOrder) {
    const objects = byRoot.get(root) ?? [];
    layers.push(layerForRoot(root, nextLayer++, objects));
  }
  return { ...map, layers };
}
