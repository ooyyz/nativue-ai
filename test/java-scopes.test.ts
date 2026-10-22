import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Runtime } from "../src/runtime.ts";
import { defaultConfig, saveConfig, readConfig, readSnapshot } from "../src/store.ts";
import { updateDescription, readDescriptions, withDescriptions } from "../src/descriptions.ts";
import { updateArchitectureEdit, readArchitectureEdits, withArchitectureEdits } from "../src/architecture-edits.ts";

async function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"nativue-java-scopes-"));
  for(const [p,source] of Object.entries({
    "alpha/src/main/java/demo/Alpha.java":"package demo; public class Alpha {public void check(){}}",
    "beta/src/main/java/demo/Beta.java":"package demo; public class Beta extends Alpha {public void run(){check();}}",
    "beta/src/test/java/demo/IgnoreTest.java":"package demo; class IgnoreTest {}",
  })) {
    fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});
    fs.writeFileSync(path.join(root,p),source);
  }
  const c=defaultConfig();
  c.java={enabled:true,roots:["alpha/src/main"],features:[{id:"logic",name:"Alpha capability",seeds:["demo.Alpha"]}]};
  saveConfig(root,c);
  const runtime=new Runtime(root);await runtime.scan(true);
  return {root,runtime};
}
test("additional scopes retain existing IDs and edits, create independent roots and resolve cross-scope source calls",async()=>{
  const {root,runtime}=await fixture();
  try {
    const before=readSnapshot(root)!;
    const alpha=before.modules.find(m=>m.symbol==="demo.Alpha")!;
    const firstFeature=before.modules.find(m=>m.level==="feature")!;
    updateDescription(root,{source:"local",moduleId:alpha.id,revision:0,description:"Keep this explanation"});
    updateArchitectureEdit(root,{source:"local",moduleId:firstFeature.id,field:"name",value:"Keep this name",revision:0});
    const c=readConfig(root);
    c.java!.scopes=[{id:"beta",name:"Beta module",roots:["beta/src/main"],features:[{id:"logic",name:"Beta capability",seeds:["demo.Beta"]}]}];
    saveConfig(root,c);await runtime.scan(true);
    const added=readSnapshot(root)!;
    assert.equal(added.java!.status,"complete");
    assert.equal(added.java!.parsedFiles,1);
    assert.equal(added.java!.reusedFiles,1);
    const moduleRoot = added.modules.find(m=>m.name==="Beta module" && !m.parentId)!;
    assert.equal(moduleRoot.kind,"application");
    assert.ok(!added.modules.some(m=>m.kind==="directory" && m.files.some(f=>f.startsWith("beta/src/main/"))));
    assert.equal(added.modules.find(m=>m.id===alpha.id)!.parentId,alpha.parentId);
    assert.ok(!added.modules.some(m=>m.symbol?.includes("IgnoreTest")));
    const beta=added.modules.find(m=>m.symbol==="demo.Beta")!;
    assert.notEqual(beta.parentId,alpha.parentId);
    assert.ok(added.edges.some(e=>e.relation==="extends" && e.from===beta.id && e.to===alpha.id));
    assert.ok(added.edges.some(e=>e.relation==="calls" && e.label.includes("demo.Alpha#check()")));
    const view=withDescriptions(withArchitectureEdits(added,readArchitectureEdits(root)),readDescriptions(root))!;
    assert.equal(view.modules.find(m=>m.id===alpha.id)!.description,"Keep this explanation");
    assert.equal(view.modules.find(m=>m.id===firstFeature.id)!.name,"Keep this name");
    assert.ok(!added.java!.changes.changed.some(m=>m.id===alpha.id));
    // Root classification survives rescanning without changing the source hierarchy.
    c.java!.scopes[0].kind="backend";saveConfig(root,c);await runtime.scan(true);
    const regrouped=readSnapshot(root)!;
    assert.equal(regrouped.java!.parsedFiles,0);
    assert.equal(regrouped.modules.find(m=>m.id===moduleRoot.id)!.kind,"backend");
    assert.ok(!regrouped.modules.find(m=>m.id===moduleRoot.id)!.parentId);
    assert.deepEqual(regrouped.modules.map(m=>[m.id,m.parentId]),added.modules.map(m=>[m.id,m.parentId]));
    assert.ok(regrouped.java!.changes.changed.some(m=>m.id===moduleRoot.id));
    await runtime.scan(true);
    assert.equal(readSnapshot(root)!.modules.find(m=>m.id===moduleRoot.id)!.kind,"backend");
    // Removing the additional scope removes its graph and dependent links only.
    delete c.java!.scopes;saveConfig(root,c);await runtime.scan(true);
    const removed=readSnapshot(root)!;
    assert.ok(!removed.modules.some(m=>m.id===beta.id));
    assert.ok(removed.java!.changes.removed.some(m=>m.id===beta.id));
    assert.equal(removed.modules.find(m=>m.id===alpha.id)!.parentId,alpha.parentId);
  } finally {await runtime.close();fs.rmSync(root,{recursive:true,force:true});}
});
test("additional scope validation rejects overlaps, duplicate scope IDs, shared parents and unsafe roots",async()=>{
  const {root,runtime}=await fixture();
  try {
    const c=readConfig(root);
    const scope={id:"beta",name:"Beta",roots:["beta/src/main"],features:[]};
    for(const scopes of [[{...scope,roots:["../outside"]}],[{...scope,roots:["alpha"]}],[scope,scope],
      [{...scope,roots:[]}],[{...scope,name:" "}],[{...scope,kind:" "}]]) {
      c.java!.scopes=scopes;assert.throws(()=>saveConfig(root,c),/Java/);
    }
    c.java!.parentId="same";c.java!.scopes=[{...scope,parentId:"same"}];
    assert.throws(()=>saveConfig(root,c),/distinct roots and parents/);
  } finally {await runtime.close();fs.rmSync(root,{recursive:true,force:true});}
});
