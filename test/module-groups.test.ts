import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../src/runtime.ts";
import { defaultConfig, saveConfig, readSnapshot } from "../src/store.ts";
import { withModuleGroups } from "../src/module-groups.ts";
import { serve } from "../src/server.ts";

test("homepage categories survive source refresh and HTTP projection without changing source hierarchy", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nativue-groups-"));
  const config=defaultConfig();
  config.java={enabled:true,roots:["src"],features:[{id:"notes",name:"Notes",seeds:["notes.Editor"]}]};
  fs.mkdirSync(path.join(root,"src"));
  const file=path.join(root,"src/Editor.java");
  fs.writeFileSync(file,"package notes; public class Editor {public void save(){}}\n");
  saveConfig(root,config);
  const runtime=new Runtime(root);
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    await runtime.scan(true);
    const before=readSnapshot(root)!;
    const anchor=before.modules.find(m=>!m.parentId)!;
    const child=before.modules.find(m=>m.level==="class")!;
    config.moduleGroups=[{id:"experimental",name:"Design architecture",description:"Under implementation",moduleIds:[anchor.id,child.id,"future-module"]}];
    saveConfig(root,config);
    fs.appendFileSync(file,"// updated source\n");
    await runtime.scan(true);
    const raw=readSnapshot(root)!;
    const projected=withModuleGroups(raw,config.moduleGroups)!;
    assert.equal(projected.modules.find(m=>m.id===anchor.id)!.kind,"experimental");
    assert.equal(raw.modules.find(m=>m.id===anchor.id)!.kind,"application");
    assert.equal(projected.modules.find(m=>m.id===child.id)!.kind,child.kind);
    assert.deepEqual(projected.modules.map(m=>[m.id,m.parentId]),raw.modules.map(m=>[m.id,m.parentId]));
    assert.deepEqual(projected.edges,raw.edges);
    assert.equal(withModuleGroups(null,config.moduleGroups),null);
    assert.equal(withModuleGroups(raw,undefined),raw);
    await runtime.close();
    server=await serve(root,0);
    const state=await (await fetch(server.url+"/api/state")).json();
    assert.equal(state.local.modules.find((m:{id:string})=>m.id===anchor.id).kind,"experimental");
    assert.deepEqual(state.config.moduleGroups,config.moduleGroups);
    assert.equal(readSnapshot(root)!.modules.find(m=>m.id===anchor.id)!.kind,"application");
  } finally {
    server?.close();await runtime.close();fs.rmSync(root,{recursive:true,force:true});
  }
});

test("homepage categories reject conflicting membership and malformed definitions", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nativue-groups-validation-"));
  const c=defaultConfig(),group={id:"experimental",name:"Design",moduleIds:["notes"]};
  try {
    for(const groups of [[group,group],[{...group,moduleIds:["notes","notes"]}],
      [group,{...group,id:"other"}],[{...group,name:" "}],[{...group,id:"Invalid ID"}],
      [{...group,moduleIds:[]}],[{...group,description:"x".repeat(301)}]]) {
      c.moduleGroups=groups;assert.throws(()=>saveConfig(root,c),/module group/);
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
