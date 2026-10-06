// Always available public-slot controls. Enabling/disabling the wallpaper never
// unregisters this controller, and its own CSS does not use the skin marker.
export function mountSkinControls(ctx, React, options) {
  const h = React.createElement;
  const style = document.createElement('style');
  style.textContent = `
.dss-control-card,.dss-control-rail{--dss-c-ink:#29466f;--dss-c-muted:#607b9e;--dss-c-line:#789acb45;--dss-c-bg:#f7faff;--dss-c-chip:#edf3ff;--dss-c-accent:#4268b5;box-sizing:border-box;-webkit-app-region:no-drag}
.dss-control-card[data-palette=dark],.dss-control-rail[data-palette=dark]{--dss-c-ink:#e5efff;--dss-c-muted:#adc3e2;--dss-c-line:#96b6ff44;--dss-c-bg:#17263d;--dss-c-chip:#233754;--dss-c-accent:#aac8ff}
.dss-control-card{display:flex;flex-direction:column;gap:10px;width:100%;margin:8px 0;padding:11px;border:1px solid var(--dss-c-line);border-radius:14px;background:linear-gradient(120deg,var(--dss-c-bg),var(--dss-c-chip));color:var(--dss-c-ink);font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.dss-control-heading{display:flex;align-items:center;gap:10px;min-width:0}
.dss-control-picture{display:grid;place-items:center;flex:none;width:38px;height:38px;object-fit:cover;border-radius:12px;background:var(--dss-c-chip);border:1px solid var(--dss-c-line);font-size:21px;color:var(--dss-c-accent)}
.dss-control-expression{background-repeat:no-repeat;background-size:600% auto}
.dss-control-heading>span:not(.dss-control-picture){display:flex;flex-direction:column;gap:3px;min-width:0}
.dss-control-heading strong{font-size:13px;font-weight:550;letter-spacing:.12em}
.dss-control-heading small{font-size:10px;color:var(--dss-c-muted);white-space:nowrap}
.dss-control-actions{display:flex;gap:7px}
.dss-control-actions button,.dss-control-rail{appearance:none;border:1px solid var(--dss-c-line);border-radius:8px;background:var(--dss-c-bg);color:var(--dss-c-ink);font:inherit;padding:6px 8px;cursor:pointer;white-space:nowrap}
.dss-control-actions button{flex:1}
.dss-control-actions button:hover,.dss-control-rail:hover{border-color:var(--dss-c-accent);background:var(--dss-c-chip)}
.dss-control-actions button:focus-visible,.dss-control-rail:focus-visible{outline:2px solid var(--dss-c-accent);outline-offset:2px}
.dss-control-rail{display:grid;place-items:center;width:36px;height:36px;margin:5px auto;padding:2px}
.dss-control-rail .dss-control-picture{width:30px;height:30px;border-radius:8px}
.dss-control-settings{max-width:440px;margin:16px 0}
.dss-control-error{font-size:10px;color:#bf5361;overflow-wrap:anywhere}
`;
  document.head.append(style);
  let disposed = false;
  let popup;
  const subscriptions = new Set();
  const disposers = [];
  let snapshot = { skin: { ...options.getSkin() }, activity: 'idle', error: '', open: false };
  const panelId = 'deepseekdeskskin-left-panel';
  const readSource = value => typeof value === 'function' ? value() : value;
  const thumbnail = () => readSource(options.portrait) || readSource(options.imageSource);
  const currentName = () => readSource(options.name) || options.skins?.find(item => item.id === snapshot.skin.asset)?.name || (snapshot.skin.asset === 'serene' ? '澄蓝' : 'DeepSeek 娘');
  const activityLabels = {idle:'就绪',thinking:'思考中',working:'工作中',answering:'回应中',parallel:'并行协作',compacting:'整理上下文',retrying:'重试中',waiting:'等待确认',complete:'本轮完成',error:'需要检查',queued:'排队中',connecting:'连接中',disconnected:'连接中断',stopped:'已停止',paused:'已暂停',blocked:'需要介入',reading:'查阅中',writing:'写入中',searching:'搜索中',executing:'命令执行',delegating:'任务分派'};
  function notify() { for (const listener of subscriptions) listener(); }
  function setSnapshot(patch) { snapshot = { ...snapshot, ...patch }; notify(); }
  function useSnapshot() {
    const subscribe = listener => { subscriptions.add(listener); return () => subscriptions.delete(listener); };
    if (React.useSyncExternalStore) return React.useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
    if (React.useState && React.useEffect) {
      const [value, setValue] = React.useState(snapshot);
      React.useEffect(() => subscribe(() => setValue(snapshot)), []);
      return value;
    }
    return snapshot;
  }
  function focusTrigger(trigger) {
    if (trigger && trigger.isConnected !== false) trigger.focus?.();
  }
  function closePopup(restore = false) {
    if (!popup) return;
    const current = popup; popup = undefined;
    current.removeListeners();
    current.root.remove();
    setSnapshot({ open: false });
    if (restore) focusTrigger(current.trigger);
  }
  function forwardedEvent(event, trigger) {
    return { ...event, currentTarget: trigger, target: trigger,
      preventDefault: () => event?.preventDefault?.(),
      stopPropagation: () => event?.stopPropagation?.() };
  }
  function showDetails(event, stableTrigger) {
    const trigger = stableTrigger || event?.currentTarget || document.activeElement;
    closePopup(false);
    if (disposed) return;
    if (options.onDetails) {
      try { options.onDetails(forwardedEvent(event, trigger), trigger); }
      catch (error) { showError(error?.message || String(error)); }
    } else {
      openPopup('details', trigger);
    }
  }
  function change(key, value) {
    if (disposed) return;
    try {
      const result = options.onChange(key, value);
      if (result && typeof result.catch === 'function') result.catch(error => showError(error?.message || String(error)));
      update(options.getSkin() || { ...snapshot.skin, [key]: value });
    } catch (error) { showError(error?.message || String(error)); }
  }
  const panelCSS = `
:host{--ink:#29466f;--muted:#607b9e;--line:#789acb45;--bg:#f7faff;--chip:#edf3ff;--accent:#4268b5;display:block;font:12px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:var(--ink)}
:host([data-palette=dark]){--ink:#e5efff;--muted:#adc3e2;--line:#96b6ff44;--bg:#17263d;--chip:#233754;--accent:#aac8ff}
*{box-sizing:border-box}
.panel{padding:17px;border:1px solid var(--line);border-radius:16px;background:var(--bg);box-shadow:0 15px 50px #10244325;max-height:calc(100vh - 24px);overflow:auto}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:17px}
h2{font-size:14px;font-weight:550;letter-spacing:.06em;margin:0}
button{appearance:none;font:inherit;border:1px solid var(--line);border-radius:8px;padding:7px 11px;background:var(--chip);color:var(--ink);cursor:pointer;-webkit-app-region:no-drag}
button:hover{border-color:var(--accent)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--chip)}
.close{padding:3px 8px;background:transparent;font-size:17px}
.group{margin:14px 0}
.label{display:block;margin-bottom:7px;font-size:10px;letter-spacing:.1em;color:var(--muted)}
.choices{display:flex;gap:7px}
.choices button{flex:1}
.skin-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.skin-choice{display:flex;flex-direction:column;align-items:center;gap:7px;min-width:0;padding:8px 5px;white-space:normal}
.skin-choice img{display:block;width:56px;height:56px;object-fit:cover;border-radius:10px}
.skin-choice span{font-size:10px;line-height:1.5;min-height:30px}
.details-link{width:100%;margin-top:8px;background:transparent}
.error{margin:12px 0 0;padding:9px;border-radius:8px;color:#b95462;background:#b9546210;overflow-wrap:anywhere}
.error[hidden]{display:none}
.detail-image{display:block;width:100%;max-height:330px;object-fit:contain;border-radius:12px;background:var(--chip)}
dl{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:16px 0 0}
dt{color:var(--muted)}dd{margin:0;text-align:right}
.note{margin:12px 0 0;color:var(--muted);font-size:11px}
`;
  function positionPopup() {
    if (!popup) return;
    const rect = popup.trigger?.getBoundingClientRect?.() || { right: 20, bottom: 400 };
    const bounds = popup.root.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = document.documentElement.clientHeight || window.innerHeight;
    const left = Math.max(12, Math.min(rect.right + 12, width - bounds.width - 12));
    const top = Math.max(12, Math.min(rect.bottom - bounds.height, height - bounds.height - 12));
    popup.root.style.left = left + 'px';
    popup.root.style.top = top + 'px';
  }
  function syncPopup() {
    if (!popup) return;
    const { skin, error } = snapshot;
    popup.root.setAttribute('data-palette', skin.palette === 'dark' ? 'dark' : 'light');
    for (const item of popup.choices) item.button.setAttribute('aria-pressed', String(skin[item.key] === item.value));
    popup.error.textContent = error; popup.error.hidden = !error;
    if (popup.detailFields) {
      popup.title.textContent = currentName() + ' · 皮肤详情';
      if (popup.detailImage) popup.detailImage.src = readSource(options.imageSource) || readSource(options.portrait);
      const labels = { palette: skin.palette === 'dark' ? '深海蓝' : '云间白',
        mode: skin.mode === 'dynamic' ? '动态' : '静态',
        position: skin.position === 'left' ? '靠左' : '靠右', enabled: skin.enabled ? '已启用' : '已关闭' };
      for (const [key, field] of Object.entries(popup.detailFields)) field.textContent = labels[key];
    }
    positionPopup();
  }
  function openPopup(kind, trigger) {
    if (disposed) return;
    if (popup?.trigger === trigger && popup.kind === kind) { closePopup(true); return; }
    closePopup(false);
    const root = document.createElement('div'); root.id = panelId;
    root.style.cssText = 'position:fixed;z-index:1000;width:min(316px,calc(100vw - 24px));left:12px;top:12px;-webkit-app-region:no-drag';
    const shadow = root.attachShadow({ mode: 'open' });
    const panelStyle = document.createElement('style'); panelStyle.textContent = panelCSS;
    const panel = document.createElement('section'); panel.className = 'panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'dss-panel-title');
    const header = document.createElement('header');
    const title = document.createElement('h2'); title.id = 'dss-panel-title';
    title.textContent = kind === 'settings' ? '切换皮肤' : currentName() + ' · 皮肤详情';
    const close = document.createElement('button'); close.className = 'close'; close.textContent = '×';
    close.setAttribute('aria-label', '关闭' + title.textContent);
    close.addEventListener('click', () => closePopup(true));
    header.append(title, close); panel.append(header);
    const choices = [];
    let detailFields;
    let detailImage;
    if (kind === 'settings') {
      if (options.skins?.length) {
        const group = document.createElement('div'); group.className = 'group';
        const caption = document.createElement('span'); caption.className = 'label'; caption.textContent = '角色皮肤';
        const buttons = document.createElement('div'); buttons.className = 'skin-choices';
        buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', '角色皮肤');
        for (const item of options.skins) {
          const button = document.createElement('button'); button.className = 'skin-choice'; button.type = 'button';
          button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', item.name);
          const portrait = readSource(item.portrait);
          if (portrait) { const image = document.createElement('img'); image.src = portrait; image.alt = ''; button.append(image); }
          const name = document.createElement('span'); name.textContent = item.name; button.append(name);
          button.addEventListener('click', () => change('asset', item.id));
          choices.push({button,key:'asset',value:item.id}); buttons.append(button);
        }
        group.append(caption, buttons); panel.append(group);
      }
      for (const [label, key, values] of [
        ['配色', 'palette', [['深海蓝', 'dark'], ['云间白', 'light']]],
        ['表现', 'mode', [['静态', 'static'], ['动态', 'dynamic']]],
        ['位置', 'position', [['靠左', 'left'], ['靠右', 'right']]],
        ['显示', 'enabled', [['启用', true], ['关闭', false]]],
      ]) {
        const group = document.createElement('div'); group.className = 'group';
        const caption = document.createElement('span'); caption.className = 'label'; caption.textContent = label;
        const buttons = document.createElement('div'); buttons.className = 'choices';
        buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', label);
        for (const [text, value] of values) {
          const button = document.createElement('button'); button.textContent = text;
          button.setAttribute('aria-pressed', 'false');
          button.addEventListener('click', () => change(key, value));
          choices.push({ button, key, value }); buttons.append(button);
        }
        group.append(caption, buttons); panel.append(group);
      }
      const details = document.createElement('button'); details.className = 'details-link'; details.textContent = '皮肤详情';
      details.addEventListener('click', event => showDetails(event, trigger)); panel.append(details);
    } else {
      const source = readSource(options.imageSource) || readSource(options.portrait);
      if (source) {
        const image = document.createElement('img'); image.className = 'detail-image'; image.src = source;
        detailImage = image;
        image.addEventListener('load', positionPopup);
        image.alt = '当前皮肤图像'; panel.append(image);
      }
      const fields = document.createElement('dl'); detailFields = {};
      for (const [key, label] of [['palette','配色'],['mode','表现'],['position','位置'],['enabled','显示']]) {
        const name = document.createElement('dt'); name.textContent = label;
        const value = document.createElement('dd'); detailFields[key] = value; fields.append(name, value);
      }
      panel.append(fields);
      const note = document.createElement('p'); note.className = 'note'; note.textContent = '当前皮肤的本地预览；关闭皮肤后仍可从左侧入口启用。';
      panel.append(note);
    }
    const error = document.createElement('p'); error.className = 'error'; error.setAttribute('role', 'status'); error.hidden = true;
    panel.append(error); shadow.append(panelStyle, panel); document.body.append(root);
    const outside = event => {
      const path = event.composedPath?.() || [];
      if (path.includes(root) || path.includes(trigger) || root.contains?.(event.target) || trigger?.contains?.(event.target)) return;
      closePopup(false);
    };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); closePopup(true); } };
    const resize = () => closePopup(false);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    popup = { root, trigger, kind, choices, error, title, detailFields, detailImage,
      removeListeners() {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('resize', resize);
      } };
    setSnapshot({ open: true }); syncPopup(); close.focus();
  }
  function Controls({ wide = true, settings = false } = {}) {
    const value = useSnapshot();
    const owner = React.useRef ? React.useRef({ settings: null, details: null }) : { current: { settings: null, details: null } };
    if (React.useEffect) React.useEffect(() => {
      // Capture committed nodes: React can clear or replace refs before effect
      // cleanup when the rail changes width or this particular slot unmounts.
      const ownedTriggers = [owner.current.settings, owner.current.details];
      return () => {
        if (popup && ownedTriggers.includes(popup.trigger)) closePopup(false);
      };
    }, [wide]);
    const skin = value.skin;
    const source = thumbnail();
    const expression = skin.enabled ? readSource(options.expressionSource) : undefined;
    const label = activityLabels[value.activity] || activityLabels.idle;
    const picture = expression
      ? h('span', { className: 'dss-control-picture dss-control-expression', role:'img', 'aria-label':label, style:{backgroundImage:`url("${expression}")`,backgroundPosition:readSource(options.expressionFocus) || '84% 28%',backgroundSize:readSource(options.expressionScale) || '600% auto'} })
      : source
      ? h('img', { className: 'dss-control-picture', src: source, alt: '' })
      : h('span', { className: 'dss-control-picture', 'aria-hidden': true }, '✧');
    const triggerProps = { ref: node => { owner.current.settings = node; }, type: 'button', 'aria-haspopup': 'dialog', 'aria-controls': panelId,
      'aria-expanded': value.open, onClick: event => openPopup('settings', event.currentTarget) };
    if (!wide) return h('button', { ...triggerProps, className: 'dss-control-rail',
      'data-palette': skin.palette, 'aria-label': '切换皮肤', 'data-state':value.activity, title: skin.enabled ? label + ' · 切换皮肤' : '切换皮肤' }, picture);
    return h('div', { className: 'dss-control-card' + (settings ? ' dss-control-settings' : ''), 'data-palette': skin.palette, 'data-state': value.activity },
      h('div', { className: 'dss-control-heading' }, picture,
        h('span', null, h('strong', null, currentName()),
          h('small', null, skin.enabled
            ? (value.activity === 'idle' ? (skin.palette === 'dark' ? '深海蓝' : '云间白') : label) + ' · ' + (skin.mode === 'dynamic' ? '动态' : '静态')
            : '皮肤已关闭'))),
      h('div', { className: 'dss-control-actions' },
        h('button', triggerProps, '切换皮肤'),
        h('button', { ref: node => { owner.current.details = node; }, type: 'button', onClick: event => showDetails(event, event.currentTarget) }, '皮肤详情')),
      value.error ? h('span', { className: 'dss-control-error', role: 'status' }, value.error) : null);
  }
  for (const [name, component] of [
    ['sidebar.footer.action', Controls],
    ...(options.includeSettings === false ? [] : [['settings.general.item', props => h(Controls, { ...props, settings: true, wide: true })]]),
  ]) {
    disposers.push(ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'deepseekdeskskin-controls', order: -100 }, component)));
  }
  function update(skin) {
    if (disposed) return;
    setSnapshot({ skin: { ...skin } }); syncPopup();
  }
  function showError(message) {
    if (disposed) return;
    setSnapshot({ error: String(message || '') }); syncPopup();
  }
  function refreshActivity() {
    if (disposed) return;
    const activity = readSource(options.activityState) || 'idle';
    if (snapshot.activity !== activity) {setSnapshot({activity}); syncPopup();}
  }
  return { update, refreshActivity, showError, dispose() {
    if (disposed) return;
    closePopup(false); disposed = true;
    for (const dispose of disposers.splice(0).reverse()) dispose?.();
    subscriptions.clear(); style.remove();
  } };
}
