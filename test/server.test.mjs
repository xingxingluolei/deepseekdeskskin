import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudio } from '../server.mjs';
import { CHARACTER_SKINS } from '../src/skin.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'deepseekdeskskin-test-'));
  const server = await createStudio({ home });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(home, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  return { home, server, base, post };
}
test('独立目录即可运行、保存设置，服务重建后仍可读取', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/`)).status, 200);
  assert.equal((await (await fetch(`${f.base}/api/health`)).json()).independent, true);
  const saved = await (await f.post('/api/settings', { mode: 'static', palette: 'light', asset: 'serene', size: 210, opacity: .9, position: 'left' })).json();
  assert.equal(saved.mode, 'static'); assert.equal(saved.position, 'left');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home, 'settings.json'), 'utf8')), saved);
  const again = await createStudio({ home: f.home }); await new Promise(resolve => again.listen(0, '127.0.0.1', resolve));
  try { assert.deepEqual(await (await fetch(`http://127.0.0.1:${again.address().port}/api/settings`)).json(), saved); }
  finally { await new Promise(resolve => again.close(resolve)); }
  assert.deepEqual((await fs.readdir(f.home)).sort(), ['media', 'settings.json']);
});

test('full-body action files are served without exposing generation records or arbitrary folders',async t=>{
  const f=await fixture(t);
  const response=await fetch(`${f.base}/assets/actions/maid-intro-away-v1.png`);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal((await fetch(`${f.base}/docs/maid-action-generation-v1.json`)).status,404);
  assert.equal((await fetch(`${f.base}/assets/actions/private.txt`)).status,404);
  const portrait=await fetch(`${f.base}/assets/portraits/serene-intro-away-v2.png`);
  assert.equal(portrait.status,200);assert.equal(portrait.headers.get('content-type'),'image/png');
  assert.equal((await fetch(`${f.base}/assets/portraits/serene-intro-attention-eyes-v3.png`)).status,200);
  assert.equal((await fetch(`${f.base}/assets/portraits/private.json`)).status,404);
});
test('自定义图片导出为便携皮肤包，能导入第二个完全独立的目录', async t => {
  const a = await fixture(t); const b = await fixture(t);
  const { asset } = await (await a.post('/api/media', { data: png })).json();
  assert.match(asset, /^custom-[a-f0-9]{24}\.png$/);
  assert.equal((await a.post('/api/settings', { asset, mode: 'static' })).status, 200);
  const pack = await (await fetch(`${a.base}/api/export`)).json();
  assert.equal(pack.media, png); assert.equal(pack.skin.mode, 'static');
  const imported = await (await b.post('/api/import', pack)).json();
  assert.equal(imported.mode, 'static');
  assert.deepEqual(Buffer.from(await (await fetch(`${b.base}/media/${imported.asset}`)).arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
});
test('导入损坏皮肤包与外站写入失败时，不覆盖已经保存的设置', async t => {
  const f = await fixture(t);
  const original = await (await f.post('/api/settings', { asset: 'serene', mode: 'static' })).json();
  assert.equal((await f.post('/api/import', { format: 'deepseekdeskskin', version: 999 })).status, 400);
  assert.equal((await f.post('/api/media', { data: 'data:image/gif;base64,PGh0bWw+ZXZpbDwvaHRtbD4=' })).status, 400);
  assert.equal((await f.post('/api/settings', { mode: 'dynamic' }, { Origin: 'https://unrelated.test' })).status, 403);
  assert.equal((await f.post('/api/settings', { mode: 'dynamic' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.post('/api/settings', { asset: 'custom-000000000000000000000000.png' })).status, 404);
  assert.deepEqual(await (await fetch(`${f.base}/api/settings`)).json(), original);
  assert.equal((await fetch(`${f.base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${f.base}/.research/private`)).status, 404);
});
test('插件导出直接得到 gzip 包，无需已安装 DeepSeek 或其他项目', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}/api/adapter`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/gzip');
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes[0], 31); assert.equal(bytes[1], 139);
});

test('内置角色便携包往返保留身份；不同内嵌图片始终按自定义导入', async t => {
  const source = await fixture(t); const destination = await fixture(t);
  let pack;
  for (const asset of ['serene','maid','maid_chibi']) {
    const saved = await source.post('/api/settings',{asset,mode:'static',position:'left'});
    assert.equal(saved.status,200);
    pack = await (await fetch(`${source.base}/api/export`)).json();
    const restored = await (await destination.post('/api/import',pack)).json();
    assert.equal(restored.asset,asset,'identical built-in artwork retains the character and its state scenes');
    assert.equal(restored.mode,'static'); assert.equal(restored.position,'left');
  }
  const different = await (await destination.post('/api/import',{...pack,media:png})).json();
  assert.match(different.asset,/^custom-/,'an external image never gets ignored because it claims a built-in ID');
  assert.equal((await (await fetch(`${destination.base}/api/export`)).json()).media,png);
});


test('公开状态清单可独立读取，覆盖十六种神态且不暴露研究目录', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}/api/state-inventory`);
  assert.equal(response.status,200);
  const inventory = await response.json();
  assert.equal(inventory.baseline,'0.2.0-rc.2');
  const phases = new Set(inventory.mappings.map(row=>row.phase));
  for (const phase of ['idle','thinking','working','answering','parallel','compacting','retrying','waiting','complete','error','queued','connecting','disconnected','stopped','paused','blocked']) assert.ok(phases.has(phase),`${phase} must have a public signal`);
  assert.ok(inventory.unsupported.length>0,'lossy public outcomes remain explicitly documented');
  assert.ok(inventory.mappings.every(row=>row.domain && row.signal && row.scope && row.source));
  assert.equal((await fetch(`${f.base}/.research/dsh-subagent/lib/index.js`)).status,404);
});


test('every catalog opening keyframe is served, including the current art revision', async t=>{
 const f=await fixture(t);
 for(const character of CHARACTER_SKINS)for(const frame of character.intro){
   const response=await fetch(f.base+'/assets/'+frame.file);
   assert.equal(response.status,200,character.id+':'+frame.key+' must preload');
   assert.equal(response.headers.get('content-type'),'image/png');
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.readUInt32BE(16),1024);
 }
});


