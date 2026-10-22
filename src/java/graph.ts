import path from "node:path";
import type {
  Snapshot,
  Module,
  Edge,
  JavaConfig,
  JavaSourceScope,
  JavaGraphState,
  JavaDiagnostic,
} from "../types.ts";
import { atomicJson, readJson, stateDir } from "../store.ts";
import { readIndexedSource } from "../source.ts";
import {
  parseJava,
  digest,
  PARSER_VERSION,
  type JavaFileFacts,
  type TypeFact,
} from "./parser.ts";
import { JavaResolver, classId, methodId } from "./resolver.ts";
interface Cache {
  version: string;
  declarations: string;
  files: Record<string, JavaFileFacts>;
  resolved: Record<string, { edges: Edge[]; diagnostics: JavaDiagnostic[] }>;
}
export const javaConfigId = (config: JavaConfig) =>
  digest(JSON.stringify(["graph-3", PARSER_VERSION, config]));
const inScope = (file: string, roots: string[]) =>
  !/(^|\/)(?:test|testFixtures|verification)(\/|$)/.test(file) &&
  (!roots.length ||
    roots.some(
      (r) => file === r || file.startsWith(r.replace(/\/$/, "") + "/"),
    ));
const glob = (name: string, pattern: string) =>
  new RegExp(
    "^" +
      pattern
        .split("*")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  ).test(name);
