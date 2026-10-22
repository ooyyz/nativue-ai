import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import { defaultConfig, saveConfig, readSnapshot } from "../src/store.ts";
import type { Module } from "../src/types.ts";

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-hierarchy-"));
  for (const id of ["workspace", "service", "storage"])
    fs.writeFileSync(path.join(root, id + ".ts"), `export const ${id}=true;\n`);
  saveConfig(root, defaultConfig());
  const runtime = new Runtime(root);
  await runtime.scan(true);
  const modules: Module[] = ["workspace", "service", "storage"].map((id, i) => ({
    id, name: id, description: "Fictional note workspace component.", kind: "backend",
    files: [id + ".ts"], evidence: [{ path: id + ".ts", line: 1 }],
    confidence: "observed", ...(i ? { parentId: i === 1 ? "workspace" : "service" } : {}),
  }));
  return {
    root, runtime, modules,
    result: (values: Module[]) => ({ schemaVersion: 1 as const,
      inputId: readSnapshot(root)!.id, modules: values, edges: [], journeys: [] }),
  };
}

test("hierarchical imports accept flat graphs and reject missing, malformed or cyclic parents atomically", async () => {
  const { root, modules, result } = await fixture();
  try {
    await importAnalysis(root, result(modules));
    assert.equal(readSnapshot(root)!.modules[2].parentId, "service");
    const accepted = fs.readFileSync(path.join(root, ".nativue/local.json"), "utf8");
    for (const parentId of ["missing", "service", "storage", "", null, 3]) {
      const bad = structuredClone(modules);
      bad[1].parentId = parentId as string;
      await assert.rejects(() => importAnalysis(root, result(bad)), /parentId|cycles/);
      assert.equal(fs.readFileSync(path.join(root, ".nativue/local.json"), "utf8"), accepted);
    }
    const flat = modules.map(({ parentId, ...m }) => m);
    await importAnalysis(root, result(flat));
    assert.ok(readSnapshot(root)!.modules.every((m) => m.parentId === undefined));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rescans preserve hierarchy and promote surviving children when their parent disappears", async () => {
  const { root, runtime, modules, result } = await fixture();
  try {
    await importAnalysis(root, result(modules));
    fs.appendFileSync(path.join(root, "storage.ts"), "// fictional change\n");
    await runtime.scan(true);
    assert.equal(readSnapshot(root)!.modules.find((m) => m.id === "storage")!.parentId, "service");
    fs.unlinkSync(path.join(root, "workspace.ts"));
    await runtime.scan(true);
    const next = readSnapshot(root)!;
    assert.ok(!next.modules.some((m) => m.id === "workspace"));
    assert.equal(next.modules.find((m) => m.id === "service")!.parentId, undefined);
    assert.equal(next.modules.find((m) => m.id === "storage")!.parentId, "service");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
