import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityTracker } from '../adapters/harness/activity.mjs';

function fixture({ id = 4, state = 'open', reason, calls = [], partial = null } = {}) {
  const turn = {
    turn: id,
    start: { type: 'turn/start', seq: id * 10, time: 100, data: { turn: id } },
    status: state,
    steps: [{ turn: id, step: 1, status: state, data: new Map() }],
    data: new Map(),
  };
  if (state === 'closed') turn.end = {
    type: 'turn/end', seq: id * 10 + 9, time: 200,
    data: { turn: id, reason: { kind: reason ?? 'completed' } },
  };
  return {
    timeline: { turnOrder: [id], turns: new Map([[id, turn]]) },
    legacy: { partial, runningCalls: calls },
  };
}

function harness(options = {}) {
  const states = [];
  const timers = new Map();
  const callbacks = [];
  const delays = [];
  let nextTimer = 0;
  const tracker = createActivityTracker(state => states.push(state), {
    ...options,
    schedule(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, callback);
      callbacks.push(callback);
      delays.push(delay);
      return id;
    },
    cancel(id) { timers.delete(id); },
  });
  return {
    tracker, states, timers, callbacks, delays,
    update(session, chat, status = {}, sessionId = 'one', context = {}) {
      tracker.update(sessionId, session, status, chat, context);
    },
    fireTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

test('waiting takes priority and stale prompt errors do not hide active work', () => {
  const h = harness();
  const chat = fixture({ calls: [{ turn: 4, step: 1, phase: 'start', callId: 'bash-1' }] });
  h.update({ running: true, promptError: { error: { code: 'old' } } }, chat);
  assert.equal(h.states.at(-1), 'working');
  h.update({ running: true }, chat, { pendingInteraction: { key: 'approval-1' } });
  assert.equal(h.states.at(-1), 'waiting');
});

test('preparing is thinking; historical and settled tools are never active work', () => {
  const h = harness();
  h.update({ running: true }, fixture({ calls: [{ turn: 4, phase: 'preparing' }] }));
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: true }, fixture({ calls: [
    { turn: 3, phase: 'start' },
    { turn: 4, kind: 'tool-result', phase: 'start' },
  ] }));
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: true }, fixture({ calls: [{ turn: 4, phase: 'start' }] }));
  assert.equal(h.states.at(-1), 'working');
});

test('model partial and awaiting first turn are thinking without claiming completion', () => {
  const h = harness();
  h.update({ running: true }, fixture({ partial: { turn: 4, step: 1, blocks: [{ kind: 'reasoning', text: '…' }] } }));
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: false, awaitingFirstTurn: true }, fixture({ id: 3, state: 'closed' }));
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: false }, fixture({ id: 3, state: 'closed' }));
  assert.equal(h.states.at(-1), 'idle');
});

test('whole-turn completion is celebrated once, then returns to idle after the hold', () => {
  const h = harness();
  h.update({ running: true }, fixture());
  const chat = fixture({ state: 'closed' });
  h.update({ running: false }, chat);
  assert.equal(h.states.at(-1), 'complete');
  assert.deepEqual(h.delays, [6000]);
  h.update({ running: false }, chat);
  assert.equal(h.timers.size, 1);
  h.fireTimers();
  assert.equal(h.states.at(-1), 'idle');
  h.update({ running: false }, chat);
  assert.equal(h.states.at(-1), 'idle');
  assert.equal(h.states.filter(state => state === 'complete').length, 1);
});

test('step end and tool result do not end an open whole turn', () => {
  const h = harness();
  const chat = fixture({ calls: [] });
  chat.timeline.turns.get(4).steps[0].status = 'closed';
  h.update({ running: true }, chat);
  h.update({ running: false }, chat);
  assert.equal(h.states.at(-1), 'idle');
  assert.equal(h.timers.size, 0);
});

test('historical closed turns and missing chat do not celebrate', () => {
  for (const reason of ['completed', 'aborted', 'error', 'max-tokens']) {
    const h = harness();
    h.update({ running: false }, fixture({ state: 'closed', reason }));
    assert.equal(h.states.at(-1), ['error','max-tokens'].includes(reason) ? 'error' : 'idle');
    assert.equal(h.timers.size, 0);
  }
  const h = harness();
  h.update({ running: true }, undefined);
  h.update({ running: false }, undefined);
  assert.equal(h.states.at(-1), 'idle');
  assert.equal(h.timers.size, 0);
});

