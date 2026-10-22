import path from "node:path";
import type { Snapshot } from "./types.ts";
import { atomicJson, readJson, readSnapshot, stateDir } from "./store.ts";

type EditField = "name" | "parentId";
export interface ArchitectureEdits {
  schemaVersion: 1;
  revision: number;
  entries: {source: "local" | "remote"; moduleId: string; field: EditField; value: string; updatedAt: string}[];
}
export function readArchitectureEdits(root: string): ArchitectureEdits {
  return readJson(path.join(stateDir(root), "architecture-edits.json"), {schemaVersion: 1, revision: 0, entries: []});
}
export function withArchitectureEdits(s: Snapshot | null, edits: ArchitectureEdits): Snapshot | null {
  if (!s) return s;
  const nodes = s.modules.map(m => ({...m}));
  const byId = new Map(nodes.map(m => [m.id, m]));
  let moved = false;
  for (const e of edits.entries) {
    if (e.source !== s.source.kind) continue;
    const node = byId.get(e.moduleId);
    if (!node || node.generator !== "java") continue;
    if (e.field === "name" && node.level === "feature") {
      node.automaticName = node.name;
      node.name = e.value;
      node.nameOrigin = "manual";
    }
    if (e.field === "parentId" && node.level === "class") {
      const automatic = byId.get(node.parentId || ""), target = byId.get(e.value);
      node.automaticParentId = node.parentId;
      if (automatic?.level === "feature" && target?.level === "feature" &&
          target.generator === "java" && target.parentId === automatic.parentId) {
        node.parentId = target.id;
        node.parentOrigin = "manual";
        moved = true;
      } else node.pendingParentId = e.value;
    }
  }
  if (moved) {
    for (const node of nodes.filter(m => m.generator === "java" && m.level === "feature")) {
      node.files = [...new Set(nodes.filter(m => m.level === "class" && m.parentId === node.id).flatMap(m => m.files))];
      node.evidence = node.evidence.filter(e => node.files.includes(e.path));
    }
  }
  return {...s, modules: nodes};
}
export function updateArchitectureEdit(root: string, input: {source: unknown; moduleId: unknown; field: unknown; value: unknown; revision: unknown}): ArchitectureEdits {
  if (!input || !["local", "remote"].includes(input.source as string) || typeof input.moduleId !== "string" ||
      !["name", "parentId"].includes(input.field as string) || !Number.isSafeInteger(input.revision) ||
      (input.value !== null && (typeof input.value !== "string" || !input.value.trim() || input.value.length > (input.field === "name" ? 100 : 240))))
    throw Error("Invalid architecture edit / 功能名称或归属格式不正确");
  const source = input.source as "local" | "remote", field = input.field as EditField;
  const s = readSnapshot(root, source), node = s?.modules.find(m => m.id === input.moduleId);
  if (!node || node.generator !== "java" || node.level !== (field === "name" ? "feature" : "class"))
    throw Error("Feature or class no longer exists; reload / 功能或类已不存在，请刷新");
  if (field === "parentId" && input.value !== null) {
    const automatic = s!.modules.find(m => m.id === node.parentId), target = s!.modules.find(m => m.id === input.value);
    if (automatic?.level !== "feature" || target?.level !== "feature" || target.generator !== "java" || target.parentId !== automatic.parentId)
      throw Error("Choose a feature in the same architecture / 请选择同一架构下的功能");
  }
  const current = readArchitectureEdits(root);
  if (current.revision !== input.revision)
    throw Error("Architecture changed in another view; reopen the editor / 功能设置已在其他页面修改，请重新打开编辑器");
  const entries = current.entries.filter(e => e.source !== source || e.moduleId !== node.id || e.field !== field);
  if (input.value !== null) entries.push({source, moduleId: node.id, field, value: (input.value as string).trim(), updatedAt: new Date().toISOString()});
  const next: ArchitectureEdits = {schemaVersion: 1, revision: current.revision + 1, entries};
  atomicJson(path.join(stateDir(root), "architecture-edits.json"), next);
  return next;
}
