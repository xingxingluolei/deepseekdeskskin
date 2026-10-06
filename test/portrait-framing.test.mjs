import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTER_SKINS} from '../src/skin.mjs';

test('runtime actions fit the whole body while opening frames retain a stable closeup camera',()=>{
 for(const skin of CHARACTER_SKINS){
  assert.ok(skin.framing,skin.id+' has portrait framing');
  assert.deepEqual(Object.keys(skin.framing.states).sort(),Object.keys(skin.scenes).sort());
  for(const state of Object.values(skin.framing.states))assert.equal(state.fit,'contain','body, hands, feet and props remain visible');
  for(const frame of skin.intro.map(f=>f.framing)) {
   for(const key of ['cx','cy','cropWidth'])assert.ok(Number.isFinite(frame[key])&&frame[key]>0&&frame[key]<=1,skin.id+' valid '+key);
   assert.equal(frame.cropWidth,1,'dedicated shoulder images use all 1024 source pixels across the portrait');
  }
  for(const intro of skin.intro)assert.deepEqual(intro.framing,skin.intro[0].framing,'the camera stays still while the head turns');
  assert.notDeepEqual(skin.framing.states.idle,skin.intro[0].framing);
 }
});
