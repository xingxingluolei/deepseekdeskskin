import test from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { normalizeSkin, readSkinPackage, ASSETS, CHARACTER_SKINS } from '../src/skin.mjs';
import { mountCharacterSurfaces } from '../adapters/harness/character.mjs';
import { buildHarnessPlugin } from '../adapters/harness/build.mjs';
import { installHarnessSkin } from '../adapters/harness/client.mjs';

test('三套角色目录保留内置身份，portable设置不退回澄蓝', () => {
  assert.deepEqual(CHARACTER_SKINS.map(item => item.id), ['serene','maid','maid_chibi']);
  for (const item of CHARACTER_SKINS) {
    assert.deepEqual(Object.keys(item.scenes).sort(), ['idle','thinking','working','reading','writing','searching','executing','delegating','waiting','complete','error','answering','parallel','compacting','retrying','queued','connecting','disconnected','stopped','paused','blocked'].sort());
    assert.equal(normalizeSkin({asset:item.id}).asset,item.id);
    assert.ok(ASSETS[item.id]);
    for (const mode of ['static','dynamic']) {
      const pack=readSkinPackage({format:'deepseekdeskskin',version:1,skin:{asset:item.id,mode}});
      assert.equal(pack.skin.asset,item.id);assert.equal(pack.skin.mode,mode);
    }
  }
});

test('each built-in has twenty-one full-body states plus a twelve-frame cinematic closeup',()=>{
  for(const item of CHARACTER_SKINS){
    assert.equal(item.presentation,'cutout');
    assert.equal(item.intro.length,12);
    assert.equal(new Set(item.intro.map(frame=>frame.file)).size,12,'every keyframe has distinct artwork');
    assert.ok(item.intro.every(frame=>frame.transitionMs<frame.duration),'a dissolve completes before the next keyframe');
    assert.match(item.scenes.idle,/^actions\/.+-intro-away-v1\.png$/,'idle source remains a full-body waiting action');
    assert.match(ASSETS[item.id],/intro-away-v2\.png$/,'canonical portable identity remains stable across opening art revisions');
    assert.deepEqual(Object.keys(item.facingByState).sort(),Object.keys(item.scenes).sort());
    assert.notEqual(item.focusByState.idle.scale,item.intro[0].scale,'full-body sidebar face crops are independent from closeup framing');
    assert.deepEqual(item.intro.map(frame=>frame.key),['away','attention-eyes','noticing','turn-early','turning','turn-late','front-neutral','front-blink','front-open','soft-smile','front-smile','smile-settle']);
    assert.equal(item.intro.reduce((sum,frame)=>sum+frame.duration,0),3900);
    assert.ok(Object.values(item.scenes).every(file=>/^actions\/[a-z-]+-v[123]\.png$/.test(file)));
    assert.equal(new Set(Object.values(item.scenes)).size,21,'every state must select independent artwork');
    for(const state of ['thinking','working','retrying','queued','error','disconnected','stopped','complete'])assert.match(item.scenes[state],new RegExp('-'+state+'-v3\\.png$'));
    assert.match(item.scenes.executing,/-working-v1\.png$/,'command execution keeps the computer action');
    assert.deepEqual(Object.keys(item.focusByState).sort(),Object.keys(item.scenes).sort(),'every action has individually inspected sidebar face framing');
    for(const frame of [...Object.values(item.focusByState),...item.intro]) {
      assert.match(frame.focus,/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/);
      assert.match(frame.scale,/^\d+(?:\.\d+)?% auto$/);
    }
  }
});

