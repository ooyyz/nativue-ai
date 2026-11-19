import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultConfig, saveConfig, readSnapshot } from "../src/store.ts";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import { readLedger, updateTask } from "../src/ledger.ts";
import { serve } from "../src/server.ts";
import type { Module } from "../src/types.ts";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-browser-"));
const root = path.join(temp, "atlas-notes");
fs.mkdirSync(root);
const files: Record<string, string> = {
  "client/screens/editor.ts":
    "import {saveNote} from '../../server/routes/notes.ts';\nexport const save=saveNote;\n",
  "server/routes/notes.ts":
    "import {Note} from '../../shared/note.ts';\nexport function saveNote(note:Note){return {ok:true,note};}\n",
  "shared/note.ts": "export interface Note {id:string;title:string}\n",
  "tools/note-export.ts": "export const format = 'markdown';\n",
};
for (let i = 0; i < 85; i++)
  files[`client/components/item-${String(i).padStart(3, "0")}.ts`] =
    `export const item${i}=${i};\n`;
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
}
saveConfig(root, defaultConfig());
await new Runtime(root).scan(true);
const s = readSnapshot(root)!;
const groups: Module[] = [
  {
    id: "editor",
    name: "Note editor",
    description: "Write and save a note.",
    kind: "frontend",
    files: ["client/screens/editor.ts"],
    evidence: [{ path: "client/screens/editor.ts", line: 1 }],
    confidence: "inferred" as const,
  },
  {
    id: "api",
    name: "Notes API",
    description: "Accept saved note data.",
    kind: "backend",
    files: ["server/routes/notes.ts"],
    evidence: [{ path: "server/routes/notes.ts", line: 2 }],
    confidence: "inferred" as const,
  },
  {
    id: "contract",
    name: "Shared note type",
    description: "The note shape used by services.",
    kind: "shared",
    files: [
      "shared/note.ts",
      ...Object.keys(files).filter((f) => f.includes("/components/")),
    ],
    evidence: [{ path: "shared/note.ts", line: 1 }],
    confidence: "observed" as const,
  },
];
groups.push(...[
  { id: "platform", name: "Note platform" },
  { id: "note-router", name: "Note router", parentId: "platform" },
  { id: "note-store", name: "Note store", parentId: "platform" },
  { id: "note-cache", name: "Note cache", parentId: "note-store" },
].map((m): Module => ({ ...m, description: "Fictional note subsystem.",
  kind: "backend", files: ["shared/note.ts"],
  evidence: [{ path: "shared/note.ts", line: 1 }], confidence: "observed" })));
