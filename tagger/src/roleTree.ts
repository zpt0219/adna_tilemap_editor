import type { TagTree, TreeNode } from "./types";

export interface RolePath {
  path: string; // "nature_prop/tree/pine"
  label: string; // "自然物(点·立体) / 树木 / 针叶/松"
  topId: string; // "nature_prop"
  objectType: string; // inherited from the top-level
  depth: number;
}

// Flattens the role forest into selectable path entries (every node, internal
// or leaf, is a valid role — see docs/TAG_SYSTEM_DESIGN.md §2).
export function flattenTree(tree: TagTree | null): RolePath[] {
  if (!tree) return [];
  const out: RolePath[] = [];
  for (const top of tree.categories) {
    const objectType = top.object_type ?? "";
    const walk = (node: TreeNode, prefix: string, labelPrefix: string, depth: number) => {
      const path = prefix ? `${prefix}/${node.id}` : node.id;
      const label = labelPrefix ? `${labelPrefix} / ${node.label ?? node.id}` : (node.label ?? node.id);
      out.push({ path, label, topId: top.id, objectType, depth });
      for (const c of node.children ?? []) walk(c, path, label, depth + 1);
    };
    walk(top, "", "", 0);
  }
  return out;
}

export function objectTypeForRole(tree: TagTree | null, role: string): string {
  if (!tree || !role) return "";
  const topId = role.split("/")[0];
  return tree.categories.find((c) => c.id === topId)?.object_type ?? "";
}
