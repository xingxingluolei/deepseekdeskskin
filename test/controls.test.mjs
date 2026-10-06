import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSkinControls } from '../adapters/harness/controls.mjs';

const choices = [
  {id:'serene',name:'澄蓝',portrait:'serene-avatar'},
  {id:'maid',name:'经典女仆 · 立绘',portrait:'maid-avatar'},
  {id:'maid_chibi',name:'经典女仆 · Q版',portrait:'chibi-avatar'},
];
function fixture(t, enabled = true) {
  const original = Object.fromEntries(['document','window'].map(key => [key,globalThis[key]]));
  class Element {
    children=[]; attributes={}; style={}; listeners=new Map(); isConnected=true;
    constructor(tag){this.tagName=tag;}
    append(...nodes){for(const node of nodes){this.children.push(node);if(node&&typeof node==='object')node.parent=this;}}
    setAttribute(key,value){this.attributes[key]=String(value);}
    removeAttribute(key){delete this.attributes[key];}
    get textContent(){return this.text ?? this.children.map(node=>typeof node==='string'?node:node.textContent).join('');}
    set textContent(value){this.text=String(value);this.children=[];}
    addEventListener(key,callback){this.listeners.set(key,callback);}
    removeEventListener(key){this.listeners.delete(key);}
    attachShadow(){return this.shadow=new Element('shadow');}
    getBoundingClientRect(){return {right:240,bottom:740,width:316,height:550};}
    focus(){this.focused=true;}
    remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
    contains(node){return node===this||this.children.some(child=>child?.contains?.(node));}
    click(){this.listeners.get('click')?.({currentTarget:this,target:this});}
  }
  const body=new Element('body'),head=new Element('head');
  const documentListeners=new Map(),windowListeners=new Map();
  globalThis.document={body,head,documentElement:{clientWidth:1400,clientHeight:1000},activeElement:null,
    createElement:tag=>new Element(tag),addEventListener:(key,value)=>documentListeners.set(key,value),
    removeEventListener:key=>documentListeners.delete(key)};
  globalThis.window={innerWidth:1400,innerHeight:1000,addEventListener:(key,value)=>windowListeners.set(key,value),removeEventListener:key=>windowListeners.delete(key)};
  t.after(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const slots=new Map();
  const ctx={slots:{inject:(name,fn)=>fn(),register:(options,component)=>{slots.set(options.name,component);return()=>slots.delete(options.name);}}};
  const React={createElement:(tag,props,...children)=>({tag,props:props||{},children})};
  let skin={asset:'serene',enabled,palette:'light',mode:'dynamic',position:'right'};
  const changes=[]; let activity = 'idle';
  const current=()=>choices.find(choice=>choice.id===skin.asset);
  const controller=mountSkinControls(ctx,React,{skins:choices,getSkin:()=>skin,
    name:()=>current().name,portrait:()=>current().portrait,imageSource:()=>`${skin.asset}-scene`,
    activityState:()=>activity, expressionSource:()=>`${skin.asset}-${activity}-scene`, expressionFocus:()=>'84% 28%',
    onChange:(key,value)=>{changes.push([key,value]);skin={...skin,[key]:value};}});
  t.after(()=>controller.dispose());
  const card=()=>slots.get('sidebar.footer.action')({wide:true});
  const trigger=new Element('button');
  return {controller,card,trigger,body,slots,changes,skin:()=>skin,setActivity:value=>{activity=value;controller.refreshActivity();},documentListeners,windowListeners};
}
function findReact(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of node.children||[]){const match=findReact(child,predicate);if(match)return match;}}
function findDOM(node,predicate){if(predicate(node))return node;for(const child of node.children||[]){const match=findDOM(child,predicate);if(match)return match;}}
function popup(f){return f.body.children.at(-1).shadow;}
function button(f,label){return findDOM(popup(f),node=>node.tagName==='button'&&node.textContent===label);}

