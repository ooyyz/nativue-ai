import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig, saveConfig, readSnapshot } from "../src/store.ts";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import { serve } from "../src/server.ts";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-java-browser-"));
const put = (p: string, s: string) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
};
put(
  "src/notes/NoteStore.java",
  "package notes; public class NoteStore { public void save(String text){commit();} void commit(){} }",
);
put(
  "src/notes/Editor.java",
  `package notes;
/** 编辑和保存笔记。 */
public class Editor {
 @Inject NoteStore store;
 /** 保存笔记。 */
 public void save(){store.save("note");}
}`,
);
const c = defaultConfig();
c.language = "zh";
saveConfig(root, c);
await new Runtime(root).scan(true);
let s = readSnapshot(root)!;
await importAnalysis(root, {
  schemaVersion: 1,
  inputId: s.id,
  modules: [
    {
      id: "workspace",
      name: "Notes workspace",
      description: "Fictional Java note application.",
      kind: "application",
      files: s.files.map((f) => f.path),
      evidence: [{ path: "src/notes/Editor.java", line: 1 }],
      confidence: "observed",
    },
  ],
  edges: [],
  journeys: [],
});
c.java = {
  enabled: true,
  roots: ["src"],
  parentId: "workspace",
  features: [{ id: "notes", name: "笔记保存", seeds: ["notes.Editor"] },
    {id:"storage", name:"笔记存储", seeds:["notes.NoteStore"]}],
};
saveConfig(root, c);
const instance = await serve(root, 0);
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const getTransform = () =>
  page.locator("#world").evaluate((el) => (el as HTMLElement).style.transform);
