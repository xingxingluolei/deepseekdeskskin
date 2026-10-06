import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnGreetingTracker} from '../adapters/harness/greeting.mjs';
import {createTaskGreetingPlayer} from '../src/greeting.mjs';
const entry=(seq,turn,type='turn/start')=>({event:{seq,type,data:{turn}}});
const store=(revision,entries,kind='append',delta=entries)=>({revision,entries,change:{kind,entries:delta}});
const chat=(turn,status='open')=>({timeline:{turnOrder:[turn],turns:new Map([[turn,{turn,status}]])}});

test('new live turn greets once; old history, duplicate changes and tools never greet',()=>{
  assert.equal(typeof createTurnGreetingTracker,'function','new-turn greeting tracker is required');
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));
  tracker.update('a',chat(1),store(1,[entry(1,1)]),{running:true},'connected');
  assert.equal(seen.length,0);
  const next=store(2,[entry(1,1),entry(3,2)],'append',[entry(3,2)]);
  tracker.update('a',chat(2),next,{running:true},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].turn,2);
  tracker.update('a',chat(2),next,{running:true},'connected');
  tracker.update('a',chat(2),store(3,[entry(1,1),entry(3,2),entry(4,2,'tool/call')],'append',[entry(4,2,'tool/call')]),{running:true},'connected');
  assert.equal(seen.length,1);
});
test('turn event preceding chat waits for its live owner; fast closed turns are skipped',()=>{
  assert.equal(typeof createTurnGreetingTracker,'function');
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));
  const base=store(1,[entry(1,1)]);tracker.update('a',chat(1,'closed'),base,{},'connected');
  const next=store(2,[entry(1,1),entry(3,2)],'append',[entry(3,2)]);
  tracker.update('a',chat(1,'closed'),next,{},'connected');assert.equal(seen.length,0);
  tracker.update('a',chat(2),next,{running:true},'connected');assert.equal(seen.length,1);
  const fast=store(3,[entry(1,1),entry(3,2),entry(7,3)],'append',[entry(7,3)]);
  tracker.update('a',chat(3,'closed'),fast,{},'connected');assert.equal(seen.length,1);
});
test('replace, reconnect, history prepend, session switch and disposal cannot replay a greeting',()=>{
  assert.equal(typeof createTurnGreetingTracker,'function');
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));
  const base=store(5,[entry(10,1)]);tracker.update('a',chat(1),base,{running:true},'connected');
  tracker.update('a',chat(2),store(6,[entry(10,1),entry(12,2)],'replace'),{running:true},'connected');
  tracker.update('a',chat(3),store(7,[entry(13,3)],'prepend'),{running:true},'connected');
  assert.equal(seen.length,0);
  tracker.update('a',chat(4),store(8,[entry(20,4)]),{running:true},'disconnected');
  tracker.update('a',chat(4),store(9,[entry(20,4)]),{running:true},'connected');assert.equal(seen.length,0);
  tracker.update('b',chat(5),store(1,[entry(1,5)]),{running:true},'connected');assert.equal(seen.length,0);
  tracker.update('b',chat(6),store(2,[entry(1,5),entry(2,6)]),{running:true},'connected');assert.equal(seen.length,1);
  tracker.dispose();tracker.update('b',chat(7),store(3,[entry(3,7)]),{running:true},'connected');assert.equal(seen.length,1);
});
function fixture(prepare=async()=>{}){
  assert.equal(typeof createTaskGreetingPlayer,'function','interruptible greeting player is required');
  const timers=new Map(),changes=[];let serial=0;
  const player=createTaskGreetingPlayer(()=>changes.push(player.currentFrame?.source),{prepare,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),reducedMotion:()=>false});
  const frames=['away','turning','front','smile'].map(source=>({source,duration:200}));
  const input={asset:'maid',state:'thinking',enabled:true,mode:'dynamic',motion:'float',frames,request:{key:'a:1:3'}};
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  const advance=()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();};
  return {player,timers,changes,input,flush,advance};
}
test('greeting advances once, then returns to the latest real state without replay',async()=>{
  const f=fixture();f.player.update(f.input);await f.flush();assert.equal(f.player.currentFrame.source,'away');
  f.player.update({...f.input,state:'working'});f.advance();assert.equal(f.player.currentFrame.source,'turning');
  f.advance();assert.equal(f.player.currentFrame.source,'front');f.advance();assert.equal(f.player.currentFrame.source,'smile');
  f.advance();assert.equal(f.player.currentFrame,undefined);assert.equal(f.timers.size,0);
  f.player.update({...f.input,state:'answering'});await f.flush();assert.equal(f.player.currentFrame,undefined);
});
test('every attention/terminal state interrupts immediately and does not resume',async()=>{
  for(const state of ['error','waiting','stopped','paused','blocked','disconnected','connecting']){
    const f=fixture();f.player.update(f.input);await f.flush();assert.ok(f.player.currentFrame);
    f.player.update({...f.input,state});assert.equal(f.player.currentFrame,undefined,state);assert.equal(f.timers.size,0);
    f.player.update(f.input);await f.flush();assert.equal(f.player.currentFrame,undefined,'same turn does not resume');
  }
});
test('static, disabled and no-motion turns never greet when later re-enabled',async()=>{
  for(const change of [{mode:'static'},{enabled:false},{motion:'none'}]){
    const f=fixture();f.player.update({...f.input,...change});await f.flush();assert.equal(f.player.currentFrame,undefined);
    f.player.update(f.input);await f.flush();assert.equal(f.player.currentFrame,undefined);
  }
});
test('late image preparation cannot revive cancelled, switched or disposed artwork',async()=>{
  for(const kind of ['error','asset','dispose']){
    let resolve;const f=fixture(()=>new Promise(done=>{resolve=done;}));f.player.update(f.input);
    if(kind==='dispose')f.player.dispose();else f.player.update({...f.input,...(kind==='error'?{state:'error'}:{asset:'serene'})});
    resolve();await f.flush();assert.equal(f.player.currentFrame,undefined);assert.equal(f.timers.size,0);
  }
});
test('withdrawn main-view ownership cancels an in-progress greeting',async()=>{
  const f=fixture();f.player.update(f.input);await f.flush();assert.ok(f.player.currentFrame);
  f.player.update({...f.input,request:undefined});assert.equal(f.player.currentFrame,undefined);assert.equal(f.timers.size,0);
});
test('coalesced live append followed by history prepend still greets the new live turn',()=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));
  tracker.update('a',chat(1,'closed'),store(1,[entry(10,1)]),{},'connected');
  tracker.update('a',chat(2),store(3,[entry(1,9),entry(10,1),entry(15,2)],'prepend',[entry(1,9)]),{running:true},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].turn,2);
});
test('intro resources are read lazily only for an eligible new dynamic request',async()=>{
  for(const change of [{mode:'static'},{enabled:false},{request:undefined},{state:'error'},{motion:'none'},{}]){
    const f=fixture();let reads=0;const frames=()=>{reads++;return f.input.frames;};
    const input={...f.input,...change,frames};f.player.update(input);await f.flush();
    assert.equal(reads,Object.keys(change).length?0:1);
    f.player.update(input);assert.equal(reads,Object.keys(change).length?0:1,'ordinary rerender does not read keyframes');f.player.dispose();
  }
});

