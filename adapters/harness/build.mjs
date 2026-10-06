import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { mountVisual } from '../../src/visual.mjs';
import { normalizeSkin, ASSETS, CHARACTER_SKINS, decodeMedia } from '../../src/skin.mjs';
import { installHarnessSkin } from './client.mjs';
import { mountCharacterSurfaces } from './character.mjs';
import { createActivityTracker } from './activity.mjs';
import { mountSkinControls } from './controls.mjs';
import { mountConversationScrollRail } from './scroll.mjs';
import { mountReceiptHost } from './receipt-host.mjs';
import { createReceiptClient } from './receipt-client.mjs';
import { createTurnGreetingTracker } from './greeting.mjs';
import { createTaskGreetingPlayer } from '../../src/greeting.mjs';
import { createPortraitPresence } from '../../src/presence.mjs';
import { createGreetingCamera } from '../../src/cinema.mjs';
import { createStateReaction } from '../../src/reaction.mjs';

export const PLUGIN_NAME = 'deepseekdeskskin-harness';
export const PLUGIN_VERSION = '0.13.0';
// Minimal USTAR writer for this fixed, flat bundle. Paths never come from users.
export function archiveFiles(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const header = Buffer.alloc(512);
    if (!/^[a-zA-Z0-9./-]+$/.test(name) || name.includes('..') || name.length > 90) throw Error('无效的插件文件路径');
    header.write(`package/${name}`, 0, 100); header.write('0000644\0', 100, 8); header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12); header.write('00000000000\0', 136, 12);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
export async function buildHarnessPlugin(skinInput, media, {readAsset = file => fs.readFile(new URL(`../../assets/${file}`, import.meta.url))} = {}) {
  let skin = normalizeSkin(skinInput);
  const decoded = decodeMedia(media);
  const buffers = new Map();
  async function read(file) {
    if (!buffers.has(file)) buffers.set(file, Promise.resolve(readAsset(file)));
    return buffers.get(file);
  }
  const builtin = CHARACTER_SKINS.some(item => item.id === skin.asset);
  const canonical = builtin && (await read(ASSETS[skin.asset])).equals(decoded.bytes);
  // A v1 portable package may claim a built-in ID while carrying edited media.
  // Preserve those bytes as the original selectable export, never silently
  // replace them with a catalog scene. CLI and server share this same check.
  if (builtin && !canonical) {
    const asset = `custom-${crypto.createHash('sha256').update(decoded.bytes).digest('hex').slice(0,24)}.${decoded.ext}`;
    skin = normalizeSkin({...skin,asset});
  }
  const characterCatalog = Object.fromEntries(CHARACTER_SKINS.map(item => [item.id,item]));
  const filenames = new Set(CHARACTER_SKINS.flatMap(item => [item.portrait,item.sheet,...Object.values(item.scenes),...item.intro.map(frame=>frame.file)].filter(Boolean)));
  const characterResources = Object.fromEntries(await Promise.all([...filenames].map(async file => [file,`data:image/png;base64,${(await read(file)).toString('base64')}`])));
  // Matching built-ins use the shared resource table, so their idle PNG is not
  // serialized a second time as an initial-media argument.
  const embeddedMedia = canonical ? '' : media;
  const identity = crypto.createHash('sha256').update(JSON.stringify(skin)).update(media).digest('hex').slice(0, 16);
  const metadata = {
    name: PLUGIN_NAME, version: PLUGIN_VERSION, description: 'Independent DeepSeek maid skin: static or animated', type: 'module', main: 'lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { inject: ['@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-job-controller', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-api-gateway'], platform: 'web' } },
    files: ['lib', 'cordis.patch.yml', 'README.md', 'CREDITS.md'],
  };
  // Function source is from our own modules only; no host source is bundled.
  const client = `window.__ModuleLoader__.load({id:${JSON.stringify(PLUGIN_NAME)},factory:(require)=>{\nconst ASSETS=${JSON.stringify(ASSETS)};\nconst CHARACTER_SKINS=${JSON.stringify(CHARACTER_SKINS)};\nconst characterCatalog=${JSON.stringify(characterCatalog)};\nconst characterResources=${JSON.stringify(characterResources)};\nconst React=require('react');\nconst RemoteStreamCarrierError=require('@deepseek-ai/dsh-api-gateway').RemoteStreamCarrierError;\nconst clamp=(v,low,high,fallback)=>Number.isFinite(Number(v))?Math.max(low,Math.min(high,Number(v))):fallback;\n${normalizeSkin.toString()}\n${mountVisual.toString()}\n${createActivityTracker.toString()}\n${createTurnGreetingTracker.toString()}\n${createTaskGreetingPlayer.toString()}\n${createPortraitPresence.toString()}\n${createGreetingCamera.toString()}\n${createStateReaction.toString()}\n${createReceiptClient.toString()}\n${mountCharacterSurfaces.toString()}\n${mountSkinControls.toString()}\n${mountConversationScrollRail.toString()}\n${installHarnessSkin.toString()}\nreturn {inject:['theme','slots','sessions','jobs','connection','remote','typert'],apply(ctx){installHarnessSkin(ctx,${JSON.stringify(skin)},${JSON.stringify(embeddedMedia)},mountVisual,normalizeSkin,${JSON.stringify(identity)},()=>mountCharacterSurfaces(ctx,characterCatalog,React,createActivityTracker,characterResources,mountConversationScrollRail,receiptCtx=>createReceiptClient(receiptCtx,RemoteStreamCarrierError),createTurnGreetingTracker),options=>mountSkinControls(ctx,React,options),createTaskGreetingPlayer);}};\n}});\n`;
  const files = {
    'package.json': JSON.stringify(metadata, null, 2),
    'cordis.patch.yml': '- insert:\n    - id: deepseekdeskskin\n      name: deepseekdeskskin-harness\n',
    'lib/index.js': `export const inject = ['tools','agents','typert'];\n${mountReceiptHost.toString()}\nexport function apply(ctx) {return mountReceiptHost(ctx); }\n`,
    'lib/client.js': client,
    'README.md': '# deepseekdeskskin-harness\n\n由独立的 deepseekdeskskin 工作室导出。图片和设置已内嵌，不需要工作室持续运行。使用 DeepSeek Harness 0.2.0-rc.2 的客户端插件接口。安装及卸载说明见项目 README。左侧皮肤卡提供「切换皮肤」与「皮肤详情」。切换面板可选静态、动态、配色和位置，或启停皮肤；关闭后入口仍保留。\n',
    'CREDITS.md': await fs.readFile(new URL('../../assets/CREDITS.md', import.meta.url), 'utf8'),
  };
  return { files, archive: archiveFiles(files), filename: `${PLUGIN_NAME}-${PLUGIN_VERSION}.tgz` };
}
