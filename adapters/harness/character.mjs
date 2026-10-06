// Own character components use public slots. Version-specific CSS stays here,
// scoped to our enabled marker, so disabling the skin restores native surfaces.
export function mountCharacterSurfaces(ctx, catalog, React, createActivityTracker, resources = {}, mountConversationScrollRail, createReceiptClient, createTurnGreetingTracker, {schedule = setTimeout, cancel = clearTimeout, now = () => globalThis.performance?.now?.() ?? Date.now()} = {}) {
  const marker = 'data-deepseekdeskskin';
  const scrollRail = mountConversationScrollRail?.();
  const style = document.createElement('style');
  // A catalog contains references to one shared embedded media table. Decode
  // only the active portrait/state, and release the prior character on switch.
  if (catalog?.portrait) catalog = {serene:{id:'serene',name:'澄蓝',label:'SERENE BLUE',...catalog}};
  const urls = new Map();
  const readResource = value => resources[value] || value;
  function resourceURL(value, cache = urls) {
    const source = readResource(value);
    if (!source) return undefined;
    if (!source.startsWith('data:image/')) return source;
    if (!cache.has(source)) {
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
      if (!match) return source;
      cache.set(source, URL.createObjectURL(new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], {type:match[1]})));
    }
    return cache.get(source);
  }
  function releaseResources(cache = urls) {for (const url of cache.values()) URL.revokeObjectURL(url);cache.clear();}
  let selectedId; let current; let currentSkin = {}; let view = {};
  const portraitURL = () => resourceURL(current?.portrait);
  const sceneURL = () => {
    if (!current) return undefined;
    const state = visualState();
    return resourceURL(current.scenes?.[state] || current.scenes?.idle || current.halfbody || current.scene);
  };
  const listeners = new Set();
  let activity = 'idle', restAfterReply = false;
  let alive = true; let tracker; let greetingTracker; let greetingRequest; let receiptClient; let jobsClient; let disposal; let driverOwner;
  const toolPoses = new Set(['reading','writing','searching','executing','delegating']);
  const ordinaryPoses = new Set(['thinking','answering','complete','idle']);
  const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let heldTool, toolDeadline = 0, toolTimer, toolGeneration = 0, toolObservation, poseSession, poseTurn;
  let toolPresentation, toolPresented = false, toolPresentationSuppressed = false;
  const visualState = () => heldTool || (activity === 'idle' && restAfterReply ? 'answering' : activity);
  function stopToolPose() {
    toolGeneration++;if(toolTimer!==undefined)cancel(toolTimer);toolTimer=undefined;heldTool=undefined;toolDeadline=0;
    toolPresentation=undefined;toolPresented=false;
  }
  function canHoldToolPose() {return Boolean(!toolPresentationSuppressed && driverOwner && current && currentSkin.enabled && currentSkin.mode==='dynamic' && currentSkin.motion!=='none' && !motionPreference?.matches);}
  function armToolPose(ms) {
    if(toolTimer!==undefined)cancel(toolTimer);
    toolDeadline=now()+ms;const token=toolGeneration;
    toolTimer=schedule(()=>{
      if(!alive || token!==toolGeneration)return;
      toolTimer=undefined;stopToolPose();publishActivity(activity);
    },ms);
  }
  function observeToolPose(next) {
    const eligible=canHoldToolPose();
    if(heldTool && (!eligible || now()>=toolDeadline || !toolPoses.has(next)&&!ordinaryPoses.has(next)))stopToolPose();
    // Only observed live entries earn a display lease. Loading/queueing has a
    // finite budget; the visible hold begins after the renderer's full dissolve.
    // Later tools replace this lease, while attention states interrupt it.
    if(eligible && toolPoses.has(next) && next!==toolObservation) {
      stopToolPose();heldTool=next;
      toolPresentation=Object.freeze({epoch:toolGeneration,state:next,asset:selectedId});
      armToolPose(3000);
    }
    toolObservation=next;
  }
  function acknowledgeToolPresentation(request,shown) {
    if(!alive || !request || !toolPresentation || toolPresented ||
        request.epoch!==toolPresentation.epoch || request.state!==heldTool || request.asset!==selectedId)return false;
    if(!canHoldToolPose() || now()>=toolDeadline) {stopToolPose();publishActivity(activity);return false;}
    if(shown!==true) {stopToolPose();publishActivity(activity);return true;}
    toolPresented=true;armToolPose(900);return true;
  }
  function setToolPresentationSuppressed(value) {
    const next=Boolean(value);if(next===toolPresentationSuppressed)return;
    toolPresentationSuppressed=next;
    // Opening portraits and detached surfaces never accumulate old tools for
    // replay. A tool still genuinely active at reveal uses its current state.
    if(next)stopToolPose();
    publishActivity(activity);
  }
  function onMotionPreference() {if(motionPreference?.matches){stopToolPose();publishActivity(activity);}}
  if(motionPreference?.addEventListener)motionPreference.addEventListener('change',onMotionPreference);
  else motionPreference?.addListener?.(onMotionPreference);
  const subscribe = listener => {listeners.add(listener);return () => listeners.delete(listener);};
  function publishActivity(next) {
    if(!alive)return;
    observeToolPose(next);
    if(activity === next && view.restAfterReply === restAfterReply && view.visualState === visualState())return;
    activity = next;
    // React external stores require a new snapshot when activity changes.
    // Skin selection and task state share this same stable snapshot.
    view = {...view,activity,restAfterReply,visualState:visualState()};
    for (const listener of listeners) listener();
  }
  function publishGreeting(request) {
    if(!alive||greetingRequest===request)return;
    greetingRequest=request;view={...view,greetingRequest};
    for(const listener of listeners)listener();
  }
  const scope = `[${marker}]`;
  function useView() {
    if (React.useSyncExternalStore) return React.useSyncExternalStore(subscribe, () => view, () => view);
    if (React.useState && React.useEffect) {
      const [value,setValue] = React.useState(view);
      React.useEffect(() => subscribe(() => setValue(view)), []);
      return value;
    }
    return view;
  }
  const wave = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><g fill="none" stroke="#8dbaff" stroke-opacity=".13"><path d="M-60 310C100 40 200 410 410 220S650 120 700 210"/><path d="M-60 322C100 52 200 422 410 232S650 132 700 222"/><path d="M-60 334C100 64 200 434 410 244S650 144 700 234"/><circle cx="440" cy="160" r="112" stroke-opacity=".07"/></g></svg>')}")`;
  style.textContent = `
${scope}{--dss-line:#92b8ef38;--dss-glow:#88b7ff18;--dss-ink:#b7d0fc;--dss-surface:#17263d;--dss-side-space:clamp(0px,calc(85cqw - 900px),340px);--dss-hero-height:min(54vh,clamp(120px,calc(100vh - 360px),440px))}
${scope}[${marker}=light]{--dss-line:#7397d044;--dss-glow:#6e9fdd12;--dss-ink:#4266a4;--dss-surface:#f5f8ff}
${scope} [class*="_sidebarCol"]{background:linear-gradient(160deg,var(--dsw-specific-sidebar-fill),var(--dsw-alias-bg-base));border-right:1px solid var(--dss-line)}
${scope} ._3WPZCG_root{background:transparent;background-image:${wave};background-position:center bottom;background-repeat:no-repeat;background-size:100% auto}
${scope}[data-deepseekdeskskin-character] ._3WPZCG_brandMark,${scope}[data-deepseekdeskskin-character] ._3WPZCG_railMark{width:30px;height:30px;border-radius:10px;background:var(--dss-portrait) center/cover;box-shadow:0 0 0 1px var(--dss-line);overflow:hidden}
${scope}[data-deepseekdeskskin-character] ._3WPZCG_brandMark svg,${scope}[data-deepseekdeskskin-character] ._3WPZCG_railMark svg{display:none}
${scope} .ST7X_W_root{container-type:inline-size;container-name:dss-conversation;background:linear-gradient(110deg,var(--dsw-alias-bg-base) 35%,var(--dsw-alias-bg-layer-1) 72%,var(--dsw-alias-bg-layer-3))}
${scope} .ST7X_W_header{background:linear-gradient(90deg,var(--dsw-alias-bg-base),var(--dsw-alias-bg-layer-1));border-color:var(--dss-line)}
${scope} .ST7X_W_root{--dss-reading-width:min(max(0px,calc(var(--dsh-conversation-column-width,1000px) - 112px)),var(--dsh-chat-user-width,clamp(680px,calc(var(--dsh-conversation-column-width,1000px) * .64),920px)))}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=active] > [data-conversation-content]{margin-right:var(--dss-side-space);--dsh-chat-content-width:var(--dss-reading-width)}
${scope}[data-deepseekdeskskin-character][data-deepseekdeskskin-position=left] .ST7X_W_root[data-phase=active] > [data-conversation-content]{margin-right:0;margin-left:var(--dss-side-space)}
/* The empty conversation is a character-led landing page. All rules are
   scoped to the native hero phase; the active transcript keeps its own dock. */
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero{width:min(46%,600px);align-self:flex-start;margin-left:clamp(28px,5cqw,84px);padding-bottom:0;--dsh-composer-side-clearance:0px;--dsh-composer-card-max-width:100%;--dsh-composer-text-max-height:176px}
${scope}[data-deepseekdeskskin-character][data-deepseekdeskskin-position=left] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero{align-self:flex-end;margin-left:0;margin-right:clamp(28px,5cqw,84px)}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_root{height:auto;padding:0 0 22px;justify-content:flex-start}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_headline,${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_titleGroup{justify-content:flex-start;font-size:24px;line-height:32px}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_heroWorkspaceRow{padding:0;flex-wrap:wrap;gap:4px}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .yhfFVG_hero .yhfFVG_input{min-height:44px}
${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .dss-hero-portrait{width:34px;height:34px;border-radius:11px}
@container dss-conversation (max-width:960px) and (min-width:701px){${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero{width:49%;margin-left:24px}${scope}[data-deepseekdeskskin-character][data-deepseekdeskskin-position=left] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero{margin-left:0;margin-right:24px}}
@container dss-conversation (max-width:700px){${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_composerSeat{margin-top:auto}${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_scrollBody{justify-content:flex-start;padding-top:calc(var(--dss-hero-height) + 48px);box-sizing:border-box}${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero,${scope}[data-deepseekdeskskin-character][data-deepseekdeskskin-position=left] .ST7X_W_root[data-phase=hero] .ST7X_W_composerHero{width:calc(100% - 40px);max-width:560px;align-self:center;margin:0 0 24px}${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_root{padding-bottom:8px}${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_headline,${scope}[data-deepseekdeskskin-character] .ST7X_W_root[data-phase=hero] .bocITq_titleGroup{font-size:20px;line-height:28px}}
${scope} .ST7X_W_root:has([data-conversation-tabs] [aria-selected=true]:not(:first-child)) #deepseekdeskskin-background{visibility:hidden}
${scope} .ST7X_W_root:has([data-conversation-tabs] [aria-selected=true]:not(:first-child)) > [data-conversation-content]{margin-left:0;margin-right:0}
${scope} .JXrxFq_frame{left:24px;right:auto;width:22px;opacity:.46;transition:opacity .18s ease}
${scope} .JXrxFq_frame:hover,${scope} .JXrxFq_frame:focus-within{opacity:1}
${scope} .JXrxFq_mark:before{left:0;right:auto;width:14px;height:3px;border-radius:999px;transform-origin:0;background:var(--dss-line)}
${scope} .JXrxFq_markActive:before,${scope} .JXrxFq_markPreview:before,${scope} .JXrxFq_mark:focus-visible:before{background:var(--dsw-alias-state-business-primary)}
${scope} .JXrxFq_mark:focus-visible:after{left:0;right:auto;width:20px}
${scope} .JXrxFq_preview{left:calc(100% + 10px);right:auto;border:1px solid var(--dss-line);background:var(--dsw-alias-bg-layer-1)}
${scope} .ST7X_W_widthHandle[data-side=right]{display:none}
${scope} .ST7X_W_widthHandle:after{top:50%;bottom:auto;width:3px;height:36px;border-radius:999px;background:var(--dsw-alias-state-business-primary);transform:translateY(-50%)}
@media(prefers-reduced-motion:reduce){${scope} .JXrxFq_frame{transition:none}}
@container dss-conversation (max-width:791px){${scope} .ST7X_W_widthHandle{display:none}}
${scope} [class*="_newSession"]:is(button){background:linear-gradient(120deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border-color:var(--dss-line);box-shadow:inset 0 1px 0 #d5e6ff12}
${scope} [role=treeitem][aria-selected=true],${scope} [role=row][aria-selected=true]{box-shadow:inset 2px 0 var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}
${scope} .ST7X_W_root[data-phase=active] .ST7X_W_composerSeat{background:none}
${scope} .ST7X_W_root[data-phase=active] .ST7X_W_composerSeat:before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(180deg,transparent,var(--dsw-alias-bg-base) 36px);mask-image:linear-gradient(to right,transparent,#000 96px,#000 calc(100% - 96px),transparent)}
${scope} [data-conversation-region=composer] .yhfFVG_card{box-shadow:0 8px 36px #08112216,inset 0 0 0 1px var(--dss-line),inset 0 1px 0 #dceaff12}
${scope} [data-conversation-region=composer]:focus-within .yhfFVG_card{box-shadow:0 8px 36px #08112216,inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
${scope} [role=menu],${scope} [role=listbox],${scope} [role=dialog]{border-color:var(--dss-line)}
${scope}[data-deepseekdeskskin-character] [data-sidebar-right-guide] [class$="_hero"]{width:88px;height:88px;border-radius:28px;background:var(--dss-portrait) center/cover;box-shadow:0 0 0 1px var(--dss-line),0 12px 40px var(--dss-glow)}
${scope}[data-deepseekdeskskin-character] [data-sidebar-right-guide] [class$="_hero"]>svg{visibility:hidden}
${scope} [data-sidebar-right-guide-entry]{border-color:var(--dss-line);background:linear-gradient(130deg,var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-2))}
${scope} .Dws9Sa_header{background-image:${wave};background-position:right center;background-size:360px auto;border-bottom:1px solid var(--dss-line)}
${scope}[data-deepseekdeskskin-character] ._7514NG_emptyState:before{content:"";display:block;width:52px;height:52px;margin:0 auto 12px;border-radius:18px;background:var(--dss-portrait) center/cover;opacity:.8}
${scope} .dss-hero-portrait{display:block;width:44px;height:44px;object-fit:cover;border-radius:16px;box-shadow:0 0 0 1px var(--dss-line),0 6px 24px var(--dss-glow)}
dialog[data-dss-album]::backdrop{background:#081427b3;backdrop-filter:blur(7px)}
`;
  document.head.append(style);
  let disposers = []; let enabled = false; let album; let restoreFocus; let albumURLs;
  const h = React.createElement;
  function closeAlbum() { if (!album) return; album.remove(); album = undefined; if (albumURLs) releaseResources(albumURLs); albumURLs = undefined; restoreFocus?.focus?.(); }
  function openAlbum(event, fallback = {}) {
    if (album) return;
    const name = current?.name || fallback.name || 'DeepSeek 娘';
    restoreFocus = event?.currentTarget || document.activeElement;
    albumURLs = new Map();
    album = document.createElement('dialog');
    album.setAttribute('data-dss-album','');
    album.setAttribute('aria-label', name + '皮肤详情');
    album.style.cssText = 'border:1px solid #b6cbed;border-radius:20px;padding:0;width:min(1120px,92vw);max-height:90vh;background:#f3f6fc;color:#18305b;box-shadow:0 28px 100px #0006;overflow:auto;-webkit-app-region:no-drag';
    const content = document.createElement('div'); album.append(content);
    const shadow = content.attachShadow({mode:'open'});
    const s = document.createElement('style');
    s.textContent = ':host::backdrop{background:#081427b3;backdrop-filter:blur(7px)}header{position:sticky;top:0;z-index:2;background:#f3f6fc;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:18px 24px;font:14px -apple-system,sans-serif;letter-spacing:.14em}header>strong{flex:1 1 160px}button{border:1px solid #7f9bc355;background:white;border-radius:9px;padding:8px 13px;color:#294770;cursor:pointer}img{width:100%;display:block}.preview{flex:1 0 100%;padding:0;display:flex;flex-wrap:wrap;gap:8px}.preview[hidden]{display:none}button[aria-pressed=true]{background:#dbe9ff;border-color:#6896d9}nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}p{margin:0;padding:18px 24px;font:12px/1.8 -apple-system,sans-serif;color:#537094}';
    const header = document.createElement('header'); const title = document.createElement('strong'); title.textContent = name + (current?.label ? ' · ' + current.label : '');
    const close = document.createElement('button'); close.textContent = '关闭'; close.addEventListener('click', closeAlbum);
    const sheet = document.createElement('img'); sheet.src = resourceURL(current?.sheet || current?.scenes?.[visualState()] || current?.scenes?.idle || current?.scene, albumURLs) || fallback.imageSource || '';
    sheet.alt = name + (current?.sheet ? '人设与细节图' : '当前场景');
    sheet.style.scale = !current?.sheet&&current?.facingByState?.[visualState()]==='right'?'-1 1':'1 1';
    const caption = document.createElement('p'); caption.textContent = (current?.caption || '当前导出皮肤的本地图像。') + ' · ' + (currentSkin.mode === 'static' ? '静态' : '动态') + ' · ' + (currentSkin.palette === 'dark' ? '深海蓝' : '云间白') + ' · ' + (currentSkin.enabled ? '已启用' : '已关闭') + '。';
    const stateNames = {idle:'就绪',thinking:'思考',working:'工作',reading:'阅读',writing:'书写',searching:'检索',executing:'命令执行',delegating:'委派任务',answering:'正文回应',parallel:'并行协作',compacting:'整理上下文',retrying:'重试',waiting:'等待确认',complete:'完成',error:'需要检查',queued:'排队',connecting:'连接中',disconnected:'连接中断',stopped:'已停止',paused:'已暂停',blocked:'需要介入'};
    const states = Object.keys(current?.scenes || {}).map(key => stateNames[key] || key);
    if (states.length) caption.textContent += ' 可用状态：' + states.join('、') + '。';
    const actions = document.createElement('nav');
    const preview = document.createElement('div'); preview.className = 'preview'; preview.hidden = true;
    const choices = [];
    const originalCaption = caption.textContent;
    const sceneEntries = Object.entries(current?.scenes || {}).filter(([,source]) => source);
    function showState(key) {
      const pose = key;
      const source = current?.scenes?.[pose] || current?.scenes?.[key]; if (!source) return;
      sheet.src = resourceURL(source, albumURLs); sheet.alt = name + ' · ' + (stateNames[key] || key); sheet.style.scale = current?.facingByState?.[pose]==='right'?'-1 1':'1 1';
      caption.textContent = '神态预览 · ' + (stateNames[key] || key) + '。预览只展示立绘，不改变客户端任务状态。';
      preview.hidden = false;
      for (const [state,button] of choices) button.setAttribute('aria-pressed',String(state === key));
    }
    if (current?.sheet) {
      const sheetButton = document.createElement('button'); sheetButton.textContent = '人设图';
      sheetButton.addEventListener('click', () => {sheet.src = resourceURL(current.sheet,albumURLs); sheet.alt = name + '人设与细节图'; sheet.style.scale='1 1'; caption.textContent = originalCaption; preview.hidden = true;});
      actions.append(sheetButton);
    }
    if (sceneEntries.length) {
      const previewButton = document.createElement('button'); previewButton.textContent = '神态预览';
      previewButton.addEventListener('click', () => showState(current.scenes?.[visualState()] ? visualState() : 'idle'));
      actions.append(previewButton);
      for (const [key] of sceneEntries) {
        const button = document.createElement('button'); button.textContent = stateNames[key] || key;
        button.setAttribute('data-dss-preview-state',key); button.setAttribute('aria-pressed','false');
        button.addEventListener('click', () => showState(key)); choices.push([key,button]); preview.append(button);
      }
    }
    actions.append(close); header.append(title,actions,preview); shadow.append(s,header,sheet,caption);
    album.addEventListener('cancel', event => { event.preventDefault(); closeAlbum(); });
    document.body.append(album); album.showModal(); close.focus();
  }
  // Slot hook providers can arrive after this plugin. A hook-free outer
  // component waits for them, then mounts a separate component with a fixed
  // hook order; an unavailable useChat must never abdicate the slot entry.
  const ownedReleases = new Set();
  const sourceAdapters = new WeakMap();
  const emptySource = {getSnapshot:() => undefined,subscribe:() => () => {}};
  function ownRelease(release) {
    let live = true;
    const stop = () => {
      if (!live) return;
      live = false; ownedReleases.delete(stop);
      try { release?.(); } catch {}
    };
    ownedReleases.add(stop);
    return stop;
  }
  // Public services may be missing during startup or be withdrawn on reload.
  // Guard optional sources so a transient error cannot trip the slot boundary
  // and permanently stop the standard session/chat hooks.
  function sourceAdapter(source) {
    if (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') source = emptySource;
    if (!sourceAdapters.has(source)) sourceAdapters.set(source, {
      getSnapshot() {if (!alive) return undefined;try {return source.getSnapshot();} catch {sourceAdapters.delete(source);return undefined;}},
      subscribe(listener) {
        if (!alive) return () => {};
        try {return ownRelease(source.subscribe(() => {if (alive) listener();}));} catch {
          // Retry on the next standard hook publication without a polling
          // timer or trapping the whole Driver in React's error boundary.
          sourceAdapters.delete(source);return () => {};
        }
      },
    });
    return sourceAdapters.get(source);
  }
  function usePublicSource(source) {
    const adapter = sourceAdapter(source);
    if (React.useSyncExternalStore) return React.useSyncExternalStore(adapter.subscribe,adapter.getSnapshot,adapter.getSnapshot);
    const [value,setValue] = React.useState(adapter.getSnapshot);
    React.useEffect(() => {
      const stop = adapter.subscribe(() => setValue(adapter.getSnapshot()));
      setValue(adapter.getSnapshot());
      return stop;
    },[adapter]);
    return value;
  }
  function ActivityDriver(props) {
    if (!alive || typeof createActivityTracker !== 'function' || props.sessionId === undefined ||
        typeof props.useSession !== 'function' || typeof props.useSessionStatus !== 'function' ||
        typeof props.useChat !== 'function' || typeof props.useSessions !== 'function') return null;
    return h(ReadyActivityDriver,props);
  }
  function ReadyActivityDriver({useSession,useSessionStatus,useChat,useSessions,sessionId}) {
    const session = useSession(s => s);
    const statuses = useSessionStatus(s => s);
    const chat = useChat(s => s);
    const sessions = useSessions(s => s);
    // Embedded child conversations have their own composer slots. Only the
    // native mainView retention may claim the single character state driver.
    const isMain = (sessions?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0;
    let eventSource;
    if (isMain) {
      try {eventSource = ctx.sessions?.binding?.(sessionId)?.eventSource;} catch {}
    }
    if (!receiptClient && isMain && typeof createReceiptClient === 'function') {try {receiptClient = createReceiptClient(ctx);} catch {}}
    const events = usePublicSource(eventSource);
    // Required native services have fresh Cordis trace proxies on each read.
    // Keep a successful jobs binding for this plugin lifetime so publications
    // do not drop/reacquire the roster. Missing optional fixtures still retry
    // acquisition on a later standard hook commit.
    if (isMain && !jobsClient) {try {jobsClient = ctx.jobs;} catch {}}
    const jobsService = isMain ? jobsClient : undefined;
    const jobs = usePublicSource(jobsService?.state);
    const connection = usePublicSource(isMain ? ctx.connection?.state : undefined);
    const receipts = usePublicSource(isMain ? receiptClient?.state : undefined);
    const owner = React.useRef();
    if (!owner.current) owner.current = {};
    const token = owner.current;
    React.useEffect(() => {
      if (!alive || !isMain) return;
      driverOwner = token;stopToolPose();poseSession=poseTurn=undefined;
      restAfterReply = false;publishActivity(activity);
      if (!tracker) tracker = createActivityTracker(publishActivity);
      if (!greetingTracker && typeof createTurnGreetingTracker === 'function') greetingTracker=createTurnGreetingTracker(publishGreeting);
      publishGreeting(undefined);
      return () => {if (driverOwner === token) {driverOwner = undefined;stopToolPose();poseSession=poseTurn=undefined;restAfterReply=false;publishActivity(activity);publishGreeting(undefined);greetingTracker?.dispose();greetingTracker=undefined;}};
    },[sessionId,isMain]);
    const jobAdmission = React.useRef();
    React.useEffect(() => {
      const admission = {};
      jobAdmission.current = admission;
      return () => {
        admission.stop?.();
        if (jobAdmission.current === admission) jobAdmission.current = undefined;
      };
    },[sessionId,isMain,jobsService]);
    // Retry only failed admission on later native-hook commits. A successful
    // lease stays stable across publications; there is no polling timer.
    React.useEffect(() => {
      const admission = jobAdmission.current;
      if (!alive || !isMain || driverOwner !== token || !admission || admission.stop ||
          typeof jobsService?.watchRows !== 'function') return;
      try {admission.stop = ownRelease(jobsService.watchRows(sessionId));} catch {}
    });
    const receiptAdmission = React.useRef();
    React.useEffect(() => {
      const admission = {};receiptAdmission.current = admission;
      return () => {admission.stop?.();if (receiptAdmission.current === admission) receiptAdmission.current = undefined;};
    },[sessionId,isMain,receiptClient]);
    React.useEffect(() => {
      const admission = receiptAdmission.current;
      if (!alive || !isMain || driverOwner !== token || !admission || !receiptClient) return;
      try {
        if (!admission.stop) admission.stop = ownRelease(receiptClient.watch(sessionId));
        receiptClient.retry(sessionId);
      } catch {}
    });
    React.useEffect(() => {
      if (alive && isMain && driverOwner === token) {
        const status = statuses?.get?.(sessionId), timeline = chat?.timeline;
        const latest = timeline?.turnOrder?.at(-1), turn = latest === undefined ? undefined : timeline?.turns?.get?.(latest);
        const turnId=turn?.turn ?? latest;
        if(poseSession!==sessionId || poseTurn!==turnId){stopToolPose();toolObservation=undefined;poseSession=sessionId;poseTurn=turnId;}
        const running = typeof session?.running === 'boolean' ? session.running : status?.running === true;
        const inbox = sessions?.projectionsBySession?.[sessionId]?.values?.inbox;
        // Normal reply rest is a visual projection, not new lifecycle evidence.
        // Empty sessions still look left; a real completed transcript may keep
        // the explaining pose without replaying the completion celebration.
        restAfterReply = Boolean(turn?.status === 'closed' && Number.isFinite(turn.end?.seq) && turn.end?.data?.reason?.kind === 'completed' &&
          !running && !session?.awaitingFirstTurn && !session?.removed && !session?.pendingSubmissions?.length &&
          !inbox?.['next-turn']?.length && !inbox?.['next-step']?.length);
        tracker?.update(sessionId,session,status,chat,
          {sessions,statuses,events,jobs:jobs?.rows?.[sessionId],connection:{state:connection},receipts});
        // A history selection can change the picture while activity stays idle.
        // Notify after tracker admission so subscribers never see an old phase
        // combined with the next session's rest evidence.
        publishActivity(activity);
        greetingTracker?.update(sessionId,chat,events,session,connection);
      }
    },[sessionId,isMain,session,statuses,chat,sessions,events,jobs,connection,receipts]);
    return null;
  }
  function Hero() {
    useView();
    const source = portraitURL();
    return source ? h('img',{className:'dss-hero-portrait',src:source,alt:current?.name || 'DeepSeek 娘'}) : null;
  }
  function registerSlots() {
    const entries = [
      ['conversation.hero.brand.mark', {}, Hero],
    ];
    for (const [name, options, component] of entries) {
      disposers.push(ctx.slots.inject(name, () => {
        // A single slot may be occupied by another theme. Respect its owner.
        if (name === 'conversation.hero.brand.mark' && ctx.slots.entries(name).length) return;
        return ctx.slots.register({name,...options},component);
      }));
    }
  }
  function update(skin) {
    if (!alive) return;
    const nextId = skin.asset || selectedId || 'serene';
    if (nextId !== selectedId) {
      stopToolPose();closeAlbum(); releaseResources(); selectedId = nextId; current = catalog[nextId];
    }
    currentSkin = {...skin};
    if(!canHoldToolPose())stopToolPose();
    view = {asset:nextId,metadata:current,enabled:skin.enabled,activity,restAfterReply,visualState:visualState(),greetingRequest};
    if (skin.enabled) {
      document.documentElement.setAttribute(marker,skin.palette);
      document.documentElement.setAttribute('data-deepseekdeskskin-motion',skin.mode === 'dynamic' && skin.motion !== 'none' ? 'dynamic' : 'static');
      document.documentElement.setAttribute('data-deepseekdeskskin-position',skin.position || 'right');
      if (current) {
        document.documentElement.setAttribute('data-deepseekdeskskin-character',nextId);
        document.documentElement.style.setProperty('--dss-portrait',`url("${portraitURL()}")`);
      } else {
        document.documentElement.removeAttribute('data-deepseekdeskskin-character');
        document.documentElement.style.removeProperty('--dss-portrait');
      }
      if (!enabled) {
        registerSlots();
      }
    } else {
      document.documentElement.removeAttribute(marker);
      document.documentElement.removeAttribute('data-deepseekdeskskin-motion');
      document.documentElement.removeAttribute('data-deepseekdeskskin-position');
      document.documentElement.removeAttribute('data-deepseekdeskskin-character');
      document.documentElement.style.removeProperty('--dss-portrait');
      for (const dispose of disposers.splice(0).reverse()) dispose?.();
      closeAlbum();
    }
    enabled = skin.enabled;
    scrollRail?.update(skin);
    for (const listener of listeners) listener();
  }
  // This list seat stays mounted while header chrome is hidden. Its empty
  // driver also remains registered when the visual skin is disabled, so an
  // in-flight task is observed accurately when the skin is enabled again.
  const disposeDriver = ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({name:'conversation.input.right',id:'deepseekdeskskin-activity-driver',order:-100},ActivityDriver));
  return {update,openAlbum,acknowledgeToolPresentation,setToolPresentationSuppressed,
    get toolPresentation(){return toolPresentation;},
    get activityState(){return activity;},
    get visualState(){return visualState();},
    get isBuiltin(){return Boolean(current);},
    get metadata(){return current;},
    get name(){return current?.name;},
    get portrait(){return portraitURL();},
    get imageSource(){return sceneURL();},
    get greetingRequest(){return greetingRequest;},
    get greetingFrames(){return current?.intro?.map(frame=>({...frame,source:resourceURL(frame.file)}));},
    get skins(){return Object.values(catalog).map(item => ({id:item.id,name:item.name,portrait:readResource(item.portrait)}));},
    subscribe,
    dispose(){
      if (!alive) return disposal;update({enabled:false});alive=false;stopToolPose();
      if(motionPreference?.removeEventListener)motionPreference.removeEventListener('change',onMotionPreference);else motionPreference?.removeListener?.(onMotionPreference);disposeDriver?.();driverOwner=undefined;tracker?.dispose();greetingTracker?.dispose();
      let receiptCleanup;try {receiptCleanup = receiptClient?.dispose();} catch {}
      for (const stop of [...ownedReleases]) stop();scrollRail?.dispose();listeners.clear();style.remove();releaseResources();
      // The plugin owner must await receipt consumption/namespace quiescence;
      // visual surfaces and direct source leases are already stopped above.
      disposal = Promise.resolve(receiptCleanup).catch(() => {});return disposal;
    }
  };
}
