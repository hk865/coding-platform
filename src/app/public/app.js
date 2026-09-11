import { createLiveRunsView } from './live-runs.js';
import { initializeExploration, explorationTaskState, explorationControls } from './exploration-ui.js';
import { readableTitle } from './markdown.js';
import { initializeRealTasks } from './real-tasks.js';
import { initializeModelSettings } from './model-settings.js';
import { initializeWorkspaceTools } from './workspace.js';
import { initializeLayout } from './layout.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  folder: '<path d="M3 7h6l2 2h10v11H3zM3 7V4h6l2 3h10v2"/>',
  message: '<path d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5"/>',
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clipboard: '<path d="M8 5H5v16h14V5h-3M8 3h8v4H8zM8 12h8M8 16h5"/>',
  send: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  agent: '<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 3v3M8 12h1m6 0h1m-7 4h6"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  source: '<path d="M9 15 15 9m-7 4-2 2a3 3 0 0 0 4 4l3-3m-2-8 3-3a3 3 0 0 1 4 4l-2 2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.message}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const phaseLabels = { pending: '待处理', satisfied: '已验证', blocked: '受阻', failed: '验证失败', active: '进行中', completed: '已完成', COMPLETED: '已完成', IN_PROGRESS: '进行中', BLOCKED: '受阻', FAILED: '验收未通过', CANCELLED: '已取消', cancelled: '已取消' };
