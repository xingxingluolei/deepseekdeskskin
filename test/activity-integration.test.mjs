import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCharacterSurfaces } from '../adapters/harness/character.mjs';
import { createActivityTracker } from '../adapters/harness/activity.mjs';
import { createTurnGreetingTracker } from '../adapters/harness/greeting.mjs';
import { createReceiptClient } from '../adapters/harness/receipt-client.mjs';
import { mountVisual } from '../src/visual.mjs';
import { frameRemote, tick } from './receipt-fixture.mjs';

// The host supplies selector hooks and commits effects. This small renderer
// exercises that boundary without importing the Electron-only React package.
function hookRenderer() {
  let active; let cursor; const roots = new Set(); let dirty = false;
  const same = (left,right) => left?.length === right?.length && left?.every((value,index) => Object.is(value,right[index]));
  function hook(kind,init) {
    if (!active) throw new Error('hook outside a component');
    const index=cursor++; let slot=active.hooks[index];
    if (!slot) active.hooks[index]=slot={kind,...init()};
    assert.equal(slot.kind,kind,'changing hook order is invalid');
    return slot;
  }
  const React={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useRef(initial){return hook('ref',()=>({value:{current:initial}})).value;},
    useMemo(factory,deps){const slot=hook('memo',()=>({}));if(!same(slot.deps,deps)){slot.value=factory();slot.deps=deps;}return slot.value;},
    useState(initial){const slot=hook('state',()=>({value:typeof initial==='function'?initial():initial}));return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;dirty=true;}];},
    useEffect(effect,deps){const slot=hook('effect',()=>({}));if(!same(slot.deps,deps)){slot.next=effect;slot.deps=deps;active.pending.add(slot);}},
    useSyncExternalStore(subscribe,getSnapshot){
      const [,wake]=React.useState(0); const slot=React.useRef(); slot.current=getSnapshot;
      React.useEffect(()=>subscribe(()=>wake(value=>value+1)),[subscribe]);
      const value=getSnapshot();assert.equal(getSnapshot(),value,'external-store snapshots must stay referentially stable until their source changes');
      return value;
    },
  };
  function unmount(instance) {
    if(!instance)return;unmount(instance.child);
    for(const slot of instance.hooks)if(slot.kind==='effect')slot.cleanup?.();
    instance.child=undefined;instance.hooks=[];
  }
  function render(instance) {
    active=instance;cursor=0;const value=instance.type(instance.props);active=undefined;
    if(instance.count!==undefined)assert.equal(cursor,instance.count,'changing hook count is invalid');
    instance.count=cursor;
    if(typeof value?.type==='function') {
      if(instance.child?.type!==value.type){unmount(instance.child);instance.child={type:value.type,props:value.props,hooks:[],pending:new Set()};}
      instance.child.props=value.props;render(instance.child);instance.output=instance.child.output;
    } else {unmount(instance.child);instance.child=undefined;instance.output=value;}
  }
  function commit(instance){if(instance.child)commit(instance.child);for(const slot of instance.pending){slot.cleanup?.();slot.cleanup=slot.next();slot.next=undefined;}instance.pending.clear();}
  function flush(){for(let iteration=0;iteration<20;iteration++){dirty=false;for(const root of roots)render(root);for(const root of roots)commit(root);if(!dirty)return;}throw new Error('render feedback did not settle');}
  return {React,flush,
    mount(type,props={}){const root={type,props,hooks:[],pending:new Set()};roots.add(root);flush();return {get output(){return root.output;},update(props){root.props=props;flush();},unmount(){roots.delete(root);unmount(root);}};},
    dispose(){for(const root of roots)unmount(root);roots.clear();},
  };
}