test('observed turn errors and token limits become error; cancellation becomes stopped', () => {
  for (const reason of ['error', 'max-tokens', 'aborted']) {
    const h = harness();
    h.update({ running: true }, fixture());
    h.update({ running: false }, fixture({ state: 'closed', reason }));
    assert.equal(h.states.at(-1), reason === 'aborted' ? 'stopped' : 'error');
    assert.equal(h.timers.size, 0);
  }
});

test('a turn/end arriving before running:false does not lose completion evidence', () => {
  const h = harness();
  h.update({ running: true }, fixture());
  h.update({ running: true }, fixture({ state: 'closed' }));
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: false }, fixture({ state: 'closed' }));
  assert.equal(h.states.at(-1), 'complete');
});

test('a closed boundary without a reason does not invent a successful outcome', () => {
  const h = harness();
  h.update({ running: true }, fixture());
  const incomplete = fixture({ state: 'closed' });
  incomplete.timeline.turns.get(4).end.data = { turn: 4 };
  h.update({ running: false }, incomplete);
  assert.equal(h.states.at(-1), 'idle');
  assert.equal(h.timers.size, 0);
});

test('a new session cancels completion and ignores a callback already queued', () => {
  const h = harness();
  h.update({ running: true }, fixture());
  h.update({ running: false }, fixture({ state: 'closed' }));
  const staleCallback = h.callbacks[0];
  h.update({ running: false }, fixture({ id: 8, state: 'closed' }), {}, 'two');
  assert.equal(h.states.at(-1), 'idle');
  assert.equal(h.timers.size, 0);
  const count = h.states.length;
  staleCallback();
  assert.equal(h.states.length, count);
});

test('a new task resets the timer even while the previous closed turn is still the tail', () => {
  const h = harness({ holdMs: 25 });
  h.update({ running: true }, fixture());
  h.update({ running: false }, fixture({ state: 'closed' }));
  assert.deepEqual(h.delays, [25]);
  const staleCallback = h.callbacks[0];
  h.update({ running: true, awaitingFirstTurn: true }, fixture({ state: 'closed' }));
  assert.equal(h.states.at(-1), 'thinking');
  assert.equal(h.timers.size, 0);
  staleCallback();
  assert.equal(h.states.at(-1), 'thinking');
  h.update({ running: true }, fixture({ id: 5 }));
  h.update({ running: false }, fixture({ id: 5, state: 'closed' }));
  assert.equal(h.states.at(-1), 'complete');
});

test('waiting counts as activity, but an unseen new closed turn does not', () => {
  const h = harness();
  h.update({ running: false }, fixture(), { pendingInteraction: { key: 'question' } });
  h.update({ running: false }, fixture({ state: 'closed' }));
  assert.equal(h.states.at(-1), 'complete');
  h.update({ running: false }, fixture({ id: 5, state: 'closed' }));
  assert.equal(h.states.at(-1), 'idle');
});

test('prompt failures surface when idle and disposal leaves no callbacks or emissions', () => {
  const h = harness();
  h.update({ running: false, promptError: { error: { code: 'DENIED' } } }, undefined);
  assert.equal(h.states.at(-1), 'error');
  h.update({ running: true }, fixture());
  h.update({ running: false }, fixture({ state: 'closed' }));
  const staleCallback = h.callbacks[0];
  h.tracker.dispose();
  assert.equal(h.timers.size, 0);
  const count = h.states.length;
  staleCallback();
  h.update({ running: true }, fixture({ id: 5 }));
  assert.equal(h.states.length, count);
});

test('the tracker can be embedded with toString without module closures', () => {
  const embedded = (0, eval)(`(${createActivityTracker.toString()})`);
  const states = [];
  const tracker = embedded(state => states.push(state));
  tracker.update('one', { running: true }, {}, fixture());
  assert.equal(states.at(-1), 'thinking');
  tracker.dispose();
});

