import { CHARACTER_SKINS } from '/src/skin.mjs';
const $ = selector => document.querySelector(selector);
const states = {
  "idle": {
    "description": "待机源图：安静等待下一项任务。",
    "alt": "待机源图：安静等待下一项任务。"
  },
  "thinking": {
    "description": "站立托住下巴思考，另一只手自然收在身前，身边不拿书。",
    "alt": "站立托住下巴思考，另一只手自然收在身前，身边不拿书。"
  },
  "working": {
    "description": "俯身操作低位工具箱与机械部件，专注推进工作。",
    "alt": "俯身操作低位工具箱与机械部件，专注推进工作。"
  },
  "reading": {
    "description": "翻看打开的书，手指沿页查阅资料。",
    "alt": "翻看打开的书，手指沿页查阅资料。"
  },
  "writing": {
    "description": "坐在桌边执笔写字，把新的内容记在本子上。",
    "alt": "坐在桌边执笔写字，把新的内容记在本子上。"
  },
  "searching": {
    "description": "俯身查看蓝图，用放大镜寻找线索。",
    "alt": "俯身查看蓝图，用放大镜寻找线索。"
  },
  "executing": {
    "description": "在电脑前操作终端，专注执行命令。",
    "alt": "在电脑前操作终端，专注执行命令。"
  },
  "delegating": {
    "description": "伸手递出任务卡，把工作分派给协作者。",
    "alt": "伸手递出任务卡，把工作分派给协作者。"
  },
  "answering": {
    "description": "抬手回应，目光在你与任务间交流。",
    "alt": "抬手回应，目光在你与任务间交流。"
  },
  "parallel": {
    "description": "双臂展开，照看同时推进的两项工作。",
    "alt": "双臂展开，照看同时推进的两项工作。"
  },
  "compacting": {
    "description": "身体朝向左侧书架，把书放回书架，重新理顺上下文。",
    "alt": "身体朝向左侧书架，把书放回书架，重新理顺上下文。"
  },
  "retrying": {
    "description": "双手操作手摇轮，重新启动，再次尝试。",
    "alt": "双手操作手摇轮，重新启动，再次尝试。"
  },
  "waiting": {
    "description": "正视你，向前递出确认板，等待回应。",
    "alt": "正视你，向前递出确认板，等待回应。"
  },
  "error": {
    "description": "身体后仰，双手抬起、一手扶额，空手提醒发生了问题。",
    "alt": "身体后仰，双手抬起、一手扶额，空手提醒发生了问题。"
  },
  "queued": {
    "description": "坐在小凳上捧着大沙漏，耐心等待任务接纳。",
    "alt": "坐在小凳上捧着大沙漏，耐心等待任务接纳。"
  },
  "connecting": {
    "description": "斜向伸手，寻找连接。",
    "alt": "斜向伸手，寻找连接。"
  },
  "disconnected": {
    "description": "双手拉开两只大插头，用断开的连接表示中断。",
    "alt": "双手拉开两只大插头，用断开的连接表示中断。"
  },
  "stopped": {
    "description": "双臂在胸前交叉成大 X，明确表示任务已停止。",
    "alt": "双臂在胸前交叉成大 X，明确表示任务已停止。"
  },
  "paused": {
    "description": "放松靠坐，清醒等待恢复。",
    "alt": "放松靠坐，清醒等待恢复。"
  },
  "blocked": {
    "description": "正视你，一掌前伸，等待你介入。",
    "alt": "正视你，一掌前伸，等待你介入。"
  },
  "complete": {
    "description": "双手轻提裙摆、浅浅鞠躬，表示本轮完成；随后回到回应收尾。",
    "alt": "双手轻提裙摆、浅浅鞠躬，表示本轮完成；随后回到回应收尾。"
  }
};
let activeImage = $('#scene-front');
let nextImage = $('#scene-back');
let selectedState = 'idle';
let requestedState = 'idle';
let selectedCharacter = 'serene';
const sceneSource = (asset,state) => '/assets/' + CHARACTER_SKINS.find(item=>item.id===asset).scenes[state];
let requestId = 0;