function chat({id=1,status='open',reason='completed',working=false,toolName}={}) {
  const turn={turn:id,status};
  if(status==='closed')turn.end={seq:id*10+9,data:{reason:{kind:reason}}};
  return {timeline:{turnOrder:[id],turns:new Map([[id,turn]])},legacy:{runningCalls:working?[{turn:id,phase:'start',callId:'tool-1',name:toolName}]:[]}};
}
function fixture(t, {receipts=false,receiptMountFailures=0,receiptCleanupGate,visualClock} = {}) {
  const prior=globalThis.document;
  class Element {attributes={};children=[];style={setProperty(){},removeProperty(){}};setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}append(...children){this.children.push(...children);}remove(){this.removed=true;}}
  globalThis.document={documentElement:new Element(),head:new Element(),body:new Element(),createElement:()=>new Element()};
  const renderer=hookRenderer();const registrations=new Map();const timers=new Map();let serial=0,created=0,disposed=0;
  const makeTracker=emit=>{created++;const tracker=createActivityTracker(emit,{schedule:callback=>{const key=++serial;timers.set(key,callback);return key;},cancel:key=>timers.delete(key)});return {update:tracker.update,dispose(){disposed++;tracker.dispose();}};};
  const ctx={slots:{entries:()=>[],inject:(name,callback)=>callback(),register:(options,component)=>{registrations.set(options.name,component);return()=>registrations.delete(options.name);}}};
  const receiptChannel = receipts ? frameRemote({mountFailures:receiptMountFailures,cleanupGate:receiptCleanupGate}) : undefined;
  if (receiptChannel) {ctx.remote = receiptChannel.remote;ctx.get = receiptChannel.ctx.get;}
  const catalog=Object.fromEntries(['serene','maid'].map(id=>[id,{id,name:id,portrait:id+'-avatar',scenes:Object.fromEntries(['idle','thinking','working','reading','writing','searching','executing','delegating','waiting','complete','error','answering','parallel','compacting','retrying','queued','connecting','disconnected','stopped','paused','blocked'].map(state=>[state,id+'-'+state]))}]));
  let receiptCreated=0,receiptDisposed=0;
  const makeReceipts=context=>{receiptCreated++;const reader=createReceiptClient(context);return {...reader,dispose(){receiptDisposed++;return reader.dispose();}};};
  const controller=mountCharacterSurfaces(ctx,catalog,renderer.React,makeTracker,{},undefined,receipts?makeReceipts:undefined,createTurnGreetingTracker,visualClock);controller.update({asset:'maid',enabled:true,palette:'light',mode:'dynamic'});
  const listeners=new Set();const source={session:{running:true},status:new Map(),chat:chat(),sessions:{byId:{one:{retainedBy:{mainView:1}},two:{retainedBy:{sidebarChat:1}}},projectionsBySession:{}},events:{revision:0,entries:[],change:{kind:'replace',entries:[]}},jobs:{rows:{},observed:{}}};
  const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  const useSource=key=>selector=>renderer.React.useSyncExternalStore(subscribe,()=>selector(source[key]));
  const props=sessionId=>({sessionId,useSession:useSource('session'),useSessionStatus:useSource('status'),useChat:useSource('chat'),useSessions:useSource('sessions')});
  let watchers=0;const eventSource={getSnapshot:()=>source.events,subscribe};ctx.sessions={binding:()=>({eventSource})};
  ctx.jobs={state:{getSnapshot:()=>source.jobs,subscribe},watchRows(){watchers++;let live=true;return()=>{if(live){live=false;watchers--;}};}};
  t.after(()=>{renderer.dispose();controller.dispose();globalThis.document=prior;});
  return {controller,renderer,registrations,props,timers,source,services:ctx,eventSource,receiptChannel,
    get listenerCount(){return listeners.size;},
    set(next){Object.assign(source,next);for(const listener of [...listeners])listener();renderer.flush();},
    get receiptCreated(){return receiptCreated;},get receiptDisposed(){return receiptDisposed;},
    get created(){return created;},get disposed(){return disposed;},get watchers(){return watchers;},
    driver(options=props('one')){const component=registrations.get('conversation.input.right');assert.equal(typeof component,'function','a persistent driver must be registered apart from header chrome');return renderer.mount(component,options);},
  };
}

test('main driver admits a new-turn greeting once; child mounts and reconnects cannot replay it',t=>{
  const f=fixture(t),requests=[];f.controller.subscribe(()=>{if(f.controller.greetingRequest)requests.push(f.controller.greetingRequest);});
  const main=f.driver();assert.equal(f.controller.greetingRequest,undefined);
  const row={event:{seq:21,type:'turn/start',data:{turn:2}}};
  f.set({chat:chat({id:2}),events:{revision:1,entries:[row],change:{kind:'append',entries:[row]}}});
  const request=f.controller.greetingRequest;assert.equal(request.turn,2);assert.equal(f.controller.activityState,'thinking');
  const child=f.driver(f.props('two'));assert.equal(f.controller.greetingRequest,request);child.unmount();
  f.set({chat:chat({id:2,working:true})});assert.equal(f.controller.greetingRequest,request);
  main.unmount();assert.equal(f.controller.greetingRequest,undefined);
  const again=f.driver();assert.equal(f.controller.greetingRequest,undefined,'remount establishes a silent event baseline');again.unmount();
});

test('late useChat injection waits safely then resumes the real tracker without changing hook order',t=>{
  const f=fixture(t);const pending={...f.props('one'),useChat:undefined};
  const component=f.registrations.get('conversation.input.right') || f.registrations.get('conversation.session.header.utilities');
  let driver;assert.doesNotThrow(()=>{driver=f.renderer.mount(component,pending);});
  assert.equal(driver.output,null);assert.equal(f.created,0);
  driver.update(f.props('one'));
  assert.equal(f.controller.activityState,'thinking');assert.equal(f.controller.imageSource,'maid-thinking');
  f.set({chat:chat({working:true})});assert.equal(f.controller.activityState,'working');
  driver.update(pending);assert.equal(driver.output,null);
  driver.update(f.props('one'));assert.equal(f.controller.activityState,'working');assert.equal(f.created,1);
});

test('the invisible driver tracks without registering the removed top-right badge',t=>{
  const f=fixture(t);const observed=[];f.controller.subscribe(()=>observed.push(f.controller.activityState));
  assert.equal(f.registrations.has('conversation.session.header.utilities'),false);
  f.driver();assert.equal(observed.at(-1),'thinking');
  f.set({chat:chat({working:true})});assert.equal(observed.at(-1),'working');
  f.set({status:new Map([['one',{pendingInteraction:{key:'approval'}}]])});assert.equal(observed.at(-1),'waiting');
  f.set({session:{running:false},status:new Map(),chat:chat({status:'closed'})});
  assert.equal(f.controller.activityState,'complete');assert.equal(f.controller.imageSource,'maid-complete');
  f.controller.update({asset:'serene',enabled:true,palette:'light',mode:'dynamic'});
  assert.equal(f.registrations.has('conversation.session.header.utilities'),false);assert.equal(f.created,1);
});

