// Official transient metadata Remote consumer. No session history namespace,
// durable cursor or output watch. Fully enclosed for Function.toString export.
export function createReceiptClient(ctx = {}, CarrierError = Error) {
  let alive = true, snapshot, revision = 0, admissionSerial = 0, active, mounting, mountedRemote, mountedRelease, disposal, remoteClient;
  const closing = new Set();
  const listeners = new Set();
  const scopeCodec = {mode:'strict',typeSymbol:'deepseekdeskskin-harness/types#ReceiptScope',create:() => ({
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'sessionId') ||
          typeof value.sessionId !== 'string' || !value.sessionId.length || value.sessionId.length > 512) throw new TypeError('Invalid receipt scope');
      return {sessionId:value.sessionId};
    },
  })};
  const descriptor = {id:'deepseekdeskskin-harness#deskskinReceipt/follow',service:'deskskinReceipt',namespace:'deskskinReceipt',method:'follow',mode:'stream',
    invocation:{kind:'direct'},parameters:[{name:'request',wire:'request',source:'json',codec:scopeCodec}],cancellation:{parameter:'signal'},result:{mode:'src-json'}};
  const bashKeys = new Set(['seq','version','kind','sessionId','turn','callId','exitCode','timedOut','signal']);
  const childKeys = new Set(['seq','version','kind','sessionId','turn','parentId','childId','runId','provider','local','stopReason']);
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
  const turn = value => Number.isSafeInteger(value) && value > 0;
  function validate(row,owner) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.version !== 1 || row.sessionId !== owner || !Number.isSafeInteger(row.seq) || row.seq < 0) return false;
    if (row.kind === 'bash') return Object.keys(row).every(key => bashKeys.has(key)) && turn(row.turn) && text(row.callId) &&
      (row.exitCode === null || Number.isSafeInteger(row.exitCode)) && typeof row.timedOut === 'boolean' &&
      (row.signal === null || typeof row.signal === 'string' && row.signal.length > 0 && row.signal.length <= 128);
    if (row.kind === 'subagent') return Object.keys(row).every(key => childKeys.has(key)) && row.parentId === owner &&
      text(row.childId) && text(row.runId) && text(row.provider) && typeof row.local === 'boolean' && (row.turn === null || turn(row.turn)) &&
      ['completed','aborted','error','max-tokens','refusal'].includes(row.stopReason);
    return false;
  }
  async function release(fn) {try {await fn?.();} catch {}}
  function remoteService() {
    // Cordis wraps a Service with a fresh trace proxy on each get(). Capture
    // one required-inject service for this owned reader lifetime. Withdrawal
    // of the injected native service tears down/restarts the plugin fiber.
    if (!remoteClient) {
      try {
        const remote = typeof ctx.get === 'function' ? ctx.get('remote') : ctx.remote;
        if (typeof remote?.$mount === 'function' && typeof remote?.$stream === 'function') remoteClient = remote;
      } catch {}
    }
    return remoteClient;
  }
  function publish(value) {if (!alive || snapshot === value) return;snapshot = value;for (const listener of [...listeners]) listener();}
  function receive(entry,frame) {
    if (!alive || entry !== active || entry.closed || !frame || frame.sessionId !== entry.owner || !text(frame.epoch)) return false;
    if (frame.type === 'opened') {
      if (Object.keys(frame).some(key => !['type','sessionId','epoch','cursor'].includes(key)) || !Number.isSafeInteger(frame.cursor) || frame.cursor < 0) return false;
      entry.epoch = frame.epoch;entry.cursor = frame.cursor;entry.rows = [];entry.admission = ++admissionSerial;
      publish(Object.freeze({sessionId:entry.owner,revision:++revision,admission:entry.admission,baseline:true,rows:Object.freeze([])}));return true;
    }
    if (frame.type !== 'receipts' || frame.epoch !== entry.epoch || Object.keys(frame).some(key => !['type','sessionId','epoch','rows'].includes(key)) || !Array.isArray(frame.rows)) return false;
    const rows = [], seen = new Set();
    for (const row of frame.rows) if (validate(row,entry.owner) && row.seq > entry.cursor && !seen.has(row.seq)) {seen.add(row.seq);rows.push(Object.freeze({...row}));}
    if (!rows.length) return true;
    entry.cursor = Math.max(entry.cursor,...rows.map(row => row.seq));
    // Preserve recent metadata across React batching of separate frames.
    // Activity consumes identities once; this is an in-memory opening ledger,
    // never a replay of durable session history.
    publish(Object.freeze({sessionId:entry.owner,revision:++revision,admission:entry.admission,baseline:false,rows:Object.freeze(entry.rows = [...entry.rows,...rows].slice(-1024))}));return true;
  }
  function closeStream(entry) {
    if (!entry?.stream) return entry?.closing || Promise.resolve();
    const stream = entry.stream, task = entry.task;entry.stream = undefined;
    const finished = (async () => {await release(() => stream.dispose());await task;})();
    entry.closing = finished;closing.add(finished);
    finished.finally(() => {closing.delete(finished);if (entry.closing === finished) entry.closing = undefined;});
    return finished;
  }
  function stop(entry) {
    if (!entry || entry.closed) return entry?.closing;
    entry.closed = true;
    if (active === entry) {active = undefined;publish(undefined);}
    return closeStream(entry);
  }
  function start(entry) {
    const remote = remoteService();
    if (!alive || !entry || active !== entry || entry.closed || entry.stream || entry.closing || remote !== mountedRemote) return;
    entry.generation = entry.epoch = entry.cursor = undefined;publish(undefined);
    let stream;
    try {
      const namespace = ctx.get?.('remote.deskskinReceipt');
      if (typeof namespace?.follow !== 'function') return;
      stream = remote.$stream({name:'DeepSeek skin metadata',open:signal => namespace.follow({sessionId:entry.owner},signal),
        ended:() => new CarrierError('Receipt stream ended'),
        carrierFailed:() => {if (alive && active === entry && !entry.closed) {entry.epoch = undefined;publish(undefined);}}});
    } catch {return;}
    entry.stream = stream;
    const task = (async () => {
      try {
        for await (const item of stream) {
          if (!alive || active !== entry || entry.closed) break;
          if (entry.generation !== item.generation) {
            entry.generation = item.generation;entry.epoch = undefined;entry.cursor = undefined;publish(undefined);
          }
          // A new native carrier starts with a validated opening baseline.
          // Never acknowledge an old epoch or an unopened generation.
          if (receive(entry,item.value)) item.accept();
        }
      } catch {if (alive && active === entry && !entry.closed) publish(undefined);}
      finally {if (entry.stream === stream) entry.stream = undefined;await release(() => stream.dispose());}
    })();
    entry.task = task;
  }
  function retry(owner) {
    if (!alive || active?.owner !== owner || active.closed) return;
    const remote = remoteService();
    if (!remote || typeof remote.$mount !== 'function' || typeof remote.$stream !== 'function') return;
    if (mountedRemote === remote) {start(active);return;}
    if (mounting) return;
    const token = {}, priorRelease = mountedRelease;
    mountedRelease = mountedRemote = undefined;mounting = token;
    const stopped = closeStream(active);publish(undefined);
    token.task = (async () => {
      try {
        await stopped;await Promise.all([...closing]);await release(priorRelease);
        if (!alive || mounting !== token) return;
        const dispose = await remote.$mount({package:'deepseekdeskskin-harness',descriptors:[descriptor]});
        if (!alive || mounting !== token) {await release(dispose);return;}
        mountedRemote = remote;mountedRelease = dispose;start(active);
      } catch {}
      finally {if (mounting === token) mounting = undefined;}
    })();
  }
  function watch(owner) {
    if (!alive || !text(owner)) return () => {};
    let entry = active;
    if (!entry || entry.owner !== owner || entry.closed) {stop(entry);entry = {owner,refs:0,closed:false};active = entry;}
    entry.refs++;retry(owner);let live = true;
    return () => {if (!live) return;live = false;if (--entry.refs <= 0) stop(entry);};
  }
  return {state:{getSnapshot:() => snapshot,subscribe(listener){if (!alive) return () => {};listeners.add(listener);return () => listeners.delete(listener);}},
    watch,retry,descriptor,
    dispose(){
      if (!alive) return disposal;stop(active);alive = false;
      const mountTask = mounting?.task, unmount = mountedRelease;mounting = undefined;mountedRelease = mountedRemote = undefined;
      listeners.clear();snapshot = undefined;
      disposal = (async () => {await mountTask;await Promise.all([...closing]);await release(unmount);})();return disposal;
    }};
}
