import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultConfig,saveConfig,readSnapshot,saveSnapshot} from '../src/store.ts';
import {Runtime} from '../src/runtime.ts';
import {serve} from '../src/server.ts';
import type {Module} from '../src/types.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nativue-drag-'));
fs.writeFileSync(path.join(root,'notes.ts'),'export const notes = [];\n');
saveConfig(root,defaultConfig());
await new Runtime(root).scan(true);
const s=readSnapshot(root)!;
const modules:Module[]=Array.from({length:45},(_,i)=>({id:`note-${i}`,name:`Note component ${i}`,kind:['frontend','backend','shared'][Math.floor(i/15)],description:'Fictional note component.',files:['notes.ts'],evidence:[{path:'notes.ts',line:1}],confidence:'observed'}));
saveSnapshot(root,{...s,modules,edges:modules.slice(1).map((m,i)=>({id:`edge-${i}`,from:modules[i].id,to:m.id,label:'Note dependency',evidence:m.evidence,confidence:'observed'})),journeys:[]});
const server=await serve(root,0);
const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}});
page.setDefaultTimeout(10000);
const errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
const rect=(selector:string)=>page.locator(selector).evaluate(el=>{
  const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
});
const near=(a:number,b:number,message:string)=>assert.ok(Math.abs(a-b)<2,`${message}: ${a} versus ${b}`);
const tick=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
const track=()=>page.evaluate(()=>{
  const w=window as any;
  w.dragWorld=document.querySelector('#world');w.dragNode=document.querySelector('[data-node="note-0"]');w.layoutWrites=0;
  if(!w.originalSetItem){w.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('nativue-layout:'))w.layoutWrites++;return w.originalSetItem.call(this,k,v);};}
});
try{
  await page.goto(server.url);
  await page.locator('[data-node="note-0"]').waitFor();
  await tick();
  const originalGroupWidth=await page.locator('[data-group-box="backend"]').evaluate(el=>(el as HTMLElement).offsetWidth);
  // Older layouts save absolute node positions without the parent group origin.
  await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.startsWith('nativue-layout:'))!;
    const saved=JSON.parse(localStorage.getItem(key)!);
    const location=saved.locations.find(([id]:[string])=>id==='')[1];
    location.groups=[];
    location.nodes=[...document.querySelectorAll<HTMLElement>('[data-node]')].map(el=>{
      const g=el.closest<HTMLElement>('[data-group-box]')!;
      return [el.dataset.node,{x:g.offsetLeft+el.offsetLeft,y:g.offsetTop+el.offsetTop}];
    });
    localStorage.setItem(key,JSON.stringify(saved));
  });
  await page.reload();
  assert.equal(await page.locator('[data-group-box="backend"]').evaluate(el=>(el as HTMLElement).offsetWidth),originalGroupWidth,'legacy absolute positions must not inflate group width');
  await page.locator('[data-node="note-0"]').click();
  await page.locator('#focus').click();
  // Screen-space displacement must remain 1:1 with the pointer at all zoom levels.
  for(const zoom of ['small','normal','large']){
    await page.locator('#focus').click();
    for(let i=0;i<(zoom==='small'?4:zoom==='large'?2:0);i++)await page.locator(zoom==='small'?'#zoom-out':'#zoom-in').click();
    const before=await rect('[data-node="note-0"]');
    const sibling=await rect('[data-node="note-15"]');
    const edgeBefore=await page.locator('path[data-from="note-0"]').getAttribute('d');
    await track();
    await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
    await page.mouse.down();
    for(let i=1;i<=8;i++){
      await page.mouse.move(before.x+before.width/2+i*10,before.y+before.height/2+i*5);
      await tick();
      if(zoom==='small' && i===4){
        const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/state'));
        server.runtime.emit();
        await (await refreshed).finished();
        await tick();
      }
      const during=await rect('[data-node="note-0"]');near(during.x-before.x,i*10,'node tracks horizontal pointer');near(during.y-before.y,i*5,'node tracks vertical pointer');
    }
    assert.notEqual(await page.locator('path[data-from="note-0"]').getAttribute('d'),edgeBefore,'connected edge follows drag');
    assert.deepEqual(await page.evaluate(()=>{const w=window as any;return [w.dragWorld===document.querySelector('#world'),w.dragNode===document.querySelector('[data-node="note-0"]'),w.layoutWrites];}),[true,true,0],'no DOM replacement or storage writes during drag');
    await page.mouse.up();
    const after=await rect('[data-node="note-0"]');near(after.x-before.x,80,'no release jump');near(after.y-before.y,40,'no release jump');
    const other=await rect('[data-node="note-15"]');near(other.x,sibling.x,'neighbor group stays fixed');near(other.y,sibling.y,'neighbor group stays fixed');
    await page.reload();
    const restored=await rect('[data-node="note-0"]');near(restored.x,after.x,'drag persists');near(restored.y,after.y,'drag persists');
  }
  // Moving a whole group moves its children once, without pushing siblings.
  await page.locator('#fit').click();
  const header=await rect('[data-drag-group="frontend"]');
  const child=await rect('[data-node="note-0"]'),other=await rect('[data-node="note-15"]');
  await track();
  await page.mouse.move(header.x+50,header.y+header.height/2);await page.mouse.down();
  await page.mouse.move(header.x+110,header.y+header.height/2+30,{steps:8});await tick();
  near((await rect('[data-node="note-0"]')).x-child.x,60,'group child tracks pointer');
  assert.equal(await page.evaluate(()=>(window as any).layoutWrites),0);
  await page.mouse.up();
  near((await rect('[data-node="note-0"]')).x-child.x,60,'group child does not move twice');
  near((await rect('[data-node="note-15"]')).x,other.x,'group drag leaves neighbor fixed');
  // Panning writes once on release; Escape cancels a node drag.
  const viewport=await rect('#viewport');
  await track();
  const origin=await rect('[data-node="note-0"]');
  await page.mouse.move(viewport.x+10,viewport.y+10);await page.mouse.down();
  await page.mouse.move(viewport.x+90,viewport.y+50,{steps:10});await tick();
  near((await rect('[data-node="note-0"]')).x-origin.x,80,'pan follows pointer');
  assert.equal(await page.evaluate(()=>(window as any).layoutWrites),0);
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>(window as any).layoutWrites),1,'save pan only on release');
  await page.locator('[data-node="note-0"]').click();await page.locator('#focus').click();
  const cancelBefore=await rect('[data-node="note-0"]');
  await page.mouse.move(cancelBefore.x+50,cancelBefore.y+50);await page.mouse.down();
  await page.mouse.move(cancelBefore.x+110,cancelBefore.y+70);await tick();
  await page.keyboard.press('Escape');await page.mouse.up();
  near((await rect('[data-node="note-0"]')).x,cancelBefore.x,'cancel restores node');
  assert.deepEqual(errors,[]);
  console.log('Drag browser passed: pointer distance at 3 zooms, stable DOM, no writes during drag, live edges, fixed neighbors, group movement, pan persistence and cancellation.');
}finally{await browser.close();await server.close();fs.rmSync(root,{recursive:true,force:true});}