async function showState(state, asset = $('#scene-character').value) {
  if (!states[state]) return;
  requestedState = state;
  const id = ++requestId;
  if (state === selectedState && asset === selectedCharacter) {
    $('#scene-description').textContent = states[state].description;
    return;
  }
  const loaded = new Image();
  loaded.src = sceneSource(asset,state);
  try {
    await loaded.decode();
    if (id !== requestId) return;
    nextImage.src = loaded.src;
    nextImage.style.scale = CHARACTER_SKINS.find(item=>item.id===asset).facingByState[state]==='right'?'-1 1':'1 1';
    nextImage.alt = states[state].alt;
    nextImage.removeAttribute('aria-hidden');
    nextImage.classList.add('visible');
    activeImage.classList.remove('visible');
    activeImage.setAttribute('aria-hidden', 'true');
    [activeImage, nextImage] = [nextImage, activeImage];
    selectedState = state;
    selectedCharacter = asset;
    const name = CHARACTER_SKINS.find(item=>item.id===asset).name;
    renderAtlas(asset);
    $('#scene-name').textContent = name;
    document.title = name + ' · 源素材与界面图鉴 · 0.13.0';
    for (const button of document.querySelectorAll('button[data-state]')) {
      button.setAttribute('aria-pressed', String(button.dataset.state === state));
    }
    $('.opening').dataset.state = state;
    $('.opening').dataset.character = asset;
    $('#scene-description').textContent = states[state].description;
  } catch {
    if (id === requestId) $('#scene-description').textContent = '这张神态图暂时无法读取，请稍后重试。';
  }
}
$('.opening').dataset.state = selectedState;
$('.opening').dataset.character = selectedCharacter;
for (const button of document.querySelectorAll('button[data-state]')) {
  button.addEventListener('click', () => { void showState(button.dataset.state); });
}
// Manual album previews stay local and do not write client or studio settings.
$('#scene-character').addEventListener('change', event => { void showState(requestedState,event.currentTarget.value); });

function renderAtlas(asset) {
  const character = CHARACTER_SKINS.find(item => item.id === asset);
  $('#atlas-character').textContent = character.name + ' · ' + Object.keys(character.scenes).length + ' 种状态源素材';
  const grid = $('#state-grid'); grid.replaceChildren();
  for (const state of Object.keys(character.scenes)) {
    const button = document.querySelector(`button[data-state="${state}"]`);
    const card = document.createElement('a'); card.className = 'state-card';
    card.href = sceneSource(asset,state); card.target = '_blank'; card.rel = 'noreferrer'; card.dataset.state = state;
    const image = document.createElement('img'); image.src = sceneSource(asset,state); image.alt = states[state].alt; image.loading = 'lazy'; image.style.scale = character.facingByState[state]==='right'?'-1 1':'1 1';
    const label = document.createElement('b'); label.textContent = button.textContent;
    const caption = document.createElement('span'); caption.textContent = states[state].description;
    card.append(image,label,caption); grid.append(card);
  }
  const introGrid = $('#intro-grid'); introGrid.replaceChildren();
  const introLabels = {away:'安静等待','attention-eyes':'注意到你',noticing:'目光回应','turn-early':'开始转头',turning:'慢慢转向','turn-late':'接近正视','front-neutral':'与你对视','front-blink':'轻轻眨眼','front-open':'睁眼回应','soft-smile':'笑意展开','front-smile':'温柔微笑','smile-settle':'微笑停留'};
  for (const [index,frame] of character.intro.entries()) {
    const card = document.createElement('a'); card.className = 'state-card';
    card.href = '/assets/'+frame.file; card.target = '_blank'; card.rel = 'noreferrer';
    const image = document.createElement('img'); image.src = card.href; image.alt = introLabels[frame.key] || frame.key; image.loading = 'lazy';
    const label = document.createElement('b'); label.textContent = `${index+1} · ${introLabels[frame.key] || frame.key}`;
    const caption = document.createElement('span'); caption.textContent = `${frame.duration}ms`;
    card.append(image,label,caption); introGrid.append(card);
  }
}
renderAtlas(selectedCharacter);
try {
  const response = await fetch('/api/state-inventory');
  if (!response.ok) throw Error('unavailable');
  const inventory = await response.json();
  const labels = Object.fromEntries([...document.querySelectorAll('button[data-state]')].map(button=>[button.dataset.state,button.textContent]));
  const table = document.createElement('table'); table.className = 'state-table';
  const head = document.createElement('tr');
  for (const title of ['状态来源','结构化信号','对应神态','范围']) {const cell=document.createElement('th');cell.textContent=title;head.append(cell);}
  const thead = document.createElement('thead');thead.append(head);table.append(thead);
  const body = document.createElement('tbody');
  for (const entry of inventory.mappings) {
    const row = document.createElement('tr');
    for (const value of [entry.domain,entry.signal,entry.phase === null ? '恢复当前状态' : labels[entry.phase] || entry.phase,entry.scope]) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
    row.title = entry.note || ''; body.append(row);
  }
  table.append(body); $('#state-mapping').append(table);
  $('#state-boundaries').textContent = (inventory.unsupported || []).map(entry=>typeof entry==='string'?entry:entry.note || entry.reason || entry.signal || entry.domain).join('；');
} catch { $('#state-mapping').textContent = '公开状态清单暂不可用，请确认工作室正在运行。'; }

