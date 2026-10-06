import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeSkin, ASSETS, detectImage, readSkinPackage } from '../src/skin.mjs';
import { buildHarnessPlugin } from '../adapters/harness/build.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const home = process.env.DEEPSEEKDESKSKIN_HOME || path.join(os.homedir(), '.deepseekdeskskin');
let skin; let bytes;
if (process.argv[2]) {
  const pack = readSkinPackage(JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8')));
  skin = pack.skin;
  if (pack.media) bytes = pack.media.bytes;
} else {
  try { skin = normalizeSkin(JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; skin = normalizeSkin(); }
}
if (!bytes) bytes = await fs.readFile(skin.asset.startsWith('custom-') ? path.join(home, 'media', skin.asset) : path.join(root, 'assets', ASSETS[skin.asset]));
const { mime } = detectImage(bytes);
const bundle = await buildHarnessPlugin(skin, `data:${mime};base64,${bytes.toString('base64')}`);
const dist = path.join(root, 'dist'); await fs.mkdir(dist, { recursive: true });
for (const [name, content] of Object.entries(bundle.files)) { const file = path.join(dist, 'harness-plugin', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
await fs.writeFile(path.join(dist, bundle.filename), bundle.archive);
console.log(`已生成独立 Harness 插件：${path.join(dist, bundle.filename)}`);
