import { paletteTagTree } from "./roleTreeData";

export interface RoleTreeNode {
  id: string;
  label?: string;
  object_type?: string;
  stratum?: string;
  children?: RoleTreeNode[];
}

export interface RoleTree {
  version: number;
  scope?: string;
  categories: RoleTreeNode[];
}

export interface RolePath {
  path: string;
  label: string;
  topId: string;
  objectType: string;
  stratum: string;
  isLeaf: boolean;
  depth: number;
}

export type CreateFamily = "terrain_area" | "terrain_line" | "fixed_rect" | "house";
export type CreateKind = "terrain_area" | "terrain_line" | "fixed_rect" | "fixed_rect_group" | "house";

export const roleTree: RoleTree = paletteTagTree as unknown as RoleTree;

export function flattenTree(tree: RoleTree = roleTree): RolePath[] {
  const out: RolePath[] = [];
  for (const top of tree.categories) {
    const walk = (node: RoleTreeNode, prefix: string, labelPrefix: string, depth: number, inType: string, inStratum: string) => {
      const path = prefix ? `${prefix}/${node.id}` : node.id;
      const label = labelPrefix ? `${labelPrefix} / ${node.label ?? node.id}` : (node.label ?? node.id);
      const objectType = node.object_type ?? inType;
      const stratum = node.stratum ?? inStratum;
      const isLeaf = (node.children?.length ?? 0) === 0;
      out.push({ path, label, topId: top.id, objectType, stratum, isLeaf, depth });
      for (const child of node.children ?? []) walk(child, path, label, depth + 1, objectType, stratum);
    };
    walk(top, "", "", 0, "", "");
  }
  return out;
}

export const flatRolePaths = flattenTree();

export const topRoleOrder = roleTree.categories.map((node) => node.id);

export function findRolePath(path: string): RolePath | null {
  return flatRolePaths.find((entry) => entry.path === path) ?? null;
}

export function roleRoot(path: string): string {
  return path.split("/")[0] ?? "";
}

export function topRoleNode(topId: string): RoleTreeNode | null {
  return roleTree.categories.find((node) => node.id === topId) ?? null;
}

export function objectTypeForRole(path: string): string {
  return findRolePath(path)?.objectType ?? "";
}

export function stratumForRole(path: string): string {
  return findRolePath(path)?.stratum ?? "";
}

export function rolesForTop(topId: string): RolePath[] {
  return flatRolePaths.filter((entry) => entry.topId === topId);
}

export function createFamilyForRole(path: string): CreateFamily | null {
  if (path === "building/house") return "house";
  const objectType = objectTypeForRole(path);
  if (objectType === "terrain_area") return "terrain_area";
  if (objectType === "terrain_line") return "terrain_line";
  if (objectType === "fixed_rect") return "fixed_rect";
  return null;
}

export function createFamiliesForTop(topId: string): CreateFamily[] {
  const seen = new Set<CreateFamily>();
  for (const role of rolesForTop(topId)) {
    const family = createFamilyForRole(role.path);
    if (family) seen.add(family);
  }
  return [...seen];
}

export function createKindsForRole(path: string): CreateKind[] {
  const family = createFamilyForRole(path);
  if (!family) return [];
  if (family === "fixed_rect") return ["fixed_rect", "fixed_rect_group"];
  return [family];
}

export function defaultRoleForTop(topId: string): string {
  const root = topRoleNode(topId);
  if (!root) return "";
  if (topId === "building") return "building/house";
  if (topId === "boundary") return "boundary/fence";
  return root.id;
}
