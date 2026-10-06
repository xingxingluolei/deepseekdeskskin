// Host-independent lifecycle tracker. Keep all helpers inside this function:
// the Harness exporter embeds it through Function.prototype.toString().
export function createActivityTracker(emit, { holdMs = 6000, errorPulseMs = 4000, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let alive = true, bound = false, currentSession, state, observedTurn, receiptObservedTurn, lastTurn, terminalKey, terminalState;
  let holdTimer, holdGeneration = 0, pulseTimer, pulseGeneration = 0, pulse = false, latestInput, lastReceiptAdmission;
  let previousSession, lastEvents, lastEventSeq = -Infinity, jobsKnown, previousGoal, pauseTurn, pendingGoalCompletion, admitting = false;
  const unresolvedJobs = new Set(), seenOutcomes = new Set(), pendingReceipts = new Map(), seenReceipts = new Set();
  const compactions = new Map(), commands = new Map(), knownCalls = new Map(), failures = new Set();
  function publish(next) { if (alive && next !== state) { state = next; emit(next); } }
  function stopHold() { holdGeneration++; if (holdTimer !== undefined) cancel(holdTimer); holdTimer = undefined; }
  function pausePulse() { pulseGeneration++; if (pulseTimer !== undefined) cancel(pulseTimer); pulseTimer = undefined; }
  function stopPulse() { pausePulse(); pulse = false; }
  function clearTerminal() { stopHold(); terminalState = undefined; }
  function fail(key) {
    if (failures.has(key)) return;
    failures.add(key);
    // Retain only recent operation identities; source watermarks separately
    // prevent history replay. This bound also covers long-lived goal sessions.
    if (failures.size > 1024) failures.delete(failures.values().next().value);
    stopPulse(); pulse = true;
  }
  function armPulse() {
    if (pulseTimer !== undefined) return;
    const token = pulseGeneration;
    pulseTimer = schedule(() => {
      if (!alive || token !== pulseGeneration) return;
      pulseTimer = undefined; pulse = false;
      if (latestInput) update(...latestInput);
    }, Math.max(4000, errorPulseMs));
  }
  function cancelled(error) { return ['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'interrupted'].includes(error?.code); }
  // Official Chat root/PTC projections expose the wire Tool name as `name`.
  // Match identities only: arguments, descriptions and assistant prose are not
  // evidence of a tool's purpose. Unknown extensions retain the generic pose.
  function toolActivity(name) {
    if (['read', 'read_image', 'web_fetch'].includes(name)) return 'reading';
    if (['write', 'edit', 'apply_patch'].includes(name)) return 'writing';
    if (['grep', 'glob', 'search', 'web_search'].includes(name)) return 'searching';
    if (['bash', 'pwsh', 'exec_command', 'write_stdin', 'run_code'].includes(name)) return 'executing';
    if (['subagent', 'create_subagent', 'subagent_create'].includes(name)) return 'delegating';
    return 'working';
  }
  function signedOut(reason) { return reason?.kind === 'aborted' && reason.reason?.kind === 'hook' && reason.reason.reason === 'deepseek-account/signed-out'; }
  function update(sessionId, session, status, chat, context = {}) {
    if (!alive) return;
    latestInput = [sessionId, session, status, chat, context];
    if (!bound || sessionId !== currentSession) {
      clearTerminal(); stopPulse(); bound = true; currentSession = sessionId;
      observedTurn = receiptObservedTurn = lastTurn = terminalKey = previousSession = lastEvents = jobsKnown = previousGoal = pauseTurn = pendingGoalCompletion = undefined;
      admitting = false; lastReceiptAdmission = undefined; lastEventSeq = -Infinity;
      compactions.clear(); commands.clear(); knownCalls.clear(); failures.clear(); unresolvedJobs.clear(); seenOutcomes.clear(); pendingReceipts.clear(); seenReceipts.clear();
    }
    const timeline = chat?.timeline, latest = timeline?.turnOrder?.at(-1);
    const turn = latest === undefined ? undefined : timeline?.turns?.get?.(latest);
    const turnId = turn?.turn ?? latest, step = turn?.steps?.at(-1);
    const running = typeof session?.running === 'boolean' ? session.running : status?.running === true;
    const awaiting = Boolean(session?.awaitingFirstTurn);
    const prior = previousSession;
    const freshTurn = turn?.status === 'open' && turnId !== lastTurn;
    const pending = Array.isArray(session?.pendingSubmissions) ? session.pendingSubmissions : [];
    const freshSubmission = prior && pending.some(row => !prior.submissions?.has(row.requestId));
    const freshAdmission = prior && ((!prior.running && running && turn?.status !== 'open') || (!prior.awaitingFirstTurn && awaiting) || freshSubmission && turn?.status !== 'open');
    if (freshTurn || freshAdmission) {
      clearTerminal(); stopPulse(); observedTurn = receiptObservedTurn = undefined; knownCalls.clear(); unresolvedJobs.clear(); seenOutcomes.clear(); pendingGoalCompletion = undefined;
      if (freshAdmission && turn?.status !== 'open') admitting = true;
    }
    if (!prior && pending.length && turn?.status !== 'open') admitting = true;
    if (turn?.status === 'open') admitting = false;
    lastTurn = turnId;
    previousSession = {running, awaitingFirstTurn:awaiting, promptError:session?.promptError, openError:session?.openError, lastAgentError:session?.lastAgentError, submissions:new Set(pending.map(row => row.requestId))};
    const values = context.sessions?.projectionsBySession?.[sessionId]?.values || {};
    const inbox = [...(values.inbox?.['next-turn'] || []), ...(values.inbox?.['next-step'] || [])];
    const queued = inbox.length > 0 || pending.length > 0;
    const queuedReplies = new Set(inbox.filter(row => row?.source?.kind === 'user-question-reply').map(row => row.source.callId));
    const activeCalls = new Map();
    function collectTools(call, path = new Set()) {
      if (!call || typeof call !== 'object' || call.turn !== turnId || call.phase !== 'start' || 'kind' in call || path.has(call) || path.size >= 256) return false;
      path.add(call); if (call.callId) knownCalls.set(call.callId, turnId);
      let child = false; for (const sub of call.subCalls || []) if (collectTools(sub, path)) child = true;
      path.delete(call); if (!child && running) activeCalls.set(call.callId ?? call, toolActivity(call.name)); return true;
    }
    if (turn?.status === 'open') for (const call of chat?.legacy?.runningCalls || []) collectTools(call);
    const currentCall = id => knownCalls.get(id) === turnId;
    const interaction = status?.pendingInteraction;
    const visibleWaiting = Boolean(interaction && interaction.review === undefined);
    const hiddenWaiting = (values.userQuestions?.active || []).some(row =>
      row?.state === 'open' ? turn?.status === 'open' && currentCall(row.callId) : row?.state === 'continued' && !running && !queuedReplies.has(row.callId));
    const waiting = visibleWaiting || hiddenWaiting;
    const goal = values.goal?.goal;
    if (['paused','blocked'].includes(goal?.phase) && (previousGoal?.phase !== goal.phase || previousGoal?.id !== goal.id)) pauseTurn = turnId;
    if (goal?.phase === 'complete' && previousGoal?.id === goal.id && previousGoal.phase !== 'complete') pendingGoalCompletion = `goal:${goal.id}:${goal.revision ?? ''}`;
    previousGoal = goal;
    const goalPhase = ['paused', 'blocked'].includes(goal?.phase) && (!running || pauseTurn === turnId) ? goal.phase : undefined;
    const nodes = Array.isArray(chat?.legacy?.nodes) ? chat.legacy.nodes : [];
    const boundary = turn?.end?.seq ?? turn?.start?.seq ?? -Infinity;
    const manualCompact = nodes.some(node => node?.kind === 'command' && node.name === 'compact' && node.outcome === null && Number.isFinite(node.seq) && node.seq > boundary);
    if (turn?.status === 'open' && (running || awaiting || waiting)) observedTurn = receiptObservedTurn = turnId;
    const scoped = data => data?.turn === turnId && (turn?.status === 'open' || observedTurn === turnId);
    function failCurrent(key, data) {
      if (failures.has(key)) return;
      if (scoped(data)) { fail(key); return; }
      // Event and Chat stores publish independently. A typed failure may be
      // delivered after the same observed turn's completed projection already
      // consumed observedTurn. Retain that admission, never old history or a
      // freshly submitted next task, just as the host receipt path does.
      if (!admitting && data?.turn === turnId && receiptObservedTurn === turnId &&
          turn?.status === 'closed' && Number.isFinite(turn.end?.seq) && turn.end?.data?.reason?.kind === 'completed') {
        clearTerminal(); terminalKey = undefined; observedTurn = turnId; fail(key);
      }
    }
    function isOutcome(event) {
      return ['tool/result','tool/ptc-dispatch','assistant/attempt','assistant/message','compaction/end','command/done'].includes(event?.type) ||
        event?.type === 'assistant/live-chunk' && event.data?.chunk?.type === 'finish';
    }
    function process(entry, baseline = false) {
      const event = entry?.event, data = event?.data;
      if (!event) return;
      if (isOutcome(event)) {
        const key = `${event.type}:${event.seq}`;
        if (!baseline && seenOutcomes.has(key)) return;
        seenOutcomes.add(key);
      }
      if (event.type === 'session/seed') { compactions.clear(); commands.clear(); knownCalls.clear(); return; }
      if (event.type === 'turn/end') {
        for (const [id, owner] of compactions) if (owner.turn === data?.turn) compactions.delete(id);
        return;
      }
      if (event.type === 'tool/call' && scoped(data) && data.callId) knownCalls.set(data.callId, data.turn);
      if (event.type === 'compaction/start' && typeof data?.compactionId === 'string') {
        // Keep metadata across the event/chat publication race. Interpret only
        // against the current live owner below, never merely from old history.
        if (data.turn !== undefined && (data.turn !== null || !baseline || manualCompact)) compactions.set(data.compactionId, {turn:data.turn,seq:event.seq,commandId:data.sourceCommandId});
        return;
      }
      if (event.type === 'compaction/end') {
        const owner = compactions.get(data?.compactionId); compactions.delete(data?.compactionId);
        if (!baseline && data?.error && owner && (owner.turn === null || scoped(owner))) fail(`compact:${data.compactionId}`);
        return;
      }
      if (event.type === 'command/run' && data?.commandId) { commands.set(data.commandId, data.name); return; }
      if (event.type === 'command/done') {
        const name = commands.get(data?.commandId); commands.delete(data?.commandId);
        if (!baseline && name === 'compact' && data.kind === 'error') fail(`command:${data.commandId}`);
        return;
      }
      if (baseline) return;
      if (event.type === 'tool/result' && data.message?.isError === true && !cancelled(data.error)) failCurrent(`tool:${data.message.source?.callId}:${event.seq}`, data);
      if (event.type === 'tool/ptc-dispatch' && currentCall(data?.rootCallId) && data.isError === true && !cancelled(data.error)) fail(`tool:${data.subCallId}:${event.seq}`);
      let finish;
      if (event.type === 'assistant/live-chunk' && data?.chunk?.type === 'finish') finish = data.chunk.reason;
      if ((event.type === 'assistant/attempt' || event.type === 'assistant/message') && Array.isArray(data?.stream)) {
        finish = data.stream.findLast(record => record?.type === 'chunk' && record.chunk?.type === 'finish')?.chunk?.reason;
      }
      if (['error', 'max-tokens'].includes(finish?.kind)) failCurrent(`assistant:${event.type}:${event.seq}`, data);
    }
    const events = context.events;
    if (!events) { compactions.clear(); commands.clear(); lastEvents = undefined; lastEventSeq = -Infinity; }
    else if (events !== lastEvents) {
      const baseline = !lastEvents || events.change?.kind === 'replace' || events.revision < lastEvents.revision;
      if (baseline) { compactions.clear(); commands.clear(); lastEventSeq = -Infinity; }
      let entries, loadedWindow;
      if (!baseline && events.revision === lastEvents.revision + 1 && events.change?.kind === 'append') entries = events.change.entries;
      else {
        // Native materialize() is lazy: ordinary token appends use only their
        // delta. Coalesced publications replay the unseen suffix once.
        const loaded = events.entries, window = Array.isArray(loaded) ? loaded : [];
        loadedWindow = window;
        if (baseline) entries = window;
        else { entries = []; for (let index = window.length - 1; index >= 0; index--) { const entry = window[index]; if (Number.isFinite(entry?.event?.seq) && entry.event.seq <= lastEventSeq) break; entries.push(entry); } entries.reverse(); }
      }
      for (const entry of entries || []) process(entry, baseline);
      // If React coalesced settlement plus another publication, the last
      // change.entry no longer names that inserted lower-seq outcome. A lazy
      // window has already been read here; replay only typed outcome metadata.
      // Baseline seeds identities silently; ordinary append never reads it.
      if (!baseline && loadedWindow) for (const entry of loadedWindow) if (isOutcome(entry?.event)) process(entry);
      // Durable settlements can be inserted earlier than transient chunks.
      // Their explicit change.entry must bypass the append watermark; failure
      // identity dedup makes repeated publications harmless.
      if (!baseline && events.change?.kind === 'settle-assistant' && events.change.entry) process(events.change.entry);
      const tailSeq = entries?.at(-1)?.event?.seq;
      if (Number.isFinite(tailSeq)) lastEventSeq = Math.max(lastEventSeq, tailSeq);
      lastEvents = events;
    }
    for (const [id, owner] of compactions) if ((owner.turn === turnId && turn?.status === 'closed') || (Number.isFinite(owner.seq) && owner.seq < boundary && !manualCompact)) compactions.delete(id);
    const compacting = manualCompact || [...compactions.values()].some(owner => owner.turn === null || (running && owner.turn === turnId && turn?.status === 'open'));
    // Legacy results are public metadata fallback when the optional raw event
    // service is unavailable. Correlate current observed calls, not result text.
    function collectResults(node, path = new Set()) {
      if (!node || typeof node !== 'object' || path.has(node) || path.size >= 256) return;
      path.add(node);
      if (node.kind === 'tool-result' && Number.isFinite(node.seq)) {
        const identity = `legacy:${node.callId}:${node.seq}`, seen = seenOutcomes.has(identity);
        seenOutcomes.add(identity);
        if (prior && !seen && currentCall(node.callId) && node.isError === true && !cancelled(node.error)) failCurrent(`tool:${node.callId}:${node.seq}`, {turn:knownCalls.get(node.callId)});
      }
      for (const child of Array.isArray(node.subCalls) ? node.subCalls : []) collectResults(child, path);
      path.delete(node);
    }
    // PTC results remain nested under an active root in runningCalls; only a
    // settled root enters legacy.nodes. Visit both public projection shapes.
    for (const node of nodes) collectResults(node);
    for (const call of chat?.legacy?.runningCalls || []) collectResults(call);
    const children = values.subagentCatalog;
    const childActive = Array.isArray(children) && children.some(child => (context.statuses?.get?.(child?.id)?.running ?? context.sessions?.byId?.[child?.id]?.running) === true);
    const rows = Array.isArray(context.jobs) ? context.jobs.filter(job => job?.owner === sessionId) : undefined;
    if (!rows) jobsKnown = undefined;
    else {
      const next = new Map(rows.map(job => [job.id, {status:job.status,finishedAt:job.finishedAt}]));
      for (const job of rows) {
        if (job.status === 'running' || job.status === 'stopping') unresolvedJobs.add(job.id);
        else if (['completed','killed','failed'].includes(job.status)) unresolvedJobs.delete(job.id);
      }
      if (jobsKnown) for (const job of rows) {
        const previous = jobsKnown.get(job.id);
        if (job.status === 'failed' && (!previous || previous.status !== 'failed' || previous.finishedAt !== job.finishedAt)) fail(`job:${job.id}:${job.finishedAt ?? 'failed'}`);
      }
      jobsKnown = next;
    }
    // The official host companion forwards only typed foreground outcome
    // metadata. Historical receipt baselines never replay an error reaction.
    const receipts = context.receipts;
    function admitReceipt(key) {
      if (seenReceipts.has(key)) return false;
      seenReceipts.add(key);
      if (seenReceipts.size > 2048) seenReceipts.delete(seenReceipts.values().next().value);
      return true;
    }
    if (!receipts || receipts.sessionId !== sessionId || receipts.baseline !== false) {
      pendingReceipts.clear();seenReceipts.clear();lastReceiptAdmission = receipts?.sessionId === sessionId ? receipts.admission : undefined;
    } else {
      // React may coalesce the opening notification with its first frame.
      // Its explicit admission identity still invalidates older pending rows.
      if (receipts.admission !== undefined && receipts.admission !== lastReceiptAdmission) {pendingReceipts.clear();seenReceipts.clear();}
      lastReceiptAdmission = receipts.admission;
      if (Array.isArray(receipts.rows)) for (const row of receipts.rows) {
      if (row?.version === 1 && row.kind === 'subagent' && row.sessionId === sessionId && row.parentId === sessionId &&
          Number.isSafeInteger(row.seq) && row.seq >= 0 && typeof row.runId === 'string' && row.runId.length > 0 &&
          typeof row.childId === 'string' && row.childId.length > 0 && typeof row.provider === 'string' && row.provider.length > 0 &&
          typeof row.local === 'boolean' && (row.turn === null || Number.isSafeInteger(row.turn) && row.turn > 0)) {
        if (!admitReceipt(`child:${row.seq}:${row.runId}`)) continue;
        // A background child may finish after its delegating parent turn has
        // closed. The host proves its exact live parent at start AND end;
        // fresh session-scoped failure is distinct from old transcript replay.
        if (['error','max-tokens','refusal'].includes(row.stopReason)) fail(`child:${row.seq}:${row.runId}`);
        continue;
      }
      if (row?.version !== 1 || row.kind !== 'bash' || row.sessionId !== sessionId ||
          !Number.isSafeInteger(row.turn) || row.turn <= 0 || !Number.isSafeInteger(row.seq) || row.seq < 0 ||
          typeof row.callId !== 'string' || !row.callId.length || row.callId.length > 512 ||
          !(row.exitCode === null || Number.isSafeInteger(row.exitCode)) || typeof row.timedOut !== 'boolean' ||
          !(row.signal === null || typeof row.signal === 'string' && row.signal.length > 0 && row.signal.length <= 128)) continue;
      if (!admitReceipt(`bash:${row.seq}:${row.turn}:${row.callId}`)) continue;
      pendingReceipts.set(`${row.seq}:${row.callId}`,row);
      if (pendingReceipts.size > 1024) pendingReceipts.delete(pendingReceipts.keys().next().value);
      }
    }
    // The host's result may publish before useChat admits the corresponding
    // turn. Keep only fresh metadata across that race, not historical output.
    for (const [key,row] of pendingReceipts) {
      // The receipt stream and chat publish independently. A completed
      // render consumes observedTurn before a fresh same-turn receipt can
      // arrive. Preserve only the turn we actually observed this admission;
      // history, another session and a newly admitted task stay ineligible.
      const lateCompleted = !admitting && row.turn === turnId && receiptObservedTurn === turnId &&
        turn?.status === 'closed' && Number.isFinite(turn.end?.seq) && turn.end?.data?.reason?.kind === 'completed';
      if (scoped(row) || lateCompleted) {
        if (row.exitCode !== null && row.exitCode !== 0 || row.timedOut || row.signal !== null) {
          if (lateCompleted && observedTurn !== turnId) {
            // A real late failure interrupts the old completion hold. After
            // its visible error pulse, the same typed end earns a full hold.
            clearTerminal(); terminalKey = undefined; observedTurn = turnId;
          }
          fail(`receipt:${key}`);
        }
        pendingReceipts.delete(key);
      } else if (row.turn < turnId || row.turn === turnId && turn?.status === 'closed') pendingReceipts.delete(key);
    }
    const jobsActive = rows?.some(job => job.status === 'running' || job.status === 'stopping') === true;
    const busy = running || awaiting || compacting || childActive || jobsActive;
    const prompt = session?.promptError, open = session?.openError, agentError = session?.lastAgentError;
    const promptFresh = prior && prompt && prompt !== prior.promptError;
    const openFresh = prior && open && open !== prior.openError;
    const agentFresh = prior && agentError && agentError !== prior.lastAgentError;
    if (promptFresh && !(prompt.op === 'send' && !running)) fail('prompt:' + pulseGeneration);
    if (openFresh && session?.openState !== 'error') fail('open:' + pulseGeneration);
    if (agentFresh) fail('agent:' + pulseGeneration);
    // Attention is truthful even while native running/awaiting flags lag a
    // failed RPC, disconnect or pause. Historical prior prompt errors cannot
    // cover a newly admitted, genuinely running task.
    if (waiting) { pausePulse(); publish('waiting'); return; }
    if (context.connection?.state === 'disconnected' || context.connection?.state === 'connecting') { pausePulse(); publish(context.connection.state); return; }
    if (goalPhase) { pausePulse(); publish(goalPhase); return; }
    if (session?.removed) { clearTerminal(); stopPulse(); publish('idle'); return; }
    if (session?.openState === 'error' && open || prompt?.op === 'send' && !running || !busy && (prompt || open || agentError)) { publish('error'); return; }
    const reason = turn?.end?.data?.reason, kind = reason?.kind;
    const closed = turn?.status === 'closed' && Number.isFinite(turn.end?.seq) && typeof kind === 'string' && kind !== '';
    const terminalFailure = closed && !admitting && (observedTurn === turnId || !running && !awaiting) && ['error', 'max-tokens'].includes(kind);
    if (terminalFailure) { clearTerminal(); stopPulse(); terminalKey = `${turnId}:${turn.end.seq}`; terminalState = 'error'; publish('error'); return; }
    if (closed && !admitting && signedOut(reason)) { clearTerminal(); stopPulse(); terminalState = 'disconnected'; publish('disconnected'); return; }
    if (closed && !admitting && observedTurn === turnId && ['aborted', 'interrupted', 'blocked'].includes(kind)) {
      clearTerminal(); stopPulse(); terminalKey = `${turnId}:${turn.end.seq}`; terminalState = kind === 'blocked' ? 'blocked' : 'stopped'; observedTurn = undefined; publish(terminalState); return;
    }
    if (pulse) { armPulse(); publish('error'); return; }
    if (busy) {
      clearTerminal();
      let retry;
      if (running && turn?.status === 'open' && step?.status === 'open') for (const node of nodes) if (node?.kind === 'model-retry' && node.turn === turnId && node.step === step.step && (!retry || node.seq >= retry.seq)) retry = node;
      if (compacting) { publish('compacting'); return; }
      if (retry?.retryState === 'scheduled') { publish('retrying'); return; }
      if (childActive || activeCalls.size > 1) { publish('parallel'); return; }
      if (activeCalls.size) { publish(activeCalls.values().next().value); return; }
      if (jobsActive) { publish('working'); return; }
      const assistant = step?.data?.get?.('assistant-step');
      const partial = assistant !== undefined ? assistant.status === 'running' ? assistant : undefined : chat?.legacy?.partial;
      const live = running && turn?.status === 'open' && step?.status === 'open' && partial?.turn === turnId && partial?.step === step.step;
      const lastBlock = live && Array.isArray(partial.blocks) ? partial.blocks.findLast(block => block && (block.kind !== 'text' && block.kind !== 'reasoning' || typeof block.text === 'string' && block.text.trim().length > 0)) : undefined;
      publish(lastBlock?.kind === 'text' ? 'answering' : 'thinking'); return;
    }
    if (queued) { clearTerminal(); publish('queued'); return; }
    if (pendingGoalCompletion) {
      clearTerminal(); terminalKey = pendingGoalCompletion; pendingGoalCompletion = undefined; terminalState = 'complete'; publish('complete');
      const token = holdGeneration;
      holdTimer = schedule(() => {if (!alive || token !== holdGeneration) return; holdTimer = undefined; terminalState = 'idle'; if (latestInput) update(...latestInput);},holdMs);
      return;
    }
    if (terminalKey?.startsWith('goal:') && terminalState !== undefined) {publish(terminalState); return;}
    if (closed) {
      const key = `${turnId}:${turn.end.seq}`;
      if (key !== terminalKey) {
        clearTerminal(); terminalKey = key;
        if (observedTurn === turnId) {
          terminalState = kind === 'completed' ? 'complete' : 'idle'; observedTurn = undefined; publish(terminalState);
          if (terminalState === 'complete') {
            const token = holdGeneration;
            holdTimer = schedule(() => { if (!alive || token !== holdGeneration) return; holdTimer = undefined; terminalState = 'idle'; if (latestInput) update(...latestInput); }, holdMs);
          }
          return;
        }
        observedTurn = undefined;
      }
      if (terminalState !== undefined) { publish(terminalState); return; }
    } else clearTerminal();
    // Foreground Bash jobs are removed immediately after settlement. The
    // coalesced roster may omit their terminal row entirely. A typed end for
    // this observed main turn is authoritative for "this turn completed";
    // unknown/dropped jobs alone still never imply success, and a currently
    // reported running job has already taken precedence in the busy branch.
    if (unresolvedJobs.size) { publish('idle'); return; }
    publish('idle');
  }
  return {update, dispose() { if (!alive) return; alive = false; stopHold(); stopPulse(); latestInput = undefined; compactions.clear(); commands.clear(); knownCalls.clear(); failures.clear(); unresolvedJobs.clear(); seenOutcomes.clear(); pendingReceipts.clear(); seenReceipts.clear(); jobsKnown = undefined; }};
}
