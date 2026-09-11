const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const views = { taskgraph: '任务图', settings: '设置', overview: '概览', agents: 'Agents', tasks: '任务', evidence: '证据', activity: '动态', baseline: '架构基线', explorer: 'Explorer', terminal: '终端' };
const prefKey = 'agent-platform.layout.v1';
const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));
export function initializeLayout(onChange) {
  const files = new Map(); let fileSequence = 0, scopeKey = '';
  const nameOf = id => views[id] ?? files.get(id)?.path.split('/').at(-1) ?? '文件';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(prefKey) ?? '{}') ?? {}; } catch {}
  let left = Number.isFinite(saved.left) ? saved.left : 228;
  let right = Number.isFinite(saved.right) ? saved.right : 320;
  let opened = Array.isArray(saved.opened) ? [...new Set(saved.opened.filter(v => Object.hasOwn(views, v)))] : ['overview', 'agents', 'tasks'];
  if (!opened.length) opened = ['overview'];
  const fromUrl = new URL(location.href).searchParams.get('panel');
  let active = Object.hasOwn(views, fromUrl ?? '') ? fromUrl : opened.includes(saved.active) ? saved.active : opened[0];
  if (!opened.includes(active)) opened.push(active);
  const el = id => document.getElementById(id);
  function save() { try { localStorage.setItem(prefKey, JSON.stringify({ left, right, opened: opened.filter(id => Object.hasOwn(views,id)), active: Object.hasOwn(views,active) ? active : 'explorer' })); } catch {} }
  function fit() {
    if (innerWidth <= 800) { el('left-resizer').tabIndex = -1; el('right-resizer').tabIndex = -1; return; }
    el('left-resizer').tabIndex = 0; el('right-resizer').tabIndex = 0;
    const hidden = document.body.classList.contains('context-hidden');
    const minCenter = 280;
    const widthLeft = clamp(left, 160, Math.min(380, innerWidth - minCenter - (hidden ? 0 : 260) - 10));
    const widthRight = clamp(right, 260, innerWidth - widthLeft - minCenter - 10);
    document.documentElement.style.setProperty('--sidebar-width', `${widthLeft}px`);
    document.documentElement.style.setProperty('--context-width', `${widthRight}px`);
    const values = [['left', widthLeft, 160, Math.min(380, innerWidth - (hidden ? 0 : widthRight) - minCenter - 10)], ['right', widthRight, 260, innerWidth - widthLeft - minCenter - 10]];
    for (const [side, value, min, max] of values) { const handle = el(`${side}-resizer`); handle.setAttribute('aria-valuenow', String(Math.round(value))); handle.setAttribute('aria-valuemin', String(min)); handle.setAttribute('aria-valuemax', String(Math.round(Math.max(min, max)))); handle.setAttribute('aria-valuetext', `${Math.round(value)} 像素`); }
  }
  function width(side) { return Number(el(`${side}-resizer`).getAttribute('aria-valuenow')); }
  function setWidth(side, value) {
    const handle = el(`${side}-resizer`);
    const result = clamp(value, Number(handle.getAttribute('aria-valuemin')), Number(handle.getAttribute('aria-valuemax')));
    if (side === 'left') left = result; else right = result;
    fit();
  }
  let dragging = null, frame = 0;
  for (const side of ['left', 'right']) {
    const handle = el(`${side}-resizer`);
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || innerWidth <= 800) return;
      event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
      dragging = { side, start: event.clientX, width: width(side), x: event.clientX };
      document.body.classList.add('resizing');
    });
    handle.addEventListener('pointermove', event => {
      if (dragging?.side !== side) return;
      dragging.x = event.clientX;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (dragging) setWidth(side, dragging.width + (dragging.x - dragging.start) * (side === 'left' ? 1 : -1)); });
    });
    function end() { if (dragging?.side !== side) return; if (frame) { cancelAnimationFrame(frame); frame = 0; } setWidth(side, dragging.width + (dragging.x - dragging.start) * (side === 'left' ? 1 : -1)); dragging = null; document.body.classList.remove('resizing'); save(); }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const delta = (event.shiftKey ? 40 : 10) * (event.key === 'ArrowLeft' ? -1 : 1) * (side === 'left' ? 1 : -1);
      setWidth(side, event.key === 'Home' ? Number(handle.getAttribute('aria-valuemin')) : event.key === 'End' ? Number(handle.getAttribute('aria-valuemax')) : width(side) + delta); save();
    });
    handle.addEventListener('dblclick', () => { if (side === 'left') left = 228; else right = 320; fit(); save(); });
  }
  el('reset-layout').onclick = () => { left = 228; right = 320; fit(); save(); };
  addEventListener('resize', fit);
  function closeMenu() { el('add-view-menu').hidden = true; el('add-view').setAttribute('aria-expanded', 'false'); }
  function render() {
    el('right-tabs').innerHTML = opened.map(id => `<div class="dock-tab ${active === id ? 'selected' : ''}"><button id="right-tab-${id}" role="tab" aria-controls="right-panel" aria-selected="${active === id}" tabindex="${active === id ? 0 : -1}" data-right-tab="${id}" title="${esc(files.get(id)?.path ?? nameOf(id))}">${esc(nameOf(id))}</button><button class="close-tab" data-close-view="${id}" aria-label="关闭${esc(nameOf(id))}视图">×</button></div>`).join('');
    for (const section of document.querySelectorAll('[data-right-view]')) section.hidden = !section.dataset.rightView.split(' ').includes(files.has(active) ? 'file' : active);
    el('right-panel').setAttribute('aria-labelledby', `right-tab-${active}`);
    el('context-pane').dataset.view = files.has(active) ? 'file' : active;
    if (files.has(active)) window.dispatchEvent(new CustomEvent('workspace-file-selected',{detail:files.get(active)}));
    el('add-view-menu').innerHTML = Object.entries(views).map(([id, name]) => `<button role="menuitem" data-open-view="${id}"><span>${name}</span><span class="muted">${opened.includes(id) ? '已打开' : '＋'}</span></button>`).join('');
  }
  function select(id) { if (!Object.hasOwn(views, id) && !files.has(id)) return; if (!opened.includes(id)) opened.push(id); active = id; document.body.classList.remove('context-hidden'); if (innerWidth <= 800) document.body.classList.add('context-open'); el('context-toggle').setAttribute('aria-expanded', 'true'); closeMenu(); render(); fit(); save(); onChange(); el(`right-tab-${id}`).focus({ preventScroll: true }); el(`right-tab-${id}`).scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  el('right-tabs').onclick = event => {
    const tab = event.target.closest('[data-right-tab]'), close = event.target.closest('[data-close-view]');
    if (tab) select(tab.dataset.rightTab);
    if (close) { const index = opened.indexOf(close.dataset.closeView); opened = opened.filter(id => id !== close.dataset.closeView); if (!opened.length) opened = ['overview']; if (!opened.includes(active)) active = opened[Math.min(index, opened.length - 1)]; closeMenu(); render(); save(); onChange(); el(`right-tab-${active}`).focus(); }
  };
  el('right-tabs').addEventListener('keydown', event => {
    if (!event.target.matches('[role=tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = opened.indexOf(active); select(event.key === 'Home' ? opened[0] : event.key === 'End' ? opened.at(-1) : opened[(index + (event.key === 'ArrowLeft' ? -1 : 1) + opened.length) % opened.length]);
  });
  el('add-view').onclick = () => { const menu = el('add-view-menu'); menu.hidden = !menu.hidden; el('add-view').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button').focus(); };
  el('add-view-menu').onclick = event => { const item = event.target.closest('[data-open-view]'); if (item) select(item.dataset.openView); };
  el('add-view-menu').addEventListener('keydown', event => {
    const buttons = [...el('add-view-menu').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus(); }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.dock-toolbar')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !el('add-view-menu').hidden) { closeMenu(); el('add-view').focus(); } });
  window.addEventListener('platform-open-view', event => select(event.detail));
  function setScope(next) {
    const key = JSON.stringify([next.projectId,next.workspaceId]); if (key === scopeKey) return;
    scopeKey = key; opened = opened.filter(id => !files.has(id)); files.clear();
    if (!opened.length) opened = ['overview']; if (!opened.includes(active)) active = opened[0];
    render(); fit(); save();
  }
  function openFile(file) {
    if (file.scopeKey !== scopeKey) return;
    const existing = [...files].find(([,value]) => value.path === file.path);
    const id = existing?.[0] ?? `file-${++fileSequence}`;
    files.set(id,file); select(id);
  }
  render(); fit();
  return { activeView: () => active, fit, select, openFile, setScope };
}