function fixture(t) {
  const keys=['document','URL','Image'];const originals=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const key of keys)globalThis[key]=originals[key];});
  class Element {
    attributes={};children=[];listeners={};style={setProperty(){},removeProperty(){}};
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    append(...els){this.children.push(...els);}remove(){this.removed=true;}
    attachShadow(){return this.shadow=new Element();}
    addEventListener(k,v){this.listeners[k]=v;}showModal(){this.open=true;}focus(){this.focused=true;}
  }
  globalThis.document={documentElement:new Element(),head:new Element(),body:new Element(),createElement:()=>new Element()};
  const created=[],revoked=[];globalThis.URL={createObjectURL:()=>{const url='blob:fixture-'+created.length;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)};globalThis.Image=undefined;
  const registrations=new Map();let count=0;
  const ctx={slots:{entries:()=>[],inject:(name,fn)=>fn(),register:(config,component)=>{count++;registrations.set(config.name,component);return()=>registrations.delete(config.name);}}};
  const effects=[];let instance,trackerDisposed=0;
  const React={createElement:(tag,props,...children)=>({tag,props,children}),useState:value=>[value,()=>{}],useRef:()=>({}),useEffect:fn=>effects.push(fn),useSyncExternalStore:(subscribe,getSnapshot)=>getSnapshot()};
  const makeTracker=callback=>{instance={publish:callback,update(){},dispose(){trackerDisposed++}};return instance;};
  const png=key=>'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(key)]).toString('base64');
  const catalog=Object.fromEntries(CHARACTER_SKINS.map(item=>[item.id,{...item,portrait:png(item.id+'-portrait'),scenes:Object.fromEntries(Object.keys(item.scenes).map(state=>[state,png(item.id+'-'+state)]))}]));
  return {ctx,React,makeTracker,catalog,created,revoked,registrations,effects,get count(){return count},get instance(){return instance},get trackerDisposed(){return trackerDisposed}};
}

test('换角色保持正在执行的tracker，资源只懒加载当前角色并释放', t => {
  const f=fixture(t);const controller=mountCharacterSurfaces(f.ctx,f.catalog,f.React,f.makeTracker);
  assert.equal(f.created.length,0,'constructor must not decode the whole catalog');
  controller.update(normalizeSkin({asset:'serene'}));
  const Driver=f.registrations.get('conversation.input.right');
  const props={sessionId:'one',useSessions:fn=>fn({byId:{one:{retainedBy:{mainView:1}}},projectionsBySession:{}}),useSession:fn=>fn({running:true}),useSessionStatus:fn=>fn(new Map()),useChat:fn=>fn({})};
  const ready=Driver(props);ready.tag(ready.props);
  const cleanup=f.effects.shift()();f.effects.shift()();
  f.instance.publish('working');assert.equal(controller.activityState,'working');
  controller.imageSource;const firstCount=f.count;
  controller.update(normalizeSkin({asset:'maid'}));
  assert.equal(f.count,firstCount,'switching character must not remount the activity slot');
  assert.equal(controller.activityState,'working');assert.equal(f.trackerDisposed,0);
  assert.equal(controller.metadata.id,'maid');assert.equal(controller.name,'经典女仆');
  assert.ok(f.revoked.length>0);assert.ok(f.created.length<8,'only visited assets get Blob URLs');
  controller.update(normalizeSkin({asset:'maid_chibi',mode:'static'}));
  assert.equal(controller.metadata.id,'maid_chibi');assert.equal(controller.activityState,'working');
  const workingSource=controller.imageSource;
  f.instance.publish('thinking');const thinkingSource=controller.imageSource;
  f.instance.publish('complete');const completeSource=controller.imageSource;
  assert.notEqual(workingSource,thinkingSource,'static mode still changes the real task expression');
  assert.notEqual(thinkingSource,completeSource);
  f.instance.publish('waiting');const waitingSource=controller.imageSource;
  f.instance.publish('error');assert.notEqual(controller.imageSource,waitingSource,'a failed task must use its error expression rather than the waiting smile');
  assert.equal(document.documentElement.attributes['data-deepseekdeskskin-motion'],'static','state changes must not enable static animation');
  assert.equal(f.count,firstCount);assert.equal(f.trackerDisposed,0);
  controller.update(normalizeSkin({asset:'custom-000000000000000000000000.png'}));assert.equal(controller.isBuiltin,false);assert.equal(controller.imageSource,undefined);
  cleanup();controller.dispose();assert.equal(f.created.length,f.revoked.length);
});

test('bundle预置三套目录且不匹配的外来media优先保留', async () => {
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  const media='data:image/png;base64,'+png.toString('base64');
  const bundle=await buildHarnessPlugin({asset:'maid'},media,{readAsset:async()=>png});
  const source=bundle.files['lib/client.js'];
  for(const id of ['serene','maid','maid_chibi'])assert.ok(source.includes('"'+id+'"'));
  const filenames=new Set(CHARACTER_SKINS.flatMap(item=>[item.portrait,...Object.values(item.scenes),item.sheet,...item.intro.map(frame=>frame.file)].filter(Boolean)));
  assert.equal(source.split(media).length-1,filenames.size,'each catalog file is encoded once, selected media is not repeated');
  const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const custom=await buildHarnessPlugin({asset:'maid'},gif,{readAsset:async()=>png});
  assert.ok(custom.files['lib/client.js'].includes(gif));assert.match(custom.files['lib/client.js'],/"asset":"custom-[a-f0-9]{24}\.gif"/);
});