test('disabled skin and character changes retain the tracker and completion evidence',t=>{
  const f=fixture(t);const driver=f.driver();assert.equal(f.controller.activityState,'thinking');
  f.controller.update({asset:'serene',enabled:false,palette:'dark',mode:'static'});f.renderer.flush();
  assert.ok(f.registrations.has('conversation.input.right'),'disabled visual skin still observes tasks');
  assert.equal(f.registrations.has('conversation.session.header.utilities'),false);
  f.set({chat:chat({working:true})});assert.equal(f.controller.activityState,'working');
  f.controller.update({asset:'maid',enabled:true,palette:'light',mode:'dynamic'});f.renderer.flush();
  f.set({session:{running:false},chat:chat({status:'closed'})});
  assert.equal(f.controller.activityState,'complete');assert.equal(f.created,1);assert.equal(f.disposed,0);
  driver.unmount();f.controller.dispose();assert.equal(f.disposed,1);assert.equal(f.timers.size,0);assert.equal(f.registrations.size,0);
});

test('switching sessions cancels prior completion and an old driver cleanup cannot reset the new owner',t=>{
  const f=fixture(t);const old=f.driver();
  f.set({session:{running:false},chat:chat({status:'closed'})});assert.equal(f.controller.activityState,'complete');
  f.set({session:{running:true},chat:chat({id:2,working:true})});
  f.set({sessions:{byId:{one:{retainedBy:{}},two:{retainedBy:{mainView:1}}},projectionsBySession:{}}});
  const current=f.driver(f.props('two'));assert.equal(f.controller.activityState,'working');assert.equal(f.timers.size,0);
  old.unmount();assert.equal(f.controller.activityState,'working');assert.equal(f.disposed,0);
  f.set({session:{running:false},chat:chat({id:2,status:'closed'})});assert.equal(f.controller.activityState,'complete');
  f.set({sessions:{byId:{three:{retainedBy:{mainView:1}}},projectionsBySession:{}}});current.update(f.props('three'));assert.equal(f.controller.activityState,'idle');assert.equal(f.timers.size,0);
});


test('the real failed-turn chain uses an error expression distinct from pending confirmation',t=>{
  const f=fixture(t);f.driver();
  f.set({status:new Map([['one',{pendingInteraction:{key:'approval'}}]])});
  const waitingSource=f.controller.imageSource;assert.equal(waitingSource,'maid-waiting');
  f.set({session:{running:false},status:new Map(),chat:chat({status:'closed',reason:'error'})});
  assert.equal(f.controller.activityState,'error');assert.equal(f.controller.imageSource,'maid-error');
  assert.notEqual(f.controller.imageSource,waitingSource);
});

test('embedded child composer cannot seize or clear the main conversation driver',t=>{
  const f=fixture(t);f.driver();const child=f.driver(f.props('two'));
  f.set({chat:chat({working:true})});assert.equal(f.controller.activityState,'working');
  child.unmount();
  f.set({session:{running:false},chat:chat({status:'closed'})});
  assert.equal(f.controller.activityState,'complete','closing an embedded child must leave the existing main driver live');
  assert.equal(f.created,1);assert.equal(f.watchers,1,'only the main view watches job rows');
});

test('public event and job sources drive compaction and release watchers on session exit',t=>{
  const f=fixture(t);const driver=f.driver();assert.equal(f.watchers,1);
  const entries=[{event:{type:'compaction/start',seq:12,data:{compactionId:'c',turn:1}}}];
  f.set({events:{revision:1,entries,change:{kind:'append',entries}}});
  assert.equal(f.controller.activityState,'compacting');
  const done=[{event:{type:'compaction/end',seq:13,data:{compactionId:'c',turn:1}}}];
  f.set({events:{revision:2,entries:[...entries,...done],change:{kind:'append',entries:done}},session:{running:false},chat:chat({status:'closed'}),jobs:{rows:{one:[{id:'job',owner:'one',status:'running'}]},observed:{}}});
  assert.equal(f.controller.activityState,'working','the still-live job must not become complete');
  f.set({jobs:{rows:{one:[{id:'job',owner:'one',status:'completed'}]},observed:{}}});assert.equal(f.controller.activityState,'complete');
  driver.unmount();assert.equal(f.watchers,0);f.controller.dispose();assert.equal(f.disposed,1);assert.equal(f.timers.size,0);
});

