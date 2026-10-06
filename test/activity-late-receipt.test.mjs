import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityTracker} from '../adapters/harness/activity.mjs';

function view(id=4,closed=false) {
  const turn={turn:id,status:closed?'closed':'open',start:{seq:id*10},steps:[{step:1,status:closed?'closed':'open',data:new Map()}]};
  if(closed)turn.end={seq:id*10+9,data:{turn:id,reason:{kind:'completed'}}};
  return {timeline:{turnOrder:[id],turns:new Map([[id,turn]])},legacy:{runningCalls:closed?[]:[{turn:id,step:1,phase:'start',callId:'bash'}]}};
}
function packet({owner='one',turn=4,baseline=false,exitCode=3,admission=1,seq=1}={}) {
  return {sessionId:owner,admission,revision:baseline?1:2,baseline,rows:baseline?[]:[{version:1,kind:'bash',sessionId:owner,turn,callId:'bash',seq,exitCode,timedOut:false,signal:null}]};
}
function fixture() {
  let serial=0;const states=[],timers=new Map();
  const tracker=createActivityTracker(state=>states.push(state),{schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel(id){timers.delete(id);}});
  return {states,timers,tracker,update(chat,receipts,{owner='one',running=chat?.timeline.turns.get(chat.timeline.turnOrder.at(-1))?.status==='open',session={},jobs}={}) {
    tracker.update(owner,{running,...session},{},chat,{receipts,jobs});
  },fire(ms) {const entry=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(entry,`a ${ms}ms timer exists`);timers.delete(entry[0]);entry[1].fn();}};
}
test('a fresh failure after completed publication gets an error pulse and a full new completion hold',()=>{
  const f=fixture(),baseline=packet({baseline:true});
  f.update(view(),baseline);f.update(view(4,true),baseline);
  assert.equal(f.states.at(-1),'complete');
  f.update(view(4,true),packet());
  assert.equal(f.states.at(-1),'error','a separate receipt publication must survive the earlier terminal render');
  assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[4000],'the previous completion hold is cancelled');
  f.fire(4000);assert.equal(f.states.at(-1),'complete');
  assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[6000]);
  f.fire(6000);assert.equal(f.states.at(-1),'idle');f.tracker.dispose();
});
test('a delayed failure still belongs to the observed current turn after its initial completion hold expires',()=>{
  const f=fixture(),baseline=packet({baseline:true});f.update(view(),baseline);f.update(view(4,true),baseline);f.fire(6000);
  assert.equal(f.states.at(-1),'idle');f.update(view(4,true),packet());assert.equal(f.states.at(-1),'error');f.tracker.dispose();
});
test('late success does not restart or interrupt an existing completion hold',()=>{
  const f=fixture(),baseline=packet({baseline:true});f.update(view(),baseline);f.update(view(4,true),baseline);
  const timer=[...f.timers.keys()][0];f.update(view(4,true),packet({exitCode:0}));
  assert.equal(f.states.at(-1),'complete');assert.deepEqual([...f.timers.keys()],[timer]);f.tracker.dispose();
});
test('a closed historical turn never claims an error from later metadata',()=>{
  const f=fixture();f.update(view(4,true),packet({baseline:true}));f.update(view(4,true),packet());
  assert.deepEqual(f.states,['idle']);assert.equal(f.timers.size,0);f.tracker.dispose();
});
test('new turn, new submission and session switch each invalidate the earlier receipt admission',()=>{
  for(const boundary of ['turn','submission','session']) {
    const f=fixture(),baseline=packet({baseline:true});f.update(view(),baseline);f.update(view(4,true),baseline);
    if(boundary==='turn') {f.update(view(5),baseline);f.update(view(5),packet());assert.equal(f.states.at(-1),'working');}
    if(boundary==='submission') {const session={pendingSubmissions:[{requestId:'next',placement:'transcript'}]};f.update(view(4,true),baseline,{session});f.update(view(4,true),packet(),{session});assert.equal(f.states.at(-1),'queued');}
    if(boundary==='session') {f.update(view(4,true),packet({owner:'two',baseline:true}),{owner:'two'});f.update(view(4,true),packet({owner:'two'}),{owner:'two'});assert.equal(f.states.at(-1),'idle');}
    assert.equal([...f.timers.values()].some(timer=>timer.ms===4000),false);f.tracker.dispose();
  }
});
test('a late local failure does not turn a known live background job into completion',()=>{
  const f=fixture(),baseline=packet({baseline:true});f.update(view(),baseline);f.update(view(4,true),baseline);
  const jobs=[{id:'background',owner:'one',status:'running'}];f.update(view(4,true),packet(),{jobs});
  assert.equal(f.states.at(-1),'error');f.fire(4000);assert.equal(f.states.at(-1),'working');
  assert.equal([...f.timers.values()].some(timer=>timer.ms===6000),false);f.tracker.dispose();
});
