import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../src/runtime.ts";
import { defaultConfig, saveConfig, readConfig, readSnapshot, saveSnapshot } from "../src/store.ts";
import { readArchitectureEdits, updateArchitectureEdit, withArchitectureEdits } from "../src/architecture-edits.ts";
import { updateDescription, readDescriptions, withDescriptions } from "../src/descriptions.ts";
import { serve } from "../src/server.ts";

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-architecture-edits-"));
  fs.mkdirSync(path.join(root,"src"));
  fs.writeFileSync(path.join(root,"src/Editor.java"), `package notes;
/** 编辑笔记。 */
class Editor {
 Store store;
 void save(){store.save();}
}`);
  fs.writeFileSync(path.join(root,"src/Store.java"), `package notes;
/** 存储笔记。 */
class Store {void save(){}}`);
  const c = defaultConfig();
  c.java = {enabled:true, roots:["src"], features:[
    {id:"editing",name:"笔记编辑",seeds:["notes.Editor"]},
    {id:"storage",name:"笔记存储",seeds:["notes.Store"]},
  ]};
  saveConfig(root,c);
  await new Runtime(root).scan(true);
  const s = readSnapshot(root)!;
  return {root, s, editor:s.modules.find(m=>m.symbol==="notes.Editor")!, store:s.modules.find(m=>m.symbol==="notes.Store")!,
    editing:s.modules.find(m=>m.name==="笔记编辑")!, storage:s.modules.find(m=>m.name==="笔记存储")!};
}
test("feature names and class memberships survive fresh analysis with latest automatic values and independent resets", async () => {
  const {root,s,editor,store,editing,storage} = await fixture();
  try {
    updateArchitectureEdit(root,{source:"local",moduleId:editing.id,field:"name",value:"人工笔记功能",revision:0});
    updateArchitectureEdit(root,{source:"local",moduleId:store.id,field:"parentId",value:editing.id,revision:1});
    updateDescription(root,{source:"local",moduleId:store.id,description:"人工存储说明",revision:0});
    const c=readConfig(root);
    c.java!.features[0].name="自动编辑新名称";
    saveConfig(root,c);
    fs.appendFileSync(path.join(root,"src/Editor.java"),"\n// source refresh\n");
    await new Runtime(root).scan(true);
    const raw=readSnapshot(root)!;
    const view=withDescriptions(withArchitectureEdits(raw,readArchitectureEdits(root)),readDescriptions(root))!;
    const manualFeature=view.modules.find(m=>m.id===editing.id)!;
    const manualClass=view.modules.find(m=>m.id===store.id)!;
    assert.equal(manualFeature.name,"人工笔记功能");
    assert.equal(manualFeature.automaticName,"自动编辑新名称");
    assert.equal(manualClass.parentId,editing.id);
    assert.equal(manualClass.automaticParentId,storage.id);
    assert.equal(manualClass.description,"人工存储说明");
    assert.equal(view.modules.find(m=>m.symbol==="notes.Store#save()")!.parentId,store.id);
    assert.deepEqual(view.edges,raw.edges);
    assert.equal(view.modules.find(m=>m.id===storage.id)!.files.length,0);
    assert.deepEqual(new Set(manualFeature.files),new Set([...editor.files,...store.files]));
    assert.equal(raw.modules.find(m=>m.id===store.id)!.parentId,storage.id);
    const remote={...raw,source:{...raw.source,kind:"remote" as const}};
    assert.equal(withArchitectureEdits(remote,readArchitectureEdits(root))!.modules.find(m=>m.id===store.id)!.parentId,storage.id);
    updateArchitectureEdit(root,{source:"local",moduleId:editing.id,field:"name",value:null,revision:2});
    const resetName=withArchitectureEdits(raw,readArchitectureEdits(root))!;
    assert.equal(resetName.modules.find(m=>m.id===editing.id)!.name,"自动编辑新名称");
    assert.equal(resetName.modules.find(m=>m.id===store.id)!.parentId,editing.id);
    updateArchitectureEdit(root,{source:"local",moduleId:store.id,field:"parentId",value:null,revision:3});
    assert.equal(withArchitectureEdits(raw,readArchitectureEdits(root))!.modules.find(m=>m.id===store.id)!.parentId,storage.id);
    assert.equal(withDescriptions(raw,readDescriptions(root))!.modules.find(m=>m.id===store.id)!.description,"人工存储说明");
    assert.equal(s.modules.find(m=>m.id===editing.id)!.name,"笔记编辑");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("architecture edits reject stale revisions, cycles, non-feature targets, cross-root moves and malformed values", async () => {
  const {root,s,editor,editing,storage} = await fixture();
  try {
    const edit={source:"local",moduleId:editor.id,field:"parentId",value:storage.id,revision:0};
    for(const bad of [{...edit,value:editor.id},{...edit,value:"missing"},{...edit,field:"name",value:"bad"},{...edit,source:"other"},{...edit,field:"parentId",value:42}])
      assert.throws(()=>updateArchitectureEdit(root,bad));
    assert.throws(()=>updateArchitectureEdit(root,{...edit,moduleId:editing.id,field:"name",value:" "}),/Invalid/);
    assert.throws(()=>updateArchitectureEdit(root,{...edit,moduleId:editing.id,field:"name",value:"x".repeat(101)}),/Invalid/);
    const other={...storage,id:"other-root-feature",parentId:"other-root"};
    saveSnapshot(root,{...s,modules:[...s.modules,{...s.modules[0],id:"other-root",parentId:undefined},other]});
    assert.throws(()=>updateArchitectureEdit(root,{...edit,value:other.id}),/same architecture/);
    updateArchitectureEdit(root,edit);
    assert.throws(()=>updateArchitectureEdit(root,edit),/another view/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("deleted targets stay dormant without dangling parents and reapply when the same feature returns", async () => {
  const {root,s,store,editing,storage} = await fixture();
  try {
    const edits=updateArchitectureEdit(root,{source:"local",moduleId:store.id,field:"parentId",value:editing.id,revision:0});
    const deleted={...s,modules:s.modules.filter(m=>m.id!==editing.id && m.symbol!=="notes.Editor" && m.symbol!=="notes.Editor#save()")};
    const pending=withArchitectureEdits(deleted,edits)!.modules.find(m=>m.id===store.id)!;
    assert.equal(pending.parentId,storage.id);
    assert.equal(pending.pendingParentId,editing.id);
    assert.equal(withArchitectureEdits(s,readArchitectureEdits(root))!.modules.find(m=>m.id===store.id)!.parentId,editing.id);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("comment-derived capability IDs survive automatic title changes", async () => {
  const {root,editor}=await fixture();
  try {
    const c=readConfig(root);c.java!.features=[];saveConfig(root,c);
    await new Runtime(root).scan(true);
    const first=readSnapshot(root)!;
    const original=first.modules.find(m=>m.id===editor.id)!.parentId;
    updateArchitectureEdit(root,{source:"local",moduleId:original,field:"name",value:"人工功能",revision:0});
    const file=path.join(root,"src/Editor.java");
    fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace("编辑笔记。","编辑与校验笔记。"));
    await new Runtime(root).scan(true);
    const latest=withArchitectureEdits(readSnapshot(root),readArchitectureEdits(root))!;
    assert.equal(latest.modules.find(m=>m.id===editor.id)!.parentId,original);
    assert.equal(latest.modules.find(m=>m.id===original)!.name,"人工功能");
    assert.equal(latest.modules.find(m=>m.id===original)!.automaticName,"编辑与校验笔记");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("architecture HTTP edits require local authorization and keep automatic snapshots intact", async () => {
  const {root,store,editing,storage}=await fixture();
  const app=await serve(root,0);
  try {
    const cookie=(await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
    const body={source:"local",moduleId:store.id,field:"parentId",value:editing.id,revision:0};
    const post=(headers:Record<string,string>,b:unknown)=>fetch(app.url+"/api/architecture-edits",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(b)});
    assert.equal((await post({},body)).status,403);
    assert.equal((await post({cookie,origin:"https://outside.example"},body)).status,403);
    assert.equal((await post({cookie},body)).status,200);
    assert.equal((await post({cookie},body)).status,400);
    const state=await(await fetch(app.url+"/api/state")).json();
    assert.equal(state.architectureRevision,1);
    assert.equal(state.local.modules.find((m:{id:string})=>m.id===store.id).parentId,editing.id);
    assert.equal(readSnapshot(root)!.modules.find(m=>m.id===store.id)!.parentId,storage.id);
    assert.equal((await post({cookie},{...body,value:null,revision:1})).status,200);
  } finally {await app.close();fs.rmSync(root,{recursive:true,force:true});}
});
