const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initializeWorkspaceTools(options) {
  let scope, key = '', generation = 0, currentFolder = '', directoryCache = new Map(), expanded = new Set(['']), root = '';
  let terminal, fitAddon, sessionId = '', after = 0, terminalGeneration = 0, polling = false, inputQueue = Promise.resolve(), terminalLoading = false;
  const selectedSessions = new Map();
  let activePreview = null;
  const readingPositions = new Map();
  async function request(path, input = {}, write = false, captured = scope) {
    const payload = {...captured,...input};
    const response = await fetch(write ? path : path + '?' + new URLSearchParams(payload), { method: write ? 'POST' : 'GET', headers: { 'x-platform-token': options.token, ...(write ? {'content-type':'application/json'} : {}) }, ...(write ? {body:JSON.stringify(payload)} : {}) });
    const body = await response.json(); if (!response.ok) throw Error(body.error ?? '操作失败'); return body;
  }
  function fileError(message) { $('files-error').hidden = !message; $('files-error').textContent = message; }
  function terminalStatus(message) { $('terminal-status').textContent = message; }
  function tree(path = '') {
    const listing = directoryCache.get(path); if (!listing) return '<p class="empty-note">正在读取…</p>';
    return `<ul class="file-list">${listing.entries.map(entry => `<li><button class="file-row ${(entry.kind === 'directory' || directoryCache.has(entry.path)) ? 'directory' : ''}" data-path="${esc(entry.path)}" data-kind="${directoryCache.has(entry.path) ? 'directory' : entry.kind}" ${(entry.kind === 'directory' || directoryCache.has(entry.path)) ? `aria-expanded="${expanded.has(entry.path)}"` : ''}><span class="file-chevron">${(entry.kind === 'directory' || directoryCache.has(entry.path)) ? (expanded.has(entry.path) ? '⌄' : '›') : ''}</span><span class="file-symbol" aria-hidden="true">${(entry.kind === 'directory' || directoryCache.has(entry.path)) ? '▱' : entry.kind === 'link' ? '↗' : '▤'}</span><span class="file-name">${esc(entry.name)}</span></button>${(entry.kind === 'directory' || directoryCache.has(entry.path)) && expanded.has(entry.path) ? tree(entry.path) : ''}</li>`).join('')}</ul>${listing.truncated ? '<p class="empty-note">目录较大，仅显示前 500 项。</p>' : ''}${listing.entries.length ? '' : '<p class="empty-note">此文件夹为空。</p>'}`;
  }
  function renderTree() { $('file-tree').innerHTML = tree(); $('current-folder').textContent = currentFolder || '项目根目录'; $('current-folder').title = currentFolder || root; }
  async function loadDirectory(path, refresh = false) {
    const version = generation; fileError('');
    try { if (refresh || !directoryCache.has(path)) { const value = await request('/api/files',{path}); if (version !== generation) return; root = value.root; directoryCache.set(path,value); } renderTree(); }
    catch(error) { if (version === generation) fileError(error.message); }
  }
  async function preview(path) {
    const version = generation; fileError('');
    try { const file = await request('/api/files/preview',{path}); if (version !== generation) return;
      if (file.kind === 'directory') { currentFolder = file.path; expanded.add(file.path); await loadDirectory(file.path); return; }
      options.openFile({...file,scopeKey:key,projectId:scope.projectId,workspaceId:scope.workspaceId});
    } catch(error) { if (version === generation) fileError(error.message); }
  }
  window.addEventListener('workspace-file-selected', event => {
    const file = event.detail; if (file.scopeKey !== key) return;
    if (activePreview) readingPositions.set(activePreview.scopeKey+'|'+activePreview.path,{top:$('file-content').scrollTop,left:$('file-content').scrollLeft});
    activePreview = file;
    $('file-title').textContent = file.path;
    $('file-info').textContent = file.kind === 'text' ? `${file.size} 字节 · 只读预览` : file.kind === 'too_large' ? '文件超过 256 KB，请在终端中查看。' : '二进制文件，无法显示文本预览。';
    $('file-content').textContent = file.content ?? '';
    const position=readingPositions.get(file.scopeKey+'|'+file.path);
    $('file-content').scrollTop=position?.top??0; $('file-content').scrollLeft=position?.left??0;
    $('file-add-reference').disabled = file.kind !== 'text' || !file.sha256;
  });
  $('file-add-reference').onclick = () => {
    if (!activePreview || activePreview.scopeKey !== key || activePreview.kind !== 'text') return;
    window.dispatchEvent(new CustomEvent('platform-add-file-reference',{detail:{projectId:scope.projectId,workspaceId:scope.workspaceId,path:activePreview.path,sha256:activePreview.sha256}}));
  };
  async function metadata() { const version = generation; try { const data = await request('/api/workspace'); if (version !== generation) return; root = data.root; $('workspace-path').textContent = root; $('terminal-root').textContent = `启动目录：${root}`; } catch(error) { if (version === generation) { fileError(error.message); terminalStatus(error.message); } } }
  function initTerminal() {
    if (terminal) return;
    if (!window.Terminal || !window.FitAddon) throw Error('终端组件尚未加载，请刷新页面');
    $('terminal-screen').replaceChildren();
    terminal = new window.Terminal({cursorBlink:true,fontFamily:'Consolas, "Cascadia Mono", monospace',fontSize:13,scrollback:3000,theme:{background:'#172538',foreground:'#d5e1f0',cursor:'#77b2fc',selectionBackground:'#416494'},allowProposedApi:false});
    fitAddon = new window.FitAddon.FitAddon(); terminal.loadAddon(fitAddon);
    // xterm creates its own dimension/theme/scrollbar styles synchronously in open.
    // Authorize those elements only, keeping arbitrary inline styles blocked by CSP.
    const createElement = document.createElement, nonce = document.querySelector('meta[name=terminal-style-nonce]').content;
    document.createElement = function(name, ...args) { const element = createElement.call(this, name, ...args); if (name.toLowerCase() === 'style') element.nonce = nonce; return element; };
    try { terminal.open($('terminal-screen')); } finally { document.createElement = createElement; }
    terminal.textarea?.setAttribute('aria-label','终端输入');
    terminal.onData(data => { if (!sessionId) return; sendInput(data); });
    const observer = new ResizeObserver(() => { if (options.getView() === 'terminal') fit(); }); observer.observe($('terminal-screen'));
  }
  let resizeTimer;
  function fit() { if (!terminal || $('terminal-screen').clientWidth < 40 || $('terminal-screen').clientHeight < 40) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fitAddon.fit(); if (sessionId) void request('/api/terminals/resize',{sessionId,cols:Math.max(10,terminal.cols),rows:Math.max(2,terminal.rows)},true).catch(()=>{}); },80); }
  function sendInput(data) {
    const target = {...scope}, id = sessionId;
    for (let start = 0; start < data.length; start += 4096) { const fragment = data.slice(start,start+4096), requestId = crypto.randomUUID(); inputQueue = inputQueue.then(() => request('/api/terminals/input',{sessionId:id,data:fragment,requestId},true,target)).catch(error => terminalStatus('输入未确认：'+error.message)); }
  }
  async function chooseSession(id) {
    $('terminal-interrupt').disabled = !id; $('terminal-close').disabled = !id;
    if (sessionId === id) return;
    sessionId = id; selectedSessions.set(key,id); after = 0; terminalGeneration++; polling = false;
    if (id) { initTerminal(); terminal.reset(); await poll(); fit(); } else { terminal?.reset(); }
  }
  async function listSessions() {
    const version = generation; const result = await request('/api/terminals'); if (version !== generation) return;
    $('terminal-session').innerHTML = result.sessions.length ? result.sessions.map((s,i)=>`<option value="${s.id}">Bash ${i+1}${s.status === 'exited' ? ' · 已退出' : ''}</option>`).join('') : '<option value="">无终端会话</option>';
    const desired = selectedSessions.get(key), chosen = result.sessions.find(s=>s.id===desired) ?? result.sessions.at(-1);
    $('terminal-session').value = chosen?.id ?? ''; await chooseSession(chosen?.id ?? '');
  }
  async function poll() {
    if (!sessionId || polling || !scope) return;
    const version = terminalGeneration, id = sessionId, captured = {...scope}; polling = true;
    try { const output = await request('/api/terminals/output',{sessionId:id,after},false,captured); if (version !== terminalGeneration || id !== sessionId) return;
      if (output.truncated) { terminal.reset(); terminal.write('\r\n[仅保留最近的终端输出]\r\n'); }
      for (const chunk of output.chunks) {
        if (version !== terminalGeneration || id !== sessionId) return;
        if (chunk.cols && chunk.rows && (terminal.cols !== chunk.cols || terminal.rows !== chunk.rows)) terminal.resize(chunk.cols, chunk.rows);
        if (chunk.data) await new Promise(resolve => terminal.write(chunk.data, resolve));
      }
      if (version !== terminalGeneration || id !== sessionId) return;
      after = output.through;
      $('terminal-root').textContent = `会话启动目录：${output.cwd}`;
      terminalStatus(output.status === 'exited' ? `会话已退出，退出码 ${output.exitCode}。可以新建终端。` : '受限 Bash · 项目内读写 · 网络关闭');
      $('terminal-interrupt').disabled = output.status !== 'running'; $('terminal-close').disabled = output.status !== 'running';
    } catch(error) { if (version === terminalGeneration) terminalStatus(error.message); }
    finally { if (version === terminalGeneration) polling = false; }
  }
  async function createTerminal(path = '') {
    if (terminalLoading) return; terminalLoading = true; const version = generation; $('terminal-new').disabled = true;
    try { options.activate('terminal'); initTerminal(); fitAddon.fit(); const created = await request('/api/terminals/create',{path,requestId:crypto.randomUUID(),cols:Math.max(10,terminal.cols),rows:Math.max(2,terminal.rows)},true); if (version !== generation) return; selectedSessions.set(key,created.id); await listSessions(); terminal.focus(); }
    catch(error) { if (version === generation) terminalStatus(error.message); }
    finally { terminalLoading = false; $('terminal-new').disabled = false; }
  }
  function setScope(next) {
    const nextKey = JSON.stringify([next.projectId,next.workspaceId]); if (nextKey === key) return;
    scope = {...next}; key = nextKey; activePreview = null; $('file-content').textContent = ''; $('file-add-reference').disabled = true; generation++; terminalGeneration++; sessionId = ''; after = 0; polling = false; currentFolder = ''; root = ''; directoryCache = new Map(); expanded = new Set(['']);
    $('file-tree').replaceChildren(); $('workspace-path').textContent = '正在读取项目目录…'; $('terminal-session').innerHTML = ''; terminal?.reset(); $('terminal-interrupt').disabled = true; $('terminal-close').disabled = true; terminalStatus('项目内读写 · 系统工具只读 · 网络关闭'); fileError('');
    void metadata(); viewChanged(options.getView());
  }
  function viewChanged(view) { if (!scope) return; if (view === 'explorer') void loadDirectory(''); if (view === 'terminal') { void listSessions().catch(error=>terminalStatus(error.message)); setTimeout(fit,0); } }
  $('files-refresh').onclick = () => { directoryCache.clear(); expanded = new Set(['']); currentFolder = ''; void loadDirectory('',true); };
  $('file-tree').onclick = async event => { const row = event.target.closest('[data-path]'); if (!row) return; if (row.dataset.kind === 'directory') { currentFolder = row.dataset.path; if (expanded.has(currentFolder)) { expanded.delete(currentFolder); renderTree(); } else { expanded.add(currentFolder); await loadDirectory(currentFolder); } } else await preview(row.dataset.path); };
  $('folder-terminal').onclick = () => { void createTerminal(currentFolder); };
  $('terminal-new').onclick = () => { void createTerminal(); };
  $('terminal-interrupt').onclick = () => sendInput('\x03');
  $('terminal-session').onchange = () => { void chooseSession($('terminal-session').value); };
  $('terminal-close').onclick = async () => { try { await request('/api/terminals/close',{sessionId},true); await poll(); } catch(error) { terminalStatus(error.message); } };
  $('new-folder').onclick = () => { $('folder-parent').textContent = '创建位置：'+(currentFolder || root); $('folder-error').hidden = true; $('folder-dialog').showModal(); };
  $('folder-form').onsubmit = async event => { event.preventDefault(); const button = event.currentTarget.querySelector('[type=submit]');button.disabled=true;const version=generation;try{await request('/api/files/mkdir',{path:currentFolder,name:$('folder-name').value},true);$('folder-dialog').close();$('folder-name').value='';if(version===generation){expanded.add(currentFolder);await loadDirectory(currentFolder,true);}}catch(error){$('folder-error').hidden=false;$('folder-error').textContent=error.message;}finally{button.disabled=false;} };
  $('add-project').onclick = () => { $('project-folder-error').hidden = true; $('project-dialog').showModal(); };
  $('project-folder-form').onsubmit = async event => { event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;try{const project=await request('/api/projects/add',{path:$('project-folder-path').value},true);$('project-dialog').close();await options.onProjectAdded(project);}catch(error){$('project-folder-error').hidden=false;$('project-folder-error').textContent=error.message;}finally{button.disabled=false;} };
  setInterval(()=>{if(!document.hidden&&options.getView()==='terminal')void poll();},250);
  return {setScope,viewChanged};
}
