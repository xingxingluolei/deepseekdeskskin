// Browser-only, host-independent renderer. Decoded buffers overlap while an
// incoming figure fades in; loading or failed artwork never clears old pixels.
export function mountVisual(container,{crossfadeMs=180,schedule=setTimeout,cancel=clearTimeout}={}) {
  const buffers=[];
  const previousIsolation=container.style.isolation;container.style.isolation='isolate';
  for(let index=0;index<2;index++) {
    const image=document.createElement('img'),canvas=document.createElement('canvas');
    image.alt='DeepSeek 娘';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','DeepSeek 娘 · 静态');
    for(const element of [image,canvas]) {element.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none;opacity:1';element.style.display='none';container.append(element);}
    buffers.push({index,image,canvas});
  }
  const framingKeys=['--dss-portrait-width','--dss-portrait-x','--dss-portrait-y'];
  let alive=true,revision=0,lastKey='',active,pending,queued,transition,motion,motionKey,latestSkin;
  const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clearLayer(layer) {
    if(!layer)return;
    layer.element.style.display='none';layer.element.style.opacity='1';layer.element.style.mixBlendMode='normal';
    if(layer.mode==='dynamic') {layer.element.onload=layer.element.onerror=null;layer.element.removeAttribute('src');}
  }
  function finishTransition(token=transition,drain=true,shown=true) {
    if(!token||token!==transition)return;
    transition=undefined;if(token.timer!==undefined)cancel(token.timer);
    for(const animation of token.animations)animation?.cancel?.();
    if(token.outgoing!==active)clearLayer(token.outgoing);
    if(active){active.element.style.opacity='1';active.element.style.mixBlendMode='normal';}
    token.presentation.resolve(shown);
    if(drain&&alive&&queued) {
      const request=queued;queued=undefined;
      startLoad(request).then(request.resolve);
    }
  }
  function cancelQueued() {const request=queued;queued=undefined;request?.resolve(false);request?.presentation.resolve(false);}
  function durationFor(skin) {
    const configured=skin.transitionMs??crossfadeMs;
    return Number.isFinite(configured)?Math.max(0,Math.min(1000,configured)):180;
  }
  function cancelPending() {const load=pending;pending=undefined;load?.finish(false);}
  function stopMotion(){motion?.cancel?.();motion=undefined;motionKey=undefined;}
  function syncMotion() {
    const key=`${active?.index}:${active?.mode}:${latestSkin?.motion}:${reduced()}`;
    if(key===motionKey)return;
    stopMotion();motionKey=key;
    if(active?.mode==='dynamic'&&latestSkin?.motion==='float'&&!reduced())motion=active.element.animate?.([
      {transform:'translateY(0) rotate(-.25deg)'},{transform:'translateY(-5px) rotate(.25deg)'},{transform:'translateY(0) rotate(-.25deg)'},
    ],{duration:7200,iterations:Infinity,easing:'ease-in-out'});
  }
  function captureFraming() {return Object.fromEntries(framingKeys.map(key=>[key,container.style.getPropertyValue?.(key)||'']));}
  function applyFraming(element,framing) {for(const key of framingKeys)element.style.setProperty?.(key,framing[key]);}
  function applyDirection(element,mirror) {element.setAttribute('data-mirror',String(mirror));element.style.scale=mirror?'-1 1':'1 1';}
  function paint(layer,framing) {
    const outgoing=active;active=layer;
    applyFraming(layer.element,framing);layer.element.setAttribute('data-fit',layer.fit);applyDirection(layer.element,layer.mirror);layer.element.style.display='block';layer.element.style.opacity='1';
    const duration=durationFor(latestSkin);
    if(outgoing&&outgoing!==layer&&layer.mode==='dynamic'&&!reduced()&&duration>0) {
      // Additive alpha sums to one during a dissolve. Normal source-over
      // blending makes two half-opaque faces only 75% opaque at midpoint.
      outgoing.element.style.mixBlendMode=layer.element.style.mixBlendMode='plus-lighter';
      outgoing.element.style.opacity='0';
      const token={outgoing,presentation:layer.presentation,animations:[],timer:undefined};transition=token;
      token.animations=[outgoing.element.animate?.([{opacity:1},{opacity:0}],{duration,easing:'ease-in-out',fill:'forwards'}),
        layer.element.animate?.([{opacity:0},{opacity:1}],{duration,easing:'ease-in-out',fill:'forwards'})];
      for(const animation of token.animations)if(animation)animation.onfinish=()=>finishTransition(token);
      token.timer=schedule(()=>finishTransition(token),duration);
    } else {if(outgoing&&outgoing!==layer)clearLayer(outgoing);layer.presentation.resolve(true);}
    syncMotion();
  }
  function freezeActive() {
    if(active?.mode!=='dynamic')return;
    const image=active.element,canvas=buffers[active.index].canvas,context=canvas.getContext('2d');
    if(!context)return;
    try {
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;context.drawImage(image,0,0);
      const framing=Object.fromEntries(framingKeys.map(key=>[key,image.style.getPropertyValue?.(key)||'']));
      const prior=active;active={index:prior.index,mode:'static',element:canvas,fit:prior.fit,mirror:prior.mirror};canvas.setAttribute('data-fit',prior.fit);applyDirection(canvas,prior.mirror);applyFraming(canvas,framing);canvas.style.display='block';canvas.style.opacity='1';clearLayer(prior);
    } catch {}
  }
  function update(skin,source,{waitForPresentation=false}={}) {
    if(!alive)return Promise.resolve(false);
    latestSkin=skin;container.style.width=`${skin.size}px`;container.style.height=`${skin.size}px`;
    container.style.opacity=skin.enabled?String(skin.opacity):'0';container.dataset.position=skin.position;
    if(!skin.enabled) {
      revision++;lastKey='';cancelQueued();cancelPending();finishTransition(transition,false,false);stopMotion();
      for(const buffer of buffers)for(const mode of ['dynamic','static'])clearLayer({mode,element:mode==='dynamic'?buffer.image:buffer.canvas});active=undefined;
      return Promise.resolve(false);
    }
    const mode=skin.mode==='dynamic'?'dynamic':'static',fit=skin.fit==='contain'?'contain':'portrait',mirror=skin.mirror===true,key=`${mode}:${fit}:${mirror}:${source}`;
    const immediate=mode==='static'||reduced()||durationFor(skin)===0;
    if(immediate) {cancelQueued();finishTransition(transition,false);}
    if(key===lastKey) {cancelQueued();syncMotion();return waitForPresentation ? pending?.promise.presented||active?.presentation?.promise||Promise.resolve(false) : pending?.promise||Promise.resolve(true);}
    const request={skin:{...skin},source,key,mode,fit,mirror,framing:captureFraming()};
    if(transition) {
      // Both buffers still own visible pixels. Keep only the newest requested
      // pose until the current dissolve releases its outgoing buffer.
      if(queued?.key===key) {Object.assign(queued,request);syncMotion();return waitForPresentation?queued.presentation.promise:queued.promise;}
      cancelQueued();
      request.promise=new Promise(resolve=>request.resolve=resolve);request.presentation=presentationReceipt();queued=request;
      syncMotion();return waitForPresentation?request.presentation.promise:request.promise;
    }
    const loaded=startLoad(request);return waitForPresentation?loaded.presented:loaded;
  }
  function presentationReceipt() {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
  function startLoad({skin,source,key,mode,fit,mirror,framing,presentation=presentationReceipt()}) {
    latestSkin=skin;lastKey=key;const token=++revision;cancelPending();stopMotion();
    if(mode==='static')freezeActive();
    const buffer=buffers[active?.index===0?1:0],element=mode==='dynamic'?buffer.image:buffer.canvas;
    const layer={index:buffer.index,mode,element,fit,mirror,presentation},loader=mode==='dynamic'?element:new Image();
    let resolve;const promise=new Promise(done=>resolve=done);promise.presented=presentation.promise;
    const load={promise,finish(success) {
      if(load.done)return;load.done=true;loader.onload=loader.onerror=null;
      if(mode==='static'||!success)loader.removeAttribute('src');
      if(!success)presentation.resolve(false);
      if(pending===load)pending=undefined;resolve(success);
    }};pending=load;
    function fail(message) {
      if(!alive||token!==revision||load.done)return;
      lastKey='';load.finish(false);container.dispatchEvent(new CustomEvent('skin-error',{detail:message}));
    }
    loader.onerror=()=>fail('图片无法解码，请重新选择形象');
    loader.onload=async()=>{
      if(!alive||token!==revision||load.done)return;
      try {
        await loader.decode?.();
        if(!alive||token!==revision||load.done)return;
        if(loader.naturalWidth*loader.naturalHeight>20_000_000)throw Error('图片分辨率过大');
        if(mode==='static') {element.width=loader.naturalWidth;element.height=loader.naturalHeight;const context=element.getContext('2d');if(!context)throw Error('无法绘制静态形象');context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(loader,0,0);}
        paint(layer,framing);load.finish(true);
      } catch(error) {fail(error?.message||'图片无法解码');}
    };
    loader.src=source;return promise;
  }
  return {update,dispose(){if(!alive)return;alive=false;revision++;cancelQueued();cancelPending();finishTransition(transition,false,false);stopMotion();container.style.isolation=previousIsolation||'';for(const buffer of buffers){clearLayer({mode:'dynamic',element:buffer.image});buffer.image.remove();buffer.canvas.remove();}active=undefined;}};
}
