import { DEFAULT_SKIN, ASSETS, CHARACTER_SKINS, ACTION_STATES, normalizeSkin } from '/src/skin.mjs';
import { mountVisual } from '/src/visual.mjs';
import { createTaskGreetingPlayer } from '/src/greeting.mjs';
import { createPortraitPresence } from '/src/presence.mjs';
import { createGreetingCamera } from '/src/cinema.mjs';
import { createStateReaction } from '/src/reaction.mjs';

const $ = id => document.getElementById(id);
const labels = Object.fromEntries(CHARACTER_SKINS.map(item => [item.id, item.name]));
for (const item of CHARACTER_SKINS) {
  const button = document.createElement('button'); button.className = 'asset-card character-card';
  button.type = 'button'; button.dataset.asset = item.id; button.setAttribute('aria-pressed', 'false');
  const portrait = document.createElement('img'); portrait.className = 'character-thumbnail';
  portrait.src = `/assets/${item.portrait}`; portrait.alt = '';
  const copy = document.createElement('span'); copy.className = 'character-copy';
  const name = document.createElement('strong'); name.textContent = item.name;
  const label = document.createElement('span'); label.textContent = item.label || '静态 / 轻动态';
  copy.append(name, label); button.append(portrait, copy); $('character-assets').append(button);
}
const renderer = mountVisual($('skin-layer'));
const camera = createGreetingCamera($('skin-layer'));
const reaction=createStateReaction($('skin-layer'));let paintRevision=0;
const readingVeil=document.createElement('div');readingVeil.className='reading-veil';readingVeil.setAttribute('aria-hidden','true');readingVeil.style.opacity='0';$('skin-layer').parentElement.append(readingVeil);
const presence=createPortraitPresence(()=>render());
let skin = normalizeSkin();
let saved = '';
let toastTimer;
let busy = false;
let previewState='idle',previewRequest,previewSequence=0,previewHasConversation=false;
const stateLabels={idle:'就绪',thinking:'思考',working:'工作',answering:'回应',parallel:'并行协作',compacting:'整理上下文',retrying:'重试',waiting:'等待确认',complete:'完成',error:'出错检查',queued:'排队',connecting:'连接中',disconnected:'连接中断',stopped:'已停止',paused:'已暂停',blocked:'需要介入',reading:'查阅中',writing:'写入中',searching:'搜索中',executing:'命令执行',delegating:'任务分派'};
for(const key of ACTION_STATES){const option=document.createElement('option');option.value=key;option.textContent=stateLabels[key];$('preview-state').append(option);}
const greeting=createTaskGreetingPlayer(()=>render());
function notify(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').dataset.error = error; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 7000 : 3500);
}
async function api(url, value) {
  const response = await fetch(url, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '操作失败，请重试');
  return result;
}
function render() {
  skin = normalizeSkin(skin);
  for (const key of ['mode', 'position', 'palette', 'asset']) document.querySelectorAll(`[data-${key}][aria-pressed]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[key] === skin[key])));
  $('preview-window').dataset.palette = skin.palette;
  const character = CHARACTER_SKINS.find(item => item.id === skin.asset);
  $('preview-window').dataset.portrait = String(Boolean(character));
  $('preview-window').dataset.position = skin.position;

  $('enabled').checked = skin.enabled;
  $('motion').checked = skin.motion === 'float';
  $('size').value = skin.size; $('opacity').value = Math.round(skin.opacity * 100);
  $('size-value').textContent = `${skin.size} px`; $('opacity-value').textContent = `${Math.round(skin.opacity * 100)}%`;
  for (const id of ['size', 'opacity']) { const input = $(id); const progress = (input.value - input.min) / (input.max - input.min) * 100; input.style.background = `linear-gradient(to right,#789aed ${progress}%,#2a3346 ${progress}%)`; }
  const custom = skin.asset.startsWith('custom-');
  $('custom-hint').hidden = !custom;
  const name = labels[skin.asset] || '自定义形象';
  $('preview-eyebrow').textContent = character ? 'DEEPSEEK · CHARACTER SKIN' : 'DEEPSEEK · YOUR COMPANION';
  $('preview-title').textContent = `${name}，静静相伴。`;
  $('mode-note').textContent = character ? skin.mode==='static'||skin.motion==='none' ? '随状态换图，保持静止。' : '新对话以特写转头微笑，随后用完整身体动作呈现思考与工作。' : skin.mode === 'static' ? '完全定格，保留立绘的细腻质感。' : skin.motion === 'float' ? '轻浮动，同时保留图片动画。' : '播放图片原有动画。';
  $('motion-dot').dataset.static = skin.mode === 'static';
  $('preview-caption').textContent = `DeepSeek 娘 · ${labels[skin.asset] || '自定义形象'} · ${skin.enabled ? skin.mode === 'static' ? '静态' : '动态' : '已隐藏'}`;
  $('preview-details').textContent = `${skin.size} px / ${Math.round(skin.opacity * 100)}%`;
  $('save-state').textContent = saved === JSON.stringify(skin) ? '已保存到本机' : '有未保存的更改';
  greeting.update({...skin,state:previewState,request:previewRequest,frames:()=>character?.intro.map(frame=>({...frame,source:`/assets/${frame.file}`}))});
  const introPlaying=['loading','running'].includes(greeting.getSnapshot().phase);
  $('preview-window').dataset.introPhase=greeting.getSnapshot().phase;
  $('preview-window').dataset.phase = character && (!previewHasConversation||introPlaying) ? 'hero' : 'active';
  $('preview-window').dataset.greetingHold = String(introPlaying);
  const closeup=Boolean(character)&&$('preview-window').dataset.phase==='hero';
  const source=greeting.currentFrame?.source || (closeup?`/assets/${character.intro[0].file}`:undefined) || (character?`/assets/${character.scenes[previewState]}`:custom?`/media/${skin.asset}`:`/assets/${ASSETS[skin.asset]}`);
  const taskBusy=['thinking','working','reading','writing','searching','executing','delegating','answering','parallel','compacting','retrying','queued','connecting'].includes(previewState);
  $('skin-layer').dataset.state=previewState;$('skin-layer').dataset.greeting=greeting.currentFrame?.key||'none';
  $('preview-state').disabled=!character;$('preview-start').disabled=!character;
  $('skin-layer').dataset.character = String(Boolean(character));
  const framing=greeting.currentFrame?.framing || (closeup?character?.intro[0]?.framing:character?.framing?.states?.[previewState]);
  $('skin-layer').dataset.shot=closeup?'portrait':'fullbody';
  $('skin-layer').style.setProperty('--dss-figure-scale',String(skin.size/340));
  $('skin-layer').style.setProperty('--dss-portrait-width',`${100/(framing?.cropWidth||.30)}%`);
  $('skin-layer').style.setProperty('--dss-portrait-x',`${-100*(framing?.cx||.5)}%`);
  $('skin-layer').style.setProperty('--dss-portrait-y',`${-100*(framing?.cy||.13)}%`);
  const animate=skin.enabled&&skin.mode==='dynamic'&&skin.motion!=='none'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const opening=greeting.getSnapshot();
  camera.update({enabled:animate&&Boolean(character),asset:skin.asset,position:skin.position,...opening});
  const attention=presence.update({enabled:skin.enabled,composed:Boolean(character),animated:animate,asset:skin.asset,
    requestKey:previewRequest?.key,greeting:introPlaying,hero:$('preview-window').dataset.phase==='hero',busy:taskBusy});
  const transition=`opacity ${attention.durationMs}ms cubic-bezier(.4,0,.2,1)`;
  $('skin-layer').style.transition=transition;readingVeil.style.transition=transition;
  readingVeil.style.opacity=String(attention.veilOpacity);readingVeil.hidden=!character||!skin.enabled;
  readingVeil.dataset.position=skin.position;$('preview-window').dataset.presence=attention.phase;
  const paintToken=++paintRevision,reactionInput={state:previewState,asset:skin.asset,enabled:skin.enabled,animated:animate&&!closeup};
  if(reactionInput.state!=='error'||!reactionInput.enabled||!reactionInput.animated)reaction.update(reactionInput);
  const painted=renderer.update({...skin,fit:character&&!closeup?'contain':'portrait',mirror:Boolean(character&&!closeup&&character.facingByState?.[previewState]==='right'),motion:character?'none':skin.motion,opacity:skin.opacity*attention.opacityFactor,transitionMs:animate?greeting.currentFrame?.transitionMs??420:0},source);
  Promise.resolve(painted).then(ok=>{if(paintToken===paintRevision&&ok!==false)reaction.update(reactionInput);});
  // The scene preview is a landscape canvas; custom artwork keeps
  // the square fitting box, with contain preserving its own natural ratio.
  $('skin-layer').style.height = `${character ? Math.round(skin.size * 1.4) : skin.size}px`;
}
$('preview-state').addEventListener('change',event=>{previewHasConversation=true;previewState=event.target.value;render();});
$('preview-start').addEventListener('click',()=>{previewHasConversation=true;previewState='thinking';$('preview-state').value=previewState;previewRequest={key:'studio-'+(++previewSequence),firstTurn:true};render();});
addEventListener('pagehide',event=>{if(!event.persisted){greeting.dispose();camera.dispose();presence.dispose();renderer.dispose();}else{previewRequest=undefined;greeting.update({...skin,state:previewState,request:undefined});presence.update({enabled:false});camera.update({enabled:false});}});
addEventListener('pageshow',event=>{if(event.persisted)render();});
async function action(fn) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button,input')]; controls.forEach(el => { el.disabled = true; });
  try { await fn(); } catch (error) { notify(error.message || '操作失败，请重试', true); }
  finally { busy = false; controls.forEach(el => { el.disabled = false; }); render(); }
}
async function save() { skin = await api('/api/settings', skin); saved = JSON.stringify(skin); render(); }
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('无法读取文件')); reader.readAsDataURL(file); }); }
async function validateImage(data) {
  if (typeof data !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(data)) throw Error('皮肤包必须内含 PNG、JPG、GIF 或 WebP 图片');
  const img = new Image();
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(Error('图片无法解码，请选择有效的图片')); img.src = data; });
    if (img.naturalWidth * img.naturalHeight > 20_000_000) throw Error('图片分辨率过大，请缩小到 2000 万像素以内');
  } finally { img.onload = null; img.onerror = null; img.removeAttribute('src'); }
}
document.querySelectorAll('button[data-mode],button[data-position],button[data-palette],button[data-asset]').forEach(button => button.addEventListener('click', () => { const key = Object.keys(button.dataset)[0]; skin[key] = button.dataset[key]; if (key === 'asset') skin.motion = CHARACTER_SKINS.some(item => item.id === skin.asset) ? 'float' : 'none'; render(); }));
$('size').addEventListener('input', event => { skin.size = Number(event.target.value); render(); });
$('opacity').addEventListener('input', event => { skin.opacity = Number(event.target.value) / 100; render(); });
$('enabled').addEventListener('change', event => { skin.enabled = event.target.checked; render(); });
$('motion').addEventListener('change', event => { skin.motion = event.target.checked ? 'float' : 'none'; render(); });
$('reset').addEventListener('click', () => { skin = { ...DEFAULT_SKIN }; render(); notify('已恢复默认，保存后生效'); });
$('save').addEventListener('click', () => action(async () => { await save(); notify('皮肤已保存，下次打开继续使用'); }));
$('upload-image').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  action(async () => {
    if (file.size > 8 * 1024 * 1024) throw Error('请选择小于 8 MB 的图片');
    const data = await readFile(file); await validateImage(data);
    const { asset } = await api('/api/media', { data }); skin.asset = asset; render(); notify('形象已导入，可继续调整皮肤');
  });
});
$('import-pack').addEventListener('click', () => $('pack-file').click());
$('pack-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  action(async () => {
    if (file.size > 12 * 1024 * 1024) throw Error('皮肤包过大');
    let pack; try { pack = JSON.parse(await file.text()); } catch { throw Error('无法读取皮肤包，请选择 .dsskin.json 文件'); }
    if (pack.media) await validateImage(pack.media);
    skin = await api('/api/import', pack); saved = JSON.stringify(skin); render(); notify('皮肤包已导入并保存');
  });
});
for (const [id, endpoint] of [['export-pack', '/api/export'], ['export-plugin', '/api/adapter']]) $(id).addEventListener('click', () => action(async () => {
  await save();
  // A normal HTTP attachment also works in embedded browsers that cannot
  // hand blob: URLs to their native download manager.
  const a = document.createElement('a'); a.href = endpoint;
  a.download = id === 'export-pack' ? 'deepseek-maid.dsskin.json' : '';
  document.body.append(a); a.click(); a.remove(); notify('设置已保存，已发起文件下载');
}));
$('skin-layer').addEventListener('skin-error', event => notify(event.detail, true));
await action(async () => { skin = await api('/api/settings'); saved = JSON.stringify(skin); render(); });