for (const reason of ['interrupted', 'unknown', 'done']) {
  test(`observed ${reason} terminals do not celebrate`, () => {
    const h = harness();
    h.update({ running: true }, fixture());
    const chat = fixture({ state: 'closed', reason });
    h.update({ running: false }, chat);
    assert.equal(h.states.at(-1), reason === 'interrupted' ? 'stopped' : 'idle');
    assert.equal(h.states.includes('complete'), false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.delays, []);
    h.update({ running: false }, chat);
    assert.equal(h.states.at(-1), reason === 'interrupted' ? 'stopped' : 'idle');
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.delays, []);
  });
}

function withNodes(chat, nodes) { chat.legacy.nodes = nodes; return chat; }
function eventSnapshot(revision, type, data, seq = revision + 41, kind = 'append') {
  const entries = [{event:{type,seq,time:100,data}}];
  return {revision, entries, change:{kind,entries}};
}

test('only current live text streams are answering; reasoning or preparation remain thinking', () => {
  const h = harness();
  const chat = fixture({partial:{turn:4,step:1,blocks:[{kind:'reasoning',text:'reason'},{kind:'text',text:'reply'}]}});
  h.update({running:true},chat); assert.equal(h.states.at(-1),'answering');
  chat.legacy.partial.blocks.push({kind:'reasoning',text:'next reasoning'});
  h.update({running:true},chat); assert.equal(h.states.at(-1),'thinking');
  chat.legacy.partial={turn:3,step:1,blocks:[{kind:'text',text:'old reply'}]};
  h.update({running:true},chat); assert.equal(h.states.at(-1),'thinking');
  chat.legacy.partial={turn:4,step:1,blocks:[{kind:'text',text:'reply'},{kind:'tool-call',name:'bash'}]};
  h.update({running:true},chat); assert.equal(h.states.at(-1),'thinking');
});

test('the published current assistant step is authoritative over an old partial', () => {
  const h=harness(); const chat=fixture(); const step=chat.timeline.turns.get(4).steps[0];
  step.data.set('assistant-step',{turn:4,step:1,status:'running',blocks:[{kind:'text',text:'hello'}]});
  h.update({running:true},chat);assert.equal(h.states.at(-1),'answering');
  step.data.get('assistant-step').status='settled';
  chat.legacy.partial={turn:4,step:1,blocks:[{kind:'text',text:'stale'}]};
  h.update({running:true},chat);assert.equal(h.states.at(-1),'thinking');
});

test('scheduled current retries are retrying; started, cancelled and older retries are not', () => {
  const h=harness(); const chat=withNodes(fixture(),[{kind:'model-retry',seq:42,turn:4,step:1,retryState:'scheduled'}]);
  h.update({running:true},chat);assert.equal(h.states.at(-1),'retrying');
  for(const retryState of ['started','cancelled']) {chat.legacy.nodes[0].retryState=retryState;h.update({running:true},chat);assert.equal(h.states.at(-1),'thinking');}
  chat.legacy.nodes[0]={kind:'model-retry',seq:12,turn:3,step:1,retryState:'scheduled'};
  h.update({running:true},chat);assert.equal(h.states.at(-1),'thinking');
  chat.legacy.nodes[0]={kind:'model-retry',seq:42,turn:4,step:0,retryState:'scheduled'};
  h.update({running:true},chat);assert.equal(h.states.at(-1),'thinking');
});

test('simultaneous current root tools or truly active catalog children are parallel', () => {
  const h=harness();const chat=fixture({calls:[{turn:4,phase:'start',callId:'a'},{turn:4,phase:'start',callId:'b'}]});
  h.update({running:true},chat);assert.equal(h.states.at(-1),'parallel');
  chat.legacy.runningCalls=[{turn:4,phase:'start',callId:'a'},{turn:4,phase:'start',callId:'a'}];
  h.update({running:true},chat);assert.equal(h.states.at(-1),'working','duplicate projections are one tool');
  chat.legacy.runningCalls=[];
  const context={sessions:{byId:{child:{running:false}},projectionsBySession:{one:{values:{subagentCatalog:[{id:'child'}]}}}},statuses:new Map([['child',{running:true}]])};
  h.update({running:true},chat,{},'one',context);assert.equal(h.states.at(-1),'parallel');
  context.statuses.set('child',{running:false});
  h.update({running:true},chat,{},'one',context);assert.equal(h.states.at(-1),'thinking');
});

