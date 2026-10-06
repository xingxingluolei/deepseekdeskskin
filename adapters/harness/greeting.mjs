// Read only typed turn/start identity. The exporter embeds this function.
// A fresh blank main session may greet on native awaitingFirstTurn publication.
// No prompt content is read, copied, delayed or resubmitted.
export function createTurnGreetingTracker(emit) {
  let alive=true, session, previous, watermark=-Infinity, rebasing=true, pending, firstEligible=false, firstGreeted=false;
  const seen=new Set();
  function reset(id) {session=id;previous=undefined;watermark=-Infinity;pending=undefined;seen.clear();rebasing=true;firstEligible=false;firstGreeted=false;}
  function update(sessionId,chat,events,owner={},connection) {
    if(!alive)return;
    if(sessionId!==session)reset(sessionId);
    if(connection==='disconnected'||connection==='connecting'||!events){rebasing=true;pending=undefined;previous=undefined;firstEligible=false;return;}
    if(events!==previous){
      const baseline=rebasing||!previous||events.change?.kind==='replace'||events.revision<previous.revision;
      // A prepend consists only of history. An eventual coalesced publication
      // uses the seq watermark, so historical starts still cannot replay.
      const historical=!baseline&&events.revision===previous.revision+1&&events.change?.kind==='prepend';
      let entries;
      if(!baseline&&events.revision===previous.revision+1&&events.change?.kind==='append')entries=events.change.entries;
      else entries=events.entries;
      if(baseline){
        pending=undefined;watermark=-Infinity;
        firstEligible=owner.blank===true && !chat?.timeline?.turnOrder?.length && !entries.some(row=>row?.event?.type==='turn/start');
      }
      for(const row of Array.isArray(entries)?entries:[]){
        const event=row?.event;
        if(!Number.isFinite(event?.seq))continue;
        if(event.type==='turn/start'&&Number.isSafeInteger(event.data?.turn)&&event.data.turn>0){
          const key=`${sessionId}:${event.data.turn}:${event.seq}`;
          if(!baseline&&!historical&&event.seq>watermark&&!seen.has(key))pending={key:firstEligible&&event.data.turn===1?`${sessionId}:first`:key,sessionId,turn:event.data.turn,seq:event.seq,firstTurn:firstEligible&&event.data.turn===1};
          seen.add(key);if(seen.size>1024)seen.delete(seen.values().next().value);
        }
      }
      for(const row of Array.isArray(entries)?entries:[])if(Number.isFinite(row?.event?.seq))watermark=Math.max(watermark,row.event.seq);
      previous=events;rebasing=false;
    }
    // This public owner flag changes at send initiation, before turn/start and
    // the model stream. It lets the presentation keep its welcome composition.
    if(firstEligible&&!firstGreeted&&owner.awaitingFirstTurn===true){
      firstGreeted=true;emit({key:`${sessionId}:first`,sessionId,turn:1,firstTurn:true});
    }
    if(pending?.firstTurn&&firstGreeted)pending=undefined;
    const latest=chat?.timeline?.turnOrder?.at(-1),turn=chat?.timeline?.turns?.get?.(latest);
    const turnId=turn?.turn??latest;
    if(pending&&(turnId>pending.turn||turnId===pending.turn&&turn?.status==='closed'&&!pending.firstTurn))pending=undefined;
    if(pending&&turnId===pending.turn&&((turn?.status==='open'&&(owner.running===true||owner.awaitingFirstTurn===true))||(pending.firstTurn&&turn?.status==='closed'))){
      const request=pending;pending=undefined;if(request.firstTurn)firstGreeted=true;emit(request);
    }
  }
  return {update,dispose(){alive=false;pending=previous=undefined;seen.clear();}};
}