const runLabels = { starting: '正在启动', ongoing: '运行中', completed_run: '运行已结束', crashed: '执行失败', cancelled: '已取消', budget_exhausted: '预算耗尽', outcome_unknown: '结果未知', ended_no_outcome: '尚无结果' };
const taskNames = { 'task-install-contract': '核对项目契约与治理基线', 'task-accept-plan': '确认计划与验收标准', 'task-verify': '验证运行与恢复流程', 'gate-goal': '目标验收' };
const eventLabels = { goal_created: '目标已创建', plan_accepted: '执行计划已接受', task_claimed: 'Agent 已领取任务', run_started: 'Agent 开始运行', run_event: '运行记录已更新', run_outcome_unknown: '运行结果待确认', evidence_admitted: '收到验证证据', task_reduction: '任务判定已更新', goal_phase: '目标状态已更新', handoff_recorded: '已记录交接材料', replacement_claimed: '替代 Agent 已接手' };
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const time = value => value && !Number.isNaN(Date.parse(value)) ? timeFormat.format(new Date(value)) : '—';
let workspaceTools, projects = [];
let scope, goalId, data, selectedTask, currentTab = 'chat', busy = false, pendingMessage = null, requestRetry = null;
let refreshId = 0, refreshRunning = false, currentSnapshot = '', forceBottom = true;
const layout = initializeLayout(() => { if (scope) syncUrl(); workspaceTools?.viewChanged(layout.activeView()); });
const liveRunsView = createLiveRunsView({ messages: $('messages'), scroller: $('conversation') });
const drafts = new Map();
const lastGoals = new Map();
const scopeKey = () => JSON.stringify([scope?.projectId, scope?.workspaceId, goalId]);
const readyGoals = () => (data?.goals ?? []).filter(v => v.status === 'ready').map(v => v.goal);
const tasks = () => data?.matrix.matrix?.rows ?? [];
const runs = () => data?.agents.agents?.rows ?? [];
const taskName = task => taskNames[task.taskId] ?? readableTitle(task.title, task.taskId);
const realMode = () => data?.executor === 'coding-agent' || !!data?.liveRuns?.length || !!data?.exploration;
const activeRun = run => ['starting', 'ongoing'].includes(run.displayState);
const liveRecord = run => (data?.liveRuns ?? []).find(record=>record.spec.runId===run.runRef?.runId);
const agentState = run => liveRecord(run)?.status==='prepared' ? '排队等待执行' : (runLabels[run.displayState] ?? run.displayState);
const stateLabel = task => phaseLabels[task.livePhase ?? task.plannedPhase] ?? task.livePhase ?? task.plannedPhase;
function params(extra = {}) { return new URLSearchParams({ ...scope, goalId, view: currentTab, panel: layout.activeView(), ...extra }); }
function syncUrl() { history.replaceState(null, '', '?' + params()); }
async function api(path, input) {
  const res = await fetch(path, input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {});
  const body = await res.json(); if (!res.ok) throw Error(body.error ?? '请求失败，请稍后重试'); return body;
}
function friendly(error) {
  if (error.includes('no focus task refs')) return '此次查询没有可用的任务来源。安装计划后可以重新提问。';
  if (error.includes('dependency') || error.includes('not_dispatchable')) return '该任务尚未满足执行条件。请先查看前置任务与验证证据。';
  try { const receipt = JSON.parse(error); return `操作未执行：${receipt.message ?? receipt.code ?? '当前状态不允许此操作'}。`; } catch { return error; }
}
function notice(text) { $('notice').hidden = !text; $('notice').textContent = text; }
function connection(ok) { $('connection').textContent = ok ? '已连接 · 本地工作区' : '连接中断 · 状态可能已过期'; $('connection-dot').classList.toggle('offline', !ok); document.querySelector('.live-label').innerHTML = `<span class="status-dot ${ok ? '' : 'offline'}"></span> ${ok ? '自动同步' : '同步中断'}`; }
async function refresh(force = false) {
  if (!scope || (refreshRunning && !force)) return;
  const id = ++refreshId, key = scopeKey(); refreshRunning = true;
  try {
    const next = await api('/api/state?' + new URLSearchParams({ ...scope, ...(goalId ? { goalId } : {}) }));
    if (id !== refreshId || key !== scopeKey()) return;
    data = next; goalId = data.goalId; lastGoals.set(scope.projectId, goalId); connection(true); syncUrl();
    const snapshot = JSON.stringify(data);
    if (snapshot !== currentSnapshot || force) { currentSnapshot = snapshot; render(); }
  } catch (error) { if (id === refreshId) { connection(false); if (force) notice('读取失败：' + friendly(error.message)); } }
  finally { if (id === refreshId) refreshRunning = false; }
}
function raw(value) { return `<details class="detail-raw"><summary>查看原始记录</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`; }
function render() {
  if (!data) return;
  const goal = readyGoals().find(g => g.goalId === goalId);
  $('objective').textContent = goal?.objective ?? '新建目标，开始项目对话';
  $('objective').title = goal?.objective ?? '';
  $('project-name').textContent = projects.find(p => p.projectId === scope.projectId)?.name ?? scope.projectId;
  $('goals').innerHTML = readyGoals().map(g => `<a href="?${esc(params({ goalId: g.goalId, view: 'chat' }))}" data-goal="${esc(g.goalId)}" ${g.goalId === goalId ? 'class="selected" aria-current="page"' : ''}>${icon('message')}<span>${esc(g.objective)}</span></a>`).join('');
  $('task-count').textContent = String(tasks().length);
  $('install').hidden = !goalId || !!goal?.activePlanRevision;
  $('real-task-open').disabled = !goalId || !!goal?.activePlanRevision;
  $('compose-real-task').disabled = $('real-task-open').disabled;
  document.querySelector('.test-mode').textContent = data.exploration ? '真实只读探索' : realMode() ? '真实 coding-agent' : '本地测试模式';
  document.querySelector('.composer-caption span:last-child').textContent = realMode() ? '真实运行记录 · 验收结果单独显示' : '回答由测试适配器生成';
  $('question').disabled = realMode();
  $('question').placeholder = realMode() ? '当前为任务记录视图，可查看进展或取消运行。' : '询问项目进展，或选择右侧 Agent 查看它的任务…';
  $('send').disabled = realMode();
  renderMessages(); renderStatus(); renderAgents(); renderTasks(); renderActivity(); renderTarget(); renderSideViews(); layout.setScope(scope); workspaceTools?.setScope(scope);
  window.dispatchEvent(new CustomEvent('platform-state', { detail: { data, scope, goalId } }));
}
function sources(answer) {
  if (!answer?.sources?.length) return '';
  return `<details class="sources"><summary class="source-toggle">${icon('source')}${answer.sources.length} 项任务来源${answer.stale ? ' · 已过期' : ''}</summary>${answer.sources.map(s => { let label = s.label ?? s.refKey; try { const ref = JSON.parse(s.refKey); label = taskNames[ref.taskId] ?? ref.taskId ?? label; } catch {} return `<div class="source-row"><strong>${esc(label)}</strong>${esc(s.version)}</div>`; }).join('')}</details>`;
}
function userMessage(text, at) { return `<article class="message user"><div class="message-content"><div class="message-meta"><strong>你</strong><small>${esc(time(at))}</small></div><div class="message-text">${esc(text)}</div></div></article>`; }
function assistantMessage(text, at, answer, status = '测试回答') { return `<article class="message assistant"><span class="avatar">${icon('spark')}</span><div class="message-content"><div class="message-meta"><strong>项目助手</strong><small>${esc(status)}${at ? ' · ' + esc(time(at)) : ''}</small></div><div class="message-text">${esc(text)}</div>${sources(answer)}</div></article>`; }
function renderMessages() {
  if (data.liveRuns?.length) {
    const live=data.exploration ? data.liveRuns.map(run=>{const state=explorationTaskState(data,run.spec.taskId,run.spec.runId);return {...run,taskTitle:state.task?.title,explorationState:state.label,explorationReportAvailable:!!state.report};}) : data.liveRuns;
    liveRunsView.render(live, scopeKey()); forceBottom = false; return;
  }
  liveRunsView.reset();
  if (data.exploration) {
    const key = 'exploration-welcome:' + scopeKey();
    if ($('messages').dataset.welcomeKey !== key) {
      $('messages').innerHTML = '<div class="welcome"><h2>只读探索计划已就绪</h2><p>计划由操作人员配置。请从任务图运行满足依赖条件的节点；每个节点会保留真实模型活动与探索报告。</p><p>后继任务等待前置报告审阅通过。本次探索不运行目标项目。</p><button data-open-dock="taskgraph">打开任务图</button></div>';
      $('messages').dataset.welcomeKey = key;
    }
    return;
  }
  delete $('messages').dataset.welcomeKey;
  const container = $('conversation');
  const nearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 100;
  const oldScroll = container.scrollTop;
  const oldOpen = [...$('messages').querySelectorAll('details[open]')].map(el => el.closest('[data-query]')?.dataset.query);
  const queries = data.queries.filter(q => q.status === 'ready' && q.job.goalId === goalId);
  const hasPlan = tasks().length > 0;
  let html = '';
  if (!queries.length) {
    html = `<div class="welcome"><h2>在这里推进你的项目</h2><p>${hasPlan ? '计划已就绪。你可以询问当前进展，或选中右侧的 Agent，查看它负责的任务与执行记录。' : (goalId ? '目标已保存。先安装样例计划，就能运行任务、查看 Agent 状态，并围绕项目提问。' : '项目文件夹已打开。先新建一个目标；也可以从右侧打开 Explorer 或终端。')}</p><p>当前模型尚未连接，对话会保存，回答使用本地测试适配器。</p><div class="prompt-list">${hasPlan ? '<button data-prompt="当前项目进展如何？">查看项目进展</button><button data-prompt="哪些任务仍然需要验证？">查看待验证任务</button>' : (goalId ? '<button data-install>安装样例计划</button>' : '<button data-new-goal>新建目标</button>')}</div></div>`;
  } else {
    const date = queries[0].job.submittedAt;
    html = `<div class="thread-start">${esc(dateFormat.format(new Date(date)))} · 项目对话</div>`;
    for (const q of queries) {
      const reason = q.job.closeReason?.message;
      html += `<section data-query="${esc(q.job.queryJobId)}">${userMessage(q.job.intent.question, q.job.submittedAt)}${assistantMessage(q.currentAnswer?.answer ?? (reason ? friendly(reason) : '查询已记录，正在等待回答…'), q.currentAnswer?.answeredAt, q.currentAnswer, q.currentAnswer ? (q.currentAnswer.stale ? '来源已过期' : '测试回答') : (reason ? '查询未完成' : '等待回答'))}</section>`;
    }
  }
  if (pendingMessage?.key === scopeKey() && !queries.some(q => q.job.queryJobId === pendingMessage.id)) html += userMessage(pendingMessage.text, pendingMessage.at) + assistantMessage('正在读取当前任务来源…', null, null, '处理中');
  $('messages').innerHTML = html;
  for (const el of $('messages').querySelectorAll('[data-query]')) if (oldOpen.includes(el.dataset.query)) el.querySelector('details')?.setAttribute('open', '');
  if (forceBottom || nearBottom) { container.scrollTop = container.scrollHeight; forceBottom = false; } else container.scrollTop = oldScroll;
}
function renderStatus() {
  const rows = tasks(), verified = rows.filter(t => t.livePhase === 'satisfied').length;
  const formal = data.goalStatus?.status === 'ready' ? data.goalStatus.goal : null;
  const state = formal ? (phaseLabels[formal.phase] ?? formal.phase) : rows.length ? '等待任务验证' : '尚未制定计划';
  const next = rows.find(t => t.livePhase !== 'satisfied');
  $('goal-status').innerHTML = `<div class="goal-state"><span class="status-dot"></span>${esc(state)}</div><div class="progress-label"><span>已验证任务</span><span>${verified} / ${rows.length}</span></div><progress class="progress-track" value="${verified}" max="${rows.length || 1}" aria-label="已验证任务进度"></progress><p class="project-next">${next ? `<strong>下一项</strong><br>${esc(taskName(next))}` : rows.length ? '当前计划的任务均已验证。' : '创建计划后，项目进展会显示在这里。'}</p>${formal ? '' : '<p class="section-description">目标尚无正式完成判定</p>'}`;
}
function agentButton(run, index) {
  const task = tasks().find(t => t.taskId === run.taskId);
  return `<button class="agent ${selectedTask === run.taskId ? 'selected' : ''}" data-agent="${index}" aria-label="查看 Worker ${index + 1} 的状态"><span class="agent-top"><span class="agent-avatar">${icon('agent')}</span><span class="agent-name">Worker ${String(index + 1).padStart(2, '0')}</span><span class="agent-status">${esc(agentState(run))}</span></span><span class="agent-task">${esc(task ? taskName(task) : run.taskId)}</span><span class="agent-bottom"><span>${activeRun(run) ? '当前任务' : '最后运行'} ${esc(time(run.endedAt ?? run.startedAt))}</span><span>查看详情 ›</span></span></button>`;
}
function renderAgents() {
  const all = runs(), live = all.filter(activeRun), past = all.filter(r => !activeRun(r));
  $('agent-count').textContent = String(live.length);
  const executing=live.filter(run=>liveRecord(run)?.status==='running'||(!liveRecord(run)&&run.displayState==='ongoing')).length;
  const waiting=live.length-executing;
  $('agent-summary').textContent = `${executing} 个正在执行${waiting ? `，${waiting} 个等待执行` : ''}${past.length ? `，${past.length} 个已结束` : ''}`;
  $('agents').innerHTML = live.length ? all.map((r, i) => activeRun(r) ? agentButton(r, i) : '').join('') : `<div class="agent-placeholder">${icon('agent')}<div><strong>当前没有运行中的 Agent</strong><p>从任务列表运行可执行任务。</p></div></div>`;
  $('past-agents').hidden = !past.length;
  $('past-count').textContent = `(${past.length})`;
  $('past-agent-list').innerHTML = all.map((r, i) => !activeRun(r) ? agentButton(r, i) : '').join('');
  if (!live.length && past.length) $('past-agents').open = true;
}
function dependencies(taskId) { return (data.graph.graph?.executionDag.dependsOn ?? []).filter(edge => edge.taskId === taskId); }
function renderTasks() {
  const rows = tasks();
  $('tasks').innerHTML = rows.length ? rows.map(t => {
    if (data.exploration) {
      const state=explorationTaskState(data,t.taskId);
      return '<article class="task-row"><span class="task-indicator '+(t.livePhase==='satisfied'?'satisfied':'')+'"></span><div class="task-body"><div class="task-title-row"><h3>'+esc(taskName(t))+'</h3><span class="task-state">'+esc(state.label)+'</span></div><p class="task-description">'+(state.gate?'整体探索审阅':'只读探索节点')+'</p><div class="task-controls">'+explorationControls(data,t.taskId)+'<button data-task-detail="'+esc(t.taskId)+'">任务依据</button></div></div></article>';
    }
    const existing = runs().find(r => r.taskId === t.taskId);
    const edges = dependencies(t.taskId);
    const blocked = edges.filter(edge => rows.find(row => row.taskId === edge.dependsOnId)?.livePhase !== 'satisfied');
    return `<article class="task-row"><span class="task-indicator ${t.livePhase === 'satisfied' ? 'satisfied' : ''}" aria-hidden="true"></span><div class="task-body"><div class="task-title-row"><h3>${esc(taskName(t))}</h3><span class="task-state">${esc(stateLabel(t))}</span></div><p class="task-description">${t.taskKind === 'gate' ? '目标验收门禁' : esc(t.stageTitle ?? '项目任务')}${existing ? ' · ' + esc(runLabels[existing.displayState] ?? existing.displayState) : ''}</p>${edges.length ? `<p class="task-description">依赖：${edges.map(edge => esc(taskName(rows.find(r => r.taskId === edge.dependsOnId) ?? { taskId: edge.dependsOnId, title: edge.dependsOnId }))).join('、')}</p>` : ''}<div class="task-controls">${t.taskKind === 'work' ? `<button data-run="${esc(t.taskId)}" ${existing || blocked.length || busy ? 'disabled' : ''}>${existing ? '已运行' : blocked.length ? '等待前置验证' : '运行样例任务'}</button>` : ''}${realMode() ? '' : `<button data-focus="${esc(t.taskId)}">询问此任务</button>`}<button data-task-detail="${esc(t.taskId)}">详情</button></div></div></article>`;
  }).join('') : '<div class="empty-note">还没有执行计划。安装样例计划后，可以在这里查看和运行任务。</div>';
  const evidence = data.evidence.filter(v => v.status === 'ready');
  const entries = evidence.flatMap(v => v.evidence.evidence);
  $('evidence-count').textContent = `${entries.length} 项已登记`;
  $('evidence').innerHTML = entries.length ? evidence.map(v => `<article class="evidence-entry"><h3>${esc(taskNames[v.evidence.taskId] ?? v.evidence.taskId)}</h3><p>${v.evidence.evidence.length} 项证据 · ${v.evidence.reduction ? esc(phaseLabels[v.evidence.reduction.phase] ?? v.evidence.reduction.phase) : '尚无正式判定'}</p>${raw(v.evidence)}</article>`).join('') : '<div class="empty-note">尚无验证证据。Agent 结束运行后，仍需验证工作结果。</div>';
}
function renderActivity() {
  const entries = data.timeline.timeline?.entries ?? [];
  $('timeline').innerHTML = entries.slice(-5).reverse().map(e => `<div class="event"><strong>${esc(eventLabels[e.kind] ?? e.summary)}</strong><small>${esc(time(e.occurredAt))}${e.refs.taskId ? ' · ' + esc(taskNames[e.refs.taskId] ?? e.refs.taskId) : ''}</small></div>`).join('') || '<p class="empty-note">暂无项目动态</p>';
}

