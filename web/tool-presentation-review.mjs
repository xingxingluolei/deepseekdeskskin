import { createToolPresentationDemo } from './tool-presentation-demo.mjs';
const $=selector=>document.querySelector(selector);
let demo;
const number=value=>Number.isFinite(value)?value.toFixed(1)+' ms':'—';
function display(result) {
  document.body.dataset.status=result.status;document.body.dataset.passed=String(result.passed);
  $('#state-line').textContent=`真实任务 ${result.activity} · 显示动作 ${result.visual}`;
  $('#verdict').textContent=result.status==='done'?(result.passed?'通过 · Read 清楚停留 ≥ 900ms':'未通过 · 停留不足 900ms'):result.status==='error'?'本轮未完成':result.status==='running'?'正在运行真实链路':'等待手动开始';
  $('#detail').textContent=result.message || (result.status==='done'?'已由真实 renderer 回执启动停留，并由 controller 自动交回最新 Thinking。':'前一动作淡入 → Read 排队 / 解码 → Read 淡入回执 → 清楚停留 → Thinking。');
  $('#call-time').textContent=number(result.times.readResult===undefined?undefined:result.times.readResult-result.times.readCall);
  $('#ack-time').textContent=number(result.times.readAcknowledged);
  $('#return-time').textContent=number(result.times.thinkingRequested);
  $('#hold-time').textContent=number(result.visibleHoldMs);
  $('#thinking-time').textContent=number(result.times.thinkingPresented);
  const rows=result.events.map(event=>{const row=document.createElement('tr');for(const value of [number(event.at),event.event,event.activity,event.visual]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}return row;});$('#events').replaceChildren(...rows);
  $('#start').disabled=result.status==='running';$('#asset').disabled=result.status==='running';$('#slow').disabled=result.status==='running';
}
function reset() {
  demo?.dispose();demo=undefined;
  display({status:'ready',passed:null,activity:'—',visual:'—',times:{},events:[],visibleHoldMs:null});
}
function start() {
  demo?.dispose();
  demo=createToolPresentationDemo($('#stage'),{asset:$('#asset').value,decodeDelayMs:$('#slow').checked?650:0,onChange:display});
  void demo.run();
  return demo.done;
}
$('#start').addEventListener('click',start);$('#reset').addEventListener('click',reset);
window.addEventListener('pagehide',()=>demo?.dispose(),{once:true});
// Browser inspection can read the same recorded result without scraping UI.
globalThis.toolPresentationReview={start,reset,snapshot:()=>demo?.snapshot()};
