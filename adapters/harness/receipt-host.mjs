// Official host extension: observe frozen canonical results and expose only
// an owned transient metadata Remote. No session writes or output/log reads.
export function mountReceiptHost(ctx, carrierKeyOf) {
  let alive = true;
  let sessions = new WeakMap();
  const seen = new WeakSet(), releases = [], runs = new Map(), watchers = new Set();
  let serial = 0;
  const epoch = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}`;
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
  const turnNumber = value => Number.isSafeInteger(value) && value > 0;
  function dispose() {
    if (!alive) return;
    alive = false; sessions = new WeakMap(); runs.clear();
    for (const watcher of watchers) {watcher.closed = true;watcher.wake?.();watcher.rows.length = 0;}
    for (const release of releases.splice(0).reverse()) {try {Promise.resolve(release?.()).catch(() => {});} catch {}}
  }
  function listen(name, listener) {const release = ctx.on(name,listener);if (typeof release === 'function') releases.push(release);}
  // Official transient Remote: metadata never enters session persistence,
  // model-visible messages or raw-log contributions. Gateway src-json is the
  // carrier; request/DTO validation remains an explicit whitelist here/client.
  const scopeCodec = {mode:'strict',typeSymbol:'deepseekdeskskin-harness/types#ReceiptScope',create:() => ({
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'sessionId') ||
          typeof value.sessionId !== 'string' || !value.sessionId.length || value.sessionId.length > 512) throw new TypeError('Invalid receipt scope');
      return {sessionId:value.sessionId};
    },
  })};
  const descriptor = {id:'deepseekdeskskin-harness#deskskinReceipt/follow',service:'deskskinReceipt',namespace:'deskskinReceipt',method:'follow',mode:'stream',
    invocation:{kind:'direct'},parameters:[{name:'request',wire:'request',source:'json',codec:scopeCodec}],cancellation:{parameter:'signal'},result:{mode:'src-json'}};
  const service = {
    async *follow(request,signal) {
      if (!request || Object.keys(request).some(key => key !== 'sessionId') || !text(request.sessionId)) throw new TypeError('Invalid receipt scope');
      if (!alive) return;
      signal?.throwIfAborted?.();
      const watcher = {sessionId:request.sessionId,rows:[],closed:false};
      const stop = () => {watcher.closed = true;watcher.wake?.();};
      signal?.addEventListener?.('abort',stop,{once:true});watchers.add(watcher);
      try {
        yield Object.freeze({type:'opened',sessionId:request.sessionId,epoch,cursor:serial});
        while (alive && !watcher.closed) {
          if (!watcher.rows.length) {await new Promise(resolve => {watcher.wake = resolve;});watcher.wake = undefined;continue;}
          const rows = Object.freeze(watcher.rows.splice(0));
          yield Object.freeze({type:'receipts',sessionId:request.sessionId,epoch,rows});
        }
      } finally {watchers.delete(watcher);signal?.removeEventListener?.('abort',stop);watcher.rows.length = 0;}
    },
  };
  service.typertRemote = Object.freeze({service,serviceKey:'deskskinReceipt',namespace:'deskskinReceipt'});
  if (typeof ctx.provide === 'function' && typeof ctx.typert?.register === 'function') {
    const releaseService = ctx.provide('deskskinReceipt',service);
    if (typeof releaseService === 'function') releases.push(releaseService);
    const releaseType = ctx.typert.register({package:'deepseekdeskskin-harness',face:'host',schemas:[],invocations:[descriptor],model:{services:[],events:[],objects:[]}});
    if (typeof releaseType === 'function') releases.push(releaseType);
  }
  function publish(receipt) {
    const row = Object.freeze({seq:++serial,...receipt});
    for (const watcher of watchers) if (!watcher.closed && watcher.sessionId === receipt.sessionId) {
      // A hung consumer is disconnected rather than silently dropping an
      // operation failure. Native connection recovery opens a fresh baseline.
      if (watcher.rows.length >= 1024) {watcher.closed = true;watcher.rows.length = 0;}
      else watcher.rows.push(row);
      watcher.wake?.();
    }
  }
  listen('session/event', (session,event) => {
    if (!alive || !session || typeof session !== 'object') return;
    // Observe only turn/call identity; never append from the synchronous
    // native session acceptance/publication boundary.
    if (!['turn/start','tool/call','turn/end','session/seed'].includes(event?.type)) return;
    if (event.type === 'session/seed') {sessions.delete(session);return;}
    let state = sessions.get(session);
    if (event.type === 'turn/start' && turnNumber(event.data?.turn)) {
      state = {turn:event.data.turn,calls:new Map()};sessions.set(session,state);return;
    }
    if (!state) return;
    if (event.type === 'turn/end' && event.data?.turn === state.turn) {sessions.delete(session);return;}
    if (event.type === 'tool/call' && event.data?.turn === state.turn && text(event.data.callId)) state.calls.set(event.data.callId,state.turn);
  });
  listen('tools/result', (exec,result) => {
    if (!alive || !exec || typeof exec !== 'object' || seen.has(exec)) return;
    seen.add(exec);
    // tools/result explicitly contains observer failures; we contain our
    // telemetry too so channel failures never change the original tool outcome.
    try {
      if (exec.name !== 'bash' || result?.isError === true) return;
      const agent = exec.agent, session = agent?.session, state = session && sessions.get(session);
      const sessionId = session?.id ?? session?.header?.id;
      if (!state || !text(sessionId) || agent.id !== sessionId || !text(exec.callId)) return;
      const root = exec.rootCallId ?? exec.callId;
      if (!text(root) || state.calls.get(root) !== state.turn) return;
      const value = result?.value;
      if (!value || value.kind !== 'foreground' || value.aborted !== false || typeof value.timedOut !== 'boolean' ||
          !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) ||
          !(value.signal === null || typeof value.signal === 'string' && value.signal.length > 0 && value.signal.length <= 128)) return;
      const receipt = Object.freeze({version:1,kind:'bash',sessionId,turn:state.turn,callId:exec.callId,
        exitCode:value.exitCode,timedOut:value.timedOut,signal:value.signal});
      publish(receipt);
    } catch {}
  });
  // Prefer an explicitly supplied official scope helper. The installed
  // companion instead uses the public local registry, avoiding a second copy
  // of the scope package's process-local carrier WeakMap. Durable lineage is
  // only a lookup candidate: runtime ownership must independently agree.
  const agents = ctx.agents;
  function parentFor(carrier,info) {
    if (typeof carrierKeyOf === 'function') {
      const parent = carrierKeyOf(carrier);
      if (parent) return {parent,proof:'scope'};
    }
    if (info?.local !== true || typeof agents?.get !== 'function' || typeof agents?.isOwnedBy !== 'function') return undefined;
    const child = agents.get(info.id), parentId = child?.session?.header?.parentSession;
    if (!child || child.id !== info.id || child.session.id !== info.id || !text(parentId)) return undefined;
    const parent = agents.get(parentId);
    if (!parent || parent.id !== parentId || agents.isOwnedBy(info.id,parent) !== true) return undefined;
    return {parent,proof:'registry'};
  }
  if (typeof carrierKeyOf === 'function' || typeof agents?.get === 'function' && typeof agents?.isOwnedBy === 'function') {
    listen('subagent/start', function(info) {
      if (!alive) return;
      try {
        const owner = parentFor(this,info), parent = owner?.parent, session = parent?.session, sessionId = session?.id;
        if (!text(sessionId) || parent.id !== sessionId ||
            typeof agents?.get === 'function' && agents.get(sessionId) !== parent ||
            !text(info?.runId) || !text(info.id) || !text(info.provider) || typeof info.local !== 'boolean' || runs.has(info.runId)) return;
        runs.set(info.runId,{parent,proof:owner.proof,session,sessionId,childId:info.id,provider:info.provider,local:info.local,turn:sessions.get(session)?.turn ?? null});
      } catch {}
    });
    listen('subagent/end', function(info) {
      if (!alive) return;
      try {
        const run = runs.get(info?.runId);
        if (!run || info.id !== run.childId || info.provider !== run.provider || info.local !== run.local ||
            run.proof === 'scope' && carrierKeyOf(this) !== run.parent) return;
        runs.delete(info.runId);
        // The child's registry entry can detach before its terminal edge.
        // The captured exact parent must still be the live registry object.
        if (typeof agents?.get === 'function' && agents.get(run.sessionId) !== run.parent) return;
        if (!['completed','aborted','error','max-tokens','refusal'].includes(info.stopReason)) return;
        publish(Object.freeze({version:1,kind:'subagent',sessionId:run.sessionId,
          parentId:run.sessionId,childId:run.childId,runId:info.runId,provider:run.provider,local:run.local,turn:run.turn,stopReason:info.stopReason}));
      } catch {}
    });
  }
  // Explicit cleanup also supports fixture tests and plugin hot reload; the
  // standard Cordis on() registrations are already owned by this plugin fiber.
  listen('dispose',dispose);
  // Bind our alive guard to the native plugin fiber as well as explicit tests.
  if (typeof ctx.effect === 'function') {
    const release = ctx.effect(() => dispose, 'deepseekdeskskin receipt');
    if (typeof release === 'function') releases.push(release);
  }
  return {dispose,service,descriptor};
}