test('explicit compaction brackets override retries and tools but never pending interaction', () => {
  const h=harness();const chat=withNodes(fixture({calls:[{turn:4,phase:'start',callId:'a'}]}),[{kind:'model-retry',seq:41,turn:4,step:1,retryState:'scheduled'}]);
  const context={events:eventSnapshot(1,'compaction/start',{compactionId:'compact-a',turn:4})};
  h.update({running:true},chat,{},'one',context);assert.equal(h.states.at(-1),'compacting');
  h.update({running:true},chat,{pendingInteraction:{key:'approval'}},'one',context);assert.equal(h.states.at(-1),'waiting');
  context.events=eventSnapshot(2,'compaction/end',{compactionId:'wrong',turn:4});
  h.update({running:true},chat,{},'one',context);assert.equal(h.states.at(-1),'compacting');
  context.events=eventSnapshot(3,'compaction/end',{compactionId:'compact-a',turn:4});
  h.update({running:true},chat,{},'one',context);assert.equal(h.states.at(-1),'retrying');
});

test('initial compaction history, a replaced source and a new session cannot leave a stale compaction', () => {
  const h=harness();const context={events:eventSnapshot(1,'compaction/start',{compactionId:'old',turn:3},12,'replace')};
  h.update({running:true},fixture(),{},'one',context);assert.equal(h.states.at(-1),'thinking');
  context.events=eventSnapshot(2,'compaction/start',{compactionId:'live',turn:4});
  h.update({running:true},fixture(),{},'one',context);assert.equal(h.states.at(-1),'compacting');
  h.update({running:true},fixture({id:8}),{},'two',{});assert.equal(h.states.at(-1),'thinking');
  context.events={revision:3,entries:[],change:{kind:'replace',entries:[]}};
  h.update({running:true},fixture(),{},'one',context);assert.equal(h.states.at(-1),'thinking');
});

test('manual compaction uses an explicit pending command and does not infer activity from completed markers', () => {
  const h=harness();const chat=withNodes(fixture({state:'closed'}),[{kind:'command',seq:50,name:'compact',outcome:null}]);
  h.update({running:false},chat);assert.equal(h.states.at(-1),'compacting');
  chat.legacy.nodes[0].outcome={kind:'success'};
  h.update({running:false},chat);assert.equal(h.states.at(-1),'idle');
  chat.legacy.nodes=[{kind:'compaction',seq:51}];
  h.update({running:false},chat);assert.equal(h.states.at(-1),'idle');
});

test('a live background job prevents a completed parent turn from falsely celebrating', () => {
  const h=harness();h.update({running:true},fixture());
  const context={jobs:[{id:'job',owner:'one',status:'running'}]};const closed=fixture({state:'closed'});
  h.update({running:false},closed,{},'one',context);assert.equal(h.states.at(-1),'working');assert.equal(h.timers.size,0);
  context.jobs[0].status='stopping';h.update({running:false},closed,{},'one',context);assert.equal(h.states.at(-1),'working');
  context.jobs[0].status='completed';h.update({running:false},closed,{},'one',context);assert.equal(h.states.at(-1),'complete');
});

test('new states remain self-contained when exported through toString', () => {
  const embedded=(0,eval)(`(${createActivityTracker.toString()})`);const states=[];
  const tracker=embedded(state=>states.push(state));
  tracker.update('one',{running:true},{},fixture({partial:{turn:4,step:1,blocks:[{kind:'text',text:'reply'}]}}));
  assert.equal(states.at(-1),'answering');tracker.dispose();
});

test('an existing event source is folded from its whole window before its last append', () => {
  const h=harness();const start={event:{type:'compaction/start',seq:42,data:{compactionId:'c',turn:4}}};
  const tail={event:{type:'step/start',seq:43,data:{turn:4,step:1}}};
  const events={revision:7,entries:[start,tail],change:{kind:'append',entries:[tail]}};
  h.update({running:true},fixture(),{},'one',{events});assert.equal(h.states.at(-1),'compacting');
});

