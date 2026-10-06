// One camera move per opening, separate from image crossfades, layout FLIP and
// opacity. Additive transforms preserve the native positioning / left mirror.
export function createGreetingCamera(element,{
  reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,
}={}) {
  let alive=true,animation,lastKey;
  function stop(){animation?.cancel?.();animation=undefined;}
  return {
    update({enabled=true,asset,position,requestKey,phase,durationMs}={}) {
      if(!alive)return;
      if(!enabled||reducedMotion()||phase!=='running'||!requestKey||!Number.isFinite(durationMs)||durationMs<=0){stop();return;}
      const key=JSON.stringify([asset,requestKey]);
      if(key===lastKey)return;
      stop();lastKey=key;
      animation=element.animate?.([
        {transform:'translateY(0px) scale(1)',offset:0},
        {transform:'translateY(-2px) scale(1.009)',offset:.32},
        {transform:'translateY(-4px) scale(1.022)',offset:.69},
        {transform:'translateY(-3px) scale(1.016)',offset:.84},
        {transform:'translateY(0px) scale(1)',offset:1},
      ],{duration:durationMs,easing:'ease-in-out',composite:'add'});
    },
    stop,
    dispose(){if(!alive)return;alive=false;stop();},
  };
}
