import test from 'node:test';
import assert from 'node:assert/strict';
import {mountVisual} from '../src/visual.mjs';
function environment(t) {
  const originals={document:globalThis.document,Image:globalThis.Image,CustomEvent:globalThis.CustomEvent,matchMedia:globalThis.matchMedia};
  const loaders=[],drawn=[],animations=[],timers=new Map(),errors=[];let serial=0,reduced=false;
  class Element {
    constructor(tag='image') {this.tag=tag;this.style={setProperty(key,value){this[key]=value;},getPropertyValue(key){return this[key]||'';}};this.dataset={};this.children=[];this.naturalWidth=1024;this.naturalHeight=1536;}
    append(el){this.children.push(el);}setAttribute(key,value){this[key]=value;}removeAttribute(key){delete this[key];}remove(){this.removed=true;}
    getContext(){return {drawImage:image=>drawn.push(image.src)};}
    dispatchEvent(event){errors.push(event.detail);}
    animate(frames,options){const animation={element:this,frames,options,cancelled:false,cancel(){this.cancelled=true;},finish(){this.onfinish?.();}};animations.push(animation);return animation;}
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.Image=class extends Element {constructor(){super();loaders.push(this);}};
  globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};
  globalThis.matchMedia=()=>({matches:reduced});
  t.after(()=>{for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const container=new Element('container'),view=mountVisual(container,{schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel(id){timers.delete(id);}});
  const skin={enabled:true,mode:'dynamic',motion:'none',size:340,opacity:.9,position:'right'};
  const pending=()=>container.children.find(el=>el.tag==='img'&&el.onload);
  const visible=()=>container.children.filter(el=>el.style.display==='block');
  return {container,view,skin,loaders,drawn,animations,timers,errors,pending,visible,setReduced(value){reduced=value;},async loadImage(){const image=pending();assert.ok(image,'a pending image exists');await image.onload();return image;}};
}
test('decoded outgoing figure stays visible while the next source loads and crossfades only after full decode',async t=>{
  const f=environment(t);f.view.update(f.skin,'first.png');assert.equal(f.visible().length,0);
  const first=await f.loadImage();f.view.update({...f.skin,transitionMs:240},'second.png');
  assert.equal(first.style.display,'block');assert.equal(first.src,'first.png','loading never clears the old pixels');
  const incoming=f.pending();let resolve;incoming.decode=()=>new Promise(done=>resolve=done);const decoding=incoming.onload();
  assert.equal(first.style.display,'block');assert.notEqual(incoming.style.display,'block','loaded bytes wait for decode completion');
  resolve();await decoding;
  assert.equal(first.style.display,'block','outgoing survives the fade');assert.equal(incoming.style.display,'block');
  const fades=f.animations.filter(animation=>animation.options.duration===240);assert.equal(fades.length,2);
  assert.deepEqual(fades.find(animation=>animation.element===incoming).frames,[{opacity:0},{opacity:1}]);
  fades[0].finish();assert.equal(first.style.display,'none');assert.equal(first.src,undefined);assert.equal(incoming.src,'second.png');f.view.dispose();
});
test('late loading and fade callbacks cannot clear a newer figure or revive disabled and disposed layers',async t=>{
  const f=environment(t);f.view.update(f.skin,'first.png');const first=await f.loadImage();
  f.view.update(f.skin,'stale.png');const stale=f.pending().onload;
  f.view.update(f.skin,'second.png');await stale();assert.equal(first.style.display,'block');const second=await f.loadImage();
  const oldFinish=f.animations.find(animation=>animation.options.duration===180)?.onfinish;
  f.view.update(f.skin,'third.png');assert.equal(f.pending(),undefined);
  assert.equal(second.style.display,'block');oldFinish?.();const late=f.pending().onload;
  oldFinish?.();assert.equal(second.style.display,'block');
  f.view.update({...f.skin,enabled:false},'third.png');await late();assert.equal(f.visible().length,0);assert.equal(f.container.style.opacity,'0');
  for(const image of f.container.children.filter(el=>el.tag==='img'))assert.equal(image.src,undefined);
  f.view.dispose();await late();assert.ok(f.container.children.every(el=>el.removed));
});
test('a failed or oversized replacement leaves the last decoded figure intact',async t=>{
  const f=environment(t);f.view.update(f.skin,'good.png');const good=await f.loadImage();
  f.view.update(f.skin,'bad.png');f.pending().onerror();assert.equal(good.style.display,'block');assert.equal(good.src,'good.png');
  f.view.update(f.skin,'huge.png');const huge=f.pending();huge.naturalWidth=10000;huge.naturalHeight=10000;await huge.onload();
  assert.equal(good.style.display,'block');assert.equal(f.errors.length,2);f.view.dispose();
});
test('static buffers retain the old canvas until replacement and immediately freeze a previously animated image',async t=>{
  const f=environment(t),skin={...f.skin,mode:'static'};
  const first=f.view.update(skin,'one.gif');f.loaders[0].onload();await first;const canvas=f.visible()[0];assert.equal(canvas.tag,'canvas');
  const second=f.view.update(skin,'two.gif');assert.equal(canvas.style.display,'block');f.loaders[1].onload();await second;
  assert.deepEqual(f.drawn,['one.gif','two.gif']);assert.equal(f.animations.length,0,'static does not fade or float');
  f.view.update(f.skin,'animated.gif');await f.loadImage();const still=f.view.update(skin,'new-still.png');
  assert.equal(f.visible().length,1);assert.equal(f.visible()[0].tag,'canvas','static mode immediately freezes the currently decoded GIF');
  f.loaders[2].onload();await still;for(const image of f.container.children.filter(el=>el.tag==='img'))assert.equal(image.src,undefined);
  f.view.dispose();
});
test('reduced motion switches decoded images directly and resizing does not restart floating',async t=>{
  const f=environment(t);f.view.update({...f.skin,motion:'float'},'one.png');await f.loadImage();
  const float=f.animations.find(animation=>animation.options.iterations===Infinity);assert.ok(float);
  f.view.update({...f.skin,motion:'float',size:380},'one.png');assert.equal(f.animations.filter(animation=>animation.options.iterations===Infinity).length,1);
  f.setReduced(true);f.view.update({...f.skin,motion:'float'},'two.png');await f.loadImage();assert.equal(float.cancelled,true);
  assert.equal(f.animations.filter(animation=>animation.options.iterations!==Infinity).length,0);assert.equal(f.visible().length,1);f.view.dispose();
});
test('each decoded buffer retains its own portrait framing throughout the next handoff',async t=>{
  const f=environment(t);f.container.style.setProperty('--dss-portrait-x','-44%');f.view.update(f.skin,'left.png');const first=await f.loadImage();
  f.container.style.setProperty('--dss-portrait-x','-52%');f.view.update(f.skin,'front.png');const second=await f.loadImage();
  assert.equal(first.style.getPropertyValue('--dss-portrait-x'),'-44%');assert.equal(second.style.getPropertyValue('--dss-portrait-x'),'-52%');f.view.dispose();
});

test('portrait and full-body fitting belong to decoded buffers, not a shared source container',async t=>{
 const f=environment(t);f.view.update({...f.skin,fit:'portrait'},'intro.png');const intro=await f.loadImage();
 assert.equal(intro['data-fit'],'portrait');f.view.update({...f.skin,fit:'contain'},'thinking.png');assert.equal(intro['data-fit'],'portrait','pending action must not shrink the visible portrait');
 const body=await f.loadImage();assert.equal(body['data-fit'],'contain');assert.equal(intro['data-fit'],'portrait','crossfade retains both independent fits');
 const still=f.view.update({...f.skin,mode:'static',fit:'contain'},'other.png');const frozen=f.visible().find(e=>e.tag==='canvas');assert.equal(frozen['data-fit'],'contain');
 f.loaders[0].onload();await still;f.view.dispose();
});
test('same-source fitting changes repaint through the other buffer',async t=>{
 const f=environment(t);f.view.update({...f.skin,fit:'portrait'},'same.png');const first=await f.loadImage();
 f.view.update({...f.skin,fit:'contain'},'same.png');assert.equal(first['data-fit'],'portrait');const second=await f.loadImage();assert.notEqual(first,second);assert.equal(second['data-fit'],'contain');f.view.dispose();
});


test('source direction stays with each decoded buffer through a state change and static freeze',async t=>{
 const f=environment(t);f.view.update({...f.skin,fit:'contain',mirror:true},'right-facing.png');const first=await f.loadImage();
 assert.equal(first['data-mirror'],'true');assert.equal(first.style.scale,'-1 1');
 f.view.update({...f.skin,fit:'contain',mirror:false},'left-facing.png');
 assert.equal(first.style.scale,'-1 1','pending left-facing source cannot flip the visible outgoing pose');
 const second=await f.loadImage();assert.equal(second.style.scale,'1 1');assert.equal(first.style.scale,'-1 1');
 const still=f.view.update({...f.skin,mode:'static',fit:'contain',mirror:true},'right-facing.png');
 const frozen=f.visible().find(e=>e.tag==='canvas');assert.equal(frozen['data-mirror'],'false');assert.equal(frozen.style.scale,'1 1');
 f.loaders[0].onload();await still;assert.equal(f.visible()[0].style.scale,'-1 1');f.view.dispose();
});
test('same-source orientation changes are decoded into the other buffer',async t=>{
 const f=environment(t);f.view.update({...f.skin,mirror:false},'same.png');const first=await f.loadImage();
 f.view.update({...f.skin,mirror:true},'same.png');assert.equal(first.style.scale,'1 1');
 const second=await f.loadImage();assert.notEqual(first,second);assert.equal(second.style.scale,'-1 1');f.view.dispose();
});
test('crossfade uses isolated additive blending so the shared face does not dip in opacity',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');const first=await f.loadImage();
 f.view.update(f.skin,'second.png');const second=await f.loadImage();
 assert.equal(f.container.style.isolation,'isolate');
 assert.equal(first.style.mixBlendMode,'plus-lighter');assert.equal(second.style.mixBlendMode,'plus-lighter');
 const fade=f.animations.find(a=>a.options.duration===180);fade.finish();
 assert.equal(second.style.mixBlendMode,'normal');assert.equal(first.style.display,'none');
 f.view.dispose();
});


test('in-flight fades finish before reusing an outgoing buffer and queued requests coalesce',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');const first=await f.loadImage();
 f.view.update({...f.skin,transitionMs:420},'second.png');const second=await f.loadImage();
 const fade=f.animations.find(a=>a.element===second&&a.options.duration===420);
 f.container.style.setProperty('--dss-portrait-x','-42%');
 const third=f.view.update({...f.skin,mirror:true},'third.png');
 assert.equal(f.pending(),undefined,'neither visible buffer can be reused mid-fade');
 assert.equal(fade.cancelled,false);assert.equal(first.src,'first.png');assert.equal(second.src,'second.png');
 const fourth=f.view.update({...f.skin,mirror:false},'fourth.png');assert.equal(await third,false,'superseded requests settle');
 f.container.style.setProperty('--dss-portrait-x','-63%');
 const repeated=f.view.update({...f.skin,mirror:false,opacity:.65},'fourth.png');assert.equal(repeated,fourth,'same queued request shares one promise');
 fade.finish();assert.equal(first.style.display,'none');assert.equal(second.style.display,'block');assert.equal(f.pending().src,'fourth.png');
 const final=await f.loadImage();assert.equal(await fourth,true);assert.equal(final['data-mirror'],'false');
 assert.equal(final.style.getPropertyValue('--dss-portrait-x'),'-63%');assert.equal(f.container.style.opacity,'0.65');
 f.view.dispose();
});
test('requesting the currently fading target cancels a queued obsolete pose',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();f.view.update(f.skin,'second.png');const second=await f.loadImage();
 const fade=f.animations.find(a=>a.element===second&&a.options.duration===180),queued=f.view.update(f.skin,'obsolete.png');
 assert.equal(await f.view.update(f.skin,'second.png'),true);assert.equal(await queued,false);
 fade.finish();assert.equal(f.pending(),undefined);assert.equal(f.visible().length,1);assert.equal(f.visible()[0].src,'second.png');f.view.dispose();
});
for(const interruption of ['static','reduced','immediate','disabled','dispose'])test(`queued fade requests cancel on ${interruption}`,async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();f.view.update(f.skin,'second.png');const second=await f.loadImage();
 const fade=f.animations.find(a=>a.element===second&&a.options.duration===180),queued=f.view.update(f.skin,'obsolete.png');
 let result;
 if(interruption==='dispose')f.view.dispose();
 else {
  if(interruption==='reduced')f.setReduced(true);
  result=f.view.update({...f.skin,mode:interruption==='static'?'static':'dynamic',enabled:interruption!=='disabled',transitionMs:interruption==='immediate'?0:180},'current.png');
 }
 assert.equal(await queued,false);assert.equal(fade.cancelled,true);fade.finish();
 assert.ok(!f.container.children.some(e=>e.src==='obsolete.png'),'old fade callbacks never resurrect the queue');
 if(['disabled','dispose'].includes(interruption)){assert.equal(f.visible().length,0);if(result)assert.equal(await result,false);}
 else if(interruption==='static'){assert.equal(f.visible().length,1);assert.equal(f.visible()[0].tag,'canvas');await f.loaders[0].onload();assert.equal(await result,true);}
 else {const current=await f.loadImage();assert.equal(await result,true);assert.equal(current.src,'current.png');assert.equal(f.visible().length,1);}
 f.view.dispose();
});


