import test from 'node:test';
import assert from 'node:assert/strict';
import {installHarnessSkin} from '../adapters/harness/client.mjs';
import {createTaskGreetingPlayer} from '../src/greeting.mjs';
import {createPortraitPresence} from '../src/presence.mjs';
import {normalizeSkin, CHARACTER_SKINS} from '../src/skin.mjs';
function fixture(t,{prepare=async()=>{},mode='dynamic',reduced=false,renderResult,toolRequest}={}){
  const original=Object.fromEntries(['document','localStorage','MutationObserver','matchMedia'].map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
  const animations=[];let cameraScale=1;
  class Element {
    attributes={};children=[];style={setProperty(){}};listeners={};
    append(...els){this.children.push(...els);}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
    getBoundingClientRect(){const width=(host.children[0]?.getAttribute('data-layout-phase')==='hero'?800:640)*cameraScale;return {x:0,y:0,width,height:width*1.25};}
    animate(frames,options){const camera=options.composite==='add';if(camera)cameraScale=1.022;const a={frames,options,cancelled:false,cancel(){this.cancelled=true;if(camera)cameraScale=1;}};if(options.duration===620)a.finished=new Promise(resolve=>a.finish=resolve);animations.push(a);return a;}
    removeAttribute(k){delete this.attributes[k];}attachShadow(){return this.shadow=new Element();}remove(){}addEventListener(k,v){this.listeners[k]=v;}
  }
  const host=new Element();host.setAttribute('data-phase','hero');let observer,cleanup,subscriber,request,state='idle',controls,preference='system';
  globalThis.document={body:new Element(),head:new Element(),createElement:()=>new Element(),querySelector:()=>host};
  globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.matchMedia=()=>({matches:reduced});
  globalThis.MutationObserver=class{constructor(fn){observer=fn;}observe(){}disconnect(){}};
  const timers=new Map(),presenceTimers=new Map();let serial=0;const rendered=[],acknowledgments=[];let toolSuppressed=false;
  const frames=CHARACTER_SKINS[0].intro.map(frame=>({...frame,source:frame.key}));
  const character={isBuiltin:true,get toolPresentation(){return !toolSuppressed&&state==='reading'?toolRequest:undefined;},setToolPresentationSuppressed(value){toolSuppressed=value;},acknowledgeToolPresentation(request,shown){acknowledgments.push({request,shown});},metadata:{...CHARACTER_SKINS[0],intro:frames},update(){},get activityState(){return state;},get greetingRequest(){return request;},get greetingFrames(){return frames;},get imageSource(){return state;},subscribe(fn){subscriber=fn;return()=>{};},dispose(){}};
  const ctx={effect:fn=>{cleanup=fn();},on:()=>()=>{},theme:{getTheme:()=>({preference}),setTheme:v=>preference=v,register:()=>()=>{}}};
  installHarnessSkin(ctx,normalizeSkin({mode}),'fallback',()=>({update:(skin,source,options)=>{rendered.push({skin,source,options});return renderResult?.(source,options);},dispose(){}}),normalizeSkin,'hold',()=>character,opts=>{controls=opts;return {update(){},refreshActivity(){},dispose(){}};},fn=>createTaskGreetingPlayer(fn,{prepare,reducedMotion:()=>reduced,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id)}),fn=>createPortraitPresence(fn,{schedule:(fn,ms)=>{const id=++serial;presenceTimers.set(id,{fn,ms});return id;},cancel:id=>presenceTimers.delete(id)}));
  t.after(()=>cleanup());const wallpaper=host.children[0];
  return {host,wallpaper,rendered,acknowledgments,timers,presenceTimers,controls,animations,publish(next,req=request){state=next;request=req;subscriber();},phase(v){host.setAttribute('data-phase',v);observer();},async flush(){await Promise.resolve();await Promise.resolve();},advance(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();return timer.ms;},held(){return 'data-dss-greeting-hold' in host.attributes;}};
}
test('first conversation keeps clear hero through all 3.9 seconds, including a fast completed reply',async t=>{
 const f=fixture(t);f.phase('active');f.publish('thinking',{key:'a:first',firstTurn:true});
 assert.equal(f.held(),true);assert.equal(f.wallpaper.getAttribute('data-layout-phase'),'hero');assert.equal(f.host.getAttribute('data-phase'),'active','native truth never changes');
 await f.flush();f.advance();f.publish('complete');assert.equal(f.held(),true);
 let elapsed=280;while(f.timers.size)elapsed+=f.advance();assert.equal(elapsed,3900);
 assert.equal(f.held(),false);assert.equal(f.wallpaper.getAttribute('data-layout-phase'),'active');assert.equal(f.rendered.at(-1).source,'complete');
});
test('follow-up tasks keep full-body actions and never restart the closeup',async t=>{
 const f=fixture(t);f.phase('active');f.publish('thinking',{key:'a:2',firstTurn:false});await f.flush();assert.equal(f.held(),false);assert.equal(f.wallpaper.getAttribute('data-layout-phase'),'active');assert.equal(f.timers.size,0);assert.equal(f.rendered.at(-1).source,'thinking');assert.equal(f.rendered.at(-1).skin.fit,'contain');
});
test('permission, error and withdrawn session ownership release the presentation immediately',async t=>{
 const f=fixture(t);f.phase('active');let n=0;
 for(const state of ['error','waiting','blocked','paused','stopped','disconnected','connecting',undefined]){
   f.publish('thinking',{key:String(++n),firstTurn:true});await f.flush();assert.equal(f.held(),true);
   f.publish(state||'idle',state?{key:String(n),firstTurn:true}:undefined); // no request is passed explicitly below for withdrawal
   if(!state)f.publish('idle',null);
   assert.equal(f.held(),false,state||'session withdrawal');assert.equal(f.timers.size,0);
 }
});
test('static mode and disabling a skin never leave conversation content hidden',async t=>{
 const f=fixture(t,{mode:'static'});f.phase('active');f.publish('thinking',{key:'static',firstTurn:true});assert.equal(f.held(),false);assert.equal(f.timers.size,0);
 f.controls.onChange('mode','dynamic');f.publish('thinking',{key:'dynamic',firstTurn:true});await f.flush();assert.equal(f.held(),true);f.controls.onChange('enabled',false);assert.equal(f.held(),false);
});
test('reduced motion immediately reveals the conversation',async t=>{
 const f=fixture(t,{reduced:true});f.phase('active');f.publish('thinking',{key:'a:first',firstTurn:true});await f.flush();assert.equal(f.held(),false);assert.equal(f.timers.size,0);
});
test('image preload failure releases content and preserves the real state',async t=>{
 const f=fixture(t,{prepare:async()=>{throw Error('decode');}});f.phase('active');f.publish('working',{key:'a:first',firstTurn:true});await f.flush();assert.equal(f.held(),false);assert.equal(f.rendered.at(-1).source,'working');
});

