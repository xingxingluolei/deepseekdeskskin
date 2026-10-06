import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudio } from '../server.mjs';
import { reviewRuntimeSource } from '../scripts/build-tool-presentation-review.mjs';
import { createToolPresentationDemo } from '../web/tool-presentation-demo.mjs';

function fixture(t,{reduced=false}={}) {
  const prior={document:globalThis.document,matchMedia:globalThis.matchMedia};
  let time=0,serial=0;const timers=new Map(),owned=[];
  const clock={now:()=>time,schedule:(fn,ms=0)=>{const id=++serial;timers.set(id,{fn,at:time+ms});return id;},cancel:id=>timers.delete(id)};
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.listeners=new Map();this.naturalWidth=1024;this.naturalHeight=1536;this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];},getPropertyValue(k){return this[k]||'';}};}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    setAttribute(k,v){this[k]=v;}removeAttribute(k){if(k==='src')this._src='';else delete this[k];}
    set src(value){this._src=value;clock.schedule(()=>{if(this._src===value)this.onload?.();},0);}get src(){return this._src;}
    decode(){return Promise.resolve();}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    querySelectorAll(tag){return this.children.filter(child=>child.tagName===tag);}
    addEventListener(name,listener){this.listeners.set(name,listener);}removeEventListener(name){this.listeners.delete(name);}
    dispatchEvent(event){this.listeners.get(event.type)?.(event);}
  }
  globalThis.document={head:new Element('head'),body:new Element('body'),documentElement:new Element('html'),createElement:tag=>new Element(tag)};
  globalThis.matchMedia=()=>({matches:reduced});
  t.after(()=>{for(const demo of owned)demo.dispose();for(const [key,value] of Object.entries(prior)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
  async function advanceNext(){await flush();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return false;timers.delete(next[0]);time=next[1].at;next[1].fn();await flush();return true;}
  return {clock,container:new Element('section'),timers,flush,advanceNext,own:demo=>{owned.push(demo);return demo;}};
}

test('review runtime embeds the current production controller and tracker verbatim',async()=>{
  assert.equal(await readFile(new URL('../web/tool-presentation-runtime.mjs',import.meta.url),'utf8'),reviewRuntimeSource());
});

for(const decodeDelayMs of [0,650])test(`manual demo keeps 20ms Read for 900ms after real renderer acknowledgment (${decodeDelayMs}ms decode delay)`,async t=>{
  const f=fixture(t),demo=f.own(createToolPresentationDemo(f.container,{...f.clock,decodeDelayMs}));
  const complete=demo.run();
  for(let i=0;i<30 && demo.snapshot().status==='running';i++)assert.ok(await f.advanceNext(),'a running review needs an outstanding real timer');
  const result=await complete;
  assert.equal(result.status,'done');assert.equal(result.times.readResult-result.times.readCall,20);
  assert.equal(result.times.readAcknowledged-result.times.readCall,840+decodeDelayMs,'previous fade, optional decode delay and Read fade precede the receipt');
  assert.equal(result.times.thinkingRequested-result.times.readAcknowledged,900);
  assert.equal(result.visibleHoldMs,900);assert.equal(result.passed,true);
  assert.equal(result.times.thinkingPresented-result.times.thinkingRequested,420);
  assert.ok(result.events.some(row=>row.event.includes('Read result')&&row.activity==='thinking'&&row.visual==='reading'));
  assert.equal(result.activity,'thinking');assert.equal(result.visual,'thinking');
  demo.dispose();assert.equal(f.timers.size,0,'review cleanup releases the watchdog and controller timers');
});

test('reset during queued Read cancels the run and no old callback can publish a successful result',async t=>{
  const f=fixture(t),updates=[],demo=f.own(createToolPresentationDemo(f.container,{...f.clock,onChange:value=>updates.push(value)}));
  const complete=demo.run();
  for(let i=0;i<10 && demo.snapshot().times.readResult===undefined;i++)await f.advanceNext();
  assert.equal(demo.snapshot().activity,'thinking');assert.equal(demo.snapshot().visual,'reading');
  demo.dispose();const count=updates.length;assert.equal((await complete).status,'cancelled');
  while(await f.advanceNext()){}
  assert.equal(updates.length,count);assert.equal(demo.snapshot().passed,null);assert.equal(f.container.children.length,0);
});

test('review reports reduced-motion exclusion instead of inventing a hold timer',async t=>{
  const f=fixture(t,{reduced:true}),demo=f.own(createToolPresentationDemo(f.container,f.clock));
  const result=await demo.run();assert.equal(result.status,'error');assert.match(result.message,/减少动态/);assert.equal(result.times.readCall,undefined);assert.equal(result.passed,null);
});


test('the review page and every module are served by existing local routes without settings writes',async t=>{
  const home=await mkdtemp(join(tmpdir(),'dss-tool-review-')),server=await createStudio({home});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(home,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['/web/tool-presentation-review.html','/web/tool-presentation-review.css','/web/tool-presentation-review.mjs','/web/tool-presentation-demo.mjs','/web/tool-presentation-runtime.mjs','/src/visual.mjs','/src/skin.mjs','/src/portrait-framing.mjs','/src/action-focus.mjs']) {
    const response=await fetch(base+route);assert.equal(response.status,200,route);
    if(route.endsWith('.mjs'))assert.equal(response.headers.get('content-type'),'text/javascript',route);
    assert.ok((await response.text()).length>0,route);
  }
  await assert.rejects(readFile(join(home,'settings.json')),error=>error.code==='ENOENT');
});
