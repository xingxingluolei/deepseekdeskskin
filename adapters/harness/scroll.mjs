// Own rail mirrors the native scrollport. Its scrollTop remains authoritative;
// no DOM reordering, direction changes, or native scrolling logic is replaced.
export function mountConversationScrollRail() {
  const selector = '[class$="_centerCol"] .ST7X_W_root[data-phase=active] > [data-conversation-content] > [data-conversation-scroll]';
  let enabled = false; let disposed = false;
  let port; let rail; let thumb; let markerBefore;
  let style; let mutationObserver; let resizeObserver;
  let frame; let drag; let metrics = {range:0,travel:0,offset:0,height:0};
  const resizeChildren = new Set();
  const listeners = [];
  const clamp = (value, max) => Math.max(0, Math.min(max, Number(value) || 0));
  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    listeners.push(() => target.removeEventListener(name, fn, options));
  }
  function ensureStyle() {
    if (style) return;
    style = document.createElement('style');
    style.textContent = `
[data-deepseekdeskskin] [data-dss-scrollport]{scrollbar-width:none}
[data-deepseekdeskskin] [data-dss-scrollport]::-webkit-scrollbar{display:none;width:0;height:0}
[data-deepseekdeskskin] [data-dss-scroll-rail]{position:absolute;left:6px;top:14px;bottom:calc(var(--dsh-composer-height,152px) + 14px);width:12px;z-index:8;touch-action:none;user-select:none;cursor:pointer;-webkit-app-region:no-drag;outline:none}
[data-deepseekdeskskin] [data-dss-scroll-rail][hidden]{display:none}
[data-deepseekdeskskin] [data-dss-scroll-rail]::before{content:"";position:absolute;inset:0 4.5px;border-radius:999px;background:transparent;transition:background .16s}
[data-deepseekdeskskin] [data-dss-scroll-thumb]{position:absolute;left:4.5px;top:0;width:3px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4268b5);opacity:.28;cursor:grab;transition:opacity .16s}
[data-deepseekdeskskin] [data-dss-scroll-rail]:is(:hover,:focus-visible,[data-dss-dragging])::before{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4268b5) 9%,transparent)}
[data-deepseekdeskskin] [data-dss-scroll-rail]:is(:hover,:focus-visible,[data-dss-dragging]) [data-dss-scroll-thumb]{opacity:.88}
[data-deepseekdeskskin] [data-dss-scroll-rail][data-dss-dragging] [data-dss-scroll-thumb]{cursor:grabbing}
[data-deepseekdeskskin] [data-dss-scroll-rail]:focus-visible{outline:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#4268b5) 26%,transparent);outline-offset:2px;border-radius:999px}
@media(prefers-reduced-motion:reduce){[data-dss-scroll-rail]::before,[data-dss-scroll-thumb]{transition:none}}
`;
    document.head.append(style);
  }
  function cancelFrame() {
    if (!frame) return;
    const ticket = frame; frame = undefined;
    if (ticket.type === 'raf') globalThis.cancelAnimationFrame?.(ticket.id);
    else clearTimeout(ticket.id);
  }
  function schedule() {
    if (!enabled || disposed || frame) return;
    const ticket = {type:typeof globalThis.requestAnimationFrame === 'function' ? 'raf' : 'timeout'};
    frame = ticket;
    const run = () => {
      if (frame !== ticket) return;
      frame = undefined;
      if (!enabled || disposed) return;
      const next = document.querySelector(selector);
      if (next !== port) bind(next);
      refresh();
    };
    ticket.id = ticket.type === 'raf' ? globalThis.requestAnimationFrame(run) : setTimeout(run,16);
  }
  function refresh() {
    if (!port || !rail || !thumb) return;
    // A previously hidden rail has no measured height. Expose it only during
    // this synchronous measurement so growing content can restore the rail.
    rail.hidden = false;
    const trackHeight = Math.max(0, rail.clientHeight || rail.getBoundingClientRect().height || 0);
    const viewport = Math.max(0, port.clientHeight);
    const content = Math.max(viewport, port.scrollHeight);
    const range = Math.max(0, content - viewport);
    const height = Math.min(trackHeight, Math.max(32, content ? trackHeight * viewport / content : trackHeight));
    const travel = Math.max(0, trackHeight - height);
    const offset = range ? travel * clamp(port.scrollTop,range) / range : 0;
    metrics = {range,travel,offset,height};
    const unusable = range > 0 && travel <= 0;
    rail.hidden = range <= 0 || trackHeight <= 0 || unusable;
    if (rail.hidden) finishDrag();
    if (unusable) {
      port.removeAttribute('data-dss-scrollport');
    } else port.setAttribute('data-dss-scrollport','');
    thumb.style.height = height + 'px';
    thumb.style.transform = 'translateY(' + offset + 'px)';
    const percent = range ? Math.round(100 * clamp(port.scrollTop,range) / range) : 0;
    rail.setAttribute('aria-valuenow',String(percent));
    rail.setAttribute('aria-valuetext',percent + '%');
    const id = port.id || port.getAttribute('id');
    if (id) rail.setAttribute('aria-controls',id); else rail.removeAttribute('aria-controls');
    if (resizeObserver) {
      const children = new Set(port.children);
      for (const child of resizeChildren) if (!children.has(child)) {resizeObserver.unobserve?.(child);resizeChildren.delete(child);}
      for (const child of children) if (!resizeChildren.has(child)) {resizeObserver.observe(child);resizeChildren.add(child);}
    }
  }
  function userIntent(type, event) {
    if (!port?.dispatchEvent) return;
    // Native ChatViewport capture listeners use these reading intents to stop
    // preserving a historical-page anchor. The sibling rail must notify that
    // owner before writing scrollTop; synthetic events have no default scroll.
    const init = {bubbles:false,cancelable:false};
    let intent;
    try {
      if (type === 'wheel' && typeof WheelEvent === 'function') intent = new WheelEvent(type,{...init,deltaX:0,deltaY:0,deltaMode:0});
      else if (type === 'keydown' && typeof KeyboardEvent === 'function') intent = new KeyboardEvent(type,{...init,key:event.key,code:event.code || ''});
      else if (type === 'pointerdown' && typeof PointerEvent === 'function') intent = new PointerEvent(type,{...init,pointerId:event.pointerId ?? 1,pointerType:event.pointerType || 'mouse',isPrimary:true,button:0});
      else if (typeof Event === 'function') intent = new Event(type,init);
      if (intent) port.dispatchEvent(intent);
    } catch { /* Older DOM implementations may not expose these constructors. */ }
  }
  function setScroll(value) {
    if (!port) return;
    // Always re-read the native dimensions before a gesture. Content can grow
    // between ResizeObserver/MutationObserver notifications and the next frame.
    const range = Math.max(0, port.scrollHeight - port.clientHeight);
    port.scrollTop = clamp(value,range);
    schedule();
  }
  function finishDrag(release = true) {
    if (!drag) return;
    const pointerId = drag.pointerId; drag = undefined;
    rail?.removeAttribute('data-dss-dragging');
    if (release) try {rail?.releasePointerCapture?.(pointerId);} catch { /* The native window may have cancelled capture already. */ }
  }
  function thumbDown(event) {
    if (drag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    refresh();
    if (!metrics.range || !metrics.travel) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    userIntent('pointerdown',event);
    rail.focus?.({preventScroll:true});
    drag = {pointerId:event.pointerId ?? 1,y:event.clientY,offset:metrics.offset};
    rail.setAttribute('data-dss-dragging','');
    try {rail.setPointerCapture?.(drag.pointerId);} catch { /* Pointer movement still works without capture support. */ }
  }
  function pointerMove(event) {
    if (!drag || (event.pointerId ?? drag.pointerId) !== drag.pointerId) return;
    event.preventDefault?.();
    refresh();
    if (!drag) return;
    const offset = clamp(drag.offset + event.clientY - drag.y,metrics.travel);
    setScroll(metrics.travel ? offset / metrics.travel * metrics.range : 0);
  }
  function pointerEnd(event) {
    if (drag && (event.pointerId ?? drag.pointerId) === drag.pointerId) finishDrag();
  }
  function trackDown(event) {
    if (drag || event.isPrimary === false || event.target !== rail || (event.button !== undefined && event.button !== 0)) return;
    refresh();
    if (!metrics.range) return;
    const y = event.clientY - rail.getBoundingClientRect().top;
    if (y >= metrics.offset && y <= metrics.offset + metrics.height) {thumbDown(event);return;}
    event.preventDefault?.();
    userIntent('pointerdown',event);
    rail.focus?.({preventScroll:true});
    const offset = clamp(event.clientY - rail.getBoundingClientRect().top - metrics.height / 2,metrics.travel);
    setScroll(metrics.travel ? offset / metrics.travel * metrics.range : 0);
  }
  function keyboard(event) {
    if (!port) return;
    const actions = {ArrowUp:-40,ArrowDown:40,PageUp:-port.clientHeight,PageDown:port.clientHeight};
    let target;
    if (Object.hasOwn(actions,event.key)) target = port.scrollTop + actions[event.key];
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = port.scrollHeight - port.clientHeight;
    else return;
    userIntent('keydown',event); setScroll(target);
    event.preventDefault?.();
    event.stopPropagation?.();
  }
  function wheel(event) {
    if (event.ctrlKey || !port || port.scrollHeight <= port.clientHeight) return;
    let delta = event.deltaY || event.deltaX || 0;
    if (event.deltaMode === 1) {
      const line = typeof globalThis.getComputedStyle === 'function' ? parseFloat(globalThis.getComputedStyle(port).lineHeight) : 0;
      delta *= line > 0 ? line : 16;
    } else if (event.deltaMode === 2) delta *= port.clientHeight;
    if (!delta) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    userIntent('wheel',event);
    setScroll(port.scrollTop + delta);
  }
  function detach() {
    finishDrag();
    for (const remove of listeners.splice(0).reverse()) remove();
    resizeObserver?.disconnect();
    resizeChildren.clear();
    if (port) {
      if (markerBefore === null) port.removeAttribute('data-dss-scrollport');
      else port.setAttribute('data-dss-scrollport',markerBefore);
    }
    rail?.remove();
    port = rail = thumb = undefined;
    metrics = {range:0,travel:0,offset:0,height:0};
  }
  function bind(next) {
    if (next === port) return;
    detach();
    if (!next?.parentElement) return;
    port = next;
    markerBefore = port.getAttribute('data-dss-scrollport');
    port.setAttribute('data-dss-scrollport','');
    rail = document.createElement('div'); rail.setAttribute('data-dss-scroll-rail','');
    rail.setAttribute('role','scrollbar'); rail.setAttribute('aria-label','正文滚动条');
    rail.setAttribute('aria-orientation','vertical'); rail.setAttribute('aria-valuemin','0'); rail.setAttribute('aria-valuemax','100');
    rail.tabIndex = 0;
    thumb = document.createElement('div'); thumb.setAttribute('data-dss-scroll-thumb',''); thumb.setAttribute('aria-hidden','true');
    rail.append(thumb); port.parentElement.append(rail);
    listen(port,'scroll',schedule,{passive:true});
    listen(thumb,'pointerdown',thumbDown);
    listen(rail,'pointerdown',trackDown);
    listen(rail,'pointermove',pointerMove);
    listen(rail,'pointerup',pointerEnd);
    listen(rail,'pointercancel',pointerEnd);
    listen(rail,'lostpointercapture',event => {if (drag && (event.pointerId ?? drag.pointerId) === drag.pointerId) finishDrag(false);});
    listen(rail,'keydown',keyboard);
    listen(rail,'wheel',wheel,{passive:false});
    if (resizeObserver) {
      // Do not observe our own show/hide changes: native dimensions and child
      // content suffice, and observing the rail can cause resize feedback.
      resizeObserver.observe(port); resizeObserver.observe(port.parentElement);
    }
    refresh();
  }
  function ownNode(node) {
    if (!node) return false;
    const element = node.nodeType === 3 ? node.parentElement : node;
    return Boolean(element?.hasAttribute?.('data-dss-scroll-rail') || element?.closest?.('[data-dss-scroll-rail]'));
  }
  function mutations(records) {
    const external = records.some(record => {
      if (ownNode(record.target)) return false;
      if (record.type === 'childList') {
        const nodes = [...(record.addedNodes || []),...(record.removedNodes || [])];
        if (nodes.length && nodes.every(ownNode)) return false;
      }
      return true;
    });
    if (external) schedule();
  }
  function activate() {
    ensureStyle();
    if (typeof MutationObserver === 'function') {
      mutationObserver = new MutationObserver(mutations);
      mutationObserver.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','data-phase','data-conversation-session']});
    }
    if (typeof ResizeObserver === 'function') resizeObserver = new ResizeObserver(schedule);
    window.addEventListener('resize',schedule);
    bind(document.querySelector(selector));
  }
  function deactivate() {
    cancelFrame();
    mutationObserver?.disconnect(); mutationObserver = undefined;
    window.removeEventListener('resize',schedule);
    detach(); resizeObserver = undefined;
    style?.remove(); style = undefined;
  }
  function update(skin) {
    if (disposed) return;
    const next = Boolean(skin?.enabled);
    if (next === enabled) {if (next) schedule();return;}
    enabled = next;
    if (enabled) activate(); else deactivate();
  }
  return {update,dispose() {
    if (disposed) return;
    enabled = false; deactivate(); disposed = true;
  }};
}
