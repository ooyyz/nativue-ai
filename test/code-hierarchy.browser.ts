import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig, saveConfig, readSnapshot, saveSnapshot } from "../src/store.ts";
import { serve } from "../src/server.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(),"nativue-hierarchy-"));
const files = {
  "NotebookProjectionDomainService.java": "package demo; public interface NotebookProjectionDomainService {void apply();}",
  "NotebookProjectionDomainServiceImpl.java": "package demo; public class NotebookProjectionDomainServiceImpl implements NotebookProjectionDomainService {public void apply(){} enum Status {READY,DONE} static class LocalState {enum Phase {IDLE} void reset(){}}}",
  "RemoteProjection.java": "package demo; public class RemoteProjection implements NotebookProjectionDomainService {public void apply(){}}",
  "Independent.java": "package demo; public class Independent {void run(){}}",
};
for (const [name,source] of Object.entries(files)) fs.writeFileSync(path.join(root,name),source);
const config = defaultConfig();
config.language = "zh";
config.java = {enabled:true,roots:[],features:[
  {id:"projection",name:"投影事件",seeds:["demo.Notebook*","demo.Remote*"]},
  {id:"independent",name:"独立功能",seeds:["demo.Independent"]},
]};
saveConfig(root,config);
const server = await serve(root,0);
const browser = await chromium.launch({channel:process.env.CI ? undefined : "chrome",headless:true});
const page = await browser.newPage({viewport:{width:1500,height:1100}});
const errors: string[] = [];
page.setDefaultTimeout(10000);
page.on("pageerror", error => errors.push(error.message));
try {
  const snapshot = readSnapshot(root)!;
  const find = (symbol: string) => snapshot.modules.find(m => m.symbol === `demo.${symbol}`)!;
  const service = find("NotebookProjectionDomainService"), impl = find("NotebookProjectionDomainServiceImpl"), status = find("NotebookProjectionDomainServiceImpl.Status");
  const local = find("NotebookProjectionDomainServiceImpl.LocalState"), phase = find("NotebookProjectionDomainServiceImpl.LocalState.Phase");
  assert.equal(status.typeKind,"enum");
  assert.equal(status.declaringTypeId,impl.id);
  assert.equal(phase.declaringTypeId,local.id);
  const feature = snapshot.modules.find(m => m.id === impl.parentId)!;
  const independent = find("Independent");
  const step = (id: string) => ({moduleId:id,label:"检查 "+id,evidence:service.evidence});
  saveSnapshot(root,{...snapshot,journeys:[
    {id:"other",name:"独立旅程",description:"另一个功能的旅程",confidence:"inferred",steps:[step(independent.id)]},
    {id:"projection",name:"投影旅程",description:"跨功能的源码推演",confidence:"inferred",steps:[step(service.id),step(independent.id),step(impl.id)]},
  ]});
  await page.goto(server.url);
  await page.locator(`[data-node="${feature.parentId}"]`).dblclick();
  await page.locator(`[data-node="${feature.id}"]`).dblclick();
  const node = (id: string) => page.locator(`[data-node="${id}"]`);
  const position = (id: string) => node(id).evaluate(el => ({x:parseFloat((el as HTMLElement).style.left),y:parseFloat((el as HTMLElement).style.top)}));
  for (const id of [service.id,impl.id]) {
    const size = await node(id).locator(".node-title").evaluate(el => ({content:el.scrollHeight, visible:el.clientHeight}));
    assert.ok(size.content <= size.visible + 1, `long service names remain readable: ${JSON.stringify(size)}`);
  }
  const a = await position(service.id), b = await position(impl.id), c = await position(status.id);
  assert.ok(b.y>a.y && b.x>a.x);
  assert.ok(c.y>b.y && c.x>b.x);
  await node(impl.id).getByText("实现 NotebookProjectionDomainService",{exact:false}).waitFor();
  await node(status.id).getByText("内部类型，属于 NotebookProjectionDomainServiceImpl",{exact:false}).waitFor();
  assert.equal(await page.locator(".type-family").count(),1);
  assert.equal(await page.locator(".containment").count(),3);
  const boxes = await page.locator(".type-node").evaluateAll(nodes => nodes.map(el => {const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y,"cards must not overlap");
  }
  await node(impl.id).focus();
  await page.keyboard.press("Alt+ArrowRight");
  const moved = await position(impl.id);
  assert.equal(moved.x,b.x+15);
  await page.reload();
  await node(impl.id).waitFor();
  assert.deepEqual(await position(impl.id),moved,"manual position survives reload");
  const requests = path.join(root,".nativue","layout-requests.json");
  fs.writeFileSync(requests,JSON.stringify({remote:{[feature.id]:"v1"}}));
  await page.reload();
  await node(impl.id).waitFor();
  assert.deepEqual(await position(impl.id),moved,"remote requests do not affect local layout");
  await page.locator("#map-up").click();
  await node(independent.parentId!).dblclick();
  await node(independent.id).focus();
  await page.keyboard.press("Alt+ArrowRight");
  const otherMoved = await position(independent.id);
  await page.locator("#map-up").click();
  await node(feature.id).dblclick();
  fs.writeFileSync(requests,JSON.stringify({local:{[feature.id]:"v1"}}));
  await page.reload();
  await node(impl.id).waitFor();
  assert.deepEqual(await position(impl.id),b,"workspace request arranges the selected scope");
  await node(impl.id).focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.reload();
  await node(impl.id).waitFor();
  assert.deepEqual(await position(impl.id),moved,"one-time request preserves subsequent manual layout");
  await page.locator("#map-up").click();
  await node(independent.parentId!).dblclick();
  assert.deepEqual(await position(independent.id),otherMoved,"other feature layout is preserved");
  await page.locator("#map-up").click();
  await node(feature.id).dblclick();
  await page.locator("#arrange-code").click();
  assert.deepEqual(await position(impl.id),b);
  await page.locator("#module-search").fill("Status");
  assert.equal(await page.locator(".type-node").count(),1);
  await node(status.id).getByText("内部类型，属于 NotebookProjectionDomainServiceImpl",{exact:false}).waitFor();
  await page.locator("#module-search").fill("");
  await page.locator("#fit").click();
  await node(local.id).click();
  await page.locator(".type-relationships").getByText("内部类型，属于 · NotebookProjectionDomainServiceImpl",{exact:false}).waitFor();
  await page.locator(".type-relationships [data-symbol-target]").click();
  await node(impl.id).waitFor();
  await page.locator("#language-button").click();
  await node(impl.id).getByText("Implements NotebookProjectionDomainService",{exact:false}).waitFor();
  await page.locator("#language-button").click();
  await page.locator("#arrange-code").click();
  await page.locator("#tab-journeys").click();
  assert.equal(await page.locator("#journey-picker").inputValue(),"projection","journey defaults to current feature");
  await page.locator('[data-step="0"]').click();
  await node(service.id).waitFor();
  await page.locator("#journey-all").click();
  await node(feature.id).waitFor();
  await node(independent.parentId!).waitFor();
  assert.equal(await node(feature.parentId!).count(),0,"entire journey stays inside common architecture");
  await page.locator('[data-step="2"]').click();
  await node(impl.id).waitFor();
  if (process.env.NATIVUE_SCREENSHOT) await page.screenshot({path:process.env.NATIVUE_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log("Code hierarchy browser passed: nested metadata, families, no overlap, scoped one-time arrangement, manual persistence, journey navigation, search, owner navigation and bilingual labels.");
} catch (error) {
  await page.screenshot({path:"/tmp/nativue-hierarchy-failure.png"});
  console.error(await page.locator("#selection").innerText());
  throw error;
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(root,{recursive:true,force:true});
}
