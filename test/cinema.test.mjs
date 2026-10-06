import test from 'node:test';
import assert from 'node:assert/strict';
import {createGreetingCamera} from '../src/cinema.mjs';
function fixture(){
 const animations=[];let reduced=false;
 const element={style:{transform:'translateY(-50%) scaleX(-1)'},animate(frames,options){const a={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;}};
 const camera=createGreetingCamera(element,{reducedMotion:()=>reduced});
 const input={asset:'serene',position:'left',requestKey:'one',phase:'running',durationMs:3900};
 return {camera,input,animations,element,reduce(){reduced=true;}};
}
test('one additive camera move spans every opening frame without replacing mirrored hero positioning',()=>{
 const f=fixture();f.camera.update({...f.input,phase:'loading'});assert.equal(f.animations.length,0);
 f.camera.update(f.input);for(let i=0;i<12;i++)f.camera.update({...f.input,frameIndex:i});
 f.camera.update({...f.input,position:'right'});assert.equal(f.animations.length,1,'moving the portrait does not restart the camera');const a=f.animations[0];assert.equal(a.options.duration,3900);assert.equal(a.options.composite,'add');
 assert.equal(f.element.style.transform,'translateY(-50%) scaleX(-1)');assert.deepEqual(a.frames[0].transform,a.frames.at(-1).transform,'camera lands at its original pose before conversation layout');
 f.camera.update({...f.input,phase:'finished'});assert.equal(a.cancelled,true);f.camera.dispose();
});
test('interruption and new request cancel the old camera, disposal cannot revive it',()=>{
 const f=fixture();f.camera.update(f.input);f.camera.update({...f.input,phase:'cancelled'});assert.equal(f.animations[0].cancelled,true);
 f.camera.update(f.input);assert.equal(f.animations.length,1,'same cancelled request cannot restart its camera');
 f.camera.update({...f.input,requestKey:'two'});assert.equal(f.animations.length,2);
 f.camera.update({...f.input,asset:'maid',requestKey:'three'});assert.equal(f.animations[1].cancelled,true);
 f.camera.dispose();assert.equal(f.animations[2].cancelled,true);f.camera.update({...f.input,requestKey:'four'});assert.equal(f.animations.length,3);
});
test('static, reduced motion, invalid timing and environments without WAAPI stay still',()=>{
 const f=fixture();for(const change of [{enabled:false},{durationMs:0},{durationMs:NaN},{requestKey:undefined}])f.camera.update({...f.input,...change});assert.equal(f.animations.length,0);
 f.camera.update(f.input);f.reduce();f.camera.update(f.input);assert.equal(f.animations[0].cancelled,true);f.camera.update({...f.input,requestKey:'two'});assert.equal(f.animations.length,1);
 const fallback=createGreetingCamera({},{reducedMotion:()=>false});assert.doesNotThrow(()=>fallback.update(f.input));fallback.dispose();f.camera.dispose();
});
