import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSkin, readSkinPackage, detectImage, DEFAULT_SKIN } from '../src/skin.mjs';

test('皮肤设置兼容缺失字段并限制装饰层尺寸、透明度', () => {
  assert.equal(normalizeSkin({}).mode, 'dynamic');
  const s = normalizeSkin({ mode: 'static', size: 9000, opacity: -3, palette: 'invalid', asset: '../../secret' });
  assert.equal(s.mode, 'static');
  assert.equal(s.size, 420);
  assert.equal(s.opacity, .1);
  assert.equal(s.palette, 'light');
  assert.equal(s.asset, 'serene');
});
test('精致立绘默认启用轻浮动，自定义素材保持原有动作，导入导出保留动态设置', () => {
  assert.equal(normalizeSkin().asset, 'serene');
  assert.equal(normalizeSkin().motion, 'float');
  assert.equal(normalizeSkin({ asset: 'custom-000000000000000000000000.gif' }).motion, 'none');
  const imported = readSkinPackage({ format: 'deepseekdeskskin', version: 1, skin: { asset: 'custom-000000000000000000000000.png', motion: 'float' } });
  assert.equal(imported.skin.motion, 'float');
  assert.equal(normalizeSkin({ asset: 'serene', motion: 'none' }).motion, 'none');
});
test('静态/动态皮肤包可移植，拒绝未来版本与外部媒体 URL', () => {
  for (const mode of ['static', 'dynamic']) {
    const p = readSkinPackage({ format: 'deepseekdeskskin', version: 1, skin: { ...DEFAULT_SKIN, mode } });
    assert.equal(p.skin.mode, mode);
  }
  assert.throws(() => readSkinPackage({ format: 'deepseekdeskskin', version: 999, skin: {} }), /版本/);
  assert.throws(() => readSkinPackage({ format: 'deepseekdeskskin', version: 1, skin: {}, media: 'https://example.com/private' }), /图片/);
});
test('根据实际内容识别 GIF、PNG 和 WebP，拒绝伪装为图片的 HTML', () => {
  assert.deepEqual(detectImage(Buffer.from('GIF89a0123456789')), { mime: 'image/gif', ext: 'gif' });
  assert.deepEqual(detectImage(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(detectImage(Buffer.from('RIFF1234WEBPVP8 ')), { mime: 'image/webp', ext: 'webp' });
  assert.throws(() => detectImage(Buffer.from('<html>not a gif</html>')), /图片/);
});