test('optional services can fail or be absent without breaking standard hooks, then recover',t=>{
  const g=fixture(t);g.services.sessions.binding=()=>{throw new Error('binding not ready');};
  g.services.jobs.state={getSnapshot(){throw new Error('snapshot not ready');},subscribe(){throw new Error('subscription not ready');}};
  g.services.jobs.watchRows=()=>{throw new Error('roster not ready');};
  let driver;assert.doesNotThrow(()=>{driver=g.driver();});assert.equal(g.controller.activityState,'thinking');
  g.set({chat:chat({working:true})});assert.equal(g.controller.activityState,'working');
  g.services.sessions.binding=()=>({eventSource:g.eventSource});
  g.services.jobs=undefined;
  const entries=[{event:{type:'compaction/start',seq:12,data:{compactionId:'c',turn:1}}}];
  g.set({events:{revision:1,entries,change:{kind:'append',entries}}});assert.equal(g.controller.activityState,'compacting');
  driver.update({...g.props('one'),useSessions:undefined});assert.equal(driver.output,null);
  driver.update(g.props('one'));assert.equal(g.controller.activityState,'compacting');
});

test('surface disposal releases services immediately even before React unmount commits',t=>{
  const f=fixture(t);f.driver();assert.equal(f.watchers,1);assert.ok(f.listenerCount>0);
  f.controller.dispose();assert.equal(f.watchers,0);
  // Standard native selector hooks are owned by React; only direct service
  // subscriptions are released by the surface immediately.
  assert.equal(f.listenerCount,4);assert.equal(f.disposed,1);assert.equal(f.timers.size,0);
  assert.doesNotThrow(()=>f.set({session:{running:false},chat:chat({status:'closed'})}));
  assert.equal(f.controller.activityState,'thinking');assert.equal(f.listenerCount,0);
});

test('a transient subscription failure retries on the next native hook publication',t=>{
  const f=fixture(t);let attempts=0;const original=f.eventSource.subscribe;
  f.eventSource.subscribe=listener=>{attempts++;if(attempts===1)throw new Error('source temporarily unavailable');return original(listener);};
  f.driver();assert.equal(attempts,1);assert.equal(f.controller.activityState,'thinking');
  f.set({chat:chat({working:true})});assert.equal(attempts,2,'the next source publication must retry the same source subscription');
  const entries=[{event:{type:'compaction/start',seq:12,data:{compactionId:'c',turn:1}}}];
  f.set({events:{revision:1,entries,change:{kind:'append',entries}}});assert.equal(f.controller.activityState,'compacting');
});

test('failed job watcher admission retries on publication and stays a single stable watcher after success',t=>{
  const f=fixture(t);let attempts=0;const original=f.services.jobs.watchRows;
  f.services.jobs.watchRows=sessionId=>{attempts++;if(attempts===1)throw new Error('roster temporarily unavailable');return original(sessionId);};
  f.driver();assert.equal(attempts,1);assert.equal(f.watchers,0);assert.equal(f.controller.activityState,'thinking');
  f.set({chat:chat({working:true})});assert.equal(attempts,2,'the next native hook publication must retry failed roster admission');assert.equal(f.watchers,1);
  f.set({status:new Map([['one',{pendingInteraction:{key:'approval'}}]])});assert.equal(attempts,2);assert.equal(f.watchers,1);
  f.set({status:new Map(),jobs:{rows:{one:[{id:'job',owner:'one',status:'running'}]},observed:{}}});assert.equal(attempts,2);assert.equal(f.watchers,1);
  f.set({session:{running:false},chat:chat({status:'closed'})});assert.equal(f.controller.activityState,'working','the successfully restored roster prevents false completion');
  f.controller.dispose();assert.equal(f.watchers,0);assert.equal(f.disposed,1);assert.equal(f.timers.size,0);
});

test('connection publications reach the persistent main driver and service failure recovers without polling',t=>{
 const f=fixture(t);const listeners=new Set();let state='connecting',attempts=0;
 f.services.connection={state:{getSnapshot:()=>state,subscribe(listener){attempts++;if(attempts===1)throw new Error('late connection');listeners.add(listener);return()=>listeners.delete(listener);}}};
 f.driver();assert.equal(f.controller.activityState,'connecting');assert.equal(attempts,1);
 f.set({chat:chat({working:true})});assert.equal(attempts,2);assert.equal(listeners.size,1);
 state='disconnected';for(const listener of listeners)listener();f.renderer.flush();assert.equal(f.controller.activityState,'disconnected');
 state='connected';for(const listener of listeners)listener();f.renderer.flush();assert.equal(f.controller.activityState,'working');
 f.controller.update({asset:'maid',enabled:false});state='connecting';for(const listener of listeners)listener();f.renderer.flush();assert.equal(f.controller.activityState,'connecting');
 f.controller.dispose();assert.equal(listeners.size,0);
});