test('同一插件切角色保存asset，运行状态保留；可选回原自定义图片', t => {
  const originals=Object.fromEntries(['document','localStorage','MutationObserver','matchMedia'].map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  class Element {
    style={};children=[];attributes={};
    append(...els){this.children.push(...els);}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    attachShadow(){return new Element();}addEventListener(){}remove(){}
  }
  const host=new Element(),store=new Map(),frames=[];let cleanup,controls,preference='system',asset;
  globalThis.document={body:new Element(),head:new Element(),createElement:()=>new Element(),querySelector:()=>host};
  globalThis.localStorage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
  globalThis.MutationObserver=class{observe(){}disconnect(){}};
  globalThis.matchMedia=()=>({matches:false});
  const character={update(skin){asset=skin.asset;},get skins(){return CHARACTER_SKINS;},get isBuiltin(){return CHARACTER_SKINS.some(item=>item.id===asset);},
    get name(){return CHARACTER_SKINS.find(item=>item.id===asset)?.name;},get imageSource(){return this.isBuiltin ? asset+'-working-scene' : undefined;},
    get portrait(){return this.isBuiltin ? asset+'-avatar' : undefined;},get activityState(){return 'working';},subscribe(){return()=>{};},dispose(){}};
  const ctx={effect:fn=>{cleanup=fn();},on:()=>()=>{},theme:{getTheme:()=>({preference}),setTheme:value=>{preference=value;},register:()=>()=>{}}};
  const originalAsset='custom-000000000000000000000000.gif',originalMedia='original.gif';
  installHarnessSkin(ctx,normalizeSkin({asset:originalAsset,opacity:.8}),originalMedia,()=>({update:(skin,source)=>frames.push({skin,source}),dispose(){}}),normalizeSkin,'catalog-persist',()=>character,
    options=>{controls=options;return {update(){},dispose(){}};});
  assert.deepEqual(controls.skins.map(item=>item.id),['serene','maid','maid_chibi',originalAsset]);
  for(const id of ['maid','maid_chibi']) {
    controls.onChange('asset',id);assert.equal(frames.at(-1).source,id+'-working-scene');assert.equal(frames.at(-1).skin.opacity,.8*.58,'custom export keeps its explicitly disabled motion setting');
    assert.equal(JSON.parse([...store.values()].at(-1)).asset,id);assert.equal(controls.name(),character.name);assert.equal(controls.portrait(),id+'-avatar');
  }
  controls.onChange('asset',originalAsset);assert.equal(frames.at(-1).source,originalMedia);assert.ok(frames.at(-1).skin.opacity<=.24);
  controls.onChange('asset','custom-111111111111111111111111.png');assert.equal(controls.getSkin().asset,originalAsset);
  cleanup();
});


test('二十一种状态使用独立源图，尺寸和文件大小适用于内嵌客户端', async () => {
  for (const character of CHARACTER_SKINS) {
    const digests = new Set();
    for (const [state,file] of Object.entries(character.scenes)) {
      const bytes = await fs.readFile(new URL('../assets/'+file,import.meta.url));
      assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],character.id+' '+state+' is PNG');
      assert.equal(bytes.readUInt32BE(16),1024);
      assert.equal(bytes.readUInt32BE(20),1536);
      assert.equal(bytes[25],6,'portrait art retains a real alpha channel');
      assert.ok(bytes.length <= 8 * 1024 * 1024,'embedded media respects the project limit');
      digests.add(crypto.createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal(digests.size,21,character.id+' has twenty-one distinct drawings for twenty-one states');
    assert.notEqual(character.scenes.complete,character.scenes.answering);
    assert.notEqual(character.scenes.executing,character.scenes.working);
    for(const state of ['reading','writing','searching','delegating','compacting'])assert.match(character.scenes[state],/-v2\.png$/);
  }
});


test('revised actions do not inherit the removed right-facing sources or alter opening portraits',()=>{
 const mirrored=CHARACTER_SKINS.flatMap(item=>Object.entries(item.facingByState).filter(([,direction])=>direction==='right').map(([state])=>item.id+':'+state)).sort();
 assert.deepEqual(mirrored,[],'v3 sources replace the former right-facing actions');
 for(const item of CHARACTER_SKINS)for(const frame of item.intro.slice(6))assert.match(frame.file,/-v4\.png$/,'eye contact keeps the softer left-turned face');
});