try {
  await page.goto(instance.url);
  await page.locator('[data-node="workspace"]').click();
  await page.getByRole("button", { name: /笔记保存/ }).waitFor();
  s = readSnapshot(root)!;
  const feature = s.modules.find((m) => m.level === "feature")!;
  const storageFeature = s.modules.find(m => m.name === "笔记存储")!;
  const storeClass = s.modules.find(m => m.symbol === "notes.NoteStore")!;
  const editor = s.modules.find((m) => m.symbol === "notes.Editor")!;
  const method = s.modules.find((m) => m.symbol === "notes.Editor#save()")!;
  await page.locator(`[data-node="${feature.id}"]`).click();
  await page.locator("#edit-feature-name").click();
  await page.locator("#architecture-value").fill("人工笔记功能");
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await page.getByText("手动命名 · 更新后保留",{exact:false}).waitFor();
  await page.reload();
  await page.locator("#map-breadcrumbs").getByText("人工笔记功能",{exact:true}).waitFor();
  await page.locator('[data-map-scope="workspace"]').click();
  await page.locator(`[data-node="${storageFeature.id}"]`).click();
  await page.locator(`[data-node="${storeClass.id}"]`).click();
  await page.locator("#edit-class-feature").click();
  await page.locator("#architecture-value").selectOption(feature.id);
  await page.getByRole("button",{name:"保存",exact:true}).click();
  await page.getByText("手动指定 · 更新后保留",{exact:false}).waitFor();
  await page.reload();
  await page.getByText("手动指定 · 更新后保留",{exact:false}).waitFor();
  assert.equal(await page.locator("[data-node]").count(), 2);
  assert.ok((await page.locator(".edge").count()) > 0);
  await page.locator(`[data-node="${editor.id}"]`).click();
  await page.locator(`[data-node="${method.id}"]`).click();
  await page.locator(".responsibility .description-origin").getByText("源码注释自动填充", {exact:true}).waitFor();
  assert.equal(await page.locator(".responsibility > .responsibility-text").textContent(), "保存笔记。");
  await page.locator("#edit-description").click();
  assert.equal(await page.locator("#description-text").inputValue(), "保存笔记。");
  await page.setViewportSize({width:451,height:740});
  const dialogBox = await page.getByRole("dialog").boundingBox();
  assert.ok(dialogBox && dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 451);
  assert.ok(await page.getByRole("button",{name:"保存",exact:true}).isVisible());
  await page.setViewportSize({width:1440,height:1000});
  const custom = '保存笔记并由人工维护说明。<img src=x onerror="throw 1">';
  await page.locator("#description-text").fill(custom);
  await page.getByRole("button", {name:"保存",exact:true}).click();
  await page.getByText("手动编辑 · 更新后保留", {exact:true}).waitFor();
  await page.reload();
  await page.getByText("手动编辑 · 更新后保留", {exact:true}).waitFor();
  assert.equal(await page.locator(".responsibility > .responsibility-text").textContent(),custom);
  assert.equal(await page.locator(".responsibility img").count(),0);
  c.java!.features[0].name = "笔记自动识别新名称";
  saveConfig(root, {...c, refresh:{debounceMs:1000,reconcileMs:1000}});
  // Source updates cannot destroy the unsaved editor draft, or overwrite a saved manual description.
  await page.locator("#edit-description").click();
  await page.locator("#description-text").fill("尚未保存的草稿");
  const editorFile = path.join(root,"src/notes/Editor.java");
  fs.writeFileSync(editorFile,fs.readFileSync(editorFile,"utf8").replace("/** 保存笔记。 */", "/** 保存笔记并校验内容。 */"));
  await page.waitForFunction(() => document.querySelector(".responsibility details p")?.textContent?.includes("保存笔记并校验内容。"),undefined,{timeout:15000});
  assert.equal(await page.locator("#description-text").inputValue(),"尚未保存的草稿");
  await page.getByRole("button",{name:"取消",exact:true}).click();
  assert.equal(await page.locator(".responsibility > .responsibility-text").textContent(),custom);
  await page.locator("#edit-description").click();
  await page.locator("#reset-description").click();
  await page.locator(".responsibility .description-origin").getByText("源码注释自动填充",{exact:true}).waitFor();
  assert.equal(await page.locator(".responsibility > .responsibility-text").textContent(),"保存笔记并校验内容。");
  await page.locator("#show-call-chain").click();
  await page
    .locator("#map-breadcrumbs")
    .getByText("调用链 · 两跳 · 最多 80 个节点")
    .waitFor();
  assert.equal(await page.locator("[data-node]").count(), 3);
  assert.equal(await page.locator(".edge").count(), 2);
  await page.locator("#zoom-in").click();
  const before = await getTransform();
  await page.reload();
  await page.locator("#show-call-chain").waitFor();
  assert.equal(await getTransform(), before);
  assert.equal(await page.locator("[data-node]").count(), 3);
  // Runtime watcher refresh is exercised by a real source edit, without manual JSON generation or scan calls.
  const cfg = { ...c, refresh: { debounceMs: 1000, reconcileMs: 1000 } };
  saveConfig(root, cfg);
  put(
    "src/notes/NoteStore.java",
    "package notes; public class NoteStore { public void save(String text){commit();audit();} void commit(){} void audit(){} }",
  );
  await page.waitForFunction(
    () => document.querySelectorAll("[data-node]").length === 4,
    undefined,
    { timeout: 15000 },
  );
  assert.equal(await getTransform(), before);
  assert.ok((readSnapshot(root)!.java?.parsedFiles || 0) <= 1);
  await page.locator(".java-report summary").click();
  await page.getByText(/新增 \/ 变化 \/ 删除关系/).waitFor();
  fs.mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/java-call-chain.png",
    fullPage: true,
  });
  // Newly added/changed relationships have source-backed visible badges.
  assert.ok((await page.locator('.edge[data-change="added"]').count()) > 0);
  await page.locator("#map-up").click();
  assert.equal(await page.locator("[data-node]").count(), 1);
  // Both overrides survived actual source updates; restoring either leaves the other intact.
  await page.locator(`[data-map-scope="${feature.id}"]`).click();
  assert.equal(await page.locator("[data-node]").count(),2);
  await page.locator(`[data-node="${storeClass.id}"]`).click();
  await page.locator("#edit-class-feature").click();
  await page.locator("#reset-architecture").click();
  await page.locator("#map-breadcrumbs").getByText("笔记存储",{exact:true}).waitFor();
  assert.equal(await page.locator("[data-node]").count(),1);
  await page.locator('[data-map-scope="workspace"]').click();
  await page.locator(`[data-node="${feature.id}"]`).getByText("人工笔记功能",{exact:true}).waitFor();
  await page.locator(`[data-node="${feature.id}"]`).click();
  await page.locator("#edit-feature-name").click();
  await page.locator("#reset-architecture").click();
  await page.locator("#map-breadcrumbs").getByText("笔记自动识别新名称",{exact:true}).waitFor();
  await page.locator(`[data-node="${editor.id}"]`).click();
  await page.locator(`[data-node="${method.id}"]`).click();
  await page.locator("#language-button").click();
  await page.getByRole("button", { name: /Explore call chain/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Java browser passed: feature rename, class reassignment, source refresh persistence, independent automatic resets, comment autofill, editable responsibilities, call graph and stable layout.",
  );
} finally {
  await browser.close();
  instance.close();
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(root, { recursive: true, force: true });
}
