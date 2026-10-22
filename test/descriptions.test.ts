import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJava, digest } from "../src/java/parser.ts";
import { Runtime } from "../src/runtime.ts";
import { defaultConfig, saveConfig, readSnapshot, saveSnapshot } from "../src/store.ts";
import { readDescriptions, updateDescription, withDescriptions } from "../src/descriptions.ts";
import { serve } from "../src/server.ts";

test("lexer documentation associates Javadoc, line and block comments with exact declarations", () => {
  const source = `package demo;
/** 资源管理。<p>提供资源分配与回收。</p>
 * @feature 资源管理
 * @author someone
 */
@Service public class ResourceService {
  /** 分配 {@code Resource}。
   * @param name 资源名
   * @return 资源
   */
  public void allocate(String name) {}
  // 归还资源。
  // 释放占用。
  void release() {}
  String fake = "/** 不属于方法的假注释 */";
  /* 字段说明 */ Object field;
  void undocumented() { /* 内部说明 */ }
  /** 辅助契约。 */
  public static class Helper {}
}
/* 方法功能入口。 */
class Query {
 /** 查询运行状态。
  * @功能 运行查询
  */
 void find() {}
}`;
  const facts = parseJava("src/demo/ResourceService.java", digest(source), source);
  const owner = facts.types.find(t => t.name === "ResourceService")!;
  assert.equal(owner.doc?.feature, "资源管理");
  assert.equal(owner.doc?.line, 2);
  assert.match(owner.doc!.summary, /提供资源分配与回收/);
  assert.ok(!owner.doc!.summary.includes("author"));
  assert.equal(owner.methods[0].doc?.summary, "分配 Resource。");
  assert.equal(owner.methods[0].doc?.line, 7);
  assert.equal(owner.methods[1].doc?.summary, "归还资源。\n释放占用。");
  assert.equal(owner.methods[2].doc, undefined);
  assert.equal(facts.types.find(t => t.name === "Helper")?.doc?.summary, "辅助契约。");
  assert.equal(facts.types.find(t => t.name === "Query")?.methods[0].doc?.feature, "运行查询");
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-description-"));
  fs.mkdirSync(path.join(root, "src"));
  const file = path.join(root, "src/Store.java");
  fs.writeFileSync(file, `package demo;
/** 资源管理。负责资源登记与回收。 */
public class Store {
 /** 登记资源。 */
 public void register() {}
}`);
  const c = defaultConfig();
  c.java = {enabled:true, roots:["src"], features:[]};
  saveConfig(root, c);
  return {root, file};
}

test("plain comments infer features, refresh descriptions and retain independent manual edits with reset and source isolation", async () => {
  const {root, file} = fixture();
  const runtime = new Runtime(root);
  try {
    await runtime.scan(true);
    const first = readSnapshot(root)!;
    const feature = first.modules.find(m => m.level === "feature")!;
    const owner = first.modules.find(m => m.symbol === "demo.Store")!;
    const method = first.modules.find(m => m.symbol === "demo.Store#register()")!;
    assert.equal(feature.name, "资源管理");
    assert.match(feature.description, /资源登记与回收/);
    assert.equal(owner.descriptionOrigin, "source-comment");
    assert.equal(method.description, "登记资源。");
    assert.equal(method.descriptionEvidence![0].line, 4);
    const remote = {...first, source:{...first.source, kind:"remote" as const}};
    saveSnapshot(root, remote);
    const edits = updateDescription(root, {source:"local", moduleId:method.id, revision:0, description:"手动说明 <script>"});
    assert.equal(withDescriptions(first, edits)!.modules.find(m => m.id === method.id)!.description, "手动说明 <script>");
    assert.equal(withDescriptions(remote, edits)!.modules.find(m => m.id === method.id)!.description, "登记资源。");
    assert.throws(() => updateDescription(root,{source:"local",moduleId:method.id,revision:0,description:"stale"}), /another view/);
    assert.throws(() => updateDescription(root,{source:"other",moduleId:method.id,revision:1,description:"bad"}), /Invalid/);
    assert.throws(() => updateDescription(root,{source:"local",moduleId:"missing",revision:1,description:"bad"}), /no longer exists/);
    assert.throws(() => updateDescription(root,{source:"local",moduleId:method.id,revision:1,description:"x".repeat(12001)}), /Invalid/);
    // Only the method comment changes; stable IDs, fingerprints and automatic content refresh.
    fs.writeFileSync(file, fs.readFileSync(file,"utf8").replace("登记资源。", "登记资源并记录凭据。"));
    await runtime.scan(true);
    const latest = readSnapshot(root)!;
    assert.ok(latest.java!.changes.changed.some(m => m.id === method.id));
    const edited = withDescriptions(latest, readDescriptions(root))!.modules.find(m => m.id === method.id)!;
    assert.equal(edited.description, "手动说明 <script>");
    assert.equal(edited.automaticDescription, "登记资源并记录凭据。");
    assert.equal(latest.modules.find(m => m.id === method.id)!.descriptionOrigin, "source-comment");
    const reset = updateDescription(root,{source:"local",moduleId:method.id,revision:1,description:null});
    assert.equal(withDescriptions(latest, reset)!.modules.find(m => m.id === method.id)!.description,"登记资源并记录凭据。");
  } finally { await runtime.close(); fs.rmSync(root,{recursive:true,force:true}); }
});

test("method feature comments create inferred capabilities without a hand-maintained graph", async () => {
  const {root,file} = fixture();
  try {
    fs.writeFileSync(file, `package demo; class Store {
      /** 查询运行状态。
       * @feature 运行查询
       */
      void query() {}
    }`);
    await new Runtime(root).scan(true);
    const s = readSnapshot(root)!;
    assert.equal(s.modules.find(m => m.level === "feature")!.name, "运行查询");
    assert.equal(s.modules.find(m => m.level === "feature")!.description, "查询运行状态。");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test("responsibility HTTP edits require authorization, persist separately and validate revisions", async () => {
  const {root} = fixture();
  const app = await serve(root, 0);
  try {
    const node = readSnapshot(root)!.modules.find(m => m.symbol === "demo.Store")!;
    const page = await fetch(app.url);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const body = {source:"local",moduleId:node.id,revision:0,description:"人工职责"};
    const post = (headers: Record<string,string>, data: unknown) => fetch(app.url+"/api/descriptions", {method:"POST", headers:{"content-type":"application/json",...headers},body:JSON.stringify(data)});
    assert.equal((await post({},body)).status,403);
    assert.equal((await post({cookie,origin:"https://outside.example"},body)).status,403);
    assert.equal((await post({cookie},body)).status,200);
    const state = await (await fetch(app.url+"/api/state")).json();
    assert.equal(state.descriptionRevision,1);
    assert.equal(state.local.modules.find((m: {id:string}) => m.id===node.id).description,"人工职责");
    assert.equal(readSnapshot(root)!.modules.find(m=>m.id===node.id)!.description,node.description);
    assert.equal((await post({cookie},body)).status,400);
    assert.equal((await post({cookie},{...body,revision:1,description:null})).status,200);
  } finally {await app.close(); fs.rmSync(root,{recursive:true,force:true});}
});
