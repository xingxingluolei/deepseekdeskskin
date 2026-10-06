import { createPortraitPresence } from '../../src/presence.mjs';
import { createGreetingCamera } from '../../src/cinema.mjs';
import { createStateReaction } from '../../src/reaction.mjs';
// Optional Harness integration. The exported bundle embeds its own renderer,
// settings and image, and never contacts the studio or another local project.
export function installHarnessSkin(ctx, initialSkin, imageSource, mountVisual, normalizeSkin, identity, createCharacterSurfaces, createControls, createTaskGreetingPlayer, presenceFactory = createPortraitPresence) {
  const id = 'deepseekdeskskin-harness';
  const storageKey = `${id}:v1:${identity}`;
  ctx.effect(() => {
    let skin = normalizeSkin(initialSkin);
    try { const saved = JSON.parse(localStorage.getItem(storageKey)); if (saved) skin = normalizeSkin({ ...skin, ...saved }); } catch { /* Storage may be disabled. */ }
    let originalPreference = ctx.theme.getTheme().preference;
    let alive = true;
    const palettes = {
      dark: { '--dsw-alias-bg-base': '#111c30', '--dsw-alias-bg-layer-1': '#17243b', '--dsw-alias-bg-layer-2': '#1c2c47', '--dsw-alias-bg-layer-3': '#243551', '--dsw-specific-sidebar-fill': '#142036', '--dsw-specific-input-major': '#1b2b46', '--dsw-alias-border-l1': '#809dc526', '--dsw-alias-border-l2': '#809dc544', '--dsw-alias-state-business-primary': '#96b6ff' },
      light: { '--dsw-alias-bg-base': '#f0f4ff', '--dsw-alias-bg-layer-1': '#f8faff', '--dsw-alias-bg-layer-2': '#ffffff', '--dsw-alias-bg-layer-3': '#e5edfd', '--dsw-specific-sidebar-fill': '#e8effb', '--dsw-specific-input-major': '#ffffff', '--dsw-alias-border-l1': '#647eac26', '--dsw-alias-border-l2': '#647eac44', '--dsw-alias-state-business-primary': '#436cc5' },
    };
    Object.assign(palettes.dark, {
      '--dsw-alias-label-primary':'#e7efff','--dsw-alias-label-secondary':'#b6c7df','--dsw-alias-label-tertiary':'#91a6c5',
      '--dsw-alias-interactive-bg-hover':'#8eb8ff18','--dsw-alias-interactive-bg-active':'#8eb8ff28','--dsw-alias-interactive-bg-hover-solid':'#283d5b',
      '--dsw-specific-sidebar-nav-item-active':'#89b2fb22','--dsw-specific-sidebar-nav-item-hover':'#89b2fb14','--dsw-specific-sidebar-nav-item-active-accent':'#a5c4ff',
      '--dsw-alias-button-primary-fill':'#4268b5','--dsw-alias-button-primary-hover':'#527ac5','--dsw-alias-button-elevated-fill':'#233754',
      '--dsw-alias-button-floating-fill':'#223550','--dsw-alias-button-floating-hover':'#314a6b','--dsw-alias-border-l3':'#91b4e444',
      '--dsw-focus-ring-color':'#a8c9ff','--dsw-alias-scrollbar-bg-l1':'#7b9dc338','--dsw-alias-scrollbar-bg-l2':'#7b9dc328',
    });
    Object.assign(palettes.light, {
      '--dsw-alias-label-primary':'#182843','--dsw-alias-label-secondary':'#435878','--dsw-alias-label-tertiary':'#607591',
      '--dsw-alias-interactive-bg-hover':'#527ab510','--dsw-alias-interactive-bg-active':'#527ab520','--dsw-alias-interactive-bg-hover-solid':'#dce6f7',
      '--dsw-specific-sidebar-nav-item-active':'#537bb520','--dsw-specific-sidebar-nav-item-hover':'#537bb512','--dsw-specific-sidebar-nav-item-active-accent':'#436cc5',
      '--dsw-alias-button-primary-fill':'#4268b5','--dsw-alias-button-primary-hover':'#365a9c','--dsw-alias-button-elevated-fill':'#f8faff',
      '--dsw-alias-button-floating-fill':'#ffffff','--dsw-alias-button-floating-hover':'#e3ecfb','--dsw-alias-border-l3':'#647eac44',
      '--dsw-focus-ring-color':'#416bb6','--dsw-alias-scrollbar-bg-l1':'#5679a938','--dsw-alias-scrollbar-bg-l2':'#5679a928',
      '--dsw-alias-bg-base':'#f8fbff','--dsw-alias-bg-layer-1':'#f0f5ff','--dsw-alias-bg-layer-2':'#ffffff','--dsw-alias-bg-layer-3':'#e2ecff',
      '--dsw-specific-sidebar-fill':'#e8f0ff','--dsw-specific-bubble':'#e8f0ff','--dsw-specific-bubble-highlight':'#d9e7ff',
      '--dsw-alias-label-caption':'#617b9f','--dsw-alias-label-primary-bluish':'#355784','--dsw-alias-label-primary-foreground':'#ffffff',
      '--dsw-alias-brand-primary':'#365e9e','--dsw-alias-brand-text':'#365e9e','--dsw-alias-link':'#3d6ec1',
      '--dsw-alias-state-business-tertiary':'#e1edff','--dsw-specific-selector':'#e9f1ff','--dsw-specific-tip':'#edf4ff',
      '--dsw-alias-markdown-code-block':'#edf3fe','--dsw-alias-markdown-code-block-banner':'#e3edff','--dsw-alias-markdown-inline-code':'#e4edfc',
      '--dsw-alias-markdown-citation':'#e4edfc','--dsw-alias-markdown-code-segment-unselected':'#edf3fe','--dsw-alias-markdown-tag':'#e7efff',
      '--dsw-specific-menu':'#f9fbfff5','--dsw-menu-surface-fill':'#f9fbfff5','--dsw-alias-menu-group-header-fill':'#eef4ff',
      '--dsw-alias-bg-document-preview':'#ffffff','--dsw-alias-label-document-preview':'#294365',
    });
    const disposeThemes = Object.entries(palettes).map(([colorScheme, tokens]) => ctx.theme.register({ id: `${id}:${colorScheme}`, colorScheme, tokens }));
    const character = createCharacterSurfaces?.();
    const exportedAsset = normalizeSkin(initialSkin).asset;
    const catalogSkins = character?.skins || [];
    const availableAssets = new Set([...catalogSkins.map(item => item.id), exportedAsset]);
    // Saved choices are scoped to this export. Another custom ID has no media
    // in this plugin and must never masquerade as the original exported image.
    if (catalogSkins.length && !availableAssets.has(skin.asset)) skin = normalizeSkin({...skin,asset:exportedAsset});
    // The decoration lives inside the main column, below its native content.
    // A full-window overlay can interfere with Electron's native drag regions,
    // even when CSS pointer events pass through it.
    const marker = 'data-deepseekdeskskin-background';
    const wallpaper = document.createElement('div'); wallpaper.id = 'deepseekdeskskin-background';
    wallpaper.setAttribute('aria-hidden', 'true');
    wallpaper.style.cssText = 'position:absolute;inset:76px 0 0;z-index:-1;pointer-events:none;overflow:hidden;contain:paint;container-type:size';
    const backgroundShadow = wallpaper.attachShadow({ mode: 'open' });
    const backgroundStyle = document.createElement('style');
    backgroundStyle.textContent = `.avatar{position:absolute;bottom:92px;pointer-events:none;max-width:70%;max-height:68%;filter:saturate(.78);mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 86%,transparent)}.avatar[data-position=right]{right:-32px}.avatar[data-position=left]{left:-32px}.avatar[data-composed=true]{inset:0;width:100%!important;height:100%!important;max-width:none;max-height:none;filter:none;mask-image:none}.avatar[data-composed=true][data-position=left]{transform:scaleX(-1)}.avatar[data-composed=true]>img,.avatar[data-composed=true]>canvas{object-fit:cover!important;object-position:right top!important;transform:translateX(8%);mask-image:linear-gradient(to right,transparent,#000 8%)}.reading-veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to right,color-mix(in srgb,var(--dsw-alias-bg-base) 86%,transparent) 0 calc(50% - var(--dss-side-space) / 2 + var(--dss-reading-width) / 2 - 40px),transparent calc(50% - var(--dss-side-space) / 2 + var(--dss-reading-width) / 2 + 36px))}.reading-veil[data-position=left]{transform:scaleX(-1)}:host([data-palette=dark]) .avatar[data-composed=true]{filter:brightness(.43) saturate(.85)}@container dss-conversation (max-width:1100px){.avatar[data-composed=true]>img,.avatar[data-composed=true]>canvas{position:absolute;inset:auto 0 0;width:100%!important;height:auto!important;max-height:100%;object-fit:contain!important;object-position:right bottom!important;transform:none;mask-image:linear-gradient(to bottom,transparent,#000 12%,#000 86%,transparent)}.reading-veil{background:linear-gradient(to right,color-mix(in srgb,var(--dsw-alias-bg-base) 86%,transparent) 0 42%,color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent) 65%,color-mix(in srgb,var(--dsw-alias-bg-base) 24%,transparent) 86%,transparent)}}@media(max-width:700px){.avatar:not([data-composed=true]){max-width:80%;max-height:58%;bottom:145px}}`;
    const avatar = document.createElement('div'); avatar.className = 'avatar';
    backgroundStyle.textContent += `
.avatar[data-cutout=true]{inset:auto!important;bottom:76px!important;width:min(60cqw,calc(640px * var(--dss-figure-scale,1)),calc((100cqh - 88px) * .8))!important;height:auto!important;aspect-ratio:4/5;max-width:none;max-height:none;overflow:hidden;filter:none;mask-image:linear-gradient(to right,transparent,#000 16%,#000 96%,transparent),linear-gradient(to bottom,transparent,#000 4%,#000 82%,transparent);mask-composite:intersect}
.avatar[data-cutout=true][data-position=right]{right:0!important}.avatar[data-cutout=true][data-position=left]{left:0!important}
.avatar[data-cutout=true]>img,.avatar[data-cutout=true]>canvas{position:absolute;inset:auto!important;left:50%!important;top:50%!important;width:var(--dss-portrait-width,240%)!important;height:auto!important;max-width:none!important;max-height:none!important;object-fit:contain!important;object-position:center!important;transform:translate(var(--dss-portrait-x,-50%),var(--dss-portrait-y,-15%))!important;mask-image:none!important}
:host([data-palette=dark]) .avatar[data-cutout=true]{filter:brightness(.82) saturate(.85)}
@container dss-conversation (max-width:700px){.avatar[data-cutout=true]{width:min(72cqw,calc(640px * var(--dss-figure-scale,1)),calc((100cqh - 96px) * .8))!important;bottom:84px!important}}

:host([data-layout-phase=hero]){inset:0!important}
.reading-veil{opacity:0}
:host([data-layout-phase=hero]) .avatar[data-cutout=true]{top:50%!important;bottom:auto!important;width:min(51cqw,calc(800px * var(--dss-figure-scale,1)),calc((100cqh - 64px) * .8))!important;transform:translateY(-50%);mask-image:linear-gradient(to right,transparent,#000 10%,#000 96%,transparent),linear-gradient(to bottom,transparent,#000 4%,#000 80%,transparent);mask-composite:intersect}
:host([data-layout-phase=hero]) .avatar[data-cutout=true][data-position=right]{right:2cqw!important}
:host([data-layout-phase=hero]) .avatar[data-cutout=true][data-position=left]{left:2cqw!important;transform:translateY(-50%) scaleX(-1)}
@container (max-width:700px){:host([data-layout-phase=hero]) .avatar[data-cutout=true]{top:36px!important;bottom:auto!important;width:min(82cqw,calc(var(--dss-hero-height) * .8))!important;transform:none}:host([data-layout-phase=hero]) .avatar[data-cutout=true][data-position=left]{transform:scaleX(-1)}}

`;
    backgroundStyle.textContent += `
.avatar[data-cutout=true]>[data-fit=contain]{inset:0!important;left:0!important;top:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;object-position:right bottom!important;transform:none!important;mask-image:none!important}
.avatar[data-cutout=true]>[data-fit=contain][data-mirror=true]{object-position:left bottom!important}
:host([data-layout-phase=active]) .avatar[data-cutout=true]{mask-image:linear-gradient(to right,transparent,#000 3%,#000 97%,transparent),linear-gradient(to bottom,transparent,#000 2%,#000 98%,transparent);mask-composite:intersect}
`;
    if (character) avatar.setAttribute('data-composed','true');
    const readingVeil = document.createElement('div'); readingVeil.className = 'reading-veil';
    backgroundShadow.append(backgroundStyle, avatar);
    if (character) backgroundShadow.append(readingVeil);
    const hostStyle = document.createElement('style');
    hostStyle.textContent = `[${marker}]{position:relative;isolation:isolate}
[${marker}][data-dss-greeting-hold] [data-conversation-scroll] > :not([data-composer-seat]){visibility:hidden;pointer-events:none}
[${marker}][data-dss-greeting-hold] [data-conversation-content] > :not([data-conversation-scroll]){visibility:hidden;pointer-events:none}
[${marker}][data-dss-greeting-hold] [data-composer-seat]{opacity:.62}
`;
    document.head.append(hostStyle);
    let backgroundHost; let holdingGreeting=false; let layoutMotion; let presence; let camera;
    function syncLayoutPhase() {
      const attentionState=['error','waiting','blocked','disconnected','stopped','paused'].includes(character?.activityState);
      const next=attentionState?'active':holdingGreeting?'hero':backgroundHost?.getAttribute?.('data-phase')||'active';
      const previous=wallpaper.getAttribute?.('data-layout-phase');
      if(previous===next)return;
      const before=avatar.getBoundingClientRect?.();
      // Measure the currently painted pose, then remove camera/layout effects
      // before measuring the destination. Interrupted openings keep their
      // visual size in the first FLIP frame instead of snapping out of the push.
      camera?.stop();layoutMotion?.cancel();layoutMotion=undefined;
      wallpaper.setAttribute('data-layout-phase',next);
      const after=avatar.getBoundingClientRect?.();
      if(previous==='hero'&&next==='active'&&before?.width&&after?.width&&skin.enabled&&skin.mode==='dynamic'&&skin.motion!=='none'&&!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        // FLIP the portrait's own geometry; the native conversation keeps its
        // phase, scroll and input nodes. Individual transforms compose with
        // the optional left-side mirror instead of replacing it.
        layoutMotion=avatar.animate?.([{translate:`${before.x-after.x+(before.width-after.width)/2}px ${before.y-after.y+(before.height-after.height)/2}px`,scale:`${before.width/after.width} ${before.height/after.height}`},{translate:'0px 0px',scale:'1 1'}],{duration:620,easing:'cubic-bezier(.2,.8,.2,1)'});
      }
      return true;
    }
    function attachBackground() {
      // ui-layout main column + ui-conversation phase root in Harness 0.2.0-rc.2.
      // Mount inside the opaque conversation surface, never above its text.
      const host = document.querySelector('[class$="_centerCol"] [data-phase]');
      // Hero and active reuse the same root: refresh phase before the identity
      // guard so sending the first message restores the reading layout.
      if(host===backgroundHost){if(syncLayoutPhase()&&presence)renderCharacter();return;}
      backgroundHost?.removeAttribute(marker);backgroundHost?.removeAttribute('data-dss-greeting-hold');
      backgroundHost = host;syncLayoutPhase();
      if (host) { host.setAttribute(marker, ''); host.append(wallpaper); if(holdingGreeting)host.setAttribute('data-dss-greeting-hold',''); }
      if(presence)renderCharacter();
    }
    const observer = new MutationObserver(attachBackground);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
    attachBackground();
    const renderer = mountVisual(avatar);
    const reaction = createStateReaction(avatar); let paintRevision=0;
    camera = createGreetingCamera(avatar);
    function restoreTheme() { if (ctx.theme.getTheme().preference.startsWith(`${id}:`)) ctx.theme.setTheme(originalPreference); }
    let controls;
    presence = presenceFactory(() => {if(alive)renderCharacter();});
    const greeting = createTaskGreetingPlayer?.(() => {renderCharacter();controls?.refreshActivity?.();});
    function renderCharacter() {
      const composed = character ? character.isBuiltin ?? true : false;
      greeting?.update({...skin,asset:skin.asset,state:character?.activityState,request:character?.greetingRequest?.firstTurn===true?character.greetingRequest:undefined,allowIdle:character?.greetingRequest?.firstTurn===true,frames:()=>character?.greetingFrames});
      const greetingPhase=greeting?.getSnapshot?.().phase;
      holdingGreeting=character?.greetingRequest?.firstTurn===true && ['loading','running'].includes(greetingPhase);
      if(holdingGreeting)backgroundHost?.setAttribute('data-dss-greeting-hold','');else backgroundHost?.removeAttribute('data-dss-greeting-hold');
      syncLayoutPhase();
      const closeup=composed&&wallpaper.getAttribute?.('data-layout-phase')==='hero';
      character?.setToolPresentationSuppressed?.(!backgroundHost || holdingGreeting || closeup || Boolean(greeting?.currentFrame));
      const visualState=character?.visualState || character?.activityState || 'idle';
      const toolPresentation=character?.toolPresentation;
      const source = greeting?.currentFrame?.source || (closeup ? character?.greetingFrames?.[0]?.source : undefined) || (composed ? character?.imageSource || imageSource : imageSource);
      if (composed) avatar.setAttribute('data-composed','true'); else avatar.removeAttribute('data-composed');
      if (composed && character?.metadata?.presentation === 'cutout') avatar.setAttribute('data-cutout','true');else avatar.removeAttribute('data-cutout');
      avatar.style.setProperty?.('--dss-figure-scale',String(skin.size/340));
      const framing=greeting?.currentFrame?.framing || (closeup?character?.metadata?.intro?.[0]?.framing:undefined) || character?.metadata?.framing?.states?.[visualState];
      avatar.style.setProperty?.('--dss-portrait-width',`${100/(framing?.cropWidth||.30)}%`);
      avatar.style.setProperty?.('--dss-portrait-x',`${-100*(framing?.cx||.5)}%`);
      avatar.style.setProperty?.('--dss-portrait-y',`${-100*(framing?.cy||.13)}%`);
      avatar.setAttribute('data-state',character?.activityState || 'idle');
      avatar.setAttribute('data-visual-state',visualState);
      avatar.setAttribute('data-greeting',greeting?.currentFrame?.key || 'none');
      avatar.setAttribute('data-shot',closeup?'portrait':'fullbody');
      readingVeil.hidden = !composed;
      const busy = ['thinking','working','reading','writing','searching','executing','delegating','answering','parallel','compacting','retrying','queued','connecting'].includes(character?.activityState);
      const animate = composed && skin.enabled && skin.mode === 'dynamic' && skin.motion !== 'none' && !(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
      const opening=greeting?.getSnapshot?.();
      camera.update({enabled:animate,asset:skin.asset,position:skin.position,requestKey:opening?.requestKey,phase:opening?.phase,durationMs:opening?.durationMs});
      const attention = presence.update({enabled:skin.enabled,composed,animated:animate,asset:skin.asset,
        requestKey:character?.greetingRequest?.key,greeting:['loading','running'].includes(greetingPhase),
        hero:wallpaper.getAttribute?.('data-layout-phase')==='hero',busy});
      // CSS retargets from the currently painted opacity, so task-phase image
      // swaps and interrupted fades never restart the attention transition.
      const transition=`opacity ${attention.durationMs}ms cubic-bezier(.4,0,.2,1)`;
      avatar.style.transition=transition;readingVeil.style.transition=transition;
      readingVeil.style.opacity=String(attention.veilOpacity);
      wallpaper.setAttribute('data-presence',attention.phase);
      const opacity = composed ? skin.opacity * attention.opacityFactor : Math.min(.24, skin.opacity * (skin.palette === 'light' ? .18 : .26));
      if(!animate){layoutMotion?.cancel();layoutMotion=undefined;}
      const paintToken=++paintRevision;
      const reactionInput={state:character?.activityState,asset:skin.asset,enabled:skin.enabled,animated:animate&&!closeup};
      if(reactionInput.state!=='error'||!reactionInput.enabled||!reactionInput.animated)reaction.update(reactionInput);
      const painted=renderer.update({ ...skin, fit:composed&&!closeup?'contain':'portrait',mirror:composed&&!closeup&&character?.metadata?.facingByState?.[visualState]==='right', motion:composed ? 'none' : skin.motion, size:Math.round(skin.size * 1.6), opacity, transitionMs:animate?(greeting?.currentFrame?.transitionMs??420):0 },source,{waitForPresentation:Boolean(toolPresentation)});
      if(toolPresentation)Promise.resolve(painted).then(
        shown=>{if(alive)character?.acknowledgeToolPresentation?.(toolPresentation,shown);},
        ()=>{if(alive)character?.acknowledgeToolPresentation?.(toolPresentation,false);});
      // A first-turn failure may be leaving the hero camera at the same time.
      // Let that geometry settle before the error gesture uses translate/scale.
      Promise.all([Promise.resolve(painted),layoutMotion?.finished?.catch?.(()=>{})]).then(([ok])=>{if(alive&&paintToken===paintRevision&&ok!==false)reaction.update(reactionInput);});
    }
    controls = createControls?.({
      getSkin: () => ({ ...skin }),
      onChange: (key, value) => {
        if (key === 'asset' && catalogSkins.length && !availableAssets.has(value)) return;
        skin = normalizeSkin({ ...skin, [key]: value }); update();
      },
      skins: [...catalogSkins, ...(catalogSkins.some(item => item.id === exportedAsset) ? [] : [{id:exportedAsset,name:exportedAsset.startsWith('custom-') ? '自定义皮肤' : '原始动态皮肤',portrait:imageSource}])],
      name: () => character?.name || (skin.asset.startsWith('custom-') ? '自定义皮肤' : 'DeepSeek 娘'),
      portrait: () => character?.portrait || imageSource,
      activityState: () => character?.activityState || 'idle',
      expressionSource: () => character?.isBuiltin ? greeting?.currentFrame?.source || character.imageSource : undefined,
      expressionFocus: () => greeting?.currentFrame?.focus || character?.metadata?.focusByState?.[character?.visualState || character?.activityState]?.focus || character?.metadata?.portraitFocus,
      expressionScale: () => greeting?.currentFrame?.scale || character?.metadata?.focusByState?.[character?.visualState || character?.activityState]?.scale || character?.metadata?.portraitScale,
      imageSource: () => character?.imageSource || imageSource,
      onDetails: character?.openAlbum ? event => character.openAlbum(event,{imageSource,name:skin.asset.startsWith('custom-') ? '自定义皮肤' : 'DeepSeek 娘'}) : undefined,
    });
    const disposeActivity = character?.subscribe?.(() => {renderCharacter();controls?.refreshActivity?.();});
    function update() {
      character?.update(skin); wallpaper.hidden = !skin.enabled; attachBackground();
      wallpaper.setAttribute('data-palette',skin.palette);
      readingVeil.setAttribute('data-position',skin.position);renderCharacter();
      controls?.update(skin); controls?.refreshActivity?.();
      if (skin.enabled) ctx.theme.setTheme(`${id}:${skin.palette}`); else restoreTheme();
      try { localStorage.setItem(storageKey, JSON.stringify(skin)); } catch { /* Rendering still works without storage. */ }
    }
    avatar.addEventListener('skin-error', event => { controls?.showError(event.detail); });
    // Harness can adopt saved native settings after this plugin has mounted.
    // Reapply after the current notification finishes, so other listeners cannot
    // paint the stale native snapshot over the chosen skin. Keep the latest
    // native preference for closing the skin or unloading the plugin.
    const disposeThemeListener = ctx.on('theme/change', () => {
      const preference = ctx.theme.getTheme().preference;
      if (!preference.startsWith(`${id}:`)) originalPreference = preference;
      if (skin.enabled && preference !== `${id}:${skin.palette}`) queueMicrotask(() => {
        if (alive && skin.enabled && ctx.theme.getTheme().preference !== `${id}:${skin.palette}`) ctx.theme.setTheme(`${id}:${skin.palette}`);
      });
    });
    update();
    return () => { alive = false; paintRevision++;reaction.dispose();greeting?.dispose();camera.dispose();presence.dispose();disposeThemeListener(); observer.disconnect();layoutMotion?.cancel(); disposeActivity?.(); controls?.dispose(); const characterCleanup = character?.dispose(); renderer.dispose(); wallpaper.remove(); backgroundHost?.removeAttribute(marker); backgroundHost?.removeAttribute('data-dss-greeting-hold');hostStyle.remove(); restoreTheme(); for (const dispose of disposeThemes.reverse()) dispose(); return characterCleanup; };
  });
}
