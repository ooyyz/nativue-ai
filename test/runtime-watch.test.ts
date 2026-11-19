import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../src/runtime.ts";
import { defaultConfig, readSnapshot, saveConfig } from "../src/store.ts";

function put(root: string, file: string, content = "package demo; class Gate {}") {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function waitForScan(runtime: Runtime, predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const listener = () => {
      if (!predicate()) return;
      clearTimeout(timeout);
      runtime.listeners.delete(listener);
      resolve();
    };
    const timeout = setTimeout(() => {
      runtime.listeners.delete(listener);
      reject(new Error("Source change did not trigger a scan"));
    }, 8000);
    runtime.listeners.add(listener);
  });
}

test("Java watching registers only selected source directories and refreshes on real edits", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-watch-"));
  const source = "alpha/src/main/java/demo/Gate.java";
  for (const file of [source, "alpha/src/main/java/demo/build/Build.java",
    "alpha/src/main/java/demo/runtime/Runtime.java", "alpha/src/main/java/demo/test/Helper.java",
    "alpha/src/main/java/demo/generated/Generated.java", "alpha/src/test/java/demo/GateTest.java",
    "alpha/build/classes/Output.java", "alpha/target/Output.java", "alpha/node_modules/Output.java",
    "alpha/.git/Output.java", "alpha/secrets/Output.java", "alpha/tests/Output.java",
    "alpha/__tests__/Output.java", "unselected/src/main/java/demo/Other.java",
    "beta/src/main/java/demo/Beta.java", "gamma/src/main/java/demo/Only.java"]) put(root, file);
  fs.symlinkSync(path.join(root, "unselected"), path.join(root, "alpha", "linked"));
  const config = defaultConfig();
  config.refresh = { debounceMs: 1000, reconcileMs: 600000 };
  config.exclude = ["**/generated"];
  config.java = { enabled: true, roots: [source, "alpha/"], features: [], scopes: [
    { id: "beta", name: "Beta", roots: ["beta/src/main/java"], features: [] },
    { id: "gamma", name: "Gamma", roots: ["gamma/src/main/java/demo/Only.java"], features: [] },
  ] };
  saveConfig(root, config);
  const runtime = new Runtime(root);
  try {
    await runtime.start();
    assert.equal(runtime.state.error, undefined);
    const directories = [...runtime.watchers.keys()];
    assert.ok(directories.includes("alpha/src/main/java/demo/build"), JSON.stringify({directories, error: runtime.state.error}));
    assert.ok(directories.includes("alpha/src/main/java/demo/runtime"));
    assert.ok(directories.includes("alpha/src/main/java/demo/test"));
    assert.ok(directories.includes("beta/src/main/java/demo"));
    assert.ok(!directories.some(directory => /(?:^|\/)(?:target|node_modules|\.git|secrets|generated|linked)(?:\/|$)/.test(directory)));
    assert.ok(!directories.some(directory => directory.startsWith("alpha/src/test")));
    assert.ok(!directories.some(directory => directory.startsWith("unselected") || directory.startsWith("alpha/build")));
    const only = runtime.watchers.get("gamma/src/main/java/demo")!;
    only.emit("change", "change", "Neighbor.java");
    assert.equal(runtime.pending, null);
    const before = readSnapshot(root)!.id;
    const changed = waitForScan(runtime, () => readSnapshot(root)!.id !== before);
    put(root, source, "package demo; class Gate { void changed() {} }");
    await changed;
    assert.ok(readSnapshot(root)!.modules.some(module => module.name === "changed()"));
    const single = "gamma/src/main/java/demo/Only.java";
    const deleted = waitForScan(runtime, () => !readSnapshot(root)!.files.some(file => file.path === single));
    fs.unlinkSync(path.join(root, single));
    await deleted;
    assert.ok(runtime.watchers.has("gamma/src/main/java/demo"));
    const recreated = waitForScan(runtime, () => readSnapshot(root)!.files.some(file => file.path === single));
    put(root, single, "package demo; class Only {}");
    await recreated;
  } finally {
    await runtime.close();
    assert.equal(runtime.watchers.size, 0);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new directories and atomic source replacement keep live watchers without periodic scans", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-watch-new-"));
  put(root, "src/main/java/demo/Gate.java");
  const config = defaultConfig();
  config.refresh = { debounceMs: 1000, reconcileMs: 600000 };
  config.java = { enabled: true, roots: ["src/main/java"], features: [] };
  saveConfig(root, config);
  const runtime = new Runtime(root);
  try {
    await runtime.start();
    const discovered = waitForScan(runtime, () => runtime.watchers.has("src/main/java/demo/newpackage"));
    put(root, "src/main/java/demo/newpackage/Seed.java", "package demo.newpackage; class Seed {}");
    await discovered;
    const source = "src/main/java/demo/newpackage/NewGate.java";
    const created = waitForScan(runtime, () => !!readSnapshot(root)!.files.find(file => file.path === source));
    put(root, source, "package demo.newpackage; class NewGate {}");
    await created;
    const before = readSnapshot(root)!.id;
    const replaced = waitForScan(runtime, () => readSnapshot(root)!.id !== before);
    put(root, source + ".tmp", "package demo.newpackage; class NewGate { void replacement() {} }");
    fs.renameSync(path.join(root, source + ".tmp"), path.join(root, source));
    await replaced;
    assert.ok(readSnapshot(root)!.modules.some(module => module.name === "replacement()"));
    const removed = waitForScan(runtime, () => !runtime.watchers.has("src/main/java/demo/newpackage"));
    fs.rmSync(path.join(root, "src/main/java/demo/newpackage"), { recursive: true });
    await removed;
  } finally {
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-Java workspaces watch indexed source directories and skip tests and outputs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-watch-web-"));
  put(root, "client/app.ts", "export const app = 1;");
  put(root, "client/src/test/app.test.ts", "export const test = 1;");
  put(root, "client/dist/app.js", "export const app = 1;");
  const config = defaultConfig();
  config.refresh = { debounceMs: 1000, reconcileMs: 600000 };
  saveConfig(root, config);
  const runtime = new Runtime(root);
  try {
    await runtime.start();
    assert.ok(runtime.watchers.has("client"));
    assert.ok(![...runtime.watchers.keys()].some(directory => directory.includes("/src/test") || directory.includes("/dist")));
    const nested = "client/views/editor.ts";
    const changed = waitForScan(runtime, () => runtime.watchers.has("client/views") && !!readSnapshot(root)!.files.find(file => file.path === nested));
    put(root, nested, "export const editor = 1;");
    await changed;
  } finally {
    await runtime.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("watcher registration and asynchronous errors retain fallback and retry without leaking watchers", async context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-watch-retry-"));
  put(root, "client/app.ts", "export const app = 1;");
  saveConfig(root, defaultConfig());
  const originalWatch = fs.watch;
  const mock = context.mock.method(fs, "watch", () => {
    throw new Error("Fictional watcher limit");
  });
  const runtime = new Runtime(root);
  try {
    await runtime.start();
    assert.match(runtime.state.error!, /periodic reconciliation/);
    assert.equal(runtime.watchers.size, 0);
    mock.mock.restore();
    await runtime.scan(true);
    assert.equal(runtime.state.error, undefined);
    const watcher = runtime.watchers.get("client")!;
    watcher.emit("error", new Error("Fictional asynchronous error"));
    assert.match(runtime.state.error!, /periodic reconciliation/);
    assert.equal(runtime.watchers.size, 0);
    await runtime.scan(true);
    assert.equal(runtime.state.error, undefined);
    assert.notEqual(runtime.watchers.get("client"), watcher);
    assert.equal(fs.watch, originalWatch);
  } finally {
    mock.mock.restore();
    await runtime.close();
    assert.equal(runtime.watchers.size, 0);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