test('角色选择发送 asset 并更新选中态、头像和主题名称，关闭皮肤仍可切换与恢复',t=>{
  const f=fixture(t,false);
  findReact(f.card(),node=>node.tag==='button'&&node.children[0]==='切换皮肤').props.onClick({currentTarget:f.trigger});
  const chibi=button(f,'经典女仆 · Q版');
  assert.ok(chibi,'all character choices are available in the settings panel');
  assert.equal(findDOM(chibi,node=>node.tagName==='img').src,'chibi-avatar');
  chibi.click();
  assert.deepEqual(f.changes[0],['asset','maid_chibi']);
  assert.equal(chibi.attributes['aria-pressed'],'true');
  assert.equal(button(f,'澄蓝').attributes['aria-pressed'],'false');
  assert.equal(f.skin().enabled,false,'changing the character does not silently enable the skin');
  const card=f.card();
  assert.equal(findReact(card,node=>node.tag==='strong').children[0],'经典女仆 · Q版');
  assert.equal(findReact(card,node=>node.tag==='img').props.src,'chibi-avatar');
  button(f,'启用').click();assert.equal(f.skin().enabled,true);
  f.documentListeners.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(f.trigger.focused,true);
  assert.equal(f.body.children.length,0);
  assert.equal(f.documentListeners.size,0);assert.equal(f.windowListeners.size,0);
  assert.ok(f.slots.has('sidebar.footer.action'),'the recovery entry stays registered');
});

test('通用详情使用当前主题名称与图像而不是固定澄蓝',t=>{
  const f=fixture(t);
  f.controller.update({...f.skin(),asset:'maid'});
  // The production owner also updates its getter snapshot when an asset changes.
  findReact(f.card(),node=>node.tag==='button'&&node.children[0]==='切换皮肤').props.onClick({currentTarget:f.trigger});
  const maid=button(f,'经典女仆 · 立绘');assert.ok(maid);maid.click();
  button(f,'皮肤详情').click();
  assert.equal(findDOM(popup(f),node=>node.tagName==='h2').textContent,'经典女仆 · 立绘 · 皮肤详情');
  assert.equal(findDOM(popup(f),node=>node.tagName==='img').src,'maid-scene');
  button(f,'×').click();assert.equal(f.trigger.focused,true);
});


test('左侧头像与实际任务状态同步，静态也变神态，关闭后保持可恢复入口',t=>{
  const f=fixture(t);
  const text=node=>node.children?.filter(child=>typeof child==='string').join('');
  assert.equal(findReact(f.card(),node=>node.props?.className?.includes('dss-control-expression')).props.style.backgroundImage,'url("serene-idle-scene")');
  for (const [state,label] of [['thinking','思考中'],['working','工作中'],['answering','回应中'],['parallel','并行协作'],['compacting','整理上下文'],['retrying','重试中'],['waiting','等待确认'],['complete','本轮完成'],['error','需要检查'],['queued','排队中'],['connecting','连接中'],['disconnected','连接中断'],['stopped','已停止'],['paused','已暂停'],['blocked','需要介入']]) {
    f.setActivity(state);
    const card=f.card();
    assert.equal(card.props['data-state'],state);
    const picture=findReact(card,node=>node.props?.className?.includes('dss-control-expression'));
    assert.ok(picture, 'task expression remains visible in sidebar even when the conversation covers the large figure');
    assert.equal(picture.props.style.backgroundImage,`url("serene-${state}-scene")`);
    assert.equal(picture.props['aria-label'],label);
    assert.ok(text(findReact(card,node=>node.tag==='small')).includes(label));
  }
  f.controller.update({...f.skin(),mode:'static'}); f.setActivity('thinking');
  assert.ok(text(findReact(f.card(),node=>node.tag==='small')).includes('静态'));
  f.setActivity('idle'); const idlePicture=findReact(f.card(),node=>node.props?.className?.includes('dss-control-expression'));
  assert.ok(idlePicture,'idle keeps the frontal expression instead of reverting to the old side portrait');
  assert.equal(idlePicture.props.style.backgroundImage,'url("serene-idle-scene")');
  f.controller.update({...f.skin(),enabled:false}); f.setActivity('working');
  assert.equal(findReact(f.card(),node=>node.tag==='img').props.src,'serene-avatar');
  assert.equal(text(findReact(f.card(),node=>node.tag==='small')),'皮肤已关闭');
  assert.ok(findReact(f.card(),node=>node.tag==='button'&&node.children[0]==='切换皮肤'));
});
