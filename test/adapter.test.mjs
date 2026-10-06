import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { buildHarnessPlugin } from '../adapters/harness/build.mjs';
import { installHarnessSkin } from '../adapters/harness/client.mjs';
import { normalizeSkin } from '../src/skin.mjs';
import {createPortraitPresence} from '../src/presence.mjs';

const tiny = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
test('导出可激活的插件 bundle，媒体内嵌，没有外部目录或运行时依赖', async () => {
  const bundle = await buildHarnessPlugin({ mode: 'static' }, tiny);
  const metadata = JSON.parse(bundle.files['package.json']);
  assert.equal(metadata.dsh.bundle.patch, './cordis.patch.yml');
  assert.match(bundle.files['cordis.patch.yml'], /name: deepseekdeskskin-harness/);
  assert.equal(metadata.dependencies, undefined);
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-api-session-controller'));
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-api-job-controller'));
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-client-connection'));
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-api-gateway'));
  const hostModule = await import('data:text/javascript;base64,' + Buffer.from(bundle.files['lib/index.js']).toString('base64'));
  assert.deepEqual(hostModule.inject,['tools','agents','typert']);
  const listeners = new Map(), services = new Map(), contributions = new Map();
  const host = hostModule.apply({on(name,callback){listeners.set(name,callback);return()=>listeners.delete(name);},effect(register){register();},provide(name,service){services.set(name,service);return()=>services.delete(name);},typert:{register(contribution){contributions.set(contribution.package,contribution);return()=>contributions.delete(contribution.package);}},agents:{get(){},isOwnedBy(){return false;}}});
  assert.equal(typeof services.get('deskskinReceipt')?.follow,'function','host exports a transient Remote');
  assert.equal(contributions.get(metadata.name)?.invocations[0]?.mode,'stream');
  assert.equal(typeof listeners.get('tools/result'),'function','installed host observes typed canonical results');
  assert.equal(typeof listeners.get('session/event'),'function');
  assert.equal(typeof listeners.get('subagent/start'),'function','installed host observes typed native child lifecycle');
  host.dispose();assert.equal(listeners.size,0,'exported companion tears down subscriptions');
  assert.equal(services.size,0);assert.equal(contributions.size,0,'owned Remote unregisters on unload');
  const client = bundle.files['lib/client.js'];
  assert.ok(client.includes(tiny)); assert.doesNotMatch(client, /LLMPET|\.octopus|\/Users\/|\.research|localhost|fetch\(/);
  let registered;
  vm.runInNewContext(client, { window: { __ModuleLoader__: { load: entry => { registered = entry; } } } });
  assert.equal(registered.id, metadata.name); assert.equal(typeof registered.factory(() => ({})).apply, 'function');
  assert.deepEqual(Array.from(registered.factory(() => ({})).inject), ['theme','slots','sessions','jobs','connection','remote','typert']);
  const tar = zlib.gunzipSync(bundle.archive); let offset = 0; const actual = {};
  while (tar[offset]) { const header = tar.subarray(offset, offset + 512); const name = header.subarray(0, 100).toString().replace(/\0.*$/, ''); const size = parseInt(header.subarray(124, 136).toString(), 8); const checksum = parseInt(header.subarray(148, 156).toString(), 8); const check = Buffer.from(header); check.fill(32, 148, 156); assert.equal(check.reduce((a, b) => a + b, 0), checksum); actual[name] = tar.subarray(offset + 512, offset + 512 + size).toString(); offset += 512 + Math.ceil(size / 512) * 512; }
  for (const [name, value] of Object.entries(bundle.files)) assert.equal(actual[`package/${name}`], value);
});
test('客户端切换、异步主题恢复、关闭及卸载均保留正确偏好', async t => {
  const originals = { document: globalThis.document, localStorage: globalThis.localStorage, MutationObserver: globalThis.MutationObserver };
  class Element {
    style = {}; children = []; attributes = {}; listeners = {}; hidden = false;
    append(...els) { this.children.push(...els); }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    removeAttribute(key) { delete this.attributes[key]; }
    attachShadow() { this.shadow = new Element(); return this.shadow; }
    addEventListener(key, callback) { this.listeners[key] = callback; }
    click() { this.listeners.click?.(); }
    remove() { this.removed = true; }
  }
  const body = new Element(); const head = new Element(); const host = new Element(); const store = new Map(); let cleanup; let preference = 'system'; const themes = new Map(); let disposed = false; const frames = []; let controls; let controlsDisposed = false; const controlFrames = [];
  let hostMounted = false; let observeMount; let observerStopped = false;
  globalThis.MutationObserver = class { constructor(callback) { observeMount = callback; } observe() {} disconnect() { observerStopped = true; } };
  globalThis.document = { createElement: () => new Element(), body, head, querySelector: () => hostMounted ? host : null };
  globalThis.localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  t.after(() => { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const listeners = new Set();
  const ctx = { effect: fn => { cleanup = fn(); }, on: (name, callback) => { assert.equal(name, 'theme/change'); listeners.add(callback); return () => listeners.delete(callback); }, theme: { getTheme: () => ({ preference }), setTheme: value => { preference = value; for (const callback of listeners) callback({ preference }); }, register: value => { themes.set(value.id, value); return () => themes.delete(value.id); } } };
  installHarnessSkin(ctx, normalizeSkin(), tiny, () => ({ update: skin => frames.push({ ...skin }), dispose: () => { disposed = true; } }), normalizeSkin, 'test', undefined, options => { controls = options; return {update:skin=>controlFrames.push({...skin}),showError(){},dispose(){controlsDisposed=true;}}; });
  assert.equal(preference, 'deepseekdeskskin-harness:light'); assert.equal(themes.size, 2);
  host.setAttribute('data-phase','hero'); hostMounted = true; observeMount();
  assert.equal(host.children[0]?.id, 'deepseekdeskskin-background');
  assert.equal(host.children[0].getAttribute('data-layout-phase'),'hero');
  host.setAttribute('data-phase','active'); observeMount();
  assert.equal(host.children[0].getAttribute('data-layout-phase'),'active','first send updates a reused native root');
  assert.equal(host.children.length,1,'phase changes do not duplicate the background');
  assert.ok(frames.at(-1).opacity <= 0.24, '人物作为淡背景，不盖住文字');
  // Harness adopts its persisted native preference after plugins have mounted.
  ctx.theme.setTheme('dark');
  await Promise.resolve();
  assert.equal(preference, 'deepseekdeskskin-harness:light');
  assert.equal(body.children.some(el=>el.id === 'deepseekdeskskin-controls'),false,'no floating lower-right control root');
  assert.ok(controls,'persistent sidebar controls are installed for every skin');
  controls.onChange('mode','static'); assert.equal(frames.at(-1).mode, 'static');
  controls.onChange('mode','dynamic'); assert.equal(frames.at(-1).mode, 'dynamic');
  controls.onChange('palette','light'); assert.equal(preference, 'deepseekdeskskin-harness:light');
  controls.onChange('enabled',false); assert.equal(frames.at(-1).enabled, false); assert.equal(preference, 'dark');
  assert.equal(controlFrames.at(-1).enabled,false,'left controls remain updated while skin is disabled');
  ctx.theme.setTheme('light'); await Promise.resolve(); assert.equal(preference, 'light');
  controls.onChange('enabled',true); assert.equal(preference, 'deepseekdeskskin-harness:light');
  ctx.theme.setTheme('system'); // Cleanup must also cancel any queued reapply.
  cleanup(); await Promise.resolve();
  assert.equal(preference, 'system'); assert.equal(themes.size, 0); assert.equal(listeners.size, 0); assert.equal(controlsDisposed, true); assert.equal(disposed, true);
  assert.equal(host.children[0].removed, true); assert.equal(observerStopped, true);
  assert.equal(host.attributes['data-deepseekdeskskin-background'], undefined);
});

test('运行先清晰停留再渐变；换图不中断，等待结束平滑恢复，静态无过渡', async t => {
  const originals = Object.fromEntries(['document','localStorage','MutationObserver','matchMedia'].map(key => [key,globalThis[key]]));
  t.after(() => { for (const [key,value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const animations = [];
  class Element {
    style = {}; children = []; attributes = {};
    append(...elements) { this.children.push(...elements); }
    setAttribute(key,value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    attachShadow() { return this.shadow = new Element(); }
    addEventListener() {}
    remove() {}
    animate(keyframes) { const animation = {keyframes,cancelled:false,cancel(){this.cancelled=true;}}; animations.push(animation); return animation; }
  }
  const host = new Element(); let reduced = false;
  globalThis.document = {body:new Element(),head:new Element(),createElement:()=>new Element(),querySelector:()=>host};
  globalThis.localStorage = {getItem:()=>null,setItem(){}};
  globalThis.MutationObserver = class {observe(){} disconnect(){}};
  globalThis.matchMedia = () => ({matches:reduced});
  let cleanup; let preference = 'system'; let controls; let state = 'idle'; let subscriber; let unsubscribed = false; let disposed = false; let refreshed = 0;
  const frames = []; let finishCharacterCleanup;
  const characterCleanup = new Promise(resolve=>{finishCharacterCleanup=resolve;});
  const ctx = {effect:fn=>{cleanup=fn();},on:()=>()=>{},theme:{getTheme:()=>({preference}),setTheme:value=>{preference=value;},register:()=>()=>{}}};
  const character = {update(){},isBuiltin:true,get activityState(){return state;},get imageSource(){return `${state}-scene`;},subscribe(fn){subscriber=fn;return ()=>{unsubscribed=true;};},dispose(){disposed=true;return characterCleanup;}};
  const attentionTimers=new Map();let attentionSerial=0;
  installHarnessSkin(ctx,normalizeSkin({opacity:.8}),tiny,()=>({update:skin=>frames.push({...skin}),dispose(){}}),normalizeSkin,'activity-opacity',()=>character,options=>{controls=options;return {update(){},refreshActivity(){refreshed++;},dispose(){}};},undefined,fn=>createPortraitPresence(fn,{schedule:(callback,ms)=>{const id=++attentionSerial;attentionTimers.set(id,{callback,ms});return id;},cancel:id=>attentionTimers.delete(id)}));
  const baseline = frames.at(-1).opacity;
  const wallpaper=host.children[0],avatar=wallpaper.shadow.children[1],veil=wallpaper.shadow.children[2];
  const expireHold=()=>{const [id,timer]=attentionTimers.entries().next().value;assert.equal(timer.ms,2400);attentionTimers.delete(id);timer.callback();};
  const publish = next => {state=next;subscriber();};
  for (const busy of ['thinking','working','answering','parallel','compacting','retrying','queued','connecting']) {
    const previousRefresh = refreshed;
    publish(busy);
    assert.ok(refreshed > previousRefresh,'task changes must notify the sidebar controls as well as the large scene');
    assert.equal(controls.activityState(),busy);assert.equal(controls.expressionSource(),`${busy}-scene`);
    if(busy==='thinking'){
      assert.equal(frames.at(-1).opacity,baseline,'reaction remains clear');assert.equal(veil.style.opacity,'0');
      expireHold();
    }
    assert.equal(frames.at(-1).opacity,baseline*.58,`${busy} retains the delayed focus target`);
    assert.equal(veil.style.opacity,'1');assert.match(avatar.style.transition,/3200ms/);
    assert.equal(attentionTimers.size,0,'changing task image does not restart the hold');
  }
  assert.equal(animations.length,0,'opacity uses a continuous CSS transition rather than restarted entrance animations');
  for (const visible of ['waiting','complete','error','idle','disconnected','stopped','paused','blocked']) {publish(visible);assert.equal(frames.at(-1).opacity,baseline,`${visible} restores the chosen opacity`);}
  assert.equal(veil.style.opacity,'0');assert.match(avatar.style.transition,/800ms/);
  controls.onChange('mode','static');
  const staticCount = animations.length;
  publish('thinking'); assert.ok(frames.at(-1).opacity > 0 && frames.at(-1).opacity < baseline);
  publish('complete'); assert.equal(frames.at(-1).opacity,baseline);
  assert.equal(animations.length,staticCount,'static mode changes opacity without animation');
  reduced = true; controls.onChange('mode','dynamic');
  publish('working'); publish('idle'); assert.equal(animations.length,staticCount,'reduced motion prevents transitions');
  reduced = false; controls.onChange('motion','none');
  publish('thinking'); assert.equal(animations.length,staticCount,'disabled motion prevents transitions');
  controls.onChange('enabled',false); assert.equal(frames.at(-1).enabled,false);
  controls.onChange('enabled',true); assert.ok(frames.at(-1).opacity > 0 && frames.at(-1).opacity < baseline);
  publish('idle'); assert.equal(frames.at(-1).opacity,baseline);
  const cleanupPromise = cleanup(); assert.equal(unsubscribed,true); assert.equal(disposed,true);
  let finished = false; cleanupPromise.then(()=>{finished=true;});
  await Promise.resolve(); assert.equal(finished,false,'Cordis unload waits for transient stream quiescence');
  finishCharacterCleanup(); await cleanupPromise; assert.equal(finished,true);
});
