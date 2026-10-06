import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeSkin, ASSETS, CHARACTER_SKINS, decodeMedia, detectImage, readSkinPackage } from './src/skin.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json; charset=utf-8', '.zip': 'application/zip' };
const soundReviewFiles = new Set([
  ...['greeting', 'thinking', 'writing', 'reading', 'searching', 'executing', 'delegating', 'parallel', 'compacting', 'retrying', 'complete', 'waiting', 'error', 'connecting', 'disconnected', 'queued', 'stopped', 'paused', 'blocked', 'preview-core', 'preview-all'].map(name => `${name}.wav`),
  'manifest.json', 'deepseekdeskskin-sfx-v1.zip',
]);
export async function createStudio({ home = process.env.DEEPSEEKDESKSKIN_HOME || path.join(os.homedir(), '.deepseekdeskskin') } = {}) {
  await fs.mkdir(path.join(home, 'media'), { recursive: true, mode: 0o700 });
  const config = path.join(home, 'settings.json');
  const load = async () => { try { return normalizeSkin(JSON.parse(await fs.readFile(config, 'utf8'))); } catch { return normalizeSkin(); } };
  const save = async (skin) => {
    const clean = normalizeSkin(skin);
    if (clean.asset.startsWith('custom-')) await fs.access(path.join(home, 'media', clean.asset));
    const temp = `${config}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(clean, null, 2), { mode: 0o600 });
    await fs.rename(temp, config);
    return clean;
  };
  const storeImage = async (media) => {
    const name = `custom-${crypto.createHash('sha256').update(media.bytes).digest('hex').slice(0,24)}.${media.ext}`;
    await fs.writeFile(path.join(home, 'media', name), media.bytes, { mode: 0o600 });
    return name;
  };
  async function body(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 12 * 1024 * 1024) throw Error('文件过大'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  return http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403); res.end(); return; }
    const base = `http://${host}`;
    const url = new URL(req.url, base);
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'POST') {
        if ((req.headers.origin && req.headers.origin !== base) || !req.headers['content-type']?.startsWith('application/json') || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: '不允许跨站请求' });
        const value = await body(req);
        if (url.pathname === '/api/settings') return send(200, await save(value));
        if (url.pathname === '/api/media') return send(200, { asset: await storeImage(decodeMedia(value.data)) });
        if (url.pathname === '/api/import') {
          const pack = readSkinPackage(value);
          if (pack.media) {
            const builtin = CHARACTER_SKINS.some(character => character.id === pack.skin.asset);
            const matchesBuiltin = builtin && pack.media.bytes.equals(await fs.readFile(path.join(ROOT, 'assets', ASSETS[pack.skin.asset])));
            if (!matchesBuiltin) pack.skin.asset = await storeImage(pack.media);
          }
          return send(200, await save(pack.skin));
        }
        return send(404, { error: '不存在的接口' });
      }
      if (req.method !== 'GET') return send(405, { error: '不支持的方法' });
      if (url.pathname === '/api/settings') return send(200, await load());
      if (url.pathname === '/api/state-inventory') return send(200, JSON.parse(await fs.readFile(path.join(ROOT, 'docs/dsh-state-inventory.json'), 'utf8')));
      if (url.pathname === '/api/design-inventory') return send(200, JSON.parse(await fs.readFile(path.join(ROOT, 'docs/design/ui-inventory.json'), 'utf8')));
      if (url.pathname === '/api/health') return send(200, { app: 'deepseekdeskskin', version: '0.13.0', independent: true });
      if (url.pathname === '/api/export' || url.pathname === '/api/adapter') {
        const skin = await load();
        const imagePath = skin.asset.startsWith('custom-') ? path.join(home, 'media', skin.asset) : path.join(ROOT, 'assets', ASSETS[skin.asset]);
        const bytes = await fs.readFile(imagePath); const { mime } = detectImage(bytes);
        const media = `data:${mime};base64,${bytes.toString('base64')}`;
        if (url.pathname === '/api/adapter') {
          const { buildHarnessPlugin } = await import('./adapters/harness/build.mjs');
          const bundle = await buildHarnessPlugin(skin, media);
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${bundle.filename}"`, 'Cache-Control': 'no-store' }); res.end(bundle.archive); return;
        }
        res.setHeader('Content-Disposition', 'attachment; filename="deepseek-maid.dsskin.json"');
        return send(200, { format: 'deepseekdeskskin', version: 1, skin, media });
      }
      let file;
      if (url.pathname === '/') file = path.join(ROOT, 'web', 'index.html');
      else if (url.pathname === '/guide') file = path.join(ROOT, 'web', 'guide.html');
      else if (url.pathname === '/design') file = path.join(ROOT, 'web', 'design.html');
      else if (/^\/media\/custom-[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(url.pathname)) file = path.join(home, url.pathname.slice(1));
      else if (/^\/(web|src|assets)\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) file = path.join(ROOT, url.pathname.slice(1));
      else if (url.pathname.startsWith('/assets/audio/ui-v1/') && soundReviewFiles.has(url.pathname.slice('/assets/audio/ui-v1/'.length))) file = path.join(ROOT, url.pathname.slice(1));
      else if (/^\/assets\/actions\/[a-z-]+-v[123]\.png$/.test(url.pathname)) file = path.join(ROOT, url.pathname.slice(1));
      else if (/^\/assets\/portraits\/[a-z-]+-v[234]\.png$/.test(url.pathname)) file = path.join(ROOT, url.pathname.slice(1));
      if (!file) return send(404, { error: '未找到文件' });
      const data = await fs.readFile(file);
      if (path.extname(file) === '.zip') res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'" });
      res.end(data);
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? '素材不存在，请重新选择' : error.message }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4178);
  const server = await createStudio();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用；设置 PORT 后重试。` : error); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`deepseekdeskskin → http://127.0.0.1:${port}`));
}