function renderSideViews() {
  const rows = tasks();
  $('side-tasks').innerHTML = rows.length ? rows.map(task => `<article class="side-task"><div class="section-head"><h3>${esc(taskName(task))}</h3><span class="task-state">${esc(stateLabel(task))}</span></div><p>${task.taskKind === 'gate' ? '目标验收门禁' : esc(task.stageTitle ?? '项目工作')}</p><button data-task-detail="${esc(task.taskId)}">查看依赖与详情</button>${realMode() ? '' : `<button data-focus="${esc(task.taskId)}">询问</button>`}</article>`).join('') : `<div class="empty-note">${goalId ? '尚未安装计划，当前没有可执行任务。' : '先新建目标，再制定项目计划。'}</div>${goalId ? '<button data-install>安装样例计划</button>' : '<button data-new-goal>新建目标</button>'}`;
  const views = data.evidence.filter(v => v.status === 'ready');
  const entries = views.flatMap(v => v.evidence.evidence);
  $('side-evidence').innerHTML = entries.length ? views.map(v => `<article class="side-task"><h3>${esc(taskNames[v.evidence.taskId] ?? v.evidence.taskId)}</h3><p>${v.evidence.evidence.length} 项证据 · ${v.evidence.reduction ? esc(phaseLabels[v.evidence.reduction.phase] ?? v.evidence.reduction.phase) : '尚无正式判定'}</p><button data-task-detail="${esc(v.evidence.taskId)}">查看证据与来源</button></article>`).join('') : '<div class="empty-note">暂无验证证据。<br>运行结束不代表任务已经通过验收。</div>';
  const graph = data.graph.status === 'ready' ? data.graph.graph : null;
  $('side-baseline').innerHTML = graph ? `<dl class="baseline-facts"><dt>当前计划</dt><dd>${esc(graph.planRef.planId)}</dd><dt>计划版本</dt><dd>${esc(graph.planRevision)}</dd><dt>接受时间</dt><dd>${esc(time(graph.acceptedAt))}</dd><dt>完成策略</dt><dd>${esc(graph.pinnedCompletionPolicy.ref.policyId)}<small>版本 ${esc(graph.pinnedCompletionPolicy.ref.revision)}</small></dd><dt>架构基线</dt><dd>${esc(graph.pinnedArchitectureBaseline.ref.baselineId)}<small>版本 ${esc(graph.pinnedArchitectureBaseline.ref.revision)}</small></dd></dl><p class="empty-note">当前计划固定使用这些版本。运行成功不会自动变更架构基线。</p>${raw({ completionPolicy: graph.pinnedCompletionPolicy, architectureBaseline: graph.pinnedArchitectureBaseline, sourceCursor: graph.sourceCursor })}` : '<div class="empty-note">目标尚无计划；接受计划后显示它绑定的完成策略与架构基线。</div>';
}