const map = [
  ['窗口与侧栏','蓝白渐变、衣纹细线、原生拖动区域','配色 + 细纹'],
  ['品牌与欢迎页','品牌小头像、清晰欢迎肖像与连续蓝白场景','肖像 + 场景'],
  ['会话与工作区','选中线、悬浮色、工作区空状态','线条 + 肖像'],
  ['输入框与工具栏','白色输入面、银蓝边框与焦点','边框 + 配色'],
  ['模型、权限、指令菜单','使用主题颜色，保留功能图标与名称','主题令牌'],
  ['消息、推理与代码','完整阅读面上呈现正文，连续衣纹自然延伸','阅读 + 场景'],
  ['思考、执行、回应、并行、整理与重试','身体姿势与道具区分状态，思考、工作与重试各自独立','表情 + 动态'],
  ['查阅、写入、搜索、命令与子代理','工具阶段各有身体动作，任务分派对应递出任务卡','动作 + 主题令牌'],
  ['右侧文件、文档、浏览器','空页面头像；内容页以阅读为主','肖像 + 配色'],
  ['插件与设置','卡片配色、设置标题纹样、角色设定入口','角色卡 + 配色'],
  ['弹窗、提示、附件','边框与中性色统一；警告、失败保留语义色','主题令牌'],
  ['系统菜单、系统文件选择器','由 macOS 绘制，未覆盖','原生保留'],
];
for (const [name, description, status] of map) {
  const row = document.createElement('div'); row.className = 'map-row';
  for (const [tag, text] of [['b', name], ['span', description], ['em', status]]) {
    const element = document.createElement(tag); element.textContent = text; row.append(element);
  }
  $('#surface-map').append(row);
}
$('#palette').addEventListener('click', event => {
  const light = document.body.classList.toggle('light');
  event.currentTarget.textContent = light ? '切换深海蓝' : '切换云间白';
});
$('#portrait-detail').addEventListener('click', () => $('#character').scrollIntoView({
  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
}));
$('#sample-send').addEventListener('click', () => {
  $('#sample-note').textContent = '已预览输入框操作，内容仍保留在本地。';
});
try {
  const response = await fetch('/api/design-inventory');
  if (!response.ok) throw Error('无法加载清单');
  const data = await response.json();
  $('#inventory-count').textContent = data.packages.length + ' 个界面模块 + 基础组件库 · ' + data.primitives.components.length + ' 个基础组件 · ' + data.primitives.icons.length + ' 个图标/插画导出';
  const packages = [...data.packages, { package: data.primitives.package, components: [...data.primitives.components, ...data.primitives.icons].map(name => ({ name })) }];
  function render() {
    const query = $('#filter').value.trim().toLowerCase();
    const list = $('#module-list'); list.replaceChildren();
    for (const pkg of packages) {
      const names = pkg.components.map(item => item.name).join(' · ');
      if (!(pkg.package + ' ' + names).toLowerCase().includes(query)) continue;
      const article = document.createElement('article');
      const title = document.createElement('h3');
      const description = document.createElement('p');
      title.textContent = pkg.package.replace('@deepseek-ai/', '');
      description.textContent = names || '通过原生服务或插槽提供界面';
      article.append(title, description); list.append(article);
    }
  }
  $('#filter').addEventListener('input', render); render();
} catch {
  $('#inventory-count').textContent = '清单暂不可用，请确认工作室正在运行。';
}