test('timer completion drains once and stale animation callbacks leave the next dissolve intact',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();f.view.update(f.skin,'second.png');const second=await f.loadImage();
 const oldFade=f.animations.find(a=>a.element===second&&a.options.duration===180),timer=[...f.timers.values()][0];
 const queued=f.view.update(f.skin,'third.png');timer.fn();const third=await f.loadImage();assert.equal(await queued,true);
 const nextFade=f.animations.findLast(a=>a.element===third&&a.options.duration===180);
 const fourth=f.view.update(f.skin,'fourth.png');oldFade.finish();timer.fn();
 assert.equal(nextFade.cancelled,false);assert.equal(f.pending(),undefined);assert.equal(f.visible().length,2);
 nextFade.finish();assert.equal(f.pending().src,'fourth.png');f.view.dispose();assert.equal(await fourth,false);
});
test('reducing motion for the current source immediately cancels its fade and queued pose',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();f.view.update(f.skin,'second.png');const second=await f.loadImage();
 const fade=f.animations.find(a=>a.element===second&&a.options.duration===180),queued=f.view.update(f.skin,'third.png');
 f.setReduced(true);assert.equal(await f.view.update(f.skin,'second.png'),true);assert.equal(await queued,false);
 assert.equal(fade.cancelled,true);assert.deepEqual(f.visible(),[second]);assert.equal(f.pending(),undefined);f.view.dispose();
});