function renderTarget() {
  if (realMode()) {
    $('chat-target').hidden = true;
    $('question').disabled = true;
    $('question').placeholder = '当前为真实任务记录；可查看进展、验收结果或取消正在执行的运行。';
    $('send').disabled = true;
    $('composer-help').textContent = '真实运行记录 · 输入不会发送至当前 Agent';
    return;
  }
  $('question').disabled = false;
  const task = tasks().find(t => t.taskId === selectedTask);
  $('chat-target').hidden = !task;
  $('chat-target').innerHTML = task ? `${icon('agent')} 关于：${esc(taskName(task))}<button id="clear-target" aria-label="取消任务范围">×</button>` : '';
  $('question').placeholder = task ? `询问“${taskName(task)}”的情况…` : '询问项目进展，或选择右侧 Agent 查看它的任务…';
  $('send').disabled = busy || !tasks().length;
  $('composer-help').textContent = tasks().length ? 'Enter 发送 · Shift + Enter 换行' : '安装计划后可以围绕任务提问';
}
function tab(name) {
  currentTab = name === 'project' ? 'project' : 'chat';
  for (const b of document.querySelectorAll('[data-tab]')) { const active = b.dataset.tab === currentTab; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; }
  $('chat-view').hidden = currentTab !== 'chat'; $('project-view').hidden = currentTab !== 'project';
  if (scope && goalId) syncUrl();
}
async function changeScope(nextScope, nextGoal) {
  drafts.set(scopeKey(), $('question').value);
  window.dispatchEvent(new CustomEvent('platform-scope-changing'));
  scope = nextScope; goalId = nextGoal ?? lastGoals.get(nextScope.projectId); selectedTask = undefined; data = null; currentSnapshot = ''; forceBottom = true;
  $('question').value = drafts.get(scopeKey()) ?? '';
  $('messages').innerHTML = '<div class="empty-note">正在加载项目对话…</div>';
  for (const id of ['agents', 'past-agent-list', 'goal-status', 'timeline', 'tasks', 'evidence', 'goals']) $(id).replaceChildren();
  $('objective').textContent = '正在加载项目…'; $('send').disabled = true;
  document.body.classList.remove('sidebar-open'); $('sidebar-toggle').setAttribute('aria-expanded', 'false');
  layout.setScope(scope); workspaceTools?.setScope(scope); notice(''); tab('chat'); await refresh(true);
}
async function action(path, input = {}) {
  if (busy || !data) return;
  busy = true; const key = scopeKey(), captured = { ...scope, goalId }; renderTarget(); renderTasks(); notice('');
  try {
    const result = await api(path, { ...captured, ...input });
    if (key === scopeKey()) {
      if (result.drive?.failures?.length) notice('操作已记录，但部分执行失败：' + result.drive.failures.map(f => f.message ?? f.code).join('；'));
      await refresh(true);
    }
    return result;
  } catch (error) { if (key === scopeKey()) notice(friendly(error.message)); throw error; }
  finally { busy = false; if (data) { renderTarget(); renderTasks(); } }
}
async function sendMessage(event) {
  event.preventDefault(); if (realMode() || busy || !tasks().length || !$('question').value.trim()) return;
  const text = $('question').value.trim(), key = scopeKey(), fingerprint = JSON.stringify([key, text, selectedTask]);
  const id = requestRetry?.fingerprint === fingerprint ? requestRetry.id : crypto.randomUUID(); requestRetry = { fingerprint, id };
  pendingMessage = { key, id, text, at: new Date().toISOString() }; forceBottom = true; renderMessages();
  try {
    await action('/api/queries', { requestId: id, question: text, ...(selectedTask ? { focusTaskId: selectedTask } : {}) });
    if (key === scopeKey() && $('question').value.trim() === text) $('question').value = '';
    drafts.delete(key); requestRetry = null;
  } catch {} finally { pendingMessage = null; if (data) renderMessages(); }
}
window.addEventListener('platform-show-run',event=>{
  const runId=event.detail, run=(data?.liveRuns ?? []).find(run=>run.spec?.runId===runId);
  if(!run)return;
  tab('chat');
  const node=[...$('messages').querySelectorAll('[data-run-id]')].find(node=>node.dataset.runId===runId);
  if(node) { node.tabIndex=-1; node.scrollIntoView({block:'start'}); node.focus({preventScroll:true}); }
});
function focusTask(taskId) { if (realMode()) return; selectedTask = taskId; tab('chat'); renderTarget(); $('question').focus(); if (matchMedia('(max-width:800px)').matches) document.body.classList.remove('context-open'); }
function agentDetails(index) {
  const run = runs()[index]; if (!run) return;
  const task = tasks().find(t => t.taskId === run.taskId);
  $('detail-title').textContent = `Worker ${String(index + 1).padStart(2, '0')}`;
  $('detail-body').innerHTML = `<dl class="detail-facts"><dt>当前状态</dt><dd>${esc(agentState(run))}</dd><dt>负责的任务</dt><dd>${esc(task ? taskName(task) : run.taskId)}</dd><dt>开始时间</dt><dd>${esc(time(run.startedAt))}</dd><dt>结束时间</dt><dd>${esc(time(run.endedAt))}</dd><dt>角色配置</dt><dd>${esc(run.binding.templateId)}</dd><dt>任务判定</dt><dd>${task ? esc(stateLabel(task)) : '暂无判定'}</dd></dl>${realMode() ? '' : `<button class="primary inline-action" data-focus="${esc(run.taskId)}">围绕此任务提问</button>`}${raw(run)}`;
  $('detail-dialog').showModal();
}
$('query-form').addEventListener('submit', sendMessage);
$('question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!$('send').disabled) $('query-form').requestSubmit(); } });
$('project').addEventListener('change', () => { void changeScope({ projectId: $('project').value, workspaceId: 'workspace-main' }, undefined); });
$('goals').addEventListener('click', event => { const link = event.target.closest('[data-goal]'); if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); void changeScope(scope, link.dataset.goal); } });
$('refresh').onclick = () => { void refresh(true); };
$('new-goal').onclick = () => { $('goal-error').hidden = true; $('goal-dialog').showModal(); };
$('install').onclick = () => { void action('/api/plans/sample').catch(() => {}); };
$('goal-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  const text = $('new-objective').value.trim(); if (!text) return;
  const button = $('goal-form').querySelector('[type=submit]'); button.disabled = true;
  const targetScope = { ...scope };
  try { const result = await action('/api/goals', { requestId: crypto.randomUUID(), objective: text }); if (result) { $('goal-dialog').close(); $('new-objective').value = ''; await changeScope(targetScope, result.goalId); } }
  catch (error) { $('goal-error').hidden = false; $('goal-error').textContent = friendly(error.message); $('new-objective').focus(); }
  finally { button.disabled = false; }
};
$('acceptance-open').onclick = () => $('acceptance-dialog').showModal();
$('sidebar-toggle').onclick = () => { const open = document.body.classList.toggle('sidebar-open'); $('sidebar-toggle').setAttribute('aria-expanded', String(open)); };
$('context-toggle').onclick = () => { if (matchMedia('(max-width:800px)').matches) { const open = document.body.classList.toggle('context-open'); $('context-toggle').setAttribute('aria-expanded', String(open)); } else { const closed = document.body.classList.toggle('context-hidden'); $('context-toggle').setAttribute('aria-expanded', String(!closed)); } layout.fit(); };
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.close) $(button.dataset.close).close();
  if (button.dataset.tab) tab(button.dataset.tab);
  if (button.dataset.newGoal !== undefined) $('new-goal').click();
  if (button.dataset.install !== undefined) void action('/api/plans/sample').catch(() => {});
  if (button.dataset.prompt) { $('question').value = button.dataset.prompt; $('question').focus(); }
  if (button.dataset.run) void action('/api/tasks/run', { taskId: button.dataset.run }).catch(() => {});
  if (button.dataset.agent !== undefined) agentDetails(Number(button.dataset.agent));
  if (button.dataset.focus) { $('detail-dialog').close(); focusTask(button.dataset.focus); }
  if (button.id === 'clear-target') { selectedTask = undefined; renderTarget(); $('question').focus(); }
  if (button.dataset.taskDetail) { const task = tasks().find(t => t.taskId === button.dataset.taskDetail); $('detail-title').textContent = taskName(task); $('detail-body').innerHTML = `<p>${esc(task.title)}</p><p>当前判定：${esc(stateLabel(task))}</p>${raw({ task, dependencies: dependencies(task.taskId), evidence: data.evidence.filter(e => e.evidence?.taskId === task.taskId) })}`; $('detail-dialog').showModal(); }
});
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); tab(event.key === 'Home' ? 'chat' : event.key === 'End' ? 'project' : currentTab === 'chat' ? 'project' : 'chat'); $(`${currentTab}-tab`).focus(); } }));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.body.classList.remove('sidebar-open', 'context-open'); $('sidebar-toggle').setAttribute('aria-expanded', 'false'); } });
(async () => {
  try {
    const meta = await api('/api/meta'), url = new URL(location.href);
    initializeModelSettings(meta.workspaceToken);
    initializeRealTasks({ token: meta.workspaceToken, current: () => ({ ...scope, goalId, objective: readyGoals().find(g => g.goalId === goalId)?.objective, root: projects.find(p => p.projectId === scope?.projectId)?.root }), refresh: () => refresh(true) });
    initializeExploration({ token: meta.workspaceToken, meta, current: () => ({ ...scope, goalId, root: projects.find(p => p.projectId === scope?.projectId)?.root }), refresh: () => refresh(true) });
    projects = meta.scopes;
    const chosen = projects.find(s => s.projectId === url.searchParams.get('projectId')) ?? projects[0];
    scope = { projectId: chosen.projectId, workspaceId: chosen.workspaceId };
    goalId = url.searchParams.get('goalId') ?? undefined;
    $('project').innerHTML = meta.scopes.map(s => `<option value="${esc(s.projectId)}">${esc(s.name ?? s.projectId)}</option>`).join(''); $('project').value = scope.projectId;
    workspaceTools = initializeWorkspaceTools({ token: meta.workspaceToken, getScope: () => scope, getView: () => layout.activeView(), openFile: file => layout.openFile(file), activate: view => layout.select(view), onProjectAdded: async project => { const updated = await api('/api/meta'); projects = updated.scopes; $('project').innerHTML = projects.map(p => `<option value="${esc(p.projectId)}">${esc(p.name)}</option>`).join(''); $('project').value = project.projectId; await changeScope({ projectId: project.projectId, workspaceId: project.workspaceId }, ''); layout.select('explorer'); } });
    tab(url.searchParams.get('view')); await refresh(true);
    setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 2500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(true); });
  } catch (error) { connection(false); notice('连接失败：' + friendly(error.message)); }
})();