test('after the final smile, working remains clear before the reading veil fades in',async t=>{
 const f=fixture(t);f.phase('active');f.publish('thinking',{key:'a:first',firstTurn:true});await f.flush();
 while(f.timers.size){assert.equal(f.rendered.at(-1).skin.opacity,.9);assert.equal(f.presenceTimers.size,0);f.advance();}
 assert.equal(f.held(),false);assert.equal(f.wallpaper.getAttribute('data-presence'),'hold');assert.equal(f.rendered.at(-1).skin.opacity,.9);
 const [id,timer]=f.presenceTimers.entries().next().value;assert.equal(timer.ms,2400);
 f.publish('working');assert.equal(f.presenceTimers.size,1,'changing expression retains original hold timer');
 f.presenceTimers.delete(id);timer.fn();assert.equal(f.wallpaper.getAttribute('data-presence'),'focus');assert.equal(f.rendered.at(-1).skin.opacity,.9*.58);
 const veil=f.wallpaper.shadow.children[2];assert.equal(veil.style.opacity,'1');assert.match(veil.style.transition,/3200ms/);
 f.publish('complete');assert.equal(veil.style.opacity,'0');assert.match(veil.style.transition,/800ms/);
});

test('interrupted camera push is included in FLIP origin and removed from its destination',async t=>{
 const f=fixture(t);f.phase('active');f.publish('thinking',{key:'camera:first',firstTurn:true});await f.flush();
 const camera=f.animations.find(a=>a.options.composite==='add');assert.ok(camera);
 f.publish('error');assert.equal(camera.cancelled,true);
 const layout=f.animations.findLast(a=>a.options.duration===620);assert.ok(layout);
 const [sx,sy]=layout.frames[0].scale.split(' ').map(Number);
 assert.equal(sx,800*1.022/640);assert.equal(sy,800*1.022/640,'destination must not include the now-cancelled camera scale');
 assert.equal(f.held(),false);
});

