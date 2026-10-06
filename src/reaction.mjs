// Apply to an outer figure wrapper, leaving the inner image's mirror and
// breathing transform independent. No inline styles or persistent fill survive.
export function createStateReaction(element) {
  const preference=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):undefined;
  let alive=true,previous,active;
  function stop() {
    const animation=active;active=undefined;
    if(!animation)return;
    animation.onfinish=animation.oncancel=null;
    animation.cancel?.();
  }
  function onPreferenceChange() {if(preference?.matches)stop();}
  if(preference?.addEventListener)preference.addEventListener('change',onPreferenceChange);
  else preference?.addListener?.(onPreferenceChange);
  function update({state,asset,enabled=true,animated=true}={}) {
    if(!alive)return;
    const entering=state==='error'&&(previous?.state!=='error'||previous?.asset!==asset);
    previous={state,asset};
    if(state!=='error'||!enabled||!animated||preference?.matches) {stop();return;}
    if(!entering)return;
    stop();
    if(typeof element?.animate!=='function')return;
    const animation=element.animate([
      {translate:'0px 0px',scale:'1',offset:0},
      {translate:'4px 0px',scale:'.986',offset:.2},
      {translate:'-1px 0px',scale:'.998',offset:.58},
      {translate:'0px 0px',scale:'1',offset:1},
    ],{duration:1300,iterations:1,easing:'cubic-bezier(.22,.61,.36,1)',fill:'none'});
    if(!animation)return;
    active=animation;animation.id='dss-error-reaction';
    animation.onfinish=()=>{if(active===animation)stop();};
    animation.oncancel=()=>{
      if(active!==animation)return;
      active=undefined;animation.onfinish=animation.oncancel=null;
    };
  }
  function dispose() {
    if(!alive)return;
    alive=false;stop();previous=undefined;
    if(preference?.removeEventListener)preference.removeEventListener('change',onPreferenceChange);
    else preference?.removeListener?.(onPreferenceChange);
  }
  return {update,dispose};
}
