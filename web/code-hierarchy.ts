import type { Edge, Module } from "../src/types.ts";

export interface TypeLink {
  parent: string;
  relation: "contains" | "implements" | "extends";
}
export interface TypeFamily {
  root: string;
  members: string[];
}
export interface CodeHierarchy {
  positions: Map<string, { x: number; y: number }>;
  parents: Map<string, TypeLink>;
  families: TypeFamily[];
  width: number;
  height: number;
}

/** A visual forest only: feature membership and source relationships remain intact. */
export function codeHierarchy(modules: Module[], edges: Edge[], columns = 2): CodeHierarchy {
  const byId = new Map(modules.map(m => [m.id, m]));
  const compare = (a: string, b: string) => {
    const left = byId.get(a)!, right = byId.get(b)!;
    return (left.symbol || left.name).localeCompare(right.symbol || right.name) || a.localeCompare(b);
  };
  const ids = [...byId.keys()].sort(compare);
  const parents = new Map<string, TypeLink>();
  for (const id of ids) {
    const owner = byId.get(id)!.declaringTypeId;
    if (owner && byId.has(owner) && owner !== id) parents.set(id, {parent: owner, relation: "contains"});
  }
  const candidates = edges.filter(e => (e.relation === "implements" || e.relation === "extends") &&
    byId.has(e.from) && byId.has(e.to) && e.from !== e.to)
    .sort((a,b) => compare(a.from,b.from) ||
      Number(a.relation !== "implements") - Number(b.relation !== "implements") || compare(a.to,b.to));
  for (const edge of candidates) {
    if (parents.has(edge.from)) continue;
    const visited = new Set([edge.from]);
    let cursor: string | undefined = edge.to;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      cursor = parents.get(cursor)?.parent;
    }
    if (!cursor) parents.set(edge.from, {parent: edge.to, relation: edge.relation as TypeLink["relation"]});
  }
  // Defensive against malformed imported containment; never lose a node to a cycle.
  for (const id of ids) {
    const visited = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      cursor = parents.get(cursor)?.parent;
    }
    if (cursor) parents.delete(cursor);
  }
  const children = new Map<string, string[]>();
  for (const id of ids) {
    const parent = parents.get(id)?.parent;
    if (parent) children.set(parent, [...(children.get(parent) || []), id]);
  }
  for (const siblings of children.values()) siblings.sort((a,b) =>
    Number(parents.get(a)?.relation === "contains") - Number(parents.get(b)?.relation === "contains") || compare(a,b));
  const families: TypeFamily[] = [];
  const depths = new Map<string, number>();
  for (const root of ids.filter(id => !parents.has(id))) {
    const members: string[] = [];
    const visit = (id: string, depth: number) => {
      members.push(id); depths.set(id, depth);
      for (const child of children.get(id) || []) visit(child, depth + 1);
    };
    visit(root, 0);
    families.push({root, members});
  }
  families.sort((a,b) => Number(b.members.length > 1) - Number(a.members.length > 1) || compare(a.root,b.root));
  const count = Math.max(1, Math.min(4, columns, families.length));
  const inset = (id: string) => Math.min(depths.get(id) || 0, 6) * 28;
  const laneWidth = 374 + Math.max(0, ...ids.map(inset));
  const bottoms = Array<number>(count).fill(0);
  const positions = new Map<string, {x: number; y: number}>();
  for (const family of families) {
    const lane = bottoms.indexOf(Math.min(...bottoms));
    family.members.forEach((id, row) => positions.set(id, {
      x: lane * laneWidth + inset(id), y: bottoms[lane] + 32 + row * 184,
    }));
    bottoms[lane] += 32 + family.members.length * 184 + 24;
  }
  return {positions, parents, families, width: count * laneWidth - 24, height: Math.max(0, ...bottoms)};
}