test('transient metadata publications reach the real driver, static image and one-reader cleanup',async t=>{
 const f=fixture(t,{receipts:true});f.driver();assert.equal(f.receiptCreated,1);await tick();f.renderer.flush();
 const row={seq:20,version:1,kind:'bash',sessionId:'one',turn:1,callId:'tool-1',exitCode:3,timedOut:false,signal:null};
 f.receiptChannel.send({type:'receipts',sessionId:'one',epoch:'epoch',rows:[row]});await tick();
 f.receiptChannel.send({type:'receipts',sessionId:'one',epoch:'epoch',rows:[{...row,seq:21,exitCode:0}]});await tick();f.renderer.flush();
 assert.equal(f.controller.activityState,'error');assert.equal(f.controller.imageSource,'maid-error');
 f.controller.update({asset:'serene',enabled:false,palette:'light',mode:'static'});f.renderer.flush();
 assert.equal(f.receiptCreated,1,'palette/asset/disable must not create another receipt reader');
 f.controller.update({asset:'serene',enabled:true,palette:'light',mode:'static'});f.renderer.flush();assert.equal(f.controller.imageSource,'serene-error');
 f.set({events:{revision:1,entries:[],change:{kind:'append',entries:[]}}});
 const timer=[...f.timers.values()][0];f.timers.clear();timer();assert.equal(f.controller.activityState,'thinking');
 const listeners=f.listenerCount;f.controller.dispose();await tick();assert.equal(f.receiptDisposed,1);assert.equal(f.receiptChannel.watchers,0);assert.equal(f.receiptChannel.releases,1);assert.equal(f.listenerCount,4,'only native selector hooks remain until React unmount');assert.ok(listeners>f.listenerCount);assert.equal(f.watchers,0);f.renderer.dispose();assert.equal(f.listenerCount,0);
});
test('failed Remote admission recovers on a standard publication without polling or duplicate readers',async t=>{
 const f=fixture(t,{receipts:true,receiptMountFailures:1});f.driver();await tick();assert.equal(f.receiptChannel.mounts.length,1);assert.equal(f.receiptChannel.watchers,0);
 f.set({chat:chat({working:true})});await tick();f.renderer.flush();assert.equal(f.receiptChannel.mounts.length,2);assert.equal(f.receiptChannel.watchers,1);
 for(let i=0;i<3;i++)f.set({chat:chat({working:true})});await tick();assert.equal(f.receiptCreated,1);assert.equal(f.receiptChannel.watchers,1);assert.equal(f.receiptChannel.mounts.length,2);
 f.controller.dispose();await tick();assert.equal(f.receiptChannel.watchers,0);assert.equal(f.receiptChannel.releases,1);
});

test('fresh Cordis jobs trace proxies do not repeatedly release a successfully admitted roster',t=>{
 const f=fixture(t),native=f.services.jobs;let admissions=0,releases=0;
 const original=native.watchRows;native.watchRows=sessionId=>{admissions++;const release=original(sessionId);return()=>{releases++;release();};};
 Object.defineProperty(f.services,'jobs',{get:()=>new Proxy(native,{}),configurable:true});f.driver();assert.equal(admissions,1);
 for(let i=0;i<3;i++)f.set({chat:chat({working:true})});assert.equal(admissions,1,'normal publications must retain the same native roster lease');assert.equal(releases,0);assert.equal(f.watchers,1);
 f.controller.dispose();assert.equal(releases,1);assert.equal(f.watchers,0);
});

test('character owner returns receipt quiescence after synchronous visual and watcher teardown',async t=>{
 let finish;const f=fixture(t,{receipts:true,receiptCleanupGate:new Promise(resolve=>finish=resolve)});f.driver();await tick();
 const cleanup=f.controller.dispose();assert.equal(typeof cleanup?.then,'function','plugin owner must be able to await transient receipt cleanup');assert.equal(f.watchers,0);await tick();assert.equal(f.receiptChannel.releases,0);
 finish();await cleanup;assert.equal(f.receiptChannel.releases,1);assert.equal(f.receiptChannel.watchers,0);
});


test('reply ending retains the answering pose after completion expires without changing lifecycle labels',t=>{
  const f=fixture(t);f.set({session:{running:false},chat:undefined});f.driver();
  assert.equal(f.controller.activityState,'idle');assert.equal(f.controller.visualState,'idle');assert.equal(f.controller.imageSource,'maid-idle');
  f.set({session:{running:true},chat:chat()});assert.equal(f.controller.visualState,'thinking');
  f.set({session:{running:false},chat:chat({status:'closed'})});assert.equal(f.controller.activityState,'complete');assert.equal(f.controller.visualState,'complete');assert.equal(f.controller.imageSource,'maid-complete');
  const timer=[...f.timers.values()][0];f.timers.clear();timer();
  assert.equal(f.controller.activityState,'idle');assert.equal(f.controller.visualState,'answering');assert.equal(f.controller.imageSource,'maid-answering');
});

test('historical successful reply changes the pose even when tracker stays idle, and new empty session resets it',t=>{
  const f=fixture(t),observed=[];f.set({session:{running:false},chat:undefined});const driver=f.driver();f.controller.subscribe(()=>observed.push([f.controller.activityState,f.controller.visualState]));
  f.set({chat:chat({status:'closed'})});assert.equal(f.controller.activityState,'idle');assert.equal(f.controller.visualState,'answering');assert.deepEqual(observed.at(-1),['idle','answering']);assert.equal(f.timers.size,0,'historical reply must not celebrate');
  f.set({chat:undefined,sessions:{byId:{two:{retainedBy:{mainView:1}}},projectionsBySession:{}}});driver.update(f.props('two'));
  assert.equal(f.controller.activityState,'idle');assert.equal(f.controller.visualState,'idle');assert.equal(f.controller.imageSource,'maid-idle');
});

