import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Config, Snapshot, JavaSourceScope } from "./types.ts";
export const defaultConfig = (): Config => ({
  schemaVersion: 1,
  language: "en",
  tool: "codex",
  mode: "manual",
  models: { A: "", B: "", C: "" },
  exclude: [],
  remote: { enabled: false, url: "", branch: "main", intervalMs: 300000 },
  analysis: {
    enabled: true,
    command: [],
    minIntervalMs: 300000,
    maxCallsPerDay: 12,
  },
  refresh: { debounceMs: 10000, reconcileMs: 60000 },
});
export function stateDir(root: string) {
  const dir = path.join(root, ".nativue");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink())
    throw Error("State directory must not be a symlink");
  return dir;
}
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export function atomicJson(file: string, value: unknown) {
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(tmp, file);
}
export function readConfig(root: string): Config {
  return readJson(path.join(stateDir(root), "config.json"), defaultConfig());
}
export function validateConfig(c: Config) {
  if (
    c.schemaVersion !== 1 ||
    !["en", "zh"].includes(c.language) ||
    !["codex", "claude", "workbuddy"].includes(c.tool) ||
    !["manual", "automatic"].includes(c.mode)
  )
    throw Error("Invalid configuration");
  if (
    !c.models ||
    !["A", "B", "C"].every(
      (k) => typeof c.models[k as keyof typeof c.models] === "string",
    )
  )
    throw Error("Invalid role models");
  if (
    !Array.isArray(c.exclude) ||
    !c.exclude.every((x) => typeof x === "string")
  )
    throw Error("Invalid exclusions");
  if (
    !Array.isArray(c.analysis.command) ||
    !c.analysis.command.every((x) => typeof x === "string")
  )
    throw Error("Invalid analysis command");
  for (const v of [
    c.analysis.minIntervalMs,
    c.refresh.debounceMs,
    c.refresh.reconcileMs,
    c.remote.intervalMs,
  ])
    if (!Number.isFinite(v) || v < 1000)
      throw Error("Intervals must be at least 1000ms");
  if (
    !Number.isInteger(c.analysis.maxCallsPerDay) ||
    c.analysis.maxCallsPerDay < 0
  )
    throw Error("Invalid analysis call limit");
  if (
    typeof c.remote.url !== "string" ||
    !c.remote.branch ||
    typeof c.remote.enabled !== "boolean" ||
    typeof c.analysis.enabled !== "boolean"
  )
    throw Error("Invalid remote/analysis configuration");
  if (c.java) {
    const safePath = (s: unknown) => typeof s === "string" && s.length > 0 &&
      !path.isAbsolute(s) && !s.includes("\\") && !s.split("/").some(p => p === ".." || p.startsWith(".git") || p === ".nativue");
    const validScope = (scope: JavaSourceScope) => scope && Array.isArray(scope.roots) && scope.roots.every(safePath) &&
      (scope.parentId === undefined || (typeof scope.parentId === "string" && !!scope.parentId)) &&
      (scope.kind === undefined || (typeof scope.kind === "string" && /^[a-z][a-z0-9-]*$/.test(scope.kind))) &&
      Array.isArray(scope.features) && scope.features.every(f => f && typeof f.id === "string" && /^[\w.-]+$/.test(f.id) &&
        !["shared", "unassigned"].includes(f.id) && typeof f.name === "string" && f.name.trim() && Array.isArray(f.seeds) && f.seeds.length && f.seeds.every(s => typeof s === "string" && s.length > 0));
    const uniqueRules = (scope: JavaSourceScope) => new Set(scope.features.map(f => f.id)).size === scope.features.length;
    const scopes = c.java.scopes;
    if (typeof c.java.enabled !== "boolean" || !validScope(c.java) || !uniqueRules(c.java) ||
        (scopes !== undefined && (!Array.isArray(scopes) || !scopes.every(scope => validScope(scope) && uniqueRules(scope) &&
          typeof scope.id === "string" && /^[\w.-]+$/.test(scope.id) && typeof scope.name === "string" && !!scope.name.trim() && scope.roots.length > 0) ||
          new Set(scopes.map(scope => scope.id)).size !== scopes.length)))
      throw Error("Invalid Java source analysis configuration");
    if (scopes?.length) {
      const all = [c.java, ...scopes];
      const parents = all.map(scope => scope.parentId).filter(Boolean);
      if (!c.java.roots.length || new Set(parents).size !== parents.length || all.some((a,i) => all.some((b,j) => i < j && a.roots.some(x => b.roots.some(y => {
        const p=x.replace(/\/$/,""), q=y.replace(/\/$/,"");
        return p === q || p.startsWith(q+"/") || q.startsWith(p+"/");
      }))))) throw Error("Java scopes must have distinct roots and parents / Java 建图范围及挂载点不能重叠");
    }
  }
  if (c.moduleGroups !== undefined) {
    const ids = new Set<string>(), members = new Set<string>();
    if (!Array.isArray(c.moduleGroups)) throw Error("Invalid module groups");
    for (const g of c.moduleGroups) {
      if (!g || typeof g.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(g.id) || ids.has(g.id) ||
          typeof g.name !== "string" || !g.name.trim() || g.name.length > 120 ||
          (g.description !== undefined && (typeof g.description !== "string" || g.description.length > 300)) ||
          !Array.isArray(g.moduleIds) || !g.moduleIds.length)
        throw Error("Invalid module groups / 模块分类格式不正确");
      ids.add(g.id);
      for (const id of g.moduleIds) {
        if (typeof id !== "string" || !id.trim() || members.has(id)) throw Error("Duplicate or invalid module group member");
        members.add(id);
      }
    }
  }
}
export function saveConfig(root: string, c: Config) {
  validateConfig(c);
  atomicJson(path.join(stateDir(root), "config.json"), c);
}
export function readSnapshot(root: string, kind: "local" | "remote" = "local") {
  return readJson<Snapshot | null>(
    path.join(stateDir(root), kind + ".json"),
    null,
  );
}
export function saveSnapshot(root: string, s: Snapshot) {
  atomicJson(path.join(stateDir(root), s.source.kind + ".json"), s);
}
