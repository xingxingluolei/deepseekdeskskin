import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortraitPresence} from '../src/presence.mjs';

function fixture(options={}) {
  let now=0,serial=0;
  const timers=new Map(),expired=[],changes=[];
  const presence=createPortraitPresence(snapshot=>changes.push({at:now,snapshot}),{
    ...options,
    schedule(fn,ms){const id=++serial;timers.set(id,{at:now+ms,fn});return id;},
    cancel(id){const timer=timers.get(id);if(timer)expired.push(timer.fn);timers.delete(id);},
  });
  let input={asset:'serene',enabled:true,composed:true,animated:true,busy:false};
  const update=patch=>presence.update(input={...input,...patch});
  function advance(ms) {
    const until=now+ms;
    while(true) {
      const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>until)break;
      now=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    now=until;
  }
  return {presence,changes,timers,expired,update,advance};
}
const clear={phase:'clear',opacityFactor:1,veilOpacity:0,durationMs:0};
const hold={phase:'hold',opacityFactor:1,veilOpacity:0,durationMs:0};
const focus={phase:'focus',opacityFactor:.58,veilOpacity:1,durationMs:3200};

test('new task remains clear through loading and all greeting frames before starting its work hold',()=>{
  const f=fixture();assert.deepEqual(f.update({hero:true}),clear);
  assert.deepEqual(f.update({hero:false,busy:true,requestKey:'session:1',greeting:true}),clear);
  f.advance(4600);assert.equal(f.timers.size,0,'image preparation and greeting consume none of the work hold');
  const held=f.update({greeting:false});assert.equal(held.phase,'hold');assert.equal(held.opacityFactor,1);assert.equal(held.veilOpacity,0);
  f.advance(2399);assert.strictEqual(f.presence.getSnapshot(),held);assert.equal(f.changes.length,0);
  f.advance(1);assert.deepEqual(f.presence.getSnapshot(),focus);assert.equal(f.changes[0].at,7000);
});

test('unchanged busy publications keep one deadline and a stable frozen snapshot',()=>{
  const f=fixture();const initial=f.update({busy:true});assert.deepEqual(initial,hold);assert.ok(Object.isFrozen(initial));
  for(let index=0;index<23;index++){f.advance(100);assert.strictEqual(f.update({busy:true}),initial);assert.equal(f.timers.size,1);}
  f.advance(100);const focused=f.presence.getSnapshot();assert.deepEqual(focused,focus);assert.ok(Object.isFrozen(focused));
  assert.strictEqual(f.update({busy:true}),focused);f.advance(30_000);assert.equal(f.changes.length,1);
});

test('a fast completed reply never fades, including completion before its greeting ends',()=>{
  for(const greeting of [false,true]){
    const f=fixture();f.update({busy:true,requestKey:'one',greeting});f.advance(600);
    f.update({busy:false});f.advance(2200);f.update({greeting:false});f.advance(10_000);
    assert.equal(f.presence.getSnapshot().phase,'clear');assert.equal(f.presence.getSnapshot().veilOpacity,0);assert.equal(f.timers.size,0);assert.equal(f.changes.length,0);
    for(const callback of f.expired)callback();assert.equal(f.changes.length,0,'cancelled timer cannot fade the completed response');
  }
});

test('a new request during focus recovers smoothly then gets a new full hold',()=>{
  const f=fixture();f.update({busy:true,requestKey:'one'});f.advance(2400);assert.equal(f.presence.getSnapshot().phase,'focus');
  assert.deepEqual(f.update({requestKey:'two'}),{...hold,durationMs:800});assert.equal(f.changes.length,1,'synchronous input never calls onChange');
  f.advance(2399);assert.equal(f.presence.getSnapshot().phase,'hold');f.advance(1);assert.deepEqual(f.presence.getSnapshot(),focus);assert.equal(f.changes.length,2);
});

test('completion and attention recover without a waiting timer; another busy burst starts its own hold',()=>{
  const f=fixture();f.update({busy:true,requestKey:'one'});f.advance(2400);
  assert.deepEqual(f.update({busy:false}),{...clear,durationMs:800});assert.equal(f.timers.size,0);
  f.advance(1000);const held=f.update({busy:true});assert.equal(held.phase,'hold');f.advance(2399);assert.strictEqual(f.presence.getSnapshot(),held);f.advance(1);assert.deepEqual(f.presence.getSnapshot(),focus);
});