test('failed, cancelled, missing-end and newly submitted turns cannot inherit the reply rest pose',t=>{
  const f=fixture(t);f.set({session:{running:false},chat:chat({status:'closed'})});f.driver();assert.equal(f.controller.visualState,'answering');
  for(const reason of ['error','max-tokens','aborted','interrupted','forked']) {
    f.set({chat:chat({id:2,status:'closed',reason})});assert.notEqual(f.controller.visualState,'answering',reason);
  }
  const missing=chat({id:3,status:'closed'});delete missing.timeline.turns.get(3).end;f.set({chat:missing});assert.equal(f.controller.visualState,'idle');
  f.set({chat:chat({id:4,status:'closed'})});assert.equal(f.controller.visualState,'answering');
  f.set({session:{running:false,pendingSubmissions:[{requestId:'new',placement:'transcript'}]}});assert.equal(f.controller.visualState,'queued');
  f.set({session:{running:false,awaitingFirstTurn:true}});assert.equal(f.controller.visualState,'thinking');
});

test('queued native inbox and status-running fallback remove the historical reply pose',t=>{
  const f=fixture(t);f.set({session:{running:false},chat:chat({status:'closed'})});f.driver();assert.equal(f.controller.visualState,'answering');
  f.set({sessions:{byId:{one:{retainedBy:{mainView:1}}},projectionsBySession:{one:{values:{inbox:{'next-turn':[{id:'m'}]}}}}}});assert.equal(f.controller.visualState,'queued');
  f.set({session:{},status:new Map([['one',{running:true}]]),sessions:{byId:{one:{retainedBy:{mainView:1}}},projectionsBySession:{}}});assert.equal(f.controller.visualState,'thinking');
});

test('disabled skin keeps the latest normal reply pose, but losing the main owner clears resting evidence',t=>{
  const f=fixture(t);f.driver();f.controller.update({asset:'maid',enabled:false});f.set({session:{running:false},chat:chat({status:'closed'})});
  const timer=[...f.timers.values()][0];f.timers.clear();timer();assert.equal(f.controller.activityState,'idle');
  f.controller.update({asset:'maid',enabled:true,palette:'light',mode:'dynamic'});assert.equal(f.controller.visualState,'answering');
  f.set({sessions:{byId:{one:{retainedBy:{}}},projectionsBySession:{}}});assert.equal(f.controller.visualState,'idle');
});


test('an old owner cleanup cannot erase the new main session reply rest',t=>{
  const f=fixture(t);const old=f.driver();f.set({session:{running:false},chat:chat({status:'closed'})});
  const timer=[...f.timers.values()][0];f.timers.clear();timer();
  f.set({chat:chat({id:2,status:'closed'}),sessions:{byId:{one:{retainedBy:{}},two:{retainedBy:{mainView:1}}},projectionsBySession:{}}});
  const current=f.driver(f.props('two'));assert.equal(f.controller.activityState,'idle');assert.equal(f.controller.visualState,'answering');
  old.unmount();assert.equal(f.controller.visualState,'answering');current.unmount();assert.equal(f.controller.visualState,'idle');
});


function poseClock() {
  let time=0,serial=0;const timers=new Map(),callbacks=[];
  return {timers,callbacks,now:()=>time,schedule(fn,delay){const id=++serial;timers.set(id,{fn,at:time+delay});callbacks.push(fn);return id;},cancel(id){timers.delete(id);},advance(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};
}

test('each actually shown short tool pose remains 900ms while the activity label advances immediately',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();
  for(const [name,pose] of [['read','reading'],['write','writing'],['grep','searching'],['bash','executing'],['subagent','delegating']]) {
    f.set({chat:chat({working:true,toolName:name})});assert.equal(f.controller.visualState,pose);assert.equal(f.controller.imageSource,'maid-'+pose);f.controller.acknowledgeToolPresentation(f.controller.toolPresentation,true);
    clock.advance(20);f.set({chat:chat()});assert.equal(f.controller.activityState,'thinking');assert.equal(f.controller.visualState,pose);
    clock.advance(879);assert.equal(f.controller.visualState,pose);clock.advance(1);assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);
  }
});

test('a tool already shown for 900ms has no extra departure delay or timer restart',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();f.set({chat:chat({working:true,toolName:'write'})});f.controller.acknowledgeToolPresentation(f.controller.toolPresentation,true);
  clock.advance(450);f.set({chat:chat({working:true,toolName:'write'})});clock.advance(450);assert.equal(clock.timers.size,0);assert.equal(f.controller.visualState,'writing');
  f.set({chat:chat()});assert.equal(f.controller.visualState,'thinking');
});

test('a short final tool holds only its pose before returning to the normal reply rest',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();f.set({chat:chat({working:true,toolName:'write'})});f.controller.acknowledgeToolPresentation(f.controller.toolPresentation,true);clock.advance(40);
  f.set({session:{running:false},chat:chat({status:'closed'})});assert.equal(f.controller.activityState,'complete');assert.equal(f.controller.visualState,'writing');
  clock.advance(860);assert.equal(f.controller.activityState,'complete');assert.equal(f.controller.visualState,'complete');
});

