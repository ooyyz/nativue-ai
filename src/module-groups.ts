import type { Config, Snapshot } from "./types.ts";

/** Apply workspace categories without changing parser facts or drill-down parents. */
export function withModuleGroups(s: Snapshot | null, groups: Config["moduleGroups"]): Snapshot | null {
  if (!s || !groups?.length) return s;
  const membership = new Map(groups.flatMap(g => g.moduleIds.map(id => [id, g.id] as const)));
  return {...s, modules: s.modules.map(m => !m.parentId && membership.has(m.id)
    ? {...m, kind: membership.get(m.id)!} : m)};
}
