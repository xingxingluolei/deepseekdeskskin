import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCharacterSurfaces } from '../adapters/harness/character.mjs';

test('角色插槽随启用状态注册和释放，尊重已有头像，关闭画册后恢复焦点', t => {
  const original = globalThis.document;
  class Element {
    attributes = {}; style = {setProperty(){},removeProperty(){}}; children = []; listeners = {};
    setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];}
    append(...els){this.children.push(...els);} remove(){this.removed=true;}
    attachShadow(){return this.shadow=new Element();}
    addEventListener(k,v){this.listeners[k]=v;} showModal(){this.open=true;} focus(){this.focused=true;}
  }
  const root = new Element(), head = new Element(), body = new Element(), origin = new Element();
  globalThis.document = {documentElement:root,head,body,activeElement:origin,createElement:()=>new Element()};
  t.after(()=>{globalThis.document=original;});
  let occupied = false; const registrations = new Map(); const injects = new Set();
  const ctx={slots:{entries:()=>occupied?[{}]:[],inject:(name,fn)=>{injects.add(name);const dispose=fn();return()=>{injects.delete(name);dispose?.();};},register:(options,component)=>{registrations.set(options.name,component);return()=>registrations.delete(options.name);}}};
  const React={createElement:(tag,props,...children)=>({tag,props,children})};
  const controller=mountCharacterSurfaces(ctx,{portrait:'portrait',scene:'scene',sheet:'sheet'},React);
  controller.update({enabled:true,palette:'dark',mode:'dynamic',motion:'float'});
  assert.equal(registrations.size,2);
  controller.update({enabled:true,palette:'light',mode:'static'});
  assert.equal(registrations.size,2,'changing palette must not duplicate slot owners');
  assert.equal(root.attributes['data-deepseekdeskskin-motion'],'static');
  assert.equal(registrations.has('conversation.session.header.utilities'),false,'no top-right badge is registered');
  controller.openAlbum({currentTarget:origin});
  const dialog=body.children.at(-1);
  assert.equal(dialog.open,true);
  assert.equal(dialog.children[0].shadow.children[2].src,'sheet');
  controller.update({enabled:false});
  assert.equal(dialog.removed,true); assert.equal(origin.focused,true);
  assert.equal(registrations.size,1); assert.equal(injects.size,1);
  assert.equal(typeof registrations.get('conversation.input.right'),'function','disabled visual skin keeps the empty activity driver');
  assert.equal(root.attributes['data-deepseekdeskskin'],undefined);
  occupied=true;
  controller.update({enabled:true,palette:'dark',mode:'dynamic',motion:'none'});
  assert.equal(registrations.size,1,'leave another theme’s single hero slot untouched');
  assert.equal(root.attributes['data-deepseekdeskskin-motion'],'static');
  controller.dispose();
  assert.equal(registrations.size,0); assert.equal(injects.size,0); assert.equal(head.children[0].removed,true);
});

test('sixteen expression previews are independent from the live task and release their own URLs on Escape',async t=>{
 const oldDocument=globalThis.document, oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let serial=0;const revoked=[],blobs=new Map();
 class Element {constructor(tag){this.tag=tag;}attributes={};style={setProperty(){},removeProperty(){}};children=[];listeners={};setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}append(...children){this.children.push(...children);}remove(){this.removed=true;}attachShadow(){return this.shadow=new Element('shadow');}addEventListener(k,fn){this.listeners[k]=fn;}showModal(){this.open=true;}focus(){this.focused=true;}}
 const origin=new Element('button');const body=new Element('body');globalThis.document={documentElement:new Element('html'),head:new Element('head'),body,activeElement:origin,createElement:tag=>new Element(tag)};
 URL.createObjectURL=blob=>{const url=`blob:preview-${++serial}`;blobs.set(url,blob);return url;};URL.revokeObjectURL=url=>revoked.push(url);
 t.after(()=>{globalThis.document=oldDocument;URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;});
 const data=name=>'data:image/png;base64,'+Buffer.from(name).toString('base64');
 const keys=['idle','thinking','working','answering','parallel','compacting','retrying','waiting','complete','error','queued','connecting','disconnected','stopped','paused','blocked'];
 const scenes=Object.fromEntries(keys.map(key=>[key,data(key)]));
 const ctx={slots:{entries:()=>[],inject:(name,fn)=>fn(),register:()=>()=>{}}};const React={createElement(){}};
 const controller=mountCharacterSurfaces(ctx,{serene:{id:'serene',name:'澄蓝',portrait:data('portrait'),sheet:data('sheet'),scenes}},React);
 controller.update({enabled:true,asset:'serene',mode:'dynamic',palette:'light'});const live=controller.imageSource;
 controller.openAlbum({currentTarget:origin});const dialog=body.children.at(-1),shadow=dialog.children[0].shadow;
 const all=element=>[element,...element.children.flatMap(all)];
 const preview=all(shadow).find(el=>el.tag==='button'&&el.textContent==='神态预览');assert.ok(preview,'a distinct preview tab must be available');preview.listeners.click();
 const choices=all(shadow).filter(el=>el.attributes['data-dss-preview-state']);assert.equal(choices.length,16);
 assert.ok(all(shadow.children[1]).includes(choices[0]),'expression controls must be reachable in the sticky header before the large image');
 assert.equal(choices.find(el=>el.attributes['data-dss-preview-state']==='error').textContent,'需要检查');
 const image=shadow.children[2],error=choices.find(el=>el.attributes['data-dss-preview-state']==='error');error.listeners.click();assert.equal(error.attributes['aria-pressed'],'true');assert.notEqual(image.src,live);
 assert.equal(controller.activityState,'idle');assert.equal(controller.imageSource,live,'manual preview must never drive live activity');
 const previewURL=image.src;
 const answering=choices.find(el=>el.attributes['data-dss-preview-state']==='answering');answering.listeners.click();const answeringURL=image.src;
 const complete=choices.find(el=>el.attributes['data-dss-preview-state']==='complete');complete.listeners.click();assert.notEqual(image.src,answeringURL,'completion previews use their independent action');assert.equal(await blobs.get(image.src).text(),'complete');assert.equal(complete.attributes['aria-pressed'],'true');
 let prevented=false;dialog.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(dialog.removed,true);assert.equal(origin.focused,true);assert.ok(revoked.includes(previewURL));assert.ok(!revoked.includes(live),'closing preview must retain the active scene resource');
 controller.dispose();assert.ok(revoked.includes(live));
});