test('a compaction admission preceding the published open turn is retained as metadata', () => {
  const h=harness();const events=eventSnapshot(1,'compaction/start',{compactionId:'next',turn:5},51);
  h.update({running:true,awaitingFirstTurn:true},fixture({state:'closed'}),{},'one',{events});
  assert.equal(h.states.at(-1),'thinking');
  h.update({running:true},fixture({id:5}),{},'one',{events});assert.equal(h.states.at(-1),'compacting');
  h.update({running:true},fixture({id:5}),{},'one',{});assert.equal(h.states.at(-1),'thinking','withdrawn source clears unknown activity');
});

test('coalesced event notifications still close a compaction even when last change is unrelated', () => {
  const h=harness();const start={event:{type:'compaction/start',seq:42,data:{compactionId:'c',turn:4}}};
  h.update({running:true},fixture(),{},'one',{events:{revision:1,entries:[start],change:{kind:'append',entries:[start]}}});
  const end={event:{type:'compaction/end',seq:43,data:{compactionId:'c',turn:4}}};
  const tail={event:{type:'step/start',seq:44,data:{turn:4,step:1}}};
  h.update({running:true},fixture(),{},'one',{events:{revision:3,entries:[start,end,tail],change:{kind:'append',entries:[tail]}}});
  assert.equal(h.states.at(-1),'thinking');
});

test('an empty current text block is not proof of streaming output', () => {
  const h=harness();h.update({running:true},fixture({partial:{turn:4,step:1,blocks:[{kind:'text',text:''}]}}));
  assert.equal(h.states.at(-1),'thinking');
});

test('an empty trailing block cannot hide the latest meaningful streaming text', () => {
  const h=harness();h.update({running:true},fixture({partial:{turn:4,step:1,blocks:[{kind:'text',text:'reply'},{kind:'reasoning',text:''}]}}));
  assert.equal(h.states.at(-1),'answering');
});

test('parallel nested tool leaves are counted without counting their dispatch wrapper twice', () => {
  const h=harness();const children=[{turn:4,step:1,phase:'start',callId:'child-a'},{turn:4,step:1,phase:'start',callId:'child-b'}];
  const chat=fixture({calls:[{turn:4,step:1,phase:'start',callId:'dispatch',subCalls:children}]});
  h.update({running:true},chat);assert.equal(h.states.at(-1),'parallel');
  children[1]={kind:'tool-result',callId:'child-b',subCalls:[]};
  h.update({running:true},chat);assert.equal(h.states.at(-1),'working','one live child plus its wrapper is one execution');
  children[1]={turn:4,step:1,phase:'start',callId:'child-a'};
  h.update({running:true},chat);assert.equal(h.states.at(-1),'working','duplicate child projections are one execution');
});

test('an unended historical compaction on a non-running open turn does not invent activity', () => {
  const h=harness();const events=eventSnapshot(1,'compaction/start',{compactionId:'c',turn:4},42,'replace');
  h.update({running:false},fixture(),{},'one',{events});assert.equal(h.states.at(-1),'idle');
  h.update({running:true},fixture(),{},'one',{events});assert.equal(h.states.at(-1),'compacting','retained metadata can become live once the same turn resumes');
});


test('continuous token appends do not materialize the lazy history window; coalesced changes still recover it', () => {
  const h=harness();const start={event:{type:'compaction/start',seq:42,data:{compactionId:'a',turn:4}}};
  h.update({running:true},fixture(),{},'one',{events:{revision:1,entries:[start],change:{kind:'append',entries:[start]}}});
  let reads=0;const end={event:{type:'compaction/end',seq:43,data:{compactionId:'a',turn:4}}};
  const next={revision:2,change:{kind:'append',entries:[end]},get entries(){reads++;return [start,end];}};
  h.update({running:true},fixture(),{},'one',{events:next});
  assert.equal(h.states.at(-1),'thinking');assert.equal(reads,0,'the normal stream path only reads its append delta');
  const restart={event:{type:'compaction/start',seq:44,data:{compactionId:'b',turn:4}}};
  const tail={event:{type:'step/start',seq:45,data:{turn:4,step:1}}};
  const coalesced={revision:4,change:{kind:'append',entries:[tail]},get entries(){reads++;return [start,end,restart,tail];}};
  h.update({running:true},fixture(),{},'one',{events:coalesced});
  assert.equal(h.states.at(-1),'compacting');assert.equal(reads,1,'a skipped revision materializes history once to recover the missed start');
});