test('different observed tools replace the pending pose and stale callbacks cannot release a newer one',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();f.set({chat:chat({working:true,toolName:'write'})});const stale=clock.callbacks.at(-1);clock.advance(40);
  f.set({chat:chat({working:true,toolName:'read'})});assert.equal(f.controller.visualState,'reading');assert.equal(clock.timers.size,1);stale();assert.equal(f.controller.visualState,'reading');
  f.controller.acknowledgeToolPresentation(f.controller.toolPresentation,true);f.set({chat:chat()});clock.advance(899);assert.equal(f.controller.visualState,'reading');clock.advance(1);assert.equal(f.controller.visualState,'thinking');
});

test('error and waiting immediately interrupt a tool pose with no stale callback resurrection',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();f.set({chat:chat({working:true,toolName:'write'})});const old=clock.callbacks.at(-1),receipt=f.controller.toolPresentation;
  f.set({status:new Map([['one',{pendingInteraction:{kind:'approval'}}]])});assert.equal(f.controller.visualState,'waiting');assert.equal(clock.timers.size,0);old();assert.equal(f.controller.visualState,'waiting');assert.equal(f.controller.acknowledgeToolPresentation(receipt,true),false);
  f.set({status:new Map(),session:{running:false},chat:chat({status:'closed',reason:'error'})});assert.equal(f.controller.visualState,'error');
});

test('static, disabled, asset and reduced-motion changes cancel short-tool presentation immediately',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');const listeners=new Set(),media={matches:false,addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,writable:true,value:()=>media});t.after(()=>{if(original)Object.defineProperty(globalThis,'matchMedia',original);else delete globalThis.matchMedia;});
  const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();
  for(const patch of [{mode:'static'},{enabled:false},{asset:'serene'},{motion:'none'},'reduce']) {
    f.controller.update({asset:'maid',enabled:true,mode:'dynamic',motion:'float'});f.set({chat:chat({working:true,toolName:'write'})});f.set({chat:chat()});assert.equal(f.controller.visualState,'writing');
    if(patch==='reduce'){media.matches=true;for(const fn of listeners)fn();}else f.controller.update({asset:'maid',enabled:true,mode:'dynamic',motion:'float',...patch});
    assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);media.matches=false;
  }
  f.controller.dispose();assert.equal(listeners.size,0);
});

test('main session or next turn changes release the previous task gesture and no unobserved tool is invented',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});const driver=f.driver();f.set({chat:chat({working:true,toolName:'write'})});const stale=clock.callbacks.at(-1);
  f.set({chat:chat({id:2})});assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);
  f.set({chat:chat({id:2,working:true,toolName:'read'})});f.set({session:{running:false},chat:undefined,sessions:{byId:{two:{retainedBy:{mainView:1}}},projectionsBySession:{}}});driver.update(f.props('two'));
  assert.equal(f.controller.visualState,'idle');assert.equal(clock.timers.size,0);stale();assert.equal(f.controller.visualState,'idle');
  const entries=[{event:{type:'tool/call',seq:22,data:{turn:3,callId:'unseen',name:'write'}}},{event:{type:'tool/result',seq:23,data:{turn:3,message:{source:{callId:'unseen'},isError:false}}}}];
  f.set({session:{running:true},chat:chat({id:3}),events:{revision:1,entries,change:{kind:'append',entries}}});assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);
});


test('pause, block, disconnect, stop and disposal cannot leave a held work pose behind',t=>{
  const clock=poseClock(),f=fixture(t,{visualClock:clock});let connection='connected',id=1;
  f.services.connection={state:{getSnapshot:()=>connection,subscribe:()=>()=>{}}};f.driver();
  for(const state of ['paused','blocked','disconnected','stopped']) {
    connection='connected';f.set({session:{running:true},chat:chat({id:++id}),sessions:{byId:{one:{retainedBy:{mainView:1}}},projectionsBySession:{}}});
    f.set({chat:chat({id,working:true,toolName:'write'})});assert.equal(f.controller.visualState,'writing');const callback=clock.callbacks.at(-1);
    if(state==='paused'||state==='blocked')f.set({sessions:{byId:{one:{retainedBy:{mainView:1}}},projectionsBySession:{one:{values:{goal:{goal:{id:'g',phase:state}}}}}}});
    if(state==='disconnected'){connection=state;f.set({chat:chat({id})});}
    if(state==='stopped')f.set({session:{running:false},chat:chat({id,status:'closed',reason:'aborted'})});
    assert.equal(f.controller.activityState,state);assert.equal(f.controller.visualState,state);assert.equal(clock.timers.size,0);callback();assert.equal(f.controller.visualState,state);
  }
  f.set({session:{running:true},chat:chat({id:++id,working:true,toolName:'write'})});const callback=clock.callbacks.at(-1);assert.equal(clock.timers.size,1);f.controller.dispose();assert.equal(clock.timers.size,0);assert.doesNotThrow(callback);
});


