import type { TagTree, TreeNode } from "./types";

export interface RolePath {
  path: string; // "nature_prop/tree/pine"
  label: string; // "自然物(点·立体) / 树木 / 针叶/松"
  topId: string; // "nature_prop"
  objectType: string; // inherited from the top-level
  stratum: string; // "ground" | "vertical" | "" — this node's, else nearest ancestor's
  isLeaf: boolean; // no children in the tree — a fully-refined role
  depth: number;
}

// Flattens the role forest into selectable path entries (every node, internal
// or leaf, is a valid role — see docs/TAG_SYSTEM_DESIGN.md §2).
export function flattenTree(tree: TagTree | null): RolePath[] {
  if (!tree) return [];
  const out: RolePath[] = [];
  for (const top of tree.categories) {
    // object_type and stratum are both declared per node now, overriding the
    // nearest ancestor's value (engine refactor 1a485a9) — inherit both down.
    const walk = (node: TreeNode, prefix: string, labelPrefix: string, depth: number, inOt: string, inStrat: string) => {
      const path = prefix ? `${prefix}/${node.id}` : node.id;
      const label = labelPrefix ? `${labelPrefix} / ${node.label ?? node.id}` : (node.label ?? node.id);
      const objectType = node.object_type ?? inOt;
      const stratum = node.stratum ?? inStrat;
      const isLeaf = (node.children?.length ?? 0) === 0;
      out.push({ path, label, topId: top.id, objectType, stratum, isLeaf, depth });
      for (const c of node.children ?? []) walk(c, path, label, depth + 1, objectType, stratum);
    };
    walk(top, "", "", 0, "", "");
  }
  return out;
}

export function objectTypeForRole(tree: TagTree | null, role: string): string {
  if (!tree || !role) return "";
  // walk the path, keeping the most specific object_type declared along it
  let nodes: TreeNode[] = tree.categories;
  let objectType = "";
  for (const seg of role.split("/")) {
    const node = nodes.find((n) => n.id === seg);
    if (!node) break;
    if (node.object_type) objectType = node.object_type;
    nodes = node.children ?? [];
  }
  return objectType;
}
