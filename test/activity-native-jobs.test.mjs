import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityTracker} from '../adapters/harness/activity.mjs';

// rc.2 bash waitOnJob removes a settled foreground job before returning its
// result. job.list coalesces settlement and removal into an empty roster;
// ClientJobsModel then exposes no per-session key. This is a main-turn
// completion test, not a claim that an absent background job succeeded.
function chat(closed=false) {
  const turn={turn:2,start:{seq:28,type:'turn/start',data:{turn:2}},status:closed?'closed':'open',
    steps:[{turn:2,step:3,status:closed?'closed':'open',data:new Map()}],data:new Map()};
  if (closed) turn.end={seq:47,type:'turn/end',data:{turn:2,reason:{kind:'completed'}}};
  return {timeline:{turnOrder:[2],turns:new Map([[2,turn]])},legacy:{runningCalls:[],nodes:[],partial:null}};
}
function fixture(t) {
  const states=[],timers=new Map();let serial=0;
  const tracker=createActivityTracker(state=>states.push(state),{
    schedule(callback,delay){const id=++serial;timers.set(id,{callback,delay});return id;},
    cancel(id){timers.delete(id);},
  });
  t.after(()=>tracker.dispose());
  return {states,timers,update(running,closed,jobs){tracker.update('native-main',{running,awaitingFirstTurn:false}, {}, chat(closed),{jobs});},
    expire(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.callback();}};
}
const job={id:'native-foreground',kind:'bash',owner:'native-main',status:'running'};

test('native coalesced foreground removal cannot hide an observed completed main turn',t=>{
  const f=fixture(t);
  f.update(true,false,[]);
  f.update(true,false,[job]);assert.equal(f.states.at(-1),'working');
  // The final per-session key disappears before the following model step.
  f.update(true,false,undefined);assert.equal(f.states.at(-1),'thinking');
  f.update(false,true,undefined);
  assert.equal(f.states.at(-1),'complete','typed current turn/end completed must reach the six-second completion reaction');
  assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,6000);
  f.expire();assert.equal(f.states.at(-1),'idle');assert.equal(f.timers.size,0);
});

test('a positively live owned background job still postpones current main completion',t=>{
  const f=fixture(t);f.update(true,false,[job]);f.update(false,true,[job]);
  assert.equal(f.states.at(-1),'working');assert.equal(f.timers.size,0);
  f.update(false,true,[{...job,status:'completed'}]);assert.equal(f.states.at(-1),'complete');
});

test('roster disappearance without a typed main turn end does not invent completion or failure',t=>{
  const f=fixture(t);f.update(true,false,[job]);f.update(false,false,undefined);
  assert.equal(f.states.at(-1),'idle');assert.equal(f.timers.size,0);
});

test('opening an old completed main turn remains silent without observed activity',t=>{
  const f=fixture(t);f.update(false,true,undefined);assert.equal(f.states.at(-1),'idle');assert.equal(f.timers.size,0);
});
