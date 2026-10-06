import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnGreetingTracker} from '../adapters/harness/greeting.mjs';

// Public rc.2 SessionEventSource wrappers, ChatSnapshot timeline and
// SessionSnapshot owner flags. No event content or native UI is inspected.
const entry=(seq,type,turn)=>({event:{seq,type,data:{turn}}});
const snapshot=(revision,rows,kind='append',delta=rows)=>({revision,entries:rows,change:{kind,entries:delta}});
function chat(turn,status='open') {
  return {timeline:{turnOrder:turn===undefined?[]:[turn],turns:new Map(turn===undefined?[]:[[turn,{turn,status,steps:[],data:new Map()}]])},legacy:{nodes:[],runningCalls:[],partial:null}};
}

test('a newly selected blank main session greets its first start once despite delayed chat and running publications',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  const base=snapshot(0,[],'replace');
  tracker.update('new-session',chat(undefined),base,{running:false,blank:true,awaitingFirstTurn:false},'connected');
  const start=entry(4,'turn/start',1),started=snapshot(1,[start],'append',[start]);
  tracker.update('new-session',chat(undefined),started,{running:false,blank:false,awaitingFirstTurn:false},'connected');
  tracker.update('new-session',chat(1),started,{running:false,blank:false,awaitingFirstTurn:false},'connected');
  assert.equal(seen.length,0,'live turn ownership must precede visual admission');
  tracker.update('new-session',chat(1),started,{running:true,blank:false,awaitingFirstTurn:false},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].turn,1);
  const tool=entry(19,'tool/call',1),toolSnapshot=snapshot(2,[start,tool],'append',[tool]);
  tracker.update('new-session',chat(1),toolSnapshot,{running:true},'connected');
  tracker.update('new-session',chat(1),toolSnapshot,{running:true},'connected');
  assert.equal(seen.length,1);
});

test('chat may open before the public start event without losing first-session greeting',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  const base=snapshot(0,[],'replace');tracker.update('new-session',chat(undefined),base,{running:false,blank:true},'connected');
  tracker.update('new-session',chat(1),base,{running:true},'connected');assert.equal(seen.length,0);
  const start=entry(4,'turn/start',1);tracker.update('new-session',chat(1),snapshot(1,[start]),{running:true},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].turn,1);
});

test('opening an already-running old session establishes history instead of greeting',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  const start=entry(28,'turn/start',2),events=snapshot(8,[start],'replace');
  tracker.update('old-session',chat(2),events,{running:true},'connected');
  tracker.update('old-session',chat(2),events,{running:true},'connected');
  assert.equal(seen.length,0);
});

test('each fresh main turn in an established conversation greets once without tool or duplicate replay',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  tracker.update('new-session',chat(undefined),snapshot(0,[],'replace'),{running:false,blank:true},'connected');
  const start=entry(4,'turn/start',1);tracker.update('new-session',chat(1),snapshot(1,[start]),{running:true},'connected');
  assert.equal(seen.length,1);
  const end=entry(26,'turn/end',1);tracker.update('new-session',chat(1,'closed'),snapshot(2,[start,end],'append',[end]),{running:false},'connected');
  const next=entry(28,'turn/start',2);tracker.update('new-session',chat(2),snapshot(3,[start,end,next],'append',[next]),{running:true},'connected');
  assert.equal(seen.length,2,'a genuinely new main task may greet again in the same session');
  const nextSnapshot=snapshot(3,[start,end,next],'append',[next]);
  tracker.update('new-session',chat(2),nextSnapshot,{running:true},'connected');
  const tool=entry(34,'tool/call',2);
  tracker.update('new-session',chat(2),snapshot(4,[start,end,next,tool],'append',[tool]),{running:true},'connected');
  assert.equal(seen.length,2,'duplicates and tools within one turn must not replay the opening');
});


test('first accepted send begins the intro before the typed turn, then the same turn cannot replay it',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  const base=snapshot(0,[],'replace');
  tracker.update('new',chat(undefined),base,{blank:true,running:false},'connected');
  tracker.update('new',chat(undefined),base,{blank:false,awaitingFirstTurn:true},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].firstTurn,true);assert.equal(seen[0].key,'new:first');
  const start=entry(2,'turn/start',1);
  tracker.update('new',chat(1),snapshot(1,[start]),{running:true},'connected');
  assert.equal(seen.length,1,'confirmation of the accepted send is not another intro');
});

test('a fresh first reply published already closed still gets the intro; reopened history never does',t=>{
  const seen=[],tracker=createTurnGreetingTracker(value=>seen.push(value));t.after(()=>tracker.dispose());
  tracker.update('new',chat(undefined),snapshot(0,[],'replace'),{blank:true},'connected');
  const rows=[entry(2,'turn/start',1),entry(8,'turn/end',1)];
  tracker.update('new',chat(1,'closed'),snapshot(2,rows),{running:false},'connected');
  assert.equal(seen.length,1);assert.equal(seen[0].firstTurn,true);
  tracker.update('old',chat(1,'closed'),snapshot(2,rows,'replace'),{running:false},'connected');
  assert.equal(seen.length,1,'only a session observed blank can hold the first conversation');
});
