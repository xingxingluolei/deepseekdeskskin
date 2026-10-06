import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityTracker} from '../adapters/harness/activity.mjs';

const tool = (name,extra={}) => ({turn:1,step:1,phase:'start',callId:name,name,subCalls:[],...extra});
function chat({id=1,closed=false,calls=[],nodes=[]}={}) {
  const turn={turn:id,status:closed?'closed':'open',start:{seq:id*100},steps:[{step:1,status:closed?'closed':'open',data:new Map()}]};
  if(closed) turn.end={seq:id*100+99,data:{turn:id,reason:{kind:'completed'}}};
  return {timeline:{turnOrder:[id],turns:new Map([[id,turn]])},legacy:{runningCalls:calls,nodes}};
}
function harness() {
  const states=[],timers=new Map();let serial=0;
  const tracker=createActivityTracker(state=>states.push(state),{schedule(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},cancel(id){timers.delete(id);}});
  return {states,timers,tracker,update(view=chat(),context={},session={running:true},status={},sessionId='one'){tracker.update(sessionId,session,status,view,context);},fire(ms){const timer=[...timers].find(([,v])=>v.ms===ms);assert.ok(timer);timers.delete(timer[0]);timer[1].fn();}};
}
const entry=(type,seq,data)=>({event:{type,seq,data}});
const window=(entries=[],revision=0,change={kind:'replace',entries})=>({entries,revision,change});
const append=(prior,...entries)=>window([...prior.entries,...entries],prior.revision+1,{kind:'append',entries});

test('live official tool names select distinct work gestures without looking at inputs',()=>{
  const states={reading:['read','read_image','web_fetch'],writing:['write','edit','apply_patch'],searching:['grep','glob','search','web_search'],executing:['bash','pwsh','exec_command','write_stdin','run_code'],delegating:['subagent','create_subagent','subagent_create']};
  for(const [expected,names] of Object.entries(states)) for(const name of names) {
    const h=harness();h.update(chat({calls:[tool(name,{argsRaw:'{"description":"please write, search, read then bash"}'})]}));
    assert.equal(h.states.at(-1),expected,name);h.tracker.dispose();
  }
  for(const name of [undefined,'unrelated_write','mcp__foo__read','load_workspace_dependencies','read_this_text']) {
    const h=harness();h.update(chat({calls:[tool(name,{callId:'unknown',argsRaw:'{"text":"write"}'})]}));assert.equal(h.states.at(-1),'working');h.tracker.dispose();
  }
});

test('only active current-turn leaves classify; wrappers, history and preparing are not work',()=>{
  const h=harness(),root=tool('run_code',{callId:'root',subCalls:[tool('write'),{kind:'tool-result',callId:'old',call:{name:'read'},subCalls:[]}]});
  h.update(chat({calls:[root]}));assert.equal(h.states.at(-1),'writing');
  root.subCalls=[tool('write',{phase:'preparing'})];h.update(chat({calls:[root]}));assert.equal(h.states.at(-1),'executing');
  h.update(chat({calls:[tool('write',{turn:0}),tool('read',{phase:'preparing'})]}));assert.equal(h.states.at(-1),'thinking');
  h.update(chat({closed:true,calls:[tool('write')]}),{},{running:false});assert.equal(h.states.at(-1),'complete');h.tracker.dispose();
});

test('parallel, confirmation, failure and compaction retain priority over a tool gesture',()=>{
  const h=harness();let events=window();const calls=[tool('write'),tool('read')];
  h.update(chat({calls}),{events});assert.equal(h.states.at(-1),'parallel');
  h.update(chat({calls:[tool('write')]}),{events},{running:true},{pendingInteraction:{kind:'approval'}});assert.equal(h.states.at(-1),'waiting');
  events=append(events,entry('compaction/start',103,{turn:1,compactionId:'c'}));h.update(chat({calls:[tool('write')]}),{events});assert.equal(h.states.at(-1),'compacting');
  events=append(events,entry('tool/result',104,{turn:1,message:{source:{callId:'write'},isError:true}}));h.update(chat({calls:[tool('write')]}),{events});assert.equal(h.states.at(-1),'error');h.tracker.dispose();
});

test('tool classification remains self-contained when the tracker is embedded',()=>{
  const factory=(0,eval)(`(${createActivityTracker.toString()})`);const states=[],tracker=factory(s=>states.push(s));
  tracker.update('one',{running:true},{},chat({calls:[tool('write')]}));assert.equal(states.at(-1),'writing');tracker.dispose();
});

