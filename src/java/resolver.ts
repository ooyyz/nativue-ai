import type { Edge, JavaDiagnostic } from "../types.ts";
import {
  digest,
  type JavaFileFacts,
  type TypeFact,
  type MethodFact,
  type Call,
} from "./parser.ts";
export const classId = (t: TypeFact) =>
  "java-class-" + digest(t.path + ":" + t.qualified).slice(0, 20);
export const methodId = (t: TypeFact, m: MethodFact) =>
  "java-method-" + digest(classId(t) + ":" + m.key).slice(0, 20);
const primitives = new Set([
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
  "char",
  "boolean",
  "void",
]);
const lang = new Set([
  "String",
  "Object",
  "Boolean",
  "Byte",
  "Short",
  "Integer",
  "Long",
  "Float",
  "Double",
  "Character",
  "Class",
  "Throwable",
  "Exception",
  "RuntimeException",
  "Number",
  "Enum",
  "Iterable",
]);
export class JavaResolver {
  types: TypeFact[];
  byName = new Map<string, TypeFact[]>();
  diagnostics: JavaDiagnostic[] = [];
  constructor(files: JavaFileFacts[]) {
    this.types = files.flatMap((f) => f.types);
    for (const t of this.types)
      this.byName.set(t.qualified, [
        ...(this.byName.get(t.qualified) || []),
        t,
      ]);
  }
  typeCandidates(name: string, owner: TypeFact): TypeFact[] {
    name = name.replace(/\[\]/g, "");
    if (this.byName.has(name)) return this.byName.get(name)!;
    const parts = name.split("."),
      head = parts.shift()!,
      tail = parts.length ? "." + parts.join(".") : "";
    const imported = owner.imports.filter(
      (i) => !i.startsWith("static ") && i.split(".").at(-1) === head,
    );
    // An explicit import may refer outside the indexed scope; don't fall through to a short-name guess.
    if (imported.length)
      return imported.flatMap((i) => this.byName.get(i + tail) || []);
    for (
      let prefix = owner.qualified;
      prefix;
      prefix = prefix.includes(".")
        ? prefix.slice(0, prefix.lastIndexOf("."))
        : ""
    ) {
      const found = this.byName.get(prefix + "." + name);
      if (found) return found;
    }
    const local = this.byName.get(
      [owner.package, name].filter(Boolean).join("."),
    );
    if (local) return local;
    return owner.imports
      .filter((i) => i.endsWith(".*") && !i.startsWith("static "))
      .flatMap((i) => this.byName.get(i.slice(0, -1) + name) || []);
  }
  canonical(name: string, owner: TypeFact): string {
    const suffix = name.endsWith("[]") ? "[]" : "",
      raw = name.replace(/\[\]/g, "");
    const found = this.typeCandidates(raw, owner);
    if (found.length === 1) return found[0].qualified + suffix;
    if (found.length > 1) return name;
    if (primitives.has(raw) || raw === "?" || raw === "null") return name;
    const imp = owner.imports.find(
      (i) => !i.startsWith("static ") && i.endsWith("." + raw),
    );
    return (
      (imp ||
        (lang.has(raw)
          ? "java.lang." + raw
          : raw.includes(".")
            ? raw
            : [owner.package, raw].filter(Boolean).join("."))) + suffix
    );
  }
  ancestors(owner: TypeFact): TypeFact[] {
    const result: TypeFact[] = [],
      seen = new Set<string>(),
      queue = [owner];
    while (queue.length) {
      const t = queue.shift()!,
        id = classId(t);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(t);
      for (const ref of [...t.extends, ...t.implements]) {
        const xs = this.typeCandidates(ref, t);
        if (xs.length === 1) queue.push(xs[0]);
      }
    }
    return result;
  }
  fieldType(name: string, owner: TypeFact): string | undefined {
    for (const t of this.ancestors(owner)) {
      const f = t.fields.find((f) => f.name === name);
      if (f) return this.canonical(f.type, t);
    }
    return undefined;
  }
  variableType(
    name: string,
    owner: TypeFact,
    m: MethodFact,
    offset: number,
  ): string | undefined {
    const vars = m.variables
      .filter((v) => v.name === name && v.start <= offset && v.end >= offset)
      .sort((a, b) => b.scopeStart - a.scopeStart || b.start - a.start);
    return vars.length
      ? this.canonical(vars[0].type, owner)
      : this.fieldType(name, owner);
  }
  argumentType(
    ts: string[],
    owner: TypeFact,
    m: MethodFact,
    call: Call,
  ): string {
    if (ts.length === 1) {
      const s = ts[0];
      if (s.startsWith('"')) return "java.lang.String";
      if (s.startsWith("'")) return "char";
      if (s === "true" || s === "false") return "boolean";
      if (s === "null") return "null";
      if (/^\d/.test(s)) {
        if (/^0[xX][0-9a-fA-F_]+[lL]?$/.test(s) || /^0[bB][01_]+[lL]?$/.test(s))
          return /[lL]$/.test(s) ? "long" : "int";
        if (/[lL]$/.test(s)) return "long";
        if (/[fF]$/.test(s)) return "float";
        return /[.eEpPdD]/.test(s) ? "double" : "int";
      }
      return this.variableType(s, owner, m, call.offset) || "?";
    }
    if (ts[0] === "new") {
      const end = ts.findIndex((x) => x === "(" || x === "[");
      return (
        this.canonical(ts.slice(1, end < 0 ? undefined : end).join(""), owner) +
        (ts[end] === "[" ? "[]" : "")
      );
    }
    if (ts[0] === "this" && ts[1] === "." && ts.length === 3)
      return this.fieldType(ts[2], owner) || "?";
    return "?";
  }
  candidates(
    owner: TypeFact,
    name: string,
  ): { type: TypeFact; method: MethodFact }[] {
    const found: { type: TypeFact; method: MethodFact }[] = [],
      signatures = new Set<string>();
    for (const t of this.ancestors(owner))
      for (const method of t.methods.filter((m) => m.name === name)) {
        const key =
          method.name +
          "(" +
          method.params.map((p) => this.canonical(p.type, t)).join(",") +
          ")";
        if (!signatures.has(key)) {
          found.push({ type: t, method });
          signatures.add(key);
        }
      }
    return found;
  }
  score(actual: string, expected: string): number {
    if (actual === "?") return 30;
    if (actual === expected) return 0;
    if (actual === "null") return primitives.has(expected) ? Infinity : 10;
    const numbers = ["byte", "short", "int", "long", "float", "double"];
    const a = numbers.indexOf(actual),
      b = numbers.indexOf(expected);
    if (a >= 0 && b >= a) return b - a + 1;
    if (
      actual === "char" &&
      ["int", "long", "float", "double"].includes(expected)
    )
      return 3;
    if (expected === "java.lang.Object" && !primitives.has(actual)) return 20;
    const t = this.byName.get(actual);
    if (
      t?.length === 1 &&
      this.ancestors(t[0]).some((x) => x.qualified === expected)
    )
      return 5;
    return Infinity;
  }
  resolveFile(file: JavaFileFacts): {
    edges: Edge[];
    diagnostics: JavaDiagnostic[];
  } {
    const edges: Edge[] = [],
      diagnostics: JavaDiagnostic[] = [];
    const report = (
      t: TypeFact,
      line: number,
      kind: JavaDiagnostic["kind"],
      message: string,
      symbol?: string,
      candidates?: string[],
    ) =>
      diagnostics.push({
        path: t.path,
        line,
        kind,
        message,
        symbol,
        candidates,
      });
    const add = (
      t: TypeFact,
      from: string,
      to: string,
      relation: NonNullable<Edge["relation"]>,
      site: string,
      line: number,
      note: string,
      inferred = false,
    ) => {
      edges.push({
        id:
          "java-edge-" +
          digest(from + ":" + to + ":" + relation + ":" + site).slice(0, 24),
        from,
        to,
        relation,
        generator: "java",
        label: note,
        evidence: [{ path: t.path, line, note }],
        confidence: inferred ? "inferred" : "observed",
      });
    };
    const typeEdge = (
      t: TypeFact,
      name: string,
      relation: NonNullable<Edge["relation"]>,
      site: string,
      line: number,
      inferred = false,
    ) => {
      const xs = this.typeCandidates(name, t);
      if (xs.length === 1)
        add(
          t,
          classId(t),
          classId(xs[0]),
          relation,
          site,
          line,
          relation +
            " " +
            name +
            (inferred ? " (constructor parameter; inferred injection)" : ""),
          inferred,
        );
      else
        report(
          t,
          line,
          xs.length ? "ambiguous" : "unresolved",
          relation + " target: " + name,
          t.qualified,
          xs.map(classId),
        );
    };
    for (const t of file.types) {
      for (const ref of t.extends)
        typeEdge(t, ref, "extends", ref, t.referenceLines[ref] || t.line);
      for (const ref of t.implements)
        typeEdge(t, ref, "implements", ref, t.referenceLines[ref] || t.line);
      for (const f of t.fields.filter((f) => f.injected))
        typeEdge(t, f.type, "injects", "field:" + f.name, f.line || t.line);
      for (const m of t.methods) {
        if (
          m.injected ||
          (m.constructor && t.methods.filter((x) => x.constructor).length === 1)
        )
          for (const p of m.params)
            typeEdge(
              t,
              p.type,
              m.injected || t.component ? "injects" : "depends",
              m.key + ":" + p.name,
              m.line,
              !m.injected && t.component,
            );
        const occurrences = new Map<string, number>();
        for (const call of m.calls) {
          let receivers: TypeFact[] = [];
          if (call.chained) {
            report(
              t,
              call.line,
              "unresolved",
              "Unsupported chained receiver: " + call.receiver,
              methodId(t, m),
            );
            continue;
          }
          if (!call.receiver || call.receiver === "this") receivers = [t];
          else if (call.receiver === "super")
            receivers = t.extends.flatMap((n) => this.typeCandidates(n, t));
          else {
            const explicit = call.receiver.startsWith("this.");
            const varName = explicit ? call.receiver.slice(5) : call.receiver;
            const varType = explicit
              ? this.fieldType(varName, t)
              : this.variableType(varName, t, m, call.offset);
            // A lexical variable shadows a type with the same name, even if its type is unresolved.
            receivers = varType
              ? this.typeCandidates(varType, t)
              : this.typeCandidates(call.receiver, t);
          }
          if (receivers.length > 1) {
            report(
              t,
              call.line,
              "ambiguous",
              "Ambiguous receiver " + call.receiver,
              methodId(t, m),
              receivers.map(classId),
            );
            continue;
          }
          let choices = receivers.flatMap((r) => this.candidates(r, call.name));
          if (!choices.length && !call.receiver)
            for (const imp of t.imports.filter((i) =>
              i.startsWith("static "),
            )) {
              const parts = imp.slice(7).split("."),
                last = parts.pop();
              if (last === call.name || last === "*")
                for (const r of this.byName.get(parts.join(".")) || [])
                  choices.push(...this.candidates(r, call.name));
            }
          const actual = call.args.map((a) => this.argumentType(a, t, m, call));
          const ranked = choices
            .filter((c) =>
              c.method.varargs
                ? actual.length >= c.method.params.length - 1
                : c.method.params.length === actual.length,
            )
            .map((c) => ({
              c,
              score: actual.reduce(
                (sum, a, i) => {
                  const p =
                    c.method.params[Math.min(i, c.method.params.length - 1)];
                  let expected = this.canonical(p.type, c.type);
                  if (
                    c.method.varargs &&
                    i >= c.method.params.length - 1 &&
                    !a.endsWith("[]")
                  )
                    expected = expected.replace(/\[\]$/, "");
                  return sum + this.score(a, expected);
                },
                c.method.varargs ? 2 : 0,
              ),
            }))
            .filter((x) => Number.isFinite(x.score));
          const best = Math.min(...ranked.map((x) => x.score));
          const winners = ranked.filter((x) => x.score === best);
          if (winners.length !== 1) {
            report(
              t,
              call.line,
              winners.length ? "ambiguous" : "unresolved",
              `Call ${call.receiver ? call.receiver + "." : ""}${call.name}(${actual.join(",")})`,
              methodId(t, m),
              winners.map((w) => methodId(w.c.type, w.c.method)),
            );
            continue;
          }
          const target = winners[0].c,
            site = call.receiver + "." + call.name;
          const occurrence = occurrences.get(site) || 0;
          occurrences.set(site, occurrence + 1);
          add(
            t,
            methodId(t, m),
            methodId(target.type, target.method),
            "calls",
            site + ":" + occurrence,
            call.line,
            `${call.receiver ? call.receiver + "." : ""}${call.name} → ${target.type.qualified}#${target.method.key} (declared source target)`,
            actual.includes("?"),
          );
        }
      }
    }
    return { edges, diagnostics };
  }
}
