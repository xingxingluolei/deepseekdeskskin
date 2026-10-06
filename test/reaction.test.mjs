import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateReaction} from '../src/reaction.mjs';

function fixture(t,{reduced=false,animate=true}={}) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');
  const listeners=new Set(),animations=[];
  const media={matches:reduced,addEventListener(type,fn){assert.equal(type,'change');listeners.add(fn);},removeEventListener(type,fn){assert.equal(type,'change');listeners.delete(fn);}};
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,writable:true,value:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return media;}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'matchMedia',original);else delete globalThis.matchMedia;});
  const element={style:{transform:'translateX(12px) scaleX(-1)',translate:'',scale:''}};
  if(animate)element.animate=(frames,options)=>{
    const animation={frames,options,cancelled:0,onfinish:null,oncancel:null,cancel(){this.cancelled++;this.oncancel?.();}};
    animations.push(animation);return animation;
  };
  const reaction=createStateReaction(element);
  t.after(()=>reaction.dispose());
  let input={state:'idle',asset:'maid',enabled:true,animated:true};
  return {reaction,element,animations,listeners,update(patch){input={...input,...patch};reaction.update(input);},reduce(value){media.matches=value;for(const fn of listeners)fn({matches:value});}};
}

test('entering error plays once with a named subtle reaction and leaves existing transform intact',t=>{
  const f=fixture(t);f.update({state:'thinking'});assert.equal(f.animations.length,0);
  f.update({state:'error'});const animation=f.animations[0];assert.equal(animation.id,'dss-error-reaction');
  assert.equal(animation.options.duration,1300);assert.equal(animation.options.iterations,1);assert.equal(animation.options.fill,'none');
  assert.deepEqual(animation.frames.map(frame=>frame.translate),['0px 0px','4px 0px','-1px 0px','0px 0px']);
  assert.deepEqual(animation.frames.map(frame=>frame.scale),['1','.986','.998','1']);
  assert.ok(animation.frames.every(frame=>!Object.hasOwn(frame,'transform')&&!Object.hasOwn(frame,'filter')&&!Object.hasOwn(frame,'opacity')));
  for(let i=0;i<8;i++)f.update({state:'error'});
  assert.equal(f.animations.length,1);assert.equal(animation.cancelled,0);
  assert.deepEqual(f.element.style,{transform:'translateX(12px) scaleX(-1)',translate:'',scale:''});
});

test('natural completion removes the effect without replaying unchanged error notifications',t=>{
  const f=fixture(t);f.update({state:'error'});const animation=f.animations[0];animation.onfinish();
  assert.equal(animation.cancelled,1);assert.equal(animation.onfinish,null);assert.equal(animation.oncancel,null);
  f.update({state:'error'});assert.equal(f.animations.length,1);assert.equal(f.element.style.scale,'');assert.equal(f.element.style.translate,'');
});

test('leaving error cancels immediately and a later error is a new entry',t=>{
  const f=fixture(t);f.update({state:'error'});const first=f.animations[0],stale=first.onfinish;
  f.update({state:'working'});assert.equal(first.cancelled,1);
  f.update({state:'error'});const second=f.animations[1];assert.ok(second);stale();assert.equal(second.cancelled,0);
});

test('switching characters during error replaces the reaction once and stale callbacks cannot cancel it',t=>{
  const f=fixture(t);f.update({state:'error'});const first=f.animations[0],staleFinish=first.onfinish,staleCancel=first.oncancel;
  f.update({asset:'serene'});const second=f.animations[1];assert.equal(first.cancelled,1);assert.ok(second);
  staleFinish();staleCancel();assert.equal(second.cancelled,0);
  f.update({asset:'serene'});assert.equal(f.animations.length,2);
});

test('reduced motion suppresses entry and system changes immediately cancel active motion',t=>{
  const f=fixture(t,{reduced:true});f.update({state:'error'});assert.equal(f.animations.length,0);
  f.reduce(false);f.update({state:'error'});assert.equal(f.animations.length,0,'preference changes do not replay an old error');
  f.update({state:'working'});f.update({state:'error'});const animation=f.animations[0];assert.ok(animation);
  f.reduce(true);assert.equal(animation.cancelled,1);f.update({state:'error'});assert.equal(f.animations.length,1);
});

for(const key of ['enabled','animated'])test(`${key} cancels and suppresses entries without replaying when re-enabled`,t=>{
    const f=fixture(t);f.update({state:'error'});const first=f.animations[0];f.update({[key]:false});assert.equal(first.cancelled,1);
    f.update({[key]:true});assert.equal(f.animations.length,1);
    f.update({state:'working',[key]:false});f.update({state:'error'});assert.equal(f.animations.length,1);
    f.update({[key]:true});assert.equal(f.animations.length,1);
    f.update({state:'answering'});f.update({state:'error'});assert.equal(f.animations.length,2);
    f.reaction.dispose();
});

test('dispose cancels once, removes the preference listener, and ignores future updates',t=>{
  const f=fixture(t);assert.equal(f.listeners.size,1);f.update({state:'error'});const animation=f.animations[0],stale=animation.onfinish;
  f.reaction.dispose();f.reaction.dispose();assert.equal(animation.cancelled,1);assert.equal(f.listeners.size,0);
  stale();f.update({state:'working'});f.update({state:'error',asset:'serene'});assert.equal(f.animations.length,1);
});

test('missing Web Animations support is a harmless still image',t=>{
  const f=fixture(t,{animate:false});assert.doesNotThrow(()=>f.update({state:'error'}));assert.doesNotThrow(()=>f.reaction.dispose());
  assert.deepEqual(f.element.style,{transform:'translateX(12px) scaleX(-1)',translate:'',scale:''});
});

test('external cancellation releases only the current animation and next entry still plays',t=>{
  const f=fixture(t);f.update({state:'error'});const first=f.animations[0];first.cancel();
  assert.equal(first.oncancel,null);f.update({state:'idle'});assert.equal(first.cancelled,1);
  f.update({state:'error'});assert.equal(f.animations.length,2);
});
