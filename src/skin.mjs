import { PORTRAIT_FRAMING } from './portrait-framing.mjs';
import { ACTION_FOCUS } from './action-focus.mjs';
export const ACTION_STATES = Object.freeze(['idle','thinking','working','reading','writing','searching','executing','delegating','answering','parallel','compacting','retrying','waiting','complete','error','queued','connecting','disconnected','stopped','paused','blocked']);
export const DEFAULT_SKIN = Object.freeze({ enabled: true, mode: 'dynamic', motion: 'float', asset: 'serene', palette: 'light', size: 340, opacity: .9, position: 'right' });
const revisedActions = new Set(['thinking','working','retrying','queued','error','disconnected','stopped','complete']);
const toolActionsV2 = new Set(['compacting','reading','writing','searching','delegating']);
export const CHARACTER_SKINS = Object.freeze([
  { id:'serene', name:'澄蓝', label:'SERENE BLUE', portrait:'serene-avatar-v1.png', sheet:'serene-character-sheet-v1.png',
    caption:'静水深流，陪你探索。蓝白衣裙、银色鲸尾与水晶，开场以特写回应，工作时以身体动作陪伴。' },
  { id:'maid', name:'经典女仆', label:'CLASSIC MAID', portrait:'maid-avatar-v1.png',
    caption:'经典海军蓝女仆装，以思考、工具操作与收尾等独立身体动作回应任务进程。' },
  { id:'maid_chibi', name:'经典女仆 · Q版', label:'CLASSIC MAID · CHIBI', portrait:'maid-chibi-avatar-v1.png',
    caption:'经典女仆的 Q版表现，保留蓝白服饰与鲸尾夹，保留完整身体动作。' },
].map(item=>{
  const prefix=item.id==='maid_chibi'?'maid-chibi':item.id;
  const scale='160% auto';
  // Source direction belongs to the artwork, independently of layout side.
  const leftFacing={serene:['idle','connecting'],maid:['idle','compacting','connecting','answering','paused'],maid_chibi:['idle','compacting','connecting']}[item.id];
  const focus=item.id==='maid_chibi'?'50% 48%':'50% 35%';
  return Object.freeze({...item,framing:PORTRAIT_FRAMING[item.id],presentation:'cutout',portraitFocus:focus,portraitScale:scale,
    caption:item.caption+' 身体与道具表达任务，脸部主要正面朝镜头；新对话开始时微笑回应，随后按真实进程切换神态。',
    facingByState:Object.freeze(Object.fromEntries(ACTION_STATES.map(state=>[state,revisedActions.has(state)?(item.id!=='maid'&&['working','retrying'].includes(state)?'left':'front'):leftFacing.includes(state)||['compacting','reading','writing','searching','executing','delegating'].includes(state)?'left':'front']))),
    focusByState:Object.freeze({...ACTION_FOCUS[item.id].states,idle:ACTION_FOCUS[item.id].intro.away}),
    scenes:Object.freeze(Object.fromEntries(ACTION_STATES.map(state=>{
      const sourceState=state==='idle'?'intro-away':state==='executing'?'working':state;
      const version=revisedActions.has(state)?3:toolActionsV2.has(state)?2:1;
      return [state,`actions/${prefix}-${sourceState}-v${version}.png`];
    }))),
    intro:Object.freeze([
      ['away',280,160,2],['attention-eyes',240,210,3],['noticing',280,230,2],
      ['turn-early',260,220,3],['turning',320,270,3,'turn-middle'],['turn-late',300,250,3],
      ['front-neutral',320,250,4],['front-blink',180,100,4],['front-open',240,140,4],
      ['soft-smile',320,260,4],['front-smile',540,320,4],['smile-settle',620,320,4],
    ].map(([key,duration,transitionMs,version,fileKey=key])=>Object.freeze({key,framing:PORTRAIT_FRAMING[item.id].intro[key],file:`portraits/${prefix}-intro-${fileKey}-v${item.id==='maid_chibi'||item.id==='maid'&&key==='turn-late'?4:version}.png`,duration,transitionMs,focus,scale}))),
  });
}));
export const ASSETS = Object.freeze({ serene: 'portraits/serene-intro-away-v2.png', maid:'portraits/maid-intro-away-v2.png', maid_chibi:'portraits/maid-chibi-intro-away-v2.png' });
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const clamp = (v, low, high, fallback) => Number.isFinite(Number(v)) ? Math.max(low, Math.min(high, Number(v))) : fallback;
export function normalizeSkin(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const asset = Object.hasOwn(ASSETS, raw.asset) || /^custom-[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(raw.asset || '') ? raw.asset : 'serene';
  return {
    enabled: raw.enabled !== false,
    mode: raw.mode === 'static' ? 'static' : 'dynamic',
    asset,
    motion: ['float', 'none'].includes(raw.motion) ? raw.motion : CHARACTER_SKINS.some(item => item.id === asset) ? 'float' : 'none',
    palette: ['light', 'dark'].includes(raw.palette) ? raw.palette : 'light',
    size: Math.round(clamp(raw.size, 160, 420, 340)),
    opacity: Math.round(clamp(raw.opacity, .1, 1, .9) * 100) / 100,
    position: raw.position === 'left' ? 'left' : 'right',
  };
}
export function detectImage(bytes) {
  if (!bytes || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Error('图片需要小于 8 MB');
  const ascii = bytes.subarray(0, 16).toString('latin1');
  if (/^GIF8[79]a/.test(ascii)) return { mime: 'image/gif', ext: 'gif' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  throw Error('仅支持 PNG、JPG、GIF、WebP 图片');
}
export function decodeMedia(data) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data || '');
  if (!match || data.length > MAX_IMAGE_BYTES * 1.4) throw Error('无效的皮肤图片');
  const bytes = Buffer.from(match[2], 'base64');
  const kind = detectImage(bytes);
  if (kind.mime !== match[1]) throw Error('图片格式与内容不一致');
  return { bytes, ...kind };
}
export function readSkinPackage(value) {
  if (!value || value.format !== 'deepseekdeskskin' || value.version !== 1) throw Error('不支持的皮肤包版本');
  return { skin: normalizeSkin(value.skin), media: value.media ? decodeMedia(value.media) : null };
}
