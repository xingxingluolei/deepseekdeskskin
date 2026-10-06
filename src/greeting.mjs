// Host-independent keyframe player. Completion is observable so a caller can
// finish a new-conversation intro before revealing the conversation content.
export function createTaskGreetingPlayer(onChange,{
  schedule=setTimeout,cancel=clearTimeout,
  reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,
  prepare,prepareTimeoutMs=1800,
}={}) {
  let alive=true,revision=0,timer,prepareTimer,loading,frame,asset,lastRequest,current,cycle;
  let snapshot=Object.freeze({phase:'idle',requestKey:undefined,frameIndex:undefined,frameCount:0,durationMs:0});
  const listeners=new Set(),busy=new Set(['thinking','working','reading','writing','searching','executing','delegating','answering','parallel','compacting','retrying']);
  const trouble=new Set(['error','waiting','stopped','paused','blocked','disconnected','connecting']);
  const enabled=()=>alive&&current?.enabled&&current.mode==='dynamic'&&current.motion!=='none'&&!reducedMotion();
  const eligible=()=>enabled()&&!trouble.has(current.state)&&(busy.has(current.state)||current.allowIdle===true&&['idle','queued','complete'].includes(current.state));
  function publish(phase,index,notify=true) {
    const next=Object.freeze({phase,requestKey:cycle?.key,frameIndex:index,frameCount:cycle?.count||0,durationMs:cycle?.durationMs||0});snapshot=next;
    if(!notify||!alive)return next;
    for(const listener of [...listeners]) {try {listener();}catch {}}
    try {onChange?.(next);}catch {}
    return next;
  }
  function finish(phase,notify=true) {
    revision++;if(prepareTimer!==undefined)cancel(prepareTimer);prepareTimer=undefined;if(timer!==undefined)cancel(timer);timer=undefined;loading?.abort();loading=undefined;frame=undefined;
    if(!cycle||cycle.settled)return;
    const finishedCycle=cycle;finishedCycle.settled=true;
    const result=publish(phase,undefined,notify);finishedCycle.resolve(result);
  }
  async function preload(frames,signal) {
    await Promise.all(frames.map(item=>new Promise((resolve,reject)=>{
      const image=new Image();let settled=false;
      function done(error) {if(settled)return;settled=true;image.onload=image.onerror=null;image.removeAttribute('src');signal.removeEventListener('abort',abort);error?reject(error):resolve();}
      function abort(){done(Error('Greeting cancelled'));}
      signal.addEventListener('abort',abort,{once:true});image.onerror=()=>done(Error('Greeting image cannot decode'));
      image.onload=async()=>{try {await image.decode?.();if(signal.aborted){abort();return;}done(image.naturalWidth*image.naturalHeight>20_000_000?Error('Greeting image too large'):undefined);}catch(error){done(error);}};
      image.src=item.source;if(signal.aborted)abort();
    })));
  }
  function update(input) {
    if(!alive)return Promise.resolve(snapshot);
    const changedAsset=asset!==undefined&&asset!==input.asset;asset=input.asset;current=input;
    const key=input.request?.key;
    if(!key) {finish('cancelled');return cycle?.promise||Promise.resolve(snapshot);}
    if(key===lastRequest) {
      if(changedAsset||!enabled()||trouble.has(input.state))finish('cancelled');
      return cycle?.promise||Promise.resolve(snapshot);
    }
    lastRequest=key;finish('cancelled',false);
    let resolve;const promise=new Promise(done=>resolve=done);cycle={key,promise,resolve,settled:false,count:0};
    if(changedAsset||!eligible()) {finish('skipped');return promise;}
    let frames;
    try {frames=typeof input.frames==='function'?input.frames():input.frames;}catch {finish('failed');return promise;}
    if(!Array.isArray(frames)||frames.length<2||frames.some(item=>typeof item?.source!=='string'||!item.source.length||!Number.isFinite(item.duration)||item.duration<=0)) {finish('failed');return promise;}
    frames=frames.map(item=>({...item}));cycle.count=frames.length;cycle.durationMs=frames.reduce((sum,item)=>sum+item.duration,0);
    const token=revision,controller=new AbortController();loading=controller;publish('loading');
    if(!alive||token!==revision)return promise;
    prepareTimer=schedule(()=>{if(alive&&token===revision)finish('failed');},prepareTimeoutMs);
    let prepared;try {prepared=(prepare||preload)(frames,controller.signal);}catch {finish('failed');return promise;}
    Promise.resolve(prepared).then(()=>{
      if(!alive||token!==revision||!enabled()||trouble.has(current.state))return;
      if(prepareTimer!==undefined)cancel(prepareTimer);prepareTimer=undefined;loading=undefined;let index=0;
      function advance() {
        timer=undefined;
        if(!alive||token!==revision)return;
        if(!enabled()||trouble.has(current.state)||current.request?.key!==key) {finish('cancelled');return;}
        if(index===frames.length) {finish('finished');return;}
        frame=frames[index];publish('running',index++);
        if(alive&&token===revision)timer=schedule(advance,frame.duration);
      }
      advance();
    }).catch(()=>{if(alive&&token===revision)finish('failed');});
    return promise;
  }
  return {update,get currentFrame(){return frame;},getSnapshot:()=>snapshot,
    subscribe(listener){if(!alive)return()=>{};listeners.add(listener);return()=>listeners.delete(listener);},
    dispose(){if(!alive)return;alive=false;finish('cancelled',false);listeners.clear();current=undefined;}};
}