test('variable-length keyframes expose loading, running and finished and keep the catalog duration',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>resolve=done));
  const frames=['away','turn-1','turn-2','turn-3','front','smile'].map((source,index)=>({source,duration:index?450:350,transitionMs:180}));
  const seen=[];const stop=f.player.subscribe(()=>seen.push(f.player.getSnapshot().phase));
  const done=f.player.update({...f.input,frames});assert.equal(f.player.getSnapshot().phase,'loading');assert.equal(f.player.currentFrame,undefined);
  resolve();await f.flush();assert.equal(f.player.getSnapshot().phase,'running');
  let total=0;for(const source of ['away','turn-1','turn-2','turn-3','front','smile']){assert.equal(f.player.currentFrame.source,source);total += [...f.timers.values()][0].ms;f.advance();}
  assert.equal(f.player.getSnapshot().durationMs,2600);assert.equal(total,2600);assert.equal((await done).phase,'finished');assert.equal(f.player.getSnapshot().phase,'finished');
  assert.deepEqual(seen,['loading',...Array(6).fill('running'),'finished']);stop();f.player.dispose();
});
test('a preflight explicitly permits idle and queued but ordinary idle never reads frames',async()=>{
  for(const state of ['idle','queued']){
    const f=fixture();f.player.update({...f.input,state,allowIdle:true});await f.flush();assert.equal(f.player.currentFrame.source,'away');f.player.dispose();
    const ordinary=fixture();let reads=0;await ordinary.player.update({...ordinary.input,state,frames:()=>{reads++;return ordinary.input.frames;}});assert.equal(reads,0);assert.equal(ordinary.player.getSnapshot().phase,'skipped');ordinary.player.dispose();
  }
});
test('a short reply completing during playback keeps the remaining turn and smile frames',async()=>{
  const f=fixture();const done=f.player.update(f.input);await f.flush();f.player.update({...f.input,state:'complete'});
  assert.equal(f.player.currentFrame.source,'away');for(let index=0;index<4;index++)f.advance();assert.equal((await done).phase,'finished');f.player.dispose();
});
test('cancelled loading resolves the owned completion promise without reviving prepared frames',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>resolve=done));const done=f.player.update(f.input);
  const next=f.player.update({...f.input,state:'error'});assert.equal((await done).phase,'cancelled');assert.equal((await next).phase,'cancelled');resolve();await f.flush();assert.equal(f.player.currentFrame,undefined);f.player.dispose();
});
test('status notifications allow a synchronous ordinary render without replay or duplicate timers',async()=>{
  const timers=new Map();let player,changes=0,serial=0;
  const input={asset:'maid',state:'idle',allowIdle:true,enabled:true,mode:'dynamic',motion:'float',frames:[{source:'away',duration:1300},{source:'smile',duration:1300}],request:{key:'preflight'}};
  player=createTaskGreetingPlayer(()=>{changes++;player.update(input);},{prepare:async()=>{},reducedMotion:()=>false,schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel(id){timers.delete(id);}});
  const done=player.update(input);await Promise.resolve();await Promise.resolve();assert.equal(player.getSnapshot().phase,'running');assert.equal(timers.size,1);
  for(let index=0;index<2;index++){const[id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}
  assert.equal((await done).phase,'finished');assert.equal(timers.size,0);assert.equal(changes,4);player.dispose();
});
test('reduced motion and static preflight settle immediately without preparing the intro',async()=>{
  let prepared=0;const player=createTaskGreetingPlayer(()=>{},{prepare:async()=>prepared++,reducedMotion:()=>true});
  const done=player.update({asset:'maid',state:'idle',allowIdle:true,enabled:true,mode:'dynamic',motion:'float',request:{key:'reduced'},frames:()=>{throw Error('must remain lazy');}});
  assert.equal((await done).phase,'skipped');assert.equal(prepared,0);player.dispose();
});

test('a completion notification starting another intro resolves only the cycle that just finished',async()=>{
  const timers=new Map();let serial=0,player,nextDone;
  const first={asset:'maid',state:'idle',allowIdle:true,enabled:true,mode:'dynamic',motion:'float',frames:[{source:'away',duration:1300},{source:'smile',duration:1300}],request:{key:'first'}};
  player=createTaskGreetingPlayer(snapshot=>{if(snapshot.phase==='finished'&&snapshot.requestKey==='first')nextDone=player.update({...first,request:{key:'second'}});},{prepare:async()=>{},reducedMotion:()=>false,schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel(id){timers.delete(id);}});
  const done=player.update(first);await Promise.resolve();await Promise.resolve();
  for(let index=0;index<2;index++){const[id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}
  const result=await Promise.race([done,Promise.resolve().then(()=>Promise.resolve()).then(()=>({phase:'unresolved'}))]);
  assert.equal(result.phase,'finished');assert.equal(result.requestKey,'first');
  await Promise.resolve();assert.equal(player.getSnapshot().requestKey,'second');assert.equal(player.getSnapshot().phase,'running');
  let settled=false;nextDone.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false,'the new cycle must remain pending');player.dispose();assert.equal((await nextDone).phase,'cancelled');
});


test('a stalled image decode releases presentation within the preload budget and late images cannot restart it',async()=>{
 let resolve;const f=fixture(()=>new Promise(done=>resolve=done));const done=f.player.update(f.input);
 assert.equal(f.player.getSnapshot().phase,'loading');assert.equal([...f.timers.values()][0].ms,1800);
 f.advance();assert.equal((await done).phase,'failed');assert.equal(f.timers.size,0);
 resolve();await f.flush();assert.equal(f.player.currentFrame,undefined);assert.equal(f.player.getSnapshot().phase,'failed');f.player.dispose();
});
