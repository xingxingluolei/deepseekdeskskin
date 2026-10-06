// Remote test double exercises public mount/stream DTO and cleanup boundaries.
export const tick = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
export const bashRow = (extra={}) => ({seq:1,version:1,kind:'bash',sessionId:'one',turn:4,callId:'bash',exitCode:3,timedOut:false,signal:null,...extra});
export function frameRemote({follow,mountFailures=0,deferredMount,cleanupGate,initialOpening=true}={}) {
 const subscriptions=new Set(), options=[], mounts=[];let releases=0,accepted=0,opened=0,disposed=0;
 const namespace={follow:follow || (async function*(request,signal){
  const channel={owner:request.sessionId,queue:initialOpening?[{type:'opened',sessionId:request.sessionId,epoch:'epoch',cursor:0}]:[],closed:false};subscriptions.add(channel);opened++;
  const stop=()=>{channel.closed=true;channel.wake?.();};signal.addEventListener('abort',stop,{once:true});
  try {while(!channel.closed){if(!channel.queue.length){await new Promise(resolve=>channel.wake=resolve);channel.wake=undefined;continue;}yield channel.queue.shift();}}
  finally{subscriptions.delete(channel);signal.removeEventListener('abort',stop);}
 })};
 const remote={
  async $mount(contribution){mounts.push(contribution);if(mountFailures-->0)throw Error('admission unavailable');if(deferredMount)await deferredMount;return async()=>{releases++;};},
  $stream(config){options.push(config);const abort=new AbortController();let done=false,iterator,finish;const completion=new Promise(resolve=>finish=resolve);const stream={
   async *[Symbol.asyncIterator](){iterator=config.open(abort.signal);try {for await(const value of iterator){if(done)break;if(value.__throw)throw value.__throw;const special=value.__item;yield {generation:special?.generation??1,value:special?.value??value,accept(){accepted++;}};}}finally{finish();}},
   async dispose(){if(!done){done=true;disposed++;abort.abort();}await completion;if(cleanupGate)await cleanupGate;},
  };return stream;}
 };
 const ctx={remote,get:key=>key==='remote'?remote:key==='remote.deskskinReceipt'?namespace:undefined};
 return {ctx,remote,namespace,options,mounts,get releases(){return releases;},get accepted(){return accepted;},get opened(){return opened;},get disposed(){return disposed;},get watchers(){return subscriptions.size;},
 send(frame,owner='one'){for(const channel of subscriptions)if(channel.owner===owner){channel.queue.push(frame);channel.wake?.();}},
 fail(error=Error('wire failed')){for(const channel of subscriptions){channel.queue.push({__item:{generation:2,value:{type:'carrier-broken',error}}});channel.wake?.();}},
 };
}
