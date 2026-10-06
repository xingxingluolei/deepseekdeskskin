import test from 'node:test';import assert from 'node:assert/strict';import {mountReceiptHost} from '../adapters/harness/receipt-host.mjs';import {createReceiptClient} from '../adapters/harness/receipt-client.mjs';import {createActivityTracker} from '../adapters/harness/activity.mjs';import {frameRemote,tick} from './receipt-fixture.mjs';
function chat(closed=false){const turn={turn:4,status:closed?'closed':'open',start:{seq:1},steps:[{step:1,status:closed?'closed':'open',data:new Map()}]};if(closed)turn.end={seq:6,data:{turn:4,reason:{kind:'completed'}}};return{timeline:{turnOrder:[4],turns:new Map([[4,turn]])},legacy:{runningCalls:closed?[]:[{turn:4,step:1,phase:'start',callId:'bash'}]}};}
test('official frozen result exit 3 crosses transient Remote into four-second error reaction before completed turn',async()=>{
 const callbacks=new Map(),events=[],states=[],timers=new Map(),delays=[];
 const emit=(name,...args)=>callbacks.get(name)?.(...args);
 const session={id:'one',append(type,data){const event={type,seq:events.length,data};events.push(event);emit('session/event',session,event);return event;}};
 const host=mountReceiptHost({on(name,fn){callbacks.set(name,fn);return()=>callbacks.delete(name);},provide(){return()=>{};},typert:{register(){return()=>{};}}});
 const channel=frameRemote({follow:host.service.follow.bind(host.service)}),reader=createReceiptClient(channel.ctx);
 const tracker=createActivityTracker(s=>states.push(s),{schedule(fn,ms){const id=timers.size+1;timers.set(id,fn);delays.push(ms);return id;},cancel(id){timers.delete(id);}});
 reader.watch('one');await tick();
 const update=(running,view)=>tracker.update('one',{running},{},view,{receipts:reader.state.getSnapshot()});
 update(false,undefined);session.append('turn/start',{turn:4});session.append('tool/call',{turn:4,step:1,callId:'bash',name:'bash'});update(true,chat());assert.equal(states.at(-1),'working');
 emit('tools/result',Object.freeze({name:'bash',callId:'bash',rootCallId:'bash',agent:{id:'one',session}}),Object.freeze({isError:false,value:Object.freeze({kind:'foreground',exitCode:3,timedOut:false,signal:null,aborted:false})}));
 await tick();update(true,chat());assert.equal(states.at(-1),'error');assert.equal(delays.at(-1),4000);
 session.append('tool/result',{turn:4,step:1,message:{isError:false,source:{callId:'bash'},content:[]}});session.append('turn/end',{turn:4,reason:{kind:'completed'}});update(false,chat(true));assert.equal(states.at(-1),'error','completed cannot immediately cover the local command failure');
 const fire=[...timers.values()][0];timers.clear();fire();assert.equal(states.at(-1),'complete');assert.deepEqual(events.map(event=>event.type),['turn/start','tool/call','tool/result','turn/end'],'no metadata is persisted alongside model events');
 tracker.dispose();await reader.dispose();host.dispose();
});

function trace() {
  const states=[],timers=new Map(),saved=[];let serial=0;
  const tracker=createActivityTracker(state=>states.push(state),{schedule(fn){const id=++serial;timers.set(id,fn);saved.push(fn);return id;},cancel(id){timers.delete(id);}});
  const update=(view,receipts,session={running:true},owner='one',status={})=>tracker.update(owner,session,status,view,{receipts});
  return {tracker,states,timers,saved,update,fire(){for(const[id,fn]of [...timers]){timers.delete(id);fn();}}};
}
function packet(row={},extra={}) {return {sessionId:'one',revision:1,baseline:false,rows:[{seq:100,version:1,kind:'bash',sessionId:'one',turn:4,callId:'bash',exitCode:3,timedOut:false,signal:null,...row}],...extra};}
function withTurn(id,closed=false){const view=chat(closed),turn=view.timeline.turns.get(4);turn.turn=id;turn.start.seq=id*10;if(turn.end)turn.end.data.turn=id;view.timeline={turnOrder:[id],turns:new Map([[id,turn]])};for(const call of view.legacy.runningCalls)call.turn=id;return view;}