test('asset changes and request withdrawal cancel stale timers and start a fresh hold',()=>{
  for(const change of [{asset:'maid'},{requestKey:undefined}]){
    const f=fixture();f.update({busy:true,requestKey:'one'});f.advance(2100);const held=f.update(change);
    assert.equal(held.phase,'hold');assert.equal(f.timers.size,1);
    for(const callback of f.expired)callback();assert.strictEqual(f.presence.getSnapshot(),held);assert.equal(f.changes.length,0);
    f.advance(2399);assert.strictEqual(f.presence.getSnapshot(),held);f.advance(1);assert.equal(f.changes.length,1);assert.equal(f.changes[0].at,4500);
  }
});

test('hero and greeting clear an existing focus and defer the next hold until both end',()=>{
  const f=fixture();f.update({busy:true});f.advance(2400);
  assert.deepEqual(f.update({hero:true,greeting:true}),{...clear,durationMs:800});f.advance(5000);assert.equal(f.timers.size,0);
  f.update({hero:false});f.advance(5000);assert.equal(f.timers.size,0);
  f.update({greeting:false});assert.equal(f.timers.size,1);f.advance(2400);assert.deepEqual(f.presence.getSnapshot(),focus);
});

test('static or reduced motion has immediate targets and switching to animation starts a fresh hold',()=>{
  const f=fixture();assert.deepEqual(f.update({animated:false,busy:true}),{...focus,durationMs:0});assert.equal(f.timers.size,0);
  assert.deepEqual(f.update({busy:false}),clear);f.update({busy:true});
  assert.deepEqual(f.update({animated:true}),{...hold,durationMs:800});f.advance(1200);
  assert.deepEqual(f.update({animated:false}),{...focus,durationMs:0});assert.equal(f.timers.size,0);
  for(const callback of f.expired)callback();assert.equal(f.changes.length,0);
  assert.deepEqual(f.update({hero:true}),clear,'even a static hero remains clear');
});

test('disabled and custom images clear without animation, re-enabling starts a fresh busy hold',()=>{
  for(const flag of ['enabled','composed']){
    const f=fixture();f.update({busy:true});f.advance(2300);
    assert.deepEqual(f.update({[flag]:false}),clear);assert.equal(f.timers.size,0);f.advance(5000);
    const held=f.update({[flag]:true});assert.equal(held.phase,'hold');f.advance(2399);assert.strictEqual(f.presence.getSnapshot(),held);f.advance(1);assert.deepEqual(f.presence.getSnapshot(),focus);
  }
});

test('disposing cancels work and late callbacks or updates cannot change the snapshot',()=>{
  const f=fixture();const snapshot=f.update({busy:true});f.presence.dispose();assert.equal(f.timers.size,0);
  for(const callback of f.expired)callback();assert.strictEqual(f.update({requestKey:'later'}),snapshot);assert.equal(f.changes.length,0);assert.equal(f.timers.size,0);
  f.presence.dispose();
});

test('onChange can synchronously publish a new input without leaving a stale fade',()=>{
  let fire,cancelled=false,presence,seen=0;
  presence=createPortraitPresence(snapshot=>{seen++;assert.equal(snapshot.phase,'focus');presence.update({busy:false});},{schedule(fn){fire=fn;return 1;},cancel(){cancelled=true;}});
  presence.update({busy:true});fire();assert.equal(seen,1);assert.equal(presence.getSnapshot().phase,'clear');assert.equal(presence.getSnapshot().durationMs,800);assert.equal(cancelled,false);presence.dispose();
});

test('configured durations preserve phase targets and one asynchronous deadline',()=>{
  const f=fixture({holdMs:100,fadeMs:900,recoverMs:200});f.update({busy:true});f.advance(99);assert.equal(f.changes.length,0);f.advance(1);
  assert.deepEqual(f.presence.getSnapshot(),{...focus,durationMs:900});assert.deepEqual(f.update({busy:false}),{...clear,durationMs:200});
});