await importAnalysis(root, {
  schemaVersion: 1,
  inputId: s.id,
  modules: [...groups, s.modules.find(m => m.name === "tools")!],
  edges: [
    { id: "route-store", from: "note-router", to: "note-store", label: "store note",
      evidence: [{ path: "shared/note.ts", line: 1 }], confidence: "observed" },
    { id: "router-api", from: "note-router", to: "api", label: "external API",
      evidence: [{ path: "shared/note.ts", line: 1 }], confidence: "inferred" },
    {
      id: "save-call",
      from: "editor",
      to: "api",
      label: "saveNote",
      evidence: [{ path: "client/screens/editor.ts", line: 1 }],
      confidence: "observed",
    },
  ],
  journeys: [
    {
      id: "save",
      name: "Save a note",
      description: "From editor to API.",
      confidence: "inferred",
      steps: [
        {
          moduleId: "editor",
          label: "Write a note",
          evidence: [{ path: "client/screens/editor.ts", line: 2 }],
        },
        {
          moduleId: "api",
          label: "Save note data",
          evidence: [{ path: "server/routes/notes.ts", line: 2 }],
        },
      ],
    },
  ],
});
fs.mkdirSync(path.join(root, "examples"));
fs.writeFileSync(path.join(root, "examples/note.ts"), "export const example = 'hello';\n");
const instance = await serve(root, 0);
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures: string[] = [];
page.on("pageerror", (e) => failures.push(e.message));
fs.mkdirSync("artifacts", { recursive: true });
try {
  await page.goto(instance.url);
  await page.locator('#dev-map-open').waitFor();
  const indexToggle = page.getByRole('button', {name:'Indexed directories · 2', exact:true});
  const directoryCards = page.locator('[data-group-box="directory"] [data-node]');
  assert.equal(await directoryCards.count(), 0, 'the main architecture opens with semantic modules');
  await indexToggle.click();
  assert.equal(await directoryCards.count(), 2, 'initial and incremental directory cards are available on demand');
  await page.reload();
  await indexToggle.waitFor();
  assert.equal(await indexToggle.getAttribute('aria-pressed'), 'true');
  await indexToggle.click();
  assert.equal(await directoryCards.count(), 0, 'closing the directory view returns to the main architecture');
  // Simulate the saved viewport from before the directory toggle existed.
  await page.addInitScript(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('nativue-layout:'))!;
    const layout = JSON.parse(localStorage.getItem(key)!);
    const location = layout.locations.find(([id]: [string]) => id === '')[1];
    delete location.showIndexedDirectories;
    location.view = { x: 0, y: 0, scale: 0.04 };
    localStorage.setItem(key, JSON.stringify(layout));
  });
  await page.reload();
  await indexToggle.waitFor();
  await page.waitForFunction(() => Number(document.querySelector('#zoom')?.textContent?.replace('%', '')) > 4);
  assert.equal(await directoryCards.count(), 0, 'legacy layouts refit the semantic overview');
  await page.locator('[data-node="editor"]').click();
  await page.locator('#selection').getByRole('heading',{name:'Note editor'}).waitFor();
  assert.equal(await page.locator('#tab-updates').getAttribute('aria-selected'),'true');
  await page.screenshot({path:'artifacts/canvas-en.png',fullPage:true});
  await page.locator('#show-selected-files').click();
  assert.equal(await page.locator('#tab-folders').getAttribute('aria-selected'),'true');
  await page.locator('#file-search').fill('no-match');
  await page.locator('#tab-updates').click();
  await page.locator('[data-node="contract"]').click();
  await page.locator('#show-selected-files').click();
  assert.equal(await page.locator('#file-search').inputValue(),'');
  await page.locator('#prev-file').click();
  const chosen=page.locator('[data-tree-file="client/components/item-084.ts"]');
  await chosen.waitFor();
  await page.waitForFunction(path=>(document.activeElement as HTMLElement | null)?.dataset.treeFile===path,'client/components/item-084.ts');
  assert.equal(await chosen.evaluate(el=>{const r=el.getBoundingClientRect();const parent=el.closest('.sidebar-scroll')!.getBoundingClientRect();return r.top>=parent.top&&r.bottom<=parent.bottom;}),true);
  await instance.runtime.scan(true);
  await page.waitForTimeout(300);
  assert.equal(await chosen.evaluate(el=>document.activeElement===el),true);
  await page.locator('#language-button').click();
  await page.getByRole('heading',{name:'代码与运行地图',exact:true}).waitFor();
  await page.locator('#tab-updates').click();
  await page.locator('[data-node="editor"]').click();
  await page.waitForTimeout(250);assert.equal(await page.locator('.toast').count(),0);await page.screenshot({path:'artifacts/canvas-zh.png',fullPage:true});
  await page.locator('#tab-journeys').click();
  await page.locator('[data-step]').first().waitFor();
  await page.locator('[data-step]').first().click();
  await page.locator('#dev-board-open').click();
  await page.locator('#board-new-task').click();
  await page.locator('#task-title').fill('Preserve note draft');
  await page.locator('#task-module').fill('Note editor');
  await page.locator('#task-description').fill('Keep entered note content when save fails.');
  await page.locator('#task-criteria').fill('Failed save keeps draft\nRetry succeeds once');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await page.locator('.parallel-card').filter({hasText:'Preserve note draft'}).waitFor();
  const ledger = readLedger(root);
  const draftTask = ledger.tasks.find(t => t.title === 'Preserve note draft')!;
  updateTask(root, ledger.revision, 'test', {
    ...draftTask, id: 'DRAFT-RESTORE', title: 'Restore draft', dependsOn: [draftTask.id],
  });
  instance.runtime.emit();
  const moduleLane = page.locator('[data-parallel-group="module:Note editor"]');
  await moduleLane.getByText('Restore draft', {exact: true}).waitFor();
  assert.equal(await moduleLane.locator('.parallel-card').count(), 2);
  await page.locator('#parallel-grouping').selectOption('dependency');
  assert.equal(await page.locator('[data-parallel-group="1"] .parallel-card strong').textContent(), 'Restore draft');
  await page.locator('#parallel-grouping').selectOption('module');
  const draftCard = page.locator(`[data-parallel-card="${draftTask.id}"]`);
  const inspector = page.locator('.parallel-inspector');
  const edit = () => inspector.getByRole('button', {name:'编辑任务', exact:true}).click();
  const taskForm = page.locator('#task-form');
  const save = async () => {
    await taskForm.getByRole('button', {name:'保存修改', exact:true}).click();
    await taskForm.waitFor({state:'detached'});
  };
  const editing = (field: string) => taskForm.locator(`#task-${field}`);
  const advance = async (stage: string) => {
    await taskForm.locator('#task-workflow > summary').click();
    await editing('status').selectOption(stage);
  };
  const savedDraft = () => readLedger(root).tasks.find(t => t.id === draftTask.id)!;
  await draftCard.click();
  await inspector.getByRole('heading', {name:'Preserve note draft', exact:true}).waitFor();
  await edit();
  await editing('progress').selectOption({label:'待测试'});
  await save();
  await draftCard.getByText('待测试', {exact:true}).waitFor();
  await edit();
  assert.equal(await editing('progress').inputValue(), 'testing');
  await editing('progress').selectOption({label:'已完成'});
  await save();
  await draftCard.getByText('已完成', {exact:true}).waitFor();
  assert.equal(savedDraft().progress, 'done');
  assert.equal(savedDraft().status, 'todo');
  assert.equal(savedDraft().userAcceptance, undefined);
  await edit();
  await editing('title').fill('Keep note drafts');
  await editing('description').fill('Keep drafts after a failed save.');
  await editing('criteria').fill('Draft content survives\nRetry saves the draft');
  await editing('branch').fill('feature/note-draft');
  await editing('acceptance-notes').fill('Saved evidence link and local observations.');
  await editing('progress').selectOption({label:'跟随交接阶段'});
  await advance('developing');
  await editing('actor').fill('Note Writer');
  await save();
  await inspector.getByRole('heading', {name:'Keep note drafts', exact:true}).waitFor();
  await inspector.getByText('Saved evidence link and local observations.').waitFor();
  assert.equal(savedDraft().branch, 'feature/note-draft');
  assert.equal(savedDraft().status, 'developing');
  assert.equal(savedDraft().progress, null);
  await draftCard.getByText('开发中', {exact:true}).waitFor();
  assert.equal(readLedger(root).tasks[0].id, draftTask.id, 'edits retain task ordering');
  await edit();
  await advance('review');
  await editing('criteria').fill('Draft content survives a failed save');
  await editing('version').fill('a'.repeat(40));
  await save();
  await edit();
  assert.equal(await editing('criteria').getAttribute('readonly'), '');
  await advance('passed');
  await editing('review-report').fill('Independent draft persistence checks passed.');
  await editing('actor').fill('Note Writer');
  await taskForm.getByRole('button', {name:'保存修改', exact:true}).click();
  await taskForm.locator('#task-error').getByText(/independent/i).waitFor();
  assert.equal(await editing('review-report').inputValue(), 'Independent draft persistence checks passed.');
  await editing('actor').fill('Note Reviewer');
  await save();
  await inspector.getByText('Independent draft persistence checks passed.', {exact:false}).waitFor();
  assert.equal(savedDraft().reviews[0].commit, 'a'.repeat(40));
  assert.deepEqual(savedDraft().criteria, ['Draft content survives a failed save']);
  await edit();
  await editing('acceptance-notes').fill('Updated evidence after review.');
  await save();
  await inspector.getByText('Updated evidence after review.').waitFor();
  assert.equal(savedDraft().reviews.length, 1);
  await edit();
  await advance('integrated');
  await editing('version').fill('b'.repeat(40));
  await save();
  await edit();
  await advance('integration-review');
  await save();
  await edit();
  await advance('integration-passed');
  await editing('actor').fill('Note Reviewer');
  await editing('review-report').fill('Integrated draft checks passed.');
  await save();
  await edit();
  await advance('handtest');
  await save();
  await edit();
  await advance('done');
  await editing('handtest-source').fill('User confirmed retry on the integrated version.');
  await save();
  await inspector.getByText('User confirmed retry on the integrated version.', {exact:false}).waitFor();
  assert.equal(savedDraft().status, 'done');
  assert.equal(savedDraft().integrationReview?.commit, 'b'.repeat(40));
  assert.equal(savedDraft().userAcceptance?.commit, 'b'.repeat(40));
  await page.locator('.toast').evaluateAll(els=>els.forEach(el=>el.remove()));await page.screenshot({path:'artifacts/tasks-zh.png',fullPage:true});
  await page.locator('#settings-button').click();
  await page.locator('#settings-form').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#dev-map-open').click();
  const before=await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  await page.locator('#zoom-in').click();
  const zoomed=await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  assert.notEqual(before,zoomed);
  await instance.runtime.scan(true);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform),zoomed);
  // Single clicks inspect nodes; double clicks drill down and keyboard users use the explicit entry button.
  assert.equal(await page.locator('[data-node]').count(), 4);
  assert.equal(await page.locator('[data-node="note-router"]').count(), 0);
  assert.equal(await page.locator('.edge').count(), 1);
  await page.locator('[data-node="platform"]').click();
  await page.locator('#selection').getByRole('heading', {name:'Note platform', exact:true}).waitFor();
  assert.equal(await page.locator('[data-node]').count(), 4, 'single click keeps the current canvas');
  assert.equal((await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform)).match(/scale\([^)]+\)/)?.[0],zoomed.match(/scale\([^)]+\)/)?.[0]);
  const parentCard = await page.locator('[data-node="platform"]').boundingBox();
  assert.ok(parentCard);
  await page.mouse.move(parentCard.x + parentCard.width / 2, parentCard.y + parentCard.height / 2);
  await page.mouse.down();
  await page.mouse.move(parentCard.x + parentCard.width / 2 + 20, parentCard.y + parentCard.height / 2 + 10, {steps:3});
  await page.mouse.up();
  await page.locator('[data-node="platform"]').click();
  assert.equal(await page.locator('[data-node]').count(),4,'drag cancels the double-click sequence');
  const parentView = await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  await page.waitForTimeout(550);
  await page.locator('[data-node="platform"]').dblclick();
  await page.locator('#map-breadcrumbs [aria-current="page"]').filter({hasText:'Note platform'}).waitFor();
  assert.equal(await page.locator('[data-node]').count(), 2);
  assert.equal(await page.locator('[data-node="editor"]').count(), 0);
  assert.equal(await page.locator('.edge').count(), 1);
  await page.locator('#zoom-in').click();
  const internalView = await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  await page.locator('[data-node="note-router"]').click();
  await page.locator('#selection').getByRole('heading', {name:'Note router', exact:true}).waitFor();
  await page.locator('[data-node="note-router"]').dblclick();
  assert.equal(await page.locator('[data-node]').count(),2,'double-clicking a leaf does not navigate');
  await page.locator('#show-selected-files').click();
  assert.equal(await page.locator('#tab-folders').getAttribute('aria-selected'), 'true');
  await page.locator('#tab-updates').click();
  await page.locator('[data-node="note-store"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#selection').getByRole('heading', {name:'Note store', exact:true}).waitFor();
  assert.equal(await page.locator('[data-node]').count(), 2, 'keyboard activation only selects');
  await page.locator('#enter-module').click();
  await page.locator('[data-node="note-cache"]').waitFor();
  assert.equal(await page.locator('[data-node]').count(), 1);
  assert.equal(await page.locator('#map-breadcrumbs li').count(), 3);
  await page.locator('[data-map-scope="platform"]').click();
  assert.equal(await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform), internalView);
  await instance.runtime.scan(true);
  await page.locator('#language-button').click();
  await page.getByRole('button', {name:'← Back', exact:true}).waitFor();
  assert.equal(await page.locator('[data-node]').count(), 2);
  await page.screenshot({path:'artifacts/drilldown-en.png',fullPage:true});
  await page.locator('#map-up').click();
  assert.equal(await page.locator('[data-node]').count(), 4);
  assert.equal(await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform), parentView);
  await page.locator('[data-node="platform"]').dblclick();
  await page.locator('#language-button').click();
  await page.getByRole('button', {name:'← 返回上层', exact:true}).waitFor();
  await page.screenshot({path:'artifacts/drilldown-zh.png',fullPage:true});
  await page.locator('[data-map-scope=""]').click();
  assert.equal(await page.locator('[data-node]').count(), 4);
  // An analysis refresh removing the open parent returns to a reachable main map.
  await page.locator('[data-node="platform"]').dblclick();
  await importAnalysis(root, {schemaVersion: 1, inputId: readSnapshot(root)!.id,
    modules: groups.filter(m=>!['platform','note-router','note-store','note-cache'].includes(m.id)),
    edges: [], journeys: []});
  instance.runtime.emit();
  await page.locator('#map-up').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-node]').count(), 3);
  assert.deepEqual(failures,[]);
  console.log('Browser smoke passed: original canvas/sidebar, journeys, parallel dependency groups, task creation, bilingual UI, exact file auto-scroll/focus, viewport retention, nested drill-down, bilingual breadcrumbs, parent removal and return viewport restoration.');
} finally {
  await browser.close();
  instance.close();
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(temp, { recursive: true, force: true });
}