test('presentation receipt resolves only after full dissolve and same-source repaint shares it',async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();
 let settled=false;const result=f.view.update({...f.skin,transitionMs:420},'reading.png',{waitForPresentation:true});result.then(()=>settled=true);
 const reading=await f.loadImage();await Promise.resolve();assert.equal(settled,false,'decode is not full presentation');
 assert.equal(f.view.update({...f.skin,transitionMs:420},'reading.png',{waitForPresentation:true}),result);
 const fade=f.animations.find(a=>a.element===reading&&a.options.duration===420);fade.finish();assert.equal(await result,true);f.view.dispose();
});


for(const phase of ['queued','loading','fading'])test(`unshown presentation receipts settle false when disabled during ${phase}`,async t=>{
 const f=environment(t);f.view.update(f.skin,'first.png');await f.loadImage();
 if(phase==='queued'){f.view.update(f.skin,'second.png');await f.loadImage();}
 const result=f.view.update(f.skin,'reading.png',{waitForPresentation:true});
 if(phase==='fading')await f.loadImage();
 f.view.update({...f.skin,enabled:false},'reading.png');assert.equal(await result,false);assert.equal(f.visible().length,0);
 for(const animation of f.animations)animation.finish();assert.equal(f.visible().length,0);f.view.dispose();
});