test('typed success stays working; nonzero, timeout and signal failures each persist before latest base recovers',()=>{
  for(const outcome of [{exitCode:0},{exitCode:3},{exitCode:0,timedOut:true},{exitCode:null,signal:'SIGKILL'}]) {
    const h=trace();h.update(chat(),packet({}, {baseline:true,rows:[]}));h.update(chat(),packet(outcome));
    if(outcome.exitCode===0&&!outcome.timedOut&&!outcome.signal){assert.equal(h.states.at(-1),'working');assert.equal(h.timers.size,0);}
    else {assert.equal(h.states.at(-1),'error');h.update(chat(),packet(outcome));assert.equal(h.timers.size,1,'repeated snapshot must not restart pulse');h.fire();assert.equal(h.states.at(-1),'working');assert.equal(h.timers.size,0,'last receipt cannot replay after expiry');}
    h.tracker.dispose();
  }
});
test('a fresh receipt can arrive at the already-closed observed current turn, but reopening old receipt history is silent',()=>{
 const h=trace();h.update(chat());h.update(chat(true),packet(),{running:false});assert.equal(h.states.at(-1),'error');h.fire();assert.equal(h.states.at(-1),'complete');h.tracker.dispose();
 const old=trace();old.update(chat(true),packet({}, {baseline:true}),{running:false});assert.equal(old.states.at(-1),'idle');old.update(chat(true),packet(),{running:false});assert.equal(old.states.at(-1),'idle','unobserved old closed turn cannot claim a local reaction');old.tracker.dispose();
});
test('receipt correlation ignores wrong owners and stale turns; error pulse cannot callback into a later session',()=>{
 const h=trace();h.update(chat());h.update(chat(),packet({sessionId:'two'}));h.update(chat(),packet({turn:3}));assert.equal(h.states.at(-1),'working');h.update(chat(),packet());assert.equal(h.states.at(-1),'error');const stale=h.saved.at(-1);h.update(withTurn(1),packet({}, {sessionId:'two',rows:[]}),{running:true},'two');assert.equal(h.states.at(-1),'working');assert.equal(h.timers.size,0);stale();assert.equal(h.states.at(-1),'working');h.tracker.dispose();
});
test('pending confirmation keeps its priority and receipt reaction gets four visible seconds afterwards',()=>{
 const h=trace();h.update(chat());h.update(chat(),packet(),{running:true},'one',{pendingInteraction:{key:'approval'}});assert.equal(h.states.at(-1),'waiting');assert.equal(h.timers.size,0);h.update(chat(),packet({}, {rows:[]}));assert.equal(h.states.at(-1),'error');assert.equal(h.timers.size,1);h.fire();assert.equal(h.states.at(-1),'working');h.tracker.dispose();
});
test('receipt publication preceding chat admission is retained as metadata until its actual turn opens',()=>{
 const h=trace();h.update(withTurn(3),packet({}, {baseline:true,rows:[]}));h.update(withTurn(3),packet());assert.equal(h.states.at(-1),'working','future-turn receipt must not cover the previous task');h.update(chat(),packet({}, {revision:2,rows:[]}));assert.equal(h.states.at(-1),'error','next token publication must not erase the pending current-turn outcome');h.fire();assert.equal(h.states.at(-1),'working');h.tracker.dispose();
});
test('withdrawing the receipt source discards unmatched admission metadata',()=>{
 const h=trace();h.update(withTurn(3),packet({}, {baseline:true,rows:[]}));h.update(withTurn(3),packet());h.update(withTurn(3),undefined);h.update(chat(),packet({}, {baseline:true,rows:[]}));assert.equal(h.states.at(-1),'working');assert.equal(h.timers.size,0);h.tracker.dispose();
});

test('exact-parent background child error/token-limit/refusal reacts, while completed and aborted do not celebrate or stop the parent',()=>{
 for(const stopReason of ['error','max-tokens','refusal','completed','aborted']) {
  const h=trace();h.update(chat(),packet({}, {baseline:true,rows:[]}));
  const child={seq:101,version:1,kind:'subagent',sessionId:'one',parentId:'one',childId:'c',runId:'r',provider:'local',local:true,turn:null,stopReason};
  h.update(chat(),packet({}, {rows:[child]}));assert.equal(h.states.at(-1),['error','max-tokens','refusal'].includes(stopReason)?'error':'working');
  if(h.timers.size){h.fire();assert.equal(h.states.at(-1),'working');}assert.ok(!h.states.includes('complete'));assert.ok(!h.states.includes('stopped'));h.tracker.dispose();
 }
});

test('coalesced opening plus next frame discards pending metadata from the prior carrier admission',()=>{
 const h=trace();h.update(withTurn(3),packet({}, {baseline:true,rows:[],admission:1}));h.update(withTurn(3),packet({}, {admission:1}));
 h.update(withTurn(3),packet({}, {revision:3,rows:[],admission:2}));h.update(chat(),packet({}, {revision:4,rows:[],admission:2}));
 assert.equal(h.states.at(-1),'working','missed opening notification must not leak an older admission into the next turn');assert.equal(h.timers.size,0);h.tracker.dispose();
});
