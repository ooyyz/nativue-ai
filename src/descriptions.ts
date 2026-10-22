import path from "node:path";
import type { Snapshot } from "./types.ts";
import { atomicJson, readJson, readSnapshot, stateDir } from "./store.ts";

export interface DescriptionStore {
  schemaVersion: 1;
  revision: number;
  entries: {source: "local" | "remote"; moduleId: string; description: string; updatedAt: string}[];
}
export function readDescriptions(root: string): DescriptionStore {
  return readJson(path.join(stateDir(root), "descriptions.json"), {schemaVersion: 1, revision: 0, entries: []});
}
export function withDescriptions(s: Snapshot | null, edits: DescriptionStore): Snapshot | null {
  if (!s) return s;
  const values = new Map(edits.entries.filter(e => e.source === s.source.kind).map(e => [e.moduleId, e.description]));
  return {...s, modules: s.modules.map(m => values.has(m.id) ? {
    ...m, automaticDescription: m.description, description: values.get(m.id)!, descriptionOrigin: "manual",
  } : m)};
}
export function updateDescription(root: string, input: {source: unknown; moduleId: unknown; revision: unknown; description: unknown}): DescriptionStore {
  if (!input || !["local", "remote"].includes(input.source as string) || typeof input.moduleId !== "string" ||
      !Number.isSafeInteger(input.revision) || (input.description !== null && (typeof input.description !== "string" || input.description.length > 12000)))
    throw Error("Invalid responsibility edit / 职责说明格式不正确（最多 12000 字符）");
  const source = input.source as "local" | "remote";
  if (!readSnapshot(root, source)?.modules.some(m => m.id === input.moduleId))
    throw Error("Module no longer exists; reload / 节点已不存在，请刷新");
  const current = readDescriptions(root);
  if (input.revision !== current.revision)
    throw Error("Responsibility changed in another view; reopen the editor / 说明已在其他页面修改，请重新打开编辑器");
  const entries = current.entries.filter(e => e.source !== source || e.moduleId !== input.moduleId);
  if (input.description !== null) entries.push({source, moduleId: input.moduleId, description: input.description as string, updatedAt: new Date().toISOString()});
  const next: DescriptionStore = {schemaVersion: 1, revision: current.revision + 1, entries};
  atomicJson(path.join(stateDir(root), "descriptions.json"), next);
  return next;
}