test('all task action resources including v3 distinct poses are actually served',async t=>{
 const f=await fixture(t);
 for(const file of new Set(CHARACTER_SKINS.flatMap(s=>Object.values(s.scenes)))){const r=await fetch(`${f.base}/assets/${file}`);assert.equal(r.status,200,file);assert.equal(r.headers.get('content-type'),'image/png');}
});


test('sound-review assets are served with usable audio and download types', async t => {
  const f = await fixture(t);
  const prefix = '/assets/audio/ui-v1/';
  const response = await fetch(`${f.base}${prefix}manifest.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const manifest = await response.json();
  const assetPath = file => file.startsWith('/') ? file : file.startsWith('assets/') ? `/${file}` : prefix + file;
  const files = [...manifest.items.map(item => item.file), manifest.previews.core.file, manifest.previews.all.file];
  for (const file of files) {
    const audio = await fetch(f.base + assetPath(file));
    assert.equal(audio.status, 200, file);
    assert.equal(audio.headers.get('content-type'), 'audio/wav', file);
    assert.equal(audio.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await audio.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE', file);
  }
  const archive = await fetch(f.base + assetPath(manifest.archive));
  assert.equal(archive.status, 200);
  assert.equal(archive.headers.get('content-type'), 'application/zip');
  assert.match(archive.headers.get('content-disposition'), /^attachment;/);
  assert.equal(Buffer.from(await archive.arrayBuffer()).toString('ascii', 0, 2), 'PK');
});

test('sound-review routing does not publish source records or arbitrary nested files', async t => {
  const f = await fixture(t);
  await fs.access(new URL('../assets/audio/ui-v1/README.md', import.meta.url));
  for (const file of ['README.md', 'private.json', 'private.wav', 'generate.py', '../manifest.json', '%2e%2e%2fmanifest.json', 'nested/greeting.wav', 'greeting.wav.txt']) {
    assert.equal((await fetch(`${f.base}/assets/audio/ui-v1/${file}`)).status, 404, file);
  }
});