test('only empty conversation and first greeting use a portrait, including after returning to idle',async t=>{
 const f=fixture(t);assert.equal(f.rendered.at(-1).source,'away');assert.equal(f.rendered.at(-1).skin.fit,'portrait');
 f.phase('active');f.publish('thinking',{key:'new:first',firstTurn:true});await f.flush();assert.equal(f.rendered.at(-1).skin.fit,'portrait');
 while(f.timers.size)f.advance();assert.equal(f.rendered.at(-1).source,'thinking');assert.equal(f.rendered.at(-1).skin.fit,'contain');
 for(const state of ['working','error','complete','idle']){f.publish(state);assert.equal(f.rendered.at(-1).source,state);assert.equal(f.rendered.at(-1).skin.fit,'contain');}
});


test('native integration preserves revised source directions independently from placement and opening portraits',async t=>{
 const f=fixture(t);assert.equal(f.rendered.at(-1).skin.mirror,false);
 f.phase('active');f.publish('thinking',{key:'follow',firstTurn:false});assert.equal(f.rendered.at(-1).skin.mirror,false);
 f.controls.onChange('position','left');assert.equal(f.rendered.at(-1).skin.mirror,false,'outer layout mirror remains separate');
 f.publish('working');assert.equal(f.rendered.at(-1).skin.mirror,false,'already left-facing work artwork stays unmodified');
 f.publish('error');assert.equal(f.rendered.at(-1).skin.mirror,false);
 f.publish('thinking',{key:'new:first',firstTurn:true});await f.flush();assert.equal(f.rendered.at(-1).skin.mirror,false,'shoulder closeup already faces left');
});


test('first submission errors override the empty hero portrait without waiting for a created turn',async t=>{
 const f=fixture(t);assert.equal(f.rendered.at(-1).skin.fit,'portrait');f.publish('error',undefined);await f.flush();
 assert.equal(f.host.getAttribute('data-phase'),'hero','native input layout stays intact');
 assert.equal(f.wallpaper.getAttribute('data-layout-phase'),'active');assert.equal(f.rendered.at(-1).source,'error');assert.equal(f.rendered.at(-1).skin.fit,'contain');assert.equal(f.held(),false);
});
test('error reaction waits for the opening layout transition instead of overriding its geometry',async t=>{
 const f=fixture(t);f.phase('active');f.publish('thinking',{key:'first',firstTurn:true});await f.flush();f.publish('error');await f.flush();
 const layout=f.animations.findLast(a=>a.options.duration===620);assert.ok(layout);assert.equal(f.animations.filter(a=>a.id==='dss-error-reaction').length,0);
 layout.finish();await f.flush();await f.flush();assert.equal(f.animations.filter(a=>a.id==='dss-error-reaction').length,1);
 f.publish('thinking');assert.equal(f.animations.find(a=>a.id==='dss-error-reaction').cancelled,true);
});


test('client requests and forwards full-presentation receipts only for exposed tool artwork',async t=>{
 let shown;const receipt=new Promise(resolve=>shown=resolve),request={epoch:7,state:'reading',asset:'serene'};
 const f=fixture(t,{toolRequest:request,renderResult:source=>source==='reading'?receipt:Promise.resolve(true)});
 f.phase('active');f.publish('reading',{key:'follow',firstTurn:false});await f.flush();
 assert.equal(f.rendered.at(-1).source,'reading');assert.equal(f.rendered.at(-1).options.waitForPresentation,true);
 assert.equal(f.acknowledgments.length,0,'the client must not acknowledge a pending renderer');shown(true);await f.flush();
 assert.ok(f.acknowledgments.length>0);assert.ok(f.acknowledgments.every(row=>row.request===request&&row.shown===true));
 const previous=f.acknowledgments.length;f.publish('reading',{key:'first',firstTurn:true});await f.flush();
 assert.notEqual(f.rendered.at(-1).source,'reading');assert.equal(f.rendered.at(-1).options.waitForPresentation,false);
 assert.equal(f.acknowledgments.length,previous,'opening portrait receipts cannot acknowledge hidden tool poses');
});
