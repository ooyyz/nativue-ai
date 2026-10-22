import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJava, digest } from "../src/java/parser.ts";
import { JavaResolver, classId, methodId } from "../src/java/resolver.ts";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import {
  defaultConfig,
  saveConfig,
  readConfig,
  readSnapshot,
} from "../src/store.ts";
const parseFiles = (files: Record<string, string>) =>
  Object.entries(files).map(([p, s]) => parseJava(p, digest(s), s));
function resolve(files: Record<string, string>) {
  const facts = parseFiles(files),
    r = new JavaResolver(facts);
  return {
    facts,
    ...facts
      .map((f) => r.resolveFile(f))
      .reduce(
        (a, b) => ({
          edges: [...a.edges, ...b.edges],
          diagnostics: [...a.diagnostics, ...b.diagnostics],
        }),
        {
          edges: [] as ReturnType<JavaResolver["resolveFile"]>["edges"],
          diagnostics: [] as ReturnType<
            JavaResolver["resolveFile"]
          >["diagnostics"],
        },
      ),
  };
}
const sources = {
  "src/demo/Base.java":
    "package demo; public class Base { public void inherited() {} }",
  "src/demo/Port.java":
    "package demo; public interface Port { void save(String value); }",
  "src/demo/Store.java":
    "package demo; public class Store implements Port {public void save(String value){} public void save(int value){}}",
  "src/demo/Service.java": `package demo;
@Service public class Service extends Base {
 @Inject private Port port;
 Service(Store store) {}
 void run(String value) {
   port.save(value);
   inherited();
   choose(1); choose("x");
   this.port.save("this");
 }
 void choose(int i) {} void choose(String s) {}
}`,
};
test("contextual Java keywords remain declaration and call identifiers", () => {
  const x = resolve({
    "src/demo/Ledger.java": `package demo;
      class Ledger {
        void record(String yield) {}
        void run() { record("entry"); }
      }`,
  });
  const method = x.facts[0].types[0].methods[0];
  assert.equal(method.key, "record(String)");
  assert.equal(method.params[0].name, "yield");
  assert.equal(x.edges.filter((e) => e.relation === "calls").length, 1);
  assert.ok(x.edges[0].label.includes("Ledger#record(String)"));
});
test("Java CST extracts extends, implements, annotation/constructor injection and exact overload calls with evidence", () => {
  const x = resolve(sources);
  assert.equal(x.edges.filter((e) => e.relation === "extends").length, 1);
  assert.equal(x.edges.filter((e) => e.relation === "implements").length, 1);
  assert.equal(x.edges.filter((e) => e.relation === "injects").length, 2);
  const calls = x.edges.filter((e) => e.relation === "calls");
  assert.equal(calls.length, 5);
  assert.ok(
    calls.some(
      (e) =>
        e.label.includes("demo.Port#save(String)") && e.evidence[0].line === 6,
    ),
  );
  assert.ok(calls.some((e) => e.label.includes("demo.Base#inherited()")));
  assert.ok(calls.some((e) => e.label.includes("choose(int)")));
  assert.ok(calls.some((e) => e.label.includes("choose(String)")));
  assert.equal(
    x.edges.find((e) => e.label === "injects Port")!.evidence[0].line,
    3,
  );
  assert.equal(
    x.edges.find((e) => e.label.includes("constructor parameter"))!.confidence,
    "inferred",
  );
  assert.deepEqual(x.diagnostics, []);
});
test("imports, qualified names, nested types, static imports and lexical shadowing avoid short-name guesses", () => {
  const x = resolve({
    "src/a/Port.java":
      "package a; public class Port {public void save(String s){}}",
    "src/b/Port.java":
      "package b; public class Port {public void save(int i){}}",
    "src/a/Tools.java":
      "package a; public class Tools {public static void check(){} public static class Nested {public void work(){}}}",
    "src/c/Use.java": `package c; import a.Port; import a.Tools.Nested; import static a.Tools.check;
    class Use { Port port; void run(){ port.save("a"); { b.Port port=new b.Port(); port.save(1); } port.save("b"); check(); Nested n=new Nested();n.work(); } }`,
    "src/d/Unknown.java":
      "package d; class Unknown { Port port; void run(){port.save(1);} }",
  });
  const calls = x.edges.filter((e) => e.relation === "calls");
  assert.equal(calls.length, 5);
  assert.equal(
    calls.filter((e) => e.label.includes("a.Port#save(String)")).length,
    2,
  );
  assert.equal(
    calls.filter((e) => e.label.includes("b.Port#save(int)")).length,
    1,
  );
  assert.ok(calls.some((e) => e.label.includes("a.Tools#check()")));
  assert.ok(calls.some((e) => e.label.includes("a.Tools.Nested#work()")));
  assert.ok(
    x.diagnostics.some(
      (d) => d.path === "src/d/Unknown.java" && d.kind === "unresolved",
    ),
  );
});
test("ambiguous overloads/receivers, external imports, strings, comments, lambdas and chains never invent targets", () => {
  const x = resolve({
    "a/Same.java": "package a; public class Same {void go(){}}",
    "b/Same.java": "package b; public class Same {void go(){}}",
    "x/U.java": `package x; import a.*; import b.*; class U { Same s; void run(){s.go(); unknown().go(); choose(missing); } Object unknown(){return null;} void choose(String s){} void choose(Integer i){} }`,
    "x/P.java": `package x; import missing.Same; class P { Same s; void run(){s.go(); String text="s.go()"; /*s.go();*/ } }`,
    "x/L.java": `package x; import a.Same; class L { Same port; void run(){ use(port -> port.go()); } void use(Object fn){} }`,
  });
  assert.equal(x.edges.filter((e) => e.label.includes("Same#go")).length, 0);
  assert.ok(
    x.diagnostics.some(
      (d) => d.kind === "ambiguous" && d.message.includes("receiver"),
    ),
  );
  assert.ok(
    x.diagnostics.some(
      (d) => d.kind === "ambiguous" && d.message.includes("choose"),
    ),
  );
  assert.ok(x.diagnostics.some((d) => d.message.includes("chained")));
  assert.ok(
    x.diagnostics.some(
      (d) => d.path === "x/L.java" && d.message.includes("port.go"),
    ),
  );
});
test("declared interface targets remain interface targets; varargs support zero and multiple arguments", () => {
  const x = resolve({
    "P.java": "interface P {void send(String... args);}",
    "Impl.java": "class Impl implements P {public void send(String... args){}}",
    "U.java": 'class U {P p; void run(){p.send();p.send("a","b");}}',
  });
  const calls = x.edges.filter((e) => e.relation === "calls");
  assert.equal(calls.length, 2);
  const p = x.facts.flatMap((f) => f.types).find((t) => t.name === "P")!;
  assert.ok(calls.every((e) => e.to === methodId(p, p.methods[0])));
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-java-"));
  for (const [p, s] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), s);
  }
  const c = defaultConfig();
  c.java = {
    enabled: true,
    roots: ["src"],
    features: [
      { id: "storage", name: "Storage capability", seeds: ["demo.Port"] },
      { id: "execution", name: "Execution capability", seeds: ["demo.Base"] },
    ],
  };
  saveConfig(root, c);
  const runtime = new Runtime(root);
  await runtime.scan(true);
  return { root, runtime };
}
test("automatic graph creates functional/class/method hierarchy, caches facts and preserves stable unrelated symbols", async () => {
  const { root, runtime } = await fixture();
  try {
    const first = readSnapshot(root)!;
    assert.equal(first.java!.status, "complete");
    assert.equal(first.java!.parsedFiles, 4);
    const features = first.modules.filter((m) => m.level === "feature");
    assert.ok(features.some((m) => m.name === "Storage capability"));
    const port = first.modules.find((m) => m.symbol === "demo.Port")!;
    assert.ok(features.some((m) => m.id === port.parentId));
    const save = first.modules.find(
      (m) => m.symbol === "demo.Port#save(String)",
    )!;
    assert.equal(save.parentId, port.id);
    const serviceFile = path.join(root, "src/demo/Service.java");
    fs.appendFileSync(serviceFile, "\n// changed file only\n");
    await runtime.scan(true);
    const second = readSnapshot(root)!;
    assert.equal(second.java!.parsedFiles, 1);
    assert.equal(second.java!.reusedFiles, 3);
    assert.equal(second.java!.resolvedFiles, 1);
    assert.equal(
      second.modules.find((m) => m.symbol === "demo.Port#save(String)")!.id,
      save.id,
    );
    assert.ok(!second.java!.changes.changed.some((m) => m.id === save.id));
    // A declaration change invalidates unchanged callers; the removed call target cannot survive.
    fs.writeFileSync(
      path.join(root, "src/demo/Port.java"),
      "package demo; public interface Port {void renamed(String value); }",
    );
    await runtime.scan(true);
    const third = readSnapshot(root)!;
    assert.equal(third.java!.parsedFiles, 1);
    assert.equal(third.java!.resolvedFiles, 4);
    assert.ok(third.java!.changes.removed.some((m) => m.id === save.id));
    assert.ok(!third.edges.some((e) => e.to === save.id));
    assert.ok(third.java!.changes.removedEdges.some((e) => e.to === save.id));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("syntax failures retain the last valid graph and recover automatically; deletion removes dependent edges", async () => {
  const { root, runtime } = await fixture();
  try {
    const original = readSnapshot(root)!,
      before = original.modules.filter((m) => m.generator === "java");
    const file = path.join(root, "src/demo/Port.java");
    fs.writeFileSync(file, "package demo; interface Port { broken ");
    await runtime.scan(true);
    const failed = readSnapshot(root)!;
    assert.equal(failed.java!.status, "failed");
    assert.deepEqual(
      failed.modules.filter((m) => m.generator === "java"),
      before,
    );
    fs.writeFileSync(file, sources["src/demo/Port.java"]);
    await runtime.scan(true);
    assert.equal(readSnapshot(root)!.java!.status, "complete");
    fs.unlinkSync(file);
    await runtime.scan(true);
    const deleted = readSnapshot(root)!;
    assert.ok(!deleted.modules.some((m) => m.symbol === "demo.Port"));
    assert.ok(deleted.java!.changes.removed.length > 0);
    assert.ok(
      deleted.edges.every(
        (e) =>
          deleted.modules.some((m) => m.id === e.from) &&
          deleted.modules.some((m) => m.id === e.to),
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("Java config validates scope and existing semantic imports cannot overwrite generated facts", async () => {
  const { root, runtime } = await fixture();
  try {
    const s = readSnapshot(root)!,
      generated = s.modules.filter((m) => m.generator === "java");
    await importAnalysis(root, {
      schemaVersion: 1,
      inputId: s.id,
      modules: s.modules.filter((m) => m.generator !== "java"),
      edges: [],
      journeys: [],
    });
    assert.deepEqual(
      readSnapshot(root)!.modules.filter((m) => m.generator === "java"),
      generated,
    );
    const c = readConfig(root);
    c.java!.roots = ["../other"];
    assert.throws(() => saveConfig(root, c), /Invalid Java/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("plain constructor parameters are dependencies rather than framework injection", () => {
  const result = resolve({
    "Port.java": "interface Port {}",
    "Plain.java": "class Plain { Plain(Port port) {} }",
    "Managed.java": "@Service class Managed { Managed(Port port) {} }",
  });
  assert.equal(result.edges.filter(e => e.relation === "depends").length, 1);
  assert.equal(result.edges.filter(e => e.relation === "injects").length, 1);
  assert.equal(result.edges.find(e => e.relation === "injects")!.confidence, "inferred");
});

test("removing the last Java source clears generated relationships and reports removals", async () => {
  const { root, runtime } = await fixture();
  try {
    fs.rmSync(path.join(root, "src"), { recursive: true });
    await runtime.scan(true);
    const last = readSnapshot(root)!;
    assert.equal(last.java!.status, "complete");
    assert.ok(!last.modules.some(m => m.generator === "java"));
    assert.ok(!last.edges.some(e => e.generator === "java"));
    assert.ok(last.java!.changes.removed.length > 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
