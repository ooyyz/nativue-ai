import test from "node:test";
import assert from "node:assert/strict";
import type { Edge, Module } from "../src/types.ts";
import { codeHierarchy } from "../web/code-hierarchy.ts";

const type = (id: string, owner?: string): Module => ({id, name:id, symbol:`demo.${id}`, level:"class",
  generator:"java", declaringTypeId:owner, kind:"shared", description:"", files:[], evidence:[], confidence:"observed"});
const edge = (from: string, to: string, relation: Edge["relation"] = "implements"): Edge =>
  ({id:`${from}-${to}`, from, to, relation, label:"", confidence:"observed", evidence:[]});

test("contracts, multiple implementations and nested declarations form contiguous families without overlaps", () => {
  const modules = [type("Other"), type("ServiceImpl"), type("Status","ServiceImpl"), type("Service"), type("RemoteImpl")];
  const edges = [edge("ServiceImpl","Service"), edge("RemoteImpl","Service")];
  const layout = codeHierarchy(modules, edges, 2);
  assert.deepEqual(new Set(layout.families.find(f => f.root === "Service")!.members),
    new Set(["Service","ServiceImpl","RemoteImpl","Status"]));
  const root = layout.positions.get("Service")!, impl = layout.positions.get("ServiceImpl")!, nested = layout.positions.get("Status")!;
  assert.ok(impl.y > root.y && impl.x > root.x);
  assert.ok(nested.y > impl.y && nested.x > impl.x);
  for (const [id, a] of layout.positions) for (const [other, b] of layout.positions) {
    if (id !== other) assert.ok(a.x+316 <= b.x || b.x+316 <= a.x || a.y+154 <= b.y || b.y+154 <= a.y);
  }
  assert.deepEqual(codeHierarchy([...modules].reverse(), [...edges].reverse(),2),layout);
});

test("containment takes precedence; multiple interfaces do not duplicate nodes; missing parents stay visible", () => {
  const modules = [type("Owner"),type("Nested","Owner"),type("PortA"),type("PortB"),type("ExternalNested","missing"),type("PortAImpl")];
  const layout = codeHierarchy(modules,[edge("Nested","PortA"),edge("Nested","PortB")]);
  assert.deepEqual(layout.parents.get("Nested"),{parent:"Owner",relation:"contains"});
  assert.equal(layout.positions.size,modules.length);
  assert.ok(layout.families.some(f => f.root === "ExternalNested"));
  assert.ok(layout.families.some(f => f.root === "PortAImpl"),"names alone must not imply implementation");
  const multiple = codeHierarchy(modules,[edge("PortAImpl","PortB"),edge("PortAImpl","PortA")]);
  assert.equal(multiple.parents.get("PortAImpl")?.parent,"PortA");
  assert.equal(multiple.positions.size,modules.length);
});

test("inheritance chains and malformed cycles terminate without hiding nodes", () => {
  const modules = [type("A"),type("B"),type("C")];
  const layout = codeHierarchy(modules,[edge("B","A","extends"),edge("C","B","extends"),edge("A","C","extends")]);
  assert.equal(layout.positions.size,3);
  assert.equal(layout.parents.size,2);
  assert.equal(codeHierarchy([type("A","B"),type("B","A")],[]).positions.size,2);
});

test("a contract's nested enum does not separate the contract from its implementation", () => {
  const layout = codeHierarchy([type("Port"),type("Port.Result","Port"),type("PortImpl")],[edge("PortImpl","Port")]);
  assert.deepEqual(layout.families[0].members,["Port","PortImpl","Port.Result"]);
});
