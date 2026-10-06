// Shared, image-independent attention timing. Callers animate the returned
// opacity targets from their current CSS value; changing artwork never restarts
// the work hold or interrupts an in-flight fade. Kept self-contained for export.
export function createPortraitPresence(onChange,{
  schedule=setTimeout,cancel=clearTimeout,holdMs=2400,fadeMs=3200,recoverMs=800,
}={}) {
  let alive=true,current,timer,revision=0;
  let snapshot=Object.freeze({phase:'clear',opacityFactor:1,veilOpacity:0,durationMs:0});
  const duration=(value,fallback)=>Number.isFinite(value)?Math.max(0,value):fallback;
  holdMs=duration(holdMs,2400);fadeMs=duration(fadeMs,3200);recoverMs=duration(recoverMs,800);
  function stop() {
    revision++;
    if(timer!==undefined)cancel(timer);
    timer=undefined;
  }
  function target(phase,durationMs) {
    const opacityFactor=phase==='focus'?.58:1,veilOpacity=phase==='focus'?1:0;
    if(snapshot.phase===phase&&snapshot.opacityFactor===opacityFactor&&snapshot.veilOpacity===veilOpacity&&snapshot.durationMs===durationMs)return snapshot;
    snapshot=Object.freeze({phase,opacityFactor,veilOpacity,durationMs});
    return snapshot;
  }
  function recoveryDuration() {
    // Do not restart or accelerate an ongoing recovery when a state publication
    // only changes the phase name (for example, hold -> clear on quick completion).
    return snapshot.opacityFactor!==1||snapshot.veilOpacity!==0?recoverMs:snapshot.durationMs;
  }
  function update({enabled=true,composed=true,animated=true,asset,requestKey,greeting=false,hero=false,busy=false}={}) {
    if(!alive)return snapshot;
    const next={enabled,composed,animated,asset,requestKey,greeting,hero,busy};
    const changed=!current||Object.keys(next).some(key=>next[key]!==current[key]);
    current=next;
    if(!enabled||!composed) {stop();return target('clear',0);}
    if(!animated) {stop();return target(busy&&!greeting&&!hero?'focus':'clear',0);}
    if(greeting||hero||!busy) {stop();return target('clear',recoveryDuration());}
    if(!changed)return snapshot;
    stop();target('hold',recoveryDuration());
    const token=revision;
    timer=schedule(()=>{
      if(!alive||token!==revision)return;
      timer=undefined;
      const nextSnapshot=target('focus',fadeMs);
      onChange?.(nextSnapshot);
    },holdMs);
    return snapshot;
  }
  return {update,getSnapshot:()=>snapshot,dispose(){if(!alive)return;alive=false;stop();current=undefined;}};
}