const word = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/)[0] || name;
export function generatedSubtree(s: Snapshot, parent: string): Set<string> {
  const removed = new Set<string>();
  let again = true;
  while (again) {
    again = false;
    for (const m of s.modules)
      if (
        m.parentId &&
        (m.parentId === parent || removed.has(m.parentId)) &&
        !removed.has(m.id)
      ) {
        removed.add(m.id);
        again = true;
      }
  }
  return removed;
}
export function graphChanges(
  previous: Snapshot | undefined,
  modules: Module[],
  edges: Edge[],
): JavaGraphState["changes"] {
  const oldNodes = new Map(
    (previous?.modules || [])
      .filter((m) => m.generator === "java")
      .map((m) => [m.id, m]),
  );
  const oldEdges = new Map(
    (previous?.edges || [])
      .filter((e) => e.generator === "java")
      .map((e) => [e.id, e]),
  );
  const summary = (m: Module) => ({ id: m.id, name: m.name });
  const added = modules.filter((m) => !oldNodes.has(m.id)),
    changed = modules.filter(
      (m) =>
        oldNodes.has(m.id) &&
        (oldNodes.get(m.id)!.fingerprint !== m.fingerprint ||
          oldNodes.get(m.id)!.parentId !== m.parentId),
    );
  const sig = (e: Edge) =>
    JSON.stringify([e.from, e.to, e.label, e.relation, e.confidence]);
  const addedEdges = edges.filter((e) => !oldEdges.has(e.id)),
    changedEdges = edges.filter(
      (e) => oldEdges.has(e.id) && sig(oldEdges.get(e.id)!) !== sig(e),
    );
  for (const m of added) m.change = "added";
  for (const m of changed) m.change = "changed";
  for (const e of addedEdges) e.change = "added";
  for (const e of changedEdges) e.change = "changed";
  return {
    added: added.map(summary),
    changed: changed.map(summary),
    removed: [...oldNodes.values()]
      .filter((m) => !modules.some((n) => n.id === m.id))
      .map(summary),
    addedEdges,
    changedEdges,
    removedEdges: [...oldEdges.values()].filter(
      (e) => !edges.some((n) => n.id === e.id),
    ),
  };
}
function features(
  types: TypeFact[],
  edges: Edge[],
  config: JavaSourceScope,
  zh: boolean,
) {
  const rules: {id: string; name: string; seeds: string[]}[] = config.features.map(r => ({...r, seeds: [...r.seeds]}));
  const commentSeeds = new Set<string>();
  const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  for (const t of types) {
    const docs = [t.doc, ...t.methods.map(m => m.doc)].filter(d => d && (d.summary || d.feature));
    const explicit = docs.map(d => d!.feature).filter((n): n is string => !!n);
    const mentioned = rules.filter(r => r.name.length >= 2 && docs.some(d => d!.summary.includes(r.name))).map(r => r.name);
    let names = explicit.length ? explicit : mentioned.length === 1 ? mentioned : [];
    // Ordinary prose supplies a candidate title when no user rules exist. It is still an inference.
    if (!names.length && !config.features.length) {
      const summary = t.doc?.summary || (docs.length === 1 ? docs[0]!.summary : "");
      const title = summary.split(/[\n。！？.!?]/)[0].trim();
      if (title.length >= 2 && title.length <= 60 && !/copyright|license|TODO|inheritDoc/i.test(title)) names = [title];
    }
    for (const name of new Set(names)) {
      let rule = rules.find(r => nameKey(r.name) === nameKey(name));
      if (!rule) {
        // A comment title can change without replacing the capability's identity.
        const classTitle = t.doc?.summary.split(/[\n。！？.!?]/)[0].trim();
        const owner = t.doc?.feature === name || (!t.doc?.feature && classTitle === name) ? "type" :
          t.methods.find(m => m.doc?.feature === name)?.key ||
          t.methods.find(m => m.doc?.summary.split(/[\n。！？.!?]/)[0].trim() === name)?.key || "type";
        rule = {id: "doc-" + digest(t.qualified + "#" + owner).slice(0, 16), name, seeds: []};
        rules.push(rule);
      }
      if (!rule.seeds.includes(t.qualified)) rule.seeds.push(t.qualified);
      commentSeeds.add(rule.id + ":" + t.qualified);
    }
  }
  if (!rules.length) rules.push(...[
        ...new Set(
          types
            .filter(
              (t) =>
                t.kind === "interface" ||
                /(Service|Registry|Manager|Gate|Port)$/.test(t.name),
            )
            .map((t) => word(t.name)),
        ),
      ]
        .sort()
        .slice(0, 12)
        .map((w) => ({ id: w.toLowerCase(), name: w, seeds: [w + "*"] })));
  if (!rules.length)
    rules.push({
      id: "source",
      name: zh ? "源码功能候选" : "Source capability",
      seeds: ["*"],
    });
  const classOf = new Map<string, string>(),
    byId = new Map(types.map((t) => [classId(t), t]));
  for (const t of types) {
    classOf.set(classId(t), classId(t));
    for (const m of t.methods) classOf.set(methodId(t, m), classId(t));
  }
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) {
    const a = classOf.get(e.from),
      b = classOf.get(e.to);
    if (!a || !b || a === b) continue;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      if (!adjacency.has(x)) adjacency.set(x, new Set());
      adjacency.get(x)!.add(y);
    }
  }
  const distance = new Map<string, Map<string, number>>();
  for (const rule of rules) {
    const d = new Map<string, number>(),
      queue: string[] = [];
    for (const t of types)
      if (rule.seeds.some((s) => glob(t.qualified, s) || glob(t.name, s))) {
        d.set(classId(t), 0);
        queue.push(classId(t));
      }
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      for (const b of adjacency.get(a) || [])
        if (!d.has(b)) {
          d.set(b, d.get(a)! + 1);
          queue.push(b);
        }
    }
    distance.set(rule.id, d);
  }
  const assigned = new Map<
    string,
    { id: string; distance: number; reason: string }
  >();
  for (const [id, t] of byId) {
    const ranked = rules
      .map((r) => ({ id: r.id, d: distance.get(r.id)!.get(id) ?? Infinity }))
      .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    const best = ranked[0];
    const tied = ranked.filter((r) => r.d === best.d);
    const feature = !Number.isFinite(best.d)
      ? "unassigned"
      : tied.length > 1
        ? "shared"
        : best.id;
    assigned.set(id, {
      id: feature,
      distance: best.d,
      reason:
        feature === "shared"
          ? "Equidistant source relationships to multiple capabilities"
          : feature === "unassigned"
            ? "No source path to configured entry symbols"
            : commentSeeds.has(best.id + ":" + t.qualified)
              ? (zh ? "由声明注释识别功能候选" : "Capability candidate from declaration comments")
              : `Source relationship distance ${best.d} to ${best.id}`,
    });
  }
  // Nested declarations inherit a containing type's capability when no relationship path exists.
  for (const t of [...types].sort(
    (a, b) => a.qualified.length - b.qualified.length,
  )) {
    const current = assigned.get(classId(t))!;
    if (current.id !== "unassigned") continue;
    const outer = types
      .filter(
        (o) => o.path === t.path && t.qualified.startsWith(o.qualified + "."),
      )
      .sort((a, b) => b.qualified.length - a.qualified.length)[0];
    if (outer) {
      const inherited = assigned.get(classId(outer))!;
      if (inherited.id !== "unassigned")
        assigned.set(classId(t), {
          ...inherited,
          reason: "Nested declaration in " + outer.qualified,
        });
    }
  }
  return {
    rules: [
      ...rules,
      {
        id: "shared",
        name: zh ? "共享契约与支撑" : "Shared contracts",
        seeds: [],
      },
      {
        id: "unassigned",
        name: zh ? "未归属源码" : "Unassigned source",
        seeds: [],
      },
    ],
    assigned,
  };
}
export function refreshJavaGraph(
  root: string,
  s: Snapshot,
  config: JavaConfig,
  previous: Snapshot | undefined,
  language: "en" | "zh",
): Snapshot {
  const configId = javaConfigId(config),
    zh = language === "zh";
  const scopes = [
    {...config, scopeId: "", scopeName: ""},
    ...(config.scopes || []).map(scope => ({...scope, scopeId: scope.id, scopeName: scope.name})),
  ];
  const entries = s.files.filter(
    (f) => f.path.endsWith(".java") && scopes.some(scope => inScope(f.path, scope.roots)),
  );
  if (!entries.length) {
    const removed = new Set(
      (previous?.modules || [])
        .filter((m) => m.generator === "java")
        .map((m) => m.id),
    );
    return {
      ...s,
      modules: s.modules.filter((m) => !removed.has(m.id)),
      edges: s.edges.filter(
        (e) =>
          e.generator !== "java" && !removed.has(e.from) && !removed.has(e.to),
      ),
      java: {
        status: "complete",
        configId,
        sourceInputId: s.id,
        parsedFiles: 0,
        reusedFiles: 0,
        resolvedFiles: 0,
        diagnostics: [],
        diagnosticCount: 0,
        changes: graphChanges(previous, [], []),
      },
    };
  }
  const cacheFile = path.join(
    stateDir(root),
    "java-" + s.source.kind + "-cache.json",
  );
  const empty: Cache = {
    version: PARSER_VERSION,
    declarations: "",
    files: {},
    resolved: {},
  };
  let cache = readJson<Cache>(cacheFile, empty);
  if (cache.version !== PARSER_VERSION) cache = empty;
  const files: Record<string, JavaFileFacts> = {},
    diagnostics: JavaDiagnostic[] = [],
    changed = new Set<string>();
  let parsedFiles = 0,
    reusedFiles = 0,
    resolvedFiles = 0;
  for (const entry of entries) {
    try {
      if (cache.files[entry.path]?.hash === entry.hash) {
        files[entry.path] = cache.files[entry.path];
        reusedFiles++;
      } else {
        files[entry.path] = parseJava(
          entry.path,
          entry.hash,
          readIndexedSource(root, entry),
        );
        changed.add(entry.path);
        parsedFiles++;
      }
    } catch (e) {
      diagnostics.push({
        path: entry.path,
        line: 1,
        kind: "parse",
        message: String(e).slice(0, 600),
      });
    }
  }
  const failure = (errors: JavaDiagnostic[]): Snapshot => {
    const keep = previous || s;
    return {
      ...s,
      modules: keep.modules,
      edges: keep.edges,
      journeys: keep.journeys,
      java: {
        status: "failed",
        configId,
        sourceInputId: previous?.java?.sourceInputId || s.id,
        parsedFiles,
        reusedFiles,
        resolvedFiles,
        diagnostics: errors.slice(0, 1000),
        diagnosticCount: errors.length,
        changes: {
          added: [],
          changed: [],
          removed: [],
          addedEdges: [],
          changedEdges: [],
          removedEdges: [],
        },
      },
    };
  };
  if (diagnostics.length) return failure(diagnostics);
  const all = Object.values(files),
    resolver = new JavaResolver(all),
    types = resolver.types;
  const declarations = digest(
    JSON.stringify(
      types.map((t) => [
        t.path,
        t.qualified,
        t.imports,
        t.extends,
        t.implements,
        t.component,
        t.fields.map((f) => [f.name, f.type, f.injected]),
        t.methods.map((m) => [m.key, m.returns]),
      ]),
    ),
  );
  const resolved: Cache["resolved"] = {};
  for (const f of all) {
    if (
      cache.declarations === declarations &&
      !changed.has(f.path) &&
      cache.resolved[f.path]
    )
      resolved[f.path] = cache.resolved[f.path];
    else {
      resolved[f.path] = resolver.resolveFile(f);
      resolvedFiles++;
    }
  }
  const edges = Object.values(resolved).flatMap((v) =>
    v.edges.map((e) => ({ ...e })),
  );
  diagnostics.push(...Object.values(resolved).flatMap((v) => v.diagnostics));
  const covered = new Set(entries.map(f => f.path));
  const anchors = new Set(scopes.map(scope => scope.parentId).filter(Boolean));
  const retained = s.modules.filter((m) => m.generator !== "java" &&
    !(m.kind === "directory" && m.confidence === "inferred" && !anchors.has(m.id) &&
      m.files.length > 0 && m.files.every(file => covered.has(file))));
  const generated: Module[] = [], purge = new Set<string>();
  for (const scope of scopes) {
    const scopeEntries = entries.filter(f => inScope(f.path, scope.roots));
    if (!scopeEntries.length) continue;
    const scopeTypes = types.filter(t => inScope(t.path, scope.roots));
    let anchor = scope.parentId;
    if (anchor) for (const id of generatedSubtree(s, anchor)) purge.add(id);
    if (anchor && !retained.some((m) => m.id === anchor))
      return failure([
        {
          path: scopeEntries[0].path,
          line: 1,
          kind: "parse",
          message: "Configured parent module no longer exists: " + anchor,
        },
      ]);
    if (!anchor) {
      anchor = scope.scopeId ? "java-scope-" + digest(scope.scopeId).slice(0,16) : "java-source-" + digest(scope.roots.join("|")).slice(0, 16);
      generated.push({
        id: anchor,
        name: scope.scopeName || (zh ? "Java 源码架构" : "Java source architecture"),
        description: zh
          ? "由 Java 语法树与声明关系自动生成。"
          : "Generated from Java syntax and declared relationships.",
        kind: scope.kind || "application",
        files: scopeEntries.map((f) => f.path),
        evidence: [{ path: scopeEntries[0].path, line: 1 }],
        confidence: "observed",
        generator: "java",
        fingerprint: digest(JSON.stringify([scope.scopeName, scope.kind || "application"])),
      });
    }
    const grouping = features(scopeTypes, edges, scope, zh),
      featureIds = new Map<string, string>();
    for (const rule of grouping.rules) {
      const owned = scopeTypes.filter(
        (t) => grouping.assigned.get(classId(t))?.id === rule.id,
      );
      if (!owned.length) continue;
      const id = "java-feature-" + digest(anchor + ":" + rule.id).slice(0, 18);
      featureIds.set(rule.id, id);
      const documented = owned.flatMap(t => [
        ...(t.doc?.summary ? [{summary: t.doc.summary, path: t.path, line: t.doc.line, entry: rule.seeds.some(seed => glob(t.qualified, seed) || glob(t.name, seed))}] : []),
        ...t.methods.filter(m => m.doc?.summary && (m.doc.feature === rule.name || (!t.doc?.summary && m.doc.summary.includes(rule.name)))).map(m => ({summary: m.doc!.summary, path: t.path, line: m.doc!.line, entry: true})),
      ]).filter(d => d.entry).slice(0,3);
      const summary = [...new Set(documented.map(d => d.summary))].join("\n\n");
      generated.push({
        id,
        parentId: anchor,
        name: rule.name,
        description: summary || (zh
          ? `功能归属由入口符号与源码关系推断，共 ${owned.length} 个类；点击查看类与方法。`
          : `Inferred from entry symbols and source relationships: ${owned.length} types. Open classes and methods.`),
        descriptionOrigin: summary ? "source-comment" : "generated",
        descriptionEvidence: documented.map(d => ({path: d.path, line: d.line, note: zh ? "源码注释" : "Source comment"})),
        kind: "backend",
        level: "feature",
        generator: "java",
        files: [...new Set(owned.map((t) => t.path))],
        evidence: owned
          .slice(0, 8)
          .map((t) => ({
            path: t.path,
            line: t.line,
            note: grouping.assigned.get(classId(t))!.reason,
          })),
        confidence: "inferred",
        fingerprint: digest(
          summary + "|" + owned
            .map((t) => t.qualified)
            .sort()
            .join("|"),
        ),
      });
    }
    for (const t of scopeTypes) {
      const id = classId(t),
        assignment = grouping.assigned.get(id)!;
      generated.push({
        id,
        parentId: featureIds.get(assignment.id),
        name: t.name,
        description: t.doc?.summary || `${t.kind} ${t.qualified} · ${t.methods.length} ${zh ? "个声明方法" : "declared methods"}. ${assignment.reason}`,
        descriptionOrigin: t.doc?.summary ? "source-comment" : "generated",
        descriptionEvidence: t.doc?.summary ? [{path: t.path, line: t.doc.line, note: zh ? "类注释" : "Class comment"}] : [],
        kind: "shared",
        level: "class",
        generator: "java",
        symbol: t.qualified,
        files: [t.path],
        evidence: [
          { path: t.path, line: t.line, note: t.kind + " " + t.qualified },
        ],
        confidence: "observed",
        fingerprint: digest(t.hash + "|" + JSON.stringify(t.doc || null)),
      });
      for (const m of t.methods)
        generated.push({
          id: methodId(t, m),
          parentId: id,
          name: m.key,
          description: m.doc?.summary || `${m.returns} ${t.qualified}#${m.key} · ${m.calls.length} ${zh ? "处调用表达式；静态目标不代表实际派发" : "call expressions; declared targets are not runtime dispatch"}`,
          descriptionOrigin: m.doc?.summary ? "source-comment" : "generated",
          descriptionEvidence: m.doc?.summary ? [{path: t.path, line: m.doc.line, note: zh ? "方法注释" : "Method comment"}] : [],
          kind: "source",
          level: "method",
          generator: "java",
          symbol: t.qualified + "#" + m.key,
          files: [t.path],
          evidence: [{ path: t.path, line: m.line, note: m.key }],
          confidence: "observed",
          fingerprint: digest(m.hash + "|" + JSON.stringify(m.doc || null)),
        });
    }
  }
  // Revalidate the indexed scope before publishing facts computed from multiple files.
  try {
    for (const entry of entries) readIndexedSource(root, entry);
  } catch (e) {
    return failure([
      { path: entries[0].path, line: 1, kind: "parse", message: String(e) },
    ]);
  }
  const manual = retained.filter((m) => !purge.has(m.id));
  const changes = graphChanges(previous, generated, edges);
  const ids = new Set([...manual, ...generated].map((m) => m.id));
  const result: Snapshot = {
    ...s,
    modules: [...manual, ...generated],
    edges: [
      ...s.edges.filter(
        (e) => e.generator !== "java" && ids.has(e.from) && ids.has(e.to),
      ),
      ...edges,
    ],
    journeys: s.journeys.filter((j) =>
      j.steps.every((st) => ids.has(st.moduleId)),
    ),
    java: {
      status: "complete",
      configId,
      sourceInputId: s.id,
      parsedFiles,
      reusedFiles,
      resolvedFiles,
      diagnostics: diagnostics.slice(0, 1000),
      diagnosticCount: diagnostics.length,
      changes,
    },
  };
  atomicJson(cacheFile, {
    version: PARSER_VERSION,
    declarations,
    files,
    resolved,
  } satisfies Cache);
  return result;
}