test('late canonical tool and assistant failures are not lost after the observed completed render',()=>{
  for(const event of [entry('tool/result',150,{turn:1,message:{source:{callId:'write'},isError:true}}),entry('assistant/attempt',151,{turn:1,stream:[{type:'chunk',chunk:{type:'finish',reason:{kind:'error'}}}]})]) {
    const h=harness();let events=window();h.update(chat({calls:[tool('write')]}),{events});h.update(chat({closed:true}),{events},{running:false});assert.equal(h.states.at(-1),'complete');
    events=append(events,event);h.update(chat({closed:true}),{events},{running:false});assert.equal(h.states.at(-1),'error');
    assert.deepEqual([...h.timers.values()].map(t=>t.ms),[4000]);h.fire(4000);assert.equal(h.states.at(-1),'complete');h.fire(6000);assert.equal(h.states.at(-1),'idle');
    h.update(chat({closed:true}),{events},{running:false});assert.equal(h.timers.size,0,'same outcome cannot restart the reaction');h.tracker.dispose();
  }
});

test('late typed errors never leak into historical turns, later submissions or another session',()=>{
  for(const boundary of ['history','submission','session']) {
    const h=harness();let events=window();if(boundary!=='history')h.update(chat({calls:[tool('write')]}),{events});h.update(chat({closed:true}),{events},{running:false});
    let session={running:false},id='one';
    if(boundary==='submission'){session={running:false,pendingSubmissions:[{requestId:'next',placement:'transcript'}]};h.update(chat({closed:true}),{events},session);}
    if(boundary==='session'){id='two';h.update(chat({closed:true}),{events},session,{},id);}
    events=append(events,entry('tool/result',150,{turn:1,message:{source:{callId:'write'},isError:true}}));h.update(chat({closed:true}),{events},session,{},id);
    assert.notEqual(h.states.at(-1),'error',boundary);assert.ok(![...h.timers.values()].some(t=>t.ms===4000));h.tracker.dispose();
  }
});

test('legacy fallback sees failed PTC leaves while the root remains running and deduplicates raw metadata',()=>{
  const h=harness();let root=tool('run_code',{subCalls:[tool('write')]});h.update(chat({calls:[root]}));
  root={...root,subCalls:[{kind:'tool-result',seq:110,callId:'write',call:{name:'write'},isError:true,subCalls:[]}]};
  h.update(chat({calls:[root]}));assert.equal(h.states.at(-1),'error');h.fire(4000);assert.equal(h.states.at(-1),'executing');
  h.update(chat({calls:[root]}));assert.equal(h.timers.size,0);h.tracker.dispose();
});

test('nested legacy cancellation and unobserved historical errors remain silent',()=>{
  for(const history of [true,false]) {
    const h=harness();const failed={kind:'tool-result',seq:110,callId:'write',isError:true,subCalls:[],...(history?{}:{error:{code:'interrupted'}})};
    if(!history)h.update(chat({calls:[tool('run_code',{subCalls:[tool('write')]})]}));
    const root=tool('run_code',{subCalls:[failed]});h.update(chat({calls:[root]}));h.update(chat({calls:[root]}));assert.notEqual(h.states.at(-1),'error');assert.equal(h.timers.size,0);h.tracker.dispose();
  }
});


test('a nested fallback failure is not replayed by root settlement or the corresponding raw outcome',()=>{
  const h=harness();let events=window();const call=tool('run_code',{subCalls:[tool('write')]});h.update(chat({calls:[call]}),{events});
  const failed={kind:'tool-result',seq:110,callId:'write',call:{name:'write'},isError:true,subCalls:[]};
  h.update(chat({calls:[{...call,subCalls:[failed]}]}),{events});assert.equal(h.states.at(-1),'error');h.fire(4000);
  const root={kind:'tool-result',seq:112,callId:'run_code',isError:false,subCalls:[failed]};
  events=append(events,entry('tool/ptc-dispatch',110,{rootCallId:'run_code',subCallId:'write',isError:true}));
  h.update(chat({nodes:[root]}),{events});assert.equal(h.states.at(-1),'thinking');assert.equal(h.timers.size,0);h.tracker.dispose();
});

test('late successful or cancelled canonical outcomes do not interrupt completion',()=>{
  for(const result of [{message:{isError:false,source:{callId:'write'}}},{message:{isError:true,source:{callId:'write'}},error:{code:'ABORTED'}}]) {
    const h=harness();let events=window();h.update(chat({calls:[tool('write')]}),{events});h.update(chat({closed:true}),{events},{running:false});
    const timer=[...h.timers.keys()][0];events=append(events,entry('tool/result',150,{turn:1,...result}));h.update(chat({closed:true}),{events},{running:false});
    assert.equal(h.states.at(-1),'complete');assert.deepEqual([...h.timers.keys()],[timer]);h.tracker.dispose();
  }
});

test('recursive failure inspection is bounded for cyclic public projections',()=>{
  const h=harness(),root=tool('run_code'),child=tool('write');root.subCalls=[child];child.subCalls=[root];
  h.update(chat({calls:[root]}));assert.equal(h.states.at(-1),'writing');
  const failure={kind:'tool-result',seq:110,callId:'write',isError:true};failure.subCalls=[root];root.subCalls=[failure];
  h.update(chat({calls:[root]}));assert.equal(h.states.at(-1),'error');h.tracker.dispose();
});
