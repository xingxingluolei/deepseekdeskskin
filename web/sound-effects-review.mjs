// An isolated audition page. Playback begins only in a user click handler.
const assetRoot = '/assets/audio/ui-v1/';
const player = document.querySelector('#player');
const status = document.querySelector('#playback-status');
const nowPlaying = document.querySelector('#now-playing');
const library = document.querySelector('#sound-library');
const controls = [];
let active = null;
let playbackRevision = 0;

function assetUrl(file, extension) {
  if (typeof file !== 'string') throw new Error('音效清单缺少文件路径');
  const url = file.startsWith('/') ? file : file.startsWith('assets/') ? `/${file}` : assetRoot + file;
  const name = url.slice(assetRoot.length);
  if (!url.startsWith(assetRoot) || !/^[a-z0-9][a-z0-9.-]*$/.test(name) || name.includes('..') || !name.endsWith(extension)) {
    throw new Error('音效清单包含无效的文件路径');
  }
  return url;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateControls() {
  for (const control of controls) {
    const selected = active === control;
    const playing = selected && !player.paused && !player.ended;
    control.button.setAttribute('aria-pressed', String(playing));
    control.button.textContent = playing ? '暂停播放' : selected && !player.ended && player.currentTime > 0 ? '继续播放' : control.defaultLabel;
    control.card?.classList.toggle('is-active', selected);
  }
}

async function audition(control) {
  const revision = ++playbackRevision;
  if (active === control && !player.paused) {
    player.pause();
    return;
  }
  if (active !== control) {
    player.pause();
    active = control;
    player.src = control.url;
    player.load();
  } else if (player.ended) {
    player.currentTime = 0;
  }
  nowPlaying.textContent = control.label;
  player.setAttribute('aria-label', `试听：${control.label}`);
  status.textContent = '正在载入音频…';
  updateControls();
  try {
    await player.play();
    if (revision === playbackRevision) {
      status.textContent = `正在试听 · ${control.label}`;
      updateControls();
    }
  } catch {
    if (revision === playbackRevision) {
      status.textContent = '暂时无法播放，请重试或下载 WAV 试听。';
      updateControls();
    }
  }
}

function register(button, file, label, card) {
  const control = { button, url: assetUrl(file, '.wav'), label, card, defaultLabel: button.textContent };
  controls.push(control);
  button.disabled = false;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => audition(control));
}

player.addEventListener('play', () => {
  if (active) status.textContent = `正在试听 · ${active.label}`;
  updateControls();
});
player.addEventListener('pause', () => {
  if (active && player.paused && !player.ended) status.textContent = `已暂停 · ${active.label}`;
  updateControls();
});
player.addEventListener('ended', () => {
  status.textContent = '这一段听完了，可以再选一个声音。';
  updateControls();
});
player.addEventListener('error', () => {
  status.textContent = '音频未能载入，请刷新后重试或下载 WAV。';
  updateControls();
});
addEventListener('pagehide', () => { playbackRevision++; player.pause(); });

function renderCard(item, index) {
  const card = element('article', 'sound-card');
  card.dataset.soundId = item.id;
  const topline = element('div', 'card-topline');
  topline.append(element('span', 'sound-id', `${String(index + 1).padStart(2, '0')} / ${item.id}`));
  topline.append(element('span', `suggestion${item.enabledSuggestion ? '' : ' optional'}`, item.enabledSuggestion ? '建议启用' : '按需启用'));
  card.append(topline, element('h3', '', item.label), element('p', 'sound-description', item.description));
  if (item.recommendation) card.append(element('p', 'sound-recommendation', item.recommendation));
  const metrics = element('div', 'sound-metrics');
  if (Number.isFinite(item.durationSeconds)) metrics.append(element('span', 'duration', `${item.durationSeconds.toFixed(2)} s`));
  if (Number.isFinite(item.peakDbfs)) metrics.append(element('span', '', `Peak ${item.peakDbfs.toFixed(1)} dBFS`));
  if (Number.isFinite(item.rmsDbfs)) metrics.append(element('span', '', `RMS ${item.rmsDbfs.toFixed(1)} dBFS`));
  const actions = element('div', 'card-actions');
  const button = element('button', 'play-one', '试听');
  button.type = 'button';
  button.setAttribute('aria-label', `试听 ${item.label}`);
  const download = element('a', 'download-one', 'WAV ↓');
  download.href = assetUrl(item.file, '.wav');
  download.download = download.href.split('/').pop();
  download.setAttribute('aria-label', `下载 ${item.label} WAV`);
  register(button, item.file, item.label, card);
  actions.append(button, download);
  card.append(metrics, actions);
  return card;
}

try {
  const response = await fetch(assetRoot + 'manifest.json');
  if (!response.ok) throw new Error('音效清单暂时无法载入');
  const manifest = await response.json();
  if (!Array.isArray(manifest.items) || !manifest.items.length) throw new Error('音效清单为空');
  // Validate every link before enabling the page's controls.
  manifest.items.forEach(item => assetUrl(item.file, '.wav'));
  assetUrl(manifest.previews.core.file, '.wav');
  assetUrl(manifest.previews.all.file, '.wav');
  const archiveUrl = assetUrl(manifest.archive, '.zip');
  const groups = [ ['core', '核心动作'], ['tool', '工作过程'], ['status', '连接与状态'] ];
  const sections = new Map();
  for (const [id, title] of groups) {
    const section = element('section', 'sound-group');
    const heading = element('h3', 'group-heading', title);
    heading.id = `group-${id}`;
    section.setAttribute('aria-labelledby', heading.id);
    const grid = element('div', 'sound-grid');
    section.append(heading, grid);
    sections.set(id, { section, grid });
  }
  manifest.items.forEach((item, index) => {
    (sections.get(item.group) || sections.get('status')).grid.append(renderCard(item, index));
  });
  for (const { section, grid } of sections.values()) if (grid.children.length) library.append(section);
  register(document.querySelector('#play-core'), manifest.previews.core.file, '核心六段 · 连续试听');
  register(document.querySelector('#play-all'), manifest.previews.all.file, '全部音效 · 连续试听');
  const labels = new Map(manifest.items.map(item => [item.id, item.label]));
  if (Array.isArray(manifest.previews.core.order)) {
    document.querySelector('#core-order').textContent = manifest.previews.core.order.map(entry => { const id = typeof entry === 'string' ? entry : entry.id; return labels.get(id) || id; }).join(' → ');
  }
  const download = document.querySelector('#download-archive');
  download.href = archiveUrl;
  download.hidden = false;
  document.querySelector('#library-summary').textContent = `${manifest.items.length} 个短音效 · 点击试听，也可以单独下载`;
} catch (error) {
  document.querySelector('#library-summary').textContent = '音效清单暂未准备好';
  const errorMessage = document.querySelector('#load-error');
  errorMessage.textContent = `${error.message}。请稍后刷新本页。`;
  errorMessage.hidden = false;
} finally {
  library.setAttribute('aria-busy', 'false');
}
