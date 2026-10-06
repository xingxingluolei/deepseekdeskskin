import { mountCharacterSurfaces, createActivityTracker } from './tool-presentation-runtime.mjs';
import { mountVisual } from '../src/visual.mjs';
import { CHARACTER_SKINS, normalizeSkin } from '../src/skin.mjs';

// Synthetic public snapshots only. The production tracker classifies `read`;
// the production controller owns every presentation deadline and hold timer.
export function createToolPresentationDemo(container, {
  asset = 'serene', decodeDelayMs = 650, onChange = () => {},
  schedule = setTimeout, cancel = clearTimeout,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  const started = now(), timers = new Map(), effects = [], cleanups = [], slots = new Map();
  let alive = true, running = false, tracker, lastVisual, latestPresentation, lastAckEpoch;
  let resolveDone; const done = new Promise(resolve => resolveDone = resolve);
  const result = {status:'ready',asset,decodeDelayMs,events:[],activity:'idle',visual:'idle',times:{},visibleHoldMs:null,passed:null};
  const elapsed = () => now() - started;
  const snapshot = () => ({...result,times:{...result.times},events:result.events.map(row=>({...row}))});
  const publish = () => onChange(snapshot());
  function record(event) {result.events.push({at:elapsed(),event,activity:controller.activityState,visual:controller.visualState});publish();}
  function finish(status, message) {
    if (result.status === 'done' || result.status === 'error' || result.status === 'cancelled') return;
    result.status=status;if(message)result.message=message;publish();resolveDone(snapshot());
  }
  function delay(ms) {return new Promise(resolve=>{const key=schedule(()=>{timers.delete(key);resolve(alive);},ms);timers.set(key,resolve);});}
  // Only enough host hooks to admit a single main conversation. Updates below
  // feed its captured real tracker; there is no alternate activity state machine.
  const React = {createElement:(type,props)=>({type,props}),useRef:()=>({}),useEffect:fn=>effects.push(fn),useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()};
  const ctx={slots:{entries:()=>[],inject:(_name,fn)=>fn(),register:({name},component)=>{slots.set(name,component);return()=>slots.delete(name);}}};
  const catalog=Object.fromEntries(CHARACTER_SKINS.map(item=>[item.id,{...item,portrait:'/assets/'+item.portrait,scenes:Object.fromEntries(Object.entries(item.scenes).map(([state,path])=>[state,'/assets/'+path]))}]));
  const skin={...normalizeSkin({asset,enabled:true,mode:'dynamic',motion:'float',size:420,opacity:1}),fit:'contain',transitionMs:420};
  const controller=mountCharacterSurfaces(ctx,catalog,React,emit=>(tracker=createActivityTracker(emit,{schedule,cancel})),{},undefined,undefined,undefined,{schedule,cancel,now});
  controller.update(skin);
  const session={running:true};
  const sessions={byId:{demo:{retainedBy:{mainView:1}}},projectionsBySession:{}};
  const chat=name=>({timeline:{turnOrder:[1],turns:new Map([[1,{turn:1,status:'open'}]])},legacy:{runningCalls:name?[{turn:1,phase:'start',callId:'demo-'+name,name}]:[]}});
  const wrapped=slots.get('conversation.input.right')({sessionId:'demo',useSession:select=>select(session),useSessionStatus:select=>select(new Map()),useChat:select=>select(chat()),useSessions:select=>select(sessions)});
  wrapped.type(wrapped.props);for(const effect of effects){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup);}
  const visual=mountVisual(container,{schedule,cancel});
  const visualSkin=()=>({...skin,motion:'none',mirror:controller.metadata.facingByState[controller.visualState]==='right'});
  const decodeRestores=[];
  for(const image of container.querySelectorAll('img')) {
    const decode=image.decode;
    image.decode=async function() {
      const source=this.src;await decode?.call(this);
      if(alive && decodeDelayMs>0 && /-reading-v2\.png(?:$|[?#])/.test(source)) {
        result.times.decodeWaitStarted=elapsed();record('Read 已解码；额外延迟 '+decodeDelayMs+'ms');
        await delay(decodeDelayMs);
        if(alive){result.times.decodeWaitEnded=elapsed();record('Read 额外解码延迟结束');}
      }
    };
    decodeRestores.push(()=>{image.decode=decode;});
  }
  function render() {
    if(!alive)return;
    result.activity=controller.activityState;result.visual=controller.visualState;
    if(lastVisual!==result.visual) {
      lastVisual=result.visual;
      if(running && result.visual==='thinking' && result.times.readCall!==undefined) {
        result.times.thinkingRequested=elapsed();
        if(result.times.readAcknowledged!==undefined)result.visibleHoldMs=result.times.thinkingRequested-result.times.readAcknowledged;
        result.passed=result.visibleHoldMs!==null && result.visibleHoldMs>=900;
      }
      record('显示请求 → '+result.visual);
    } else publish();
    const request=controller.toolPresentation, state=controller.visualState;
    const presentation=visual.update(visualSkin(),controller.imageSource,{waitForPresentation:true});latestPresentation=presentation;
    Promise.resolve(presentation).then(shown=>{
      if(!alive)return;
      if(request && request.epoch!==lastAckEpoch) {
        lastAckEpoch=request.epoch;
        const acknowledgedAt=elapsed();
        const accepted=controller.acknowledgeToolPresentation(request,shown);
        if(accepted && shown && request.state==='reading') {
          result.times.readAcknowledged=acknowledgedAt;record('Read 淡入完成；controller 接受 renderer 回执');
        } else record('Read 回执：shown='+shown+'，accepted='+accepted);
      }
      if(state==='thinking' && result.times.thinkingRequested!==undefined && shown) {
        result.times.thinkingPresented=elapsed();record('Thinking 淡入完成');finish('done');
      }
    }).catch(error=>finish('error',error.message));
  }
  const stop=controller.subscribe(render);
  const onError=event=>finish('error',event.detail || '图片无法加载');container.addEventListener('skin-error',onError);
  render();
  function feed(name){tracker.update('demo',session,undefined,chat(name),{sessions,statuses:new Map()});}
  async function run() {
    if(running)return done;
    running=true;result.status='running';publish();
    if(typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish('error','系统启用了减少动态效果；真实 controller 会跳过工具停留。请关闭该选项后重新运行。');return done;
    }
    // A watchdog only fails this review. It never controls when poses change.
    void delay(8000).then(live=>{if(live)finish('error','八秒内未完成，请检查本地 PNG、页面可见性与控制台。');});
    if(!await latestPresentation || !alive)return done;
    feed('review-generic-tool');
    // Wait for decode but deliberately leave the preceding 420ms dissolve in
    // flight, exercising the real renderer's single-newest-request queue.
    if(!await visual.update(visualSkin(),controller.imageSource) || !alive)return done;
    result.times.readCall=elapsed();record('Read call 开始（wire name: read）');feed('read');
    if(!await delay(20))return done;
    result.times.readResult=elapsed();feed();record('Read result；真实状态已回到 Thinking');
    return done;
  }
  function dispose() {
    if(!alive)return;alive=false;stop();container.removeEventListener('skin-error',onError);
    for(const [key,resolve] of timers){cancel(key);resolve(false);}timers.clear();
    for(const restore of decodeRestores)restore();visual.dispose();for(const cleanup of cleanups.reverse())cleanup();controller.dispose();
    if(!['done','error'].includes(result.status))finish('cancelled');
  }
  return {run,dispose,snapshot,done};
}