test('a short tool waits for actual presentation before its 900ms visible hold starts',t=>{
 const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();
 f.set({chat:chat({working:true,toolName:'read'})});const request=f.controller.toolPresentation;
 f.set({chat:chat()});clock.advance(1100);
 assert.equal(f.controller.visualState,'reading','queueing and decoding must not consume the visible hold');
 assert.ok(request);assert.equal(f.controller.acknowledgeToolPresentation(request,true),true);
 clock.advance(899);assert.equal(f.controller.visualState,'reading');clock.advance(1);assert.equal(f.controller.visualState,'thinking');
});

test('unpainted or failed tool artwork releases after a bounded wait and stale receipts never revive it',t=>{
 const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();
 f.set({chat:chat({working:true,toolName:'read'})});const expired=f.controller.toolPresentation;f.set({chat:chat()});
 clock.advance(2999);assert.equal(f.controller.visualState,'reading');clock.advance(1);assert.equal(f.controller.visualState,'thinking');
 assert.equal(f.controller.acknowledgeToolPresentation(expired,true),false);assert.equal(clock.timers.size,0);
 f.set({chat:chat({working:true,toolName:'write'})});const failed=f.controller.toolPresentation;f.set({chat:chat()});
 assert.equal(f.controller.acknowledgeToolPresentation(failed,false),true);assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);
});

test('presentation receipts validate the latest tool, asset and admission and cannot extend a shown hold',t=>{
 const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();
 f.set({chat:chat({working:true,toolName:'read'})});const old=f.controller.toolPresentation;
 f.set({chat:chat({working:true,toolName:'write'})});const current=f.controller.toolPresentation;
 assert.ok(current);assert.equal(f.controller.acknowledgeToolPresentation(old,true),false);
 assert.equal(f.controller.acknowledgeToolPresentation({...current,asset:'serene'},true),false);
 assert.equal(f.controller.acknowledgeToolPresentation(current,true),true);f.set({chat:chat()});clock.advance(450);
 assert.equal(f.controller.acknowledgeToolPresentation(current,true),false);clock.advance(450);assert.equal(f.controller.visualState,'thinking');
 f.set({chat:chat({working:true,toolName:'read'})});const moved=f.controller.toolPresentation;f.controller.update({asset:'serene',enabled:true,mode:'dynamic'});
 assert.equal(f.controller.acknowledgeToolPresentation(moved,true),false);assert.equal(clock.timers.size,0);
});

test('opening and unavailable surfaces discard old tool holds without replaying them when revealed',t=>{
 const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();f.set({chat:chat({working:true,toolName:'read'})});
 const request=f.controller.toolPresentation;assert.ok(request);f.controller.setToolPresentationSuppressed(true);f.set({chat:chat()});
 assert.equal(f.controller.visualState,'thinking');assert.equal(clock.timers.size,0);f.controller.setToolPresentationSuppressed(false);
 assert.equal(f.controller.visualState,'thinking');assert.equal(f.controller.acknowledgeToolPresentation(request,true),false);
 f.set({chat:chat({working:true,toolName:'read'})});assert.ok(f.controller.toolPresentation);
});

test('real renderer queue and slow decode preserve a short Read until 900ms after its dissolve finishes',async t=>{
 const clock=poseClock(),f=fixture(t,{visualClock:clock});f.driver();const images=[],animations=[];
 class PixelElement {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.naturalWidth=1024;this.naturalHeight=1536;this.style={setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';}};}
  append(el){this.children.push(el);}setAttribute(k,v){this[k]=v;}removeAttribute(k){delete this[k];}remove(){}dispatchEvent(){}
  animate(frames,options){const a={frames,options,cancel(){}};animations.push(a);return a;}
 }
 const testDocument=document,prior=document.createElement;document.createElement=tag=>{const e=new PixelElement(tag);if(tag==='img')images.push(e);return e;};
 const output=new PixelElement('container'),visual=mountVisual(output,{schedule:clock.schedule,cancel:clock.cancel});
 const skin={enabled:true,mode:'dynamic',motion:'none',size:340,opacity:1,position:'right',transitionMs:420};
 const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
 const paint=()=>{const request=f.controller.toolPresentation;const result=visual.update(skin,f.controller.imageSource,{waitForPresentation:true});Promise.resolve(result).then(ok=>{if(request)f.controller.acknowledgeToolPresentation(request,ok);});};
 const stop=f.controller.subscribe(paint);t.after(()=>{stop();visual.dispose();testDocument.createElement=prior;});
 paint();await images.find(i=>i.onload).onload();await flush();
 f.set({chat:chat({working:true})});await images.find(i=>i.onload).onload();
 f.set({chat:chat({working:true,toolName:'read'})});f.set({chat:chat()});
 clock.advance(420);const read=images.find(i=>i.onload);assert.equal(read.src,'maid-reading');
 let finishDecode;read.decode=()=>new Promise(resolve=>finishDecode=resolve);const decode=read.onload();clock.advance(650);
 assert.equal(f.controller.visualState,'reading','the former 900ms deadline cannot cancel pending decode');
 finishDecode();await decode;await flush();assert.equal(read.style.display,'block');assert.ok(animations.some(a=>a.options.duration===420));
 clock.advance(419);await flush();assert.equal(f.controller.visualState,'reading');clock.advance(1);await flush();
 clock.advance(899);assert.equal(f.controller.visualState,'reading');clock.advance(1);assert.equal(f.controller.visualState,'thinking');
});
