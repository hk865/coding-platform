import { renderMarkdown, readableTitle } from './markdown.js';

const labels = { prepared: '等待启动', running: '正在执行', completed: '运行已结束', failed: '执行失败', cancelled: '运行已取消', budget_exhausted: '运行达到限制', outcome_unknown: '运行结果未知' };
const number = value => Number(value).toLocaleString('zh-CN');
const at = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const element = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const setText = (node, value) => { const text = String(value ?? ''); if (node.textContent !== text) node.textContent = text; };
const json = value => JSON.stringify(value, null, 2);
const active = run => ['prepared', 'running'].includes(run.status);

export function summarizeUsage(usage = []) {
  const total = { input: 0, output: 0, cached: 0, requests: usage.length, unknown: 0 };
  for (const entry of usage) {
    if (entry.status !== 'reported' || !Number.isFinite(entry.inputTokens) || !Number.isFinite(entry.outputTokens)) total.unknown++;
    if (Number.isFinite(entry.inputTokens)) total.input += entry.inputTokens;
    if (Number.isFinite(entry.outputTokens)) total.output += entry.outputTokens;
    if (Number.isFinite(entry.cachedInputTokens)) total.cached += entry.cachedInputTokens;
  }
  return total;
}
const command = call => {
  const args = call?.arguments ?? {};
  return String(args.command ?? args.path ?? args.pattern ?? call?.name ?? '工具调用');
};
const toolNames = { shell: '执行命令', read: '读取文件', edit: '修改文件', write: '写入文件', search: '搜索', glob: '查找文件' };
function currentAction(run) {
  if (!active(run)) return run.status === 'completed' ? (run.spec?.mode === 'review' ? '独立审阅运行结束；报告资格与正式证据请在工作台核对。' : run.spec?.mode === 'explore' ? '只读探索结束；报告审阅独立记录，本次未运行项目测试。' : '编码运行结束，查看独立验收结果。') : (run.error || labels[run.status] || run.status);
  const trace = run.trace ?? [], last = trace.at(-1);
  const open = new Map();
  for (const event of trace) {
    if (event.type === 'tool.started') open.set(event.data?.call?.callId, event.data?.call);
    else if (/^tool\.(completed|failed|outcome_unknown)$/.test(event.type)) open.delete(event.data?.callId);
  }
  const call = [...open.values()].at(-1);
  if (call) return (toolNames[call.name] ?? call.name ?? '执行工具') + ' · ' + command(call).slice(0, 160);
  if (last?.type === 'model.request_started') return '模型正在分析下一步';
  if (last?.type === 'model.request_failed') return '本次模型请求失败，等待运行状态确认';
  return run.status === 'prepared' ? (run.spec?.mode === 'explore' ? '节点已登记，排队等待执行；尚未发起模型调用' : '等待绑定模型并启动') : '处理运行记录，等待下一步';
}
function createTool(event) {
  const root = element('details', 'live-tool'), summary = element('summary');
  const name = element('span', 'live-tool-name'), state = element('span', 'live-tool-state');
  const cmd = element('span', 'live-tool-command'), args = element('pre'), output = element('pre');
  const note = element('p', 'live-tool-note', '此处记录工具执行结果；测试是否通过，以测试报告和独立验收为准。');
  const stamp = element('small', 'live-event-meta', at(event.at));
  summary.append(name, state, cmd); root.append(summary, stamp, args, output, note);
  return { root, name, state, cmd, args, output, stamp };
}
function updateTool(view, event, call) {
  const status = event.type.slice(5);
  const states = { started: '执行中', completed: '执行已结束', failed: '执行失败', outcome_unknown: '结果未知' };
  const failed = event.data?.result?.status === 'error';
  view.root.dataset.toolState = failed ? 'failed' : status;
  setText(view.name, toolNames[call?.name] ?? call?.name ?? '工具调用');
  const result = event.data?.result;
  const metadata = result?.output?.find(item => item.kind === 'json' && item.value?.exitCode !== undefined)?.value;
  setText(view.state, (failed ? '执行返回错误' : states[status] ?? status) + (metadata ? ' · 退出码 ' + metadata.exitCode : ''));
  setText(view.cmd, command(call));
  setText(view.args, call?.arguments ? json(call.arguments) : '');
  setText(view.output, (result?.output ?? []).map(item => item.kind === 'text' ? item.text : json(item.value ?? item)).join('\n\n') || (event.data?.error ? json(event.data.error) : ''));
  view.output.hidden = !view.output.textContent;
}
function createRun(run) {
  const root = element('section', 'real-run'); root.dataset.runId = run.spec.runId;
  const header = element('header', 'live-run-summary'), heading = element('div', 'live-run-heading');
  const title = element('h2'), state = element('span', 'live-run-state');
  state.setAttribute('role', 'status'); heading.append(title, state);
  const current = element('p', 'live-run-current'), usage = element('p', 'live-run-usage'), context = element('p', 'live-run-usage');
  const verdict = element('p', 'live-run-verdict'), error = element('p', 'live-run-error');
  header.append(heading, current, usage, context, verdict);
  const instruction = element('details', 'live-instruction'), instructionSummary = element('summary', '', '查看完整任务要求');
  const instructionBody = element('div', 'markdown-body'); instructionBody.innerHTML = renderMarkdown(run.spec.instruction);
  instruction.append(instructionSummary, instructionBody);
  const actions = element('div', 'live-run-actions');
  const cancel = element('button', '', '取消此运行'); cancel.dataset.cancelReal = run.spec.runId;
  const importButton = element('button', '', '导入独立验收'); importButton.dataset.importVerification = run.spec.runId;
  const checkButton = element('button', '', '运行独立检查'); checkButton.dataset.runCommandCheck = run.spec.runId;
  const reportButton=element('button','','查看探索报告'); reportButton.dataset.exploreReport=run.spec.taskId; reportButton.dataset.exploreReportRun=run.spec.runId;
  actions.append(cancel, checkButton, importButton, reportButton);
  const commandChecks = element('details', 'live-verifications'); commandChecks.append(element('summary', '', '命令检查记录'), element('pre'), element('div'));
  const verifications = element('details', 'live-verifications'), verificationSummary = element('summary', '', '独立验收记录');
  const verificationList = element('div'); verifications.append(verificationSummary, verificationList);
  const events = element('div', 'live-event-list');
  const empty = element('p', 'live-run-empty', '真实助手消息和工具活动会在这里持续追加。');
  const basis = element('details', 'live-run-basis'); basis.append(element('summary', '', '查看运行依据'));
  const basisBody = element('pre'); basis.append(basisBody);
  root.append(header, error, actions, commandChecks, verifications, instruction, empty, events, basis);
  return { root, title, state, current, usage, context, verdict, error, cancel, checkButton, commandChecks, checkReportButtons: new Map(), importButton, reportButton, verifications, verificationSummary, verificationList, verificationEntries: new Map(), events, empty, basisBody, eventViews: new Map(), tools: new Map(), calls: new Map() };
}
function updateVerifications(view, run) {
  const entries = run.verifications ?? [];
  view.verifications.hidden = !entries.length;
  setText(view.verificationSummary, '独立验收记录 · ' + entries.length + ' 次');
  const original = entries.find(entry => entry.purpose === 'original') ?? entries[0];
  const latest = entries.at(-1);
  if (!original) { setText(view.verdict, '独立验收：尚未导入结果'); delete view.verdict.dataset.verdict; return; }
  const names = { PASS: '通过', FAIL: '未通过', MISSING: '结果不完整' };
  const latestText = latest !== original ? ' · ' + ({repair:'辅助修复',diagnostic:'诊断复跑'}[latest.purpose] ?? '最近一次') + '：' + (names[latest.verdict] ?? latest.verdict) : '';
  setText(view.verdict, '独立验收 · ' + (original.purpose === 'original' ? '首次自主：' : '首次导入：') + (names[original.verdict] ?? original.verdict) + latestText);
  view.verdict.dataset.verdict = original.verdict;
  for (const entry of entries) {
    const key = entry.verificationId;
    let node = view.verificationEntries.get(key);
    if (!node) {
      node = element('article', 'live-verification-entry'); node.dataset.verificationId = key;
      const source = element('details'); source.append(element('summary','','候选与报告来源'),element('pre'));
      node.append(element('h4'), element('p'), source, element('p'), element('pre'));
      view.verificationList.append(node); view.verificationEntries.set(key, node);
    }
    const children = node.children;
    const purposes = { original: '首次验收', diagnostic: '诊断重放', repair: '辅助修复验收' };
    setText(children[0], (purposes[entry.purpose] ?? '独立验收') + ' · ' + (names[entry.verdict] ?? entry.verdict));
    setText(children[1], (entry.source?.name ?? '外部评分器') + ' · ' + at(entry.completedAt ?? entry.importedAt));
    setText(children[2].querySelector('pre'), '候选：' + (entry.candidateDigest ?? entry.candidateId ?? '未提供') + '\n来源：' + (entry.source?.reportUri ?? '未提供'));
    const counts = entry.counts ?? {};
    const phases = { satisfied: '已验证', failed: '验证失败', pending: '待验证', blocked: '受阻', COMPLETED: '已完成', IN_PROGRESS: '进行中', BLOCKED: '受阻', FAILED: '验收未通过' };
    const formal = entry.control?.status === 'applied' ? ' · 正式任务：' + (phases[entry.control.taskPhase] ?? entry.control.taskPhase ?? '尚无判定') + ' · 目标：' + (phases[entry.control.goalPhase] ?? entry.control.goalPhase ?? '尚无判定') : '';
    setText(children[3], '通过 ' + (counts.passed ?? '—') + ' · 失败 ' + (counts.failed ?? '—') + ' · 缺失 ' + (counts.missing ?? '—') + ' · 正式判定' + (entry.control?.status === 'applied' ? '已回流' : '待回流') + formal);
    const missing = (entry.missingTests ?? []).map(test => '缺失：' + test);
    const failed = (entry.failedTests ?? []).map(test => '失败：' + test);
    setText(children[4], [...failed, ...missing].join('\n')); children[4].hidden = !children[4].textContent;
  }
}
function updateRun(view, run) {
  view.root.dataset.realStatus = run.status;
  setText(view.title, run.taskTitle ?? readableTitle(run.spec.instruction));
  setText(view.state, run.explorationState ?? labels[run.status] ?? run.status);
  setText(view.current, currentAction(run));
  const total = summarizeUsage(run.usage);
  setText(view.usage, '本次运行累计输入 ' + number(total.input) + ' · 输出 ' + number(total.output) + ' tokens · ' + total.requests + ' 次模型调用' + (total.unknown ? '（' + total.unknown + ' 次用量未完整报告，合计不完整）' : ''));
  const toolCount = (run.trace ?? []).filter(e => e.type === 'tool.started').length;
  setText(view.context, (run.configuration?.model ?? '准备模型连接') + ' · 单次上下文 ' + (Number.isFinite(run.spec.budget?.contextWindowTokens) ? number(run.spec.budget.contextWindowTokens) : '未报告') + ' tokens · ' + toolCount + ' 次工具调用');
  setText(view.error, run.error); view.error.hidden = !run.error;
  view.cancel.hidden = !active(run); view.cancel.disabled = !!run.cancelRequested;
  setText(view.cancel, run.cancelRequested ? '正在取消…' : '取消此运行');
  view.importButton.hidden = active(run) || ['explore', 'review'].includes(run.spec?.mode);
  view.checkButton.hidden = active(run) || run.status === 'outcome_unknown' || ['explore', 'review'].includes(run.spec?.mode);
  view.commandChecks.hidden = !(run.commandChecks?.length);
  setText(view.commandChecks.querySelector('pre'), (run.commandChecks ?? []).map(c => {
    const state = { running: '检查中', finished: '检查结束', interrupted: '检查中断，需核对后发起新检查' }[c.status] ?? c.status;
    const observations = c.result?.observations ?? [];
    return state + ' · ' + c.requestId + '\n' + (c.result?.status === 'rejected' ? json(c.result) : observations.map(o => o.summary + '\n报告摘要：' + (o.artifactRef?.digest ?? '报告未保存')).join('\n')) + '\n命令检查不代表整体验收。';
  }).join('\n\n'));
  for (const check of run.commandChecks ?? []) {
    if (!view.checkReportButtons.has(check.requestId)) {
      const button = element('button', '', '查看检查报告 · ' + check.requestId);
      button.dataset.checkReport = check.requestId; button.dataset.checkRun = run.spec.runId;
      view.commandChecks.lastElementChild.append(button); view.checkReportButtons.set(check.requestId, button);
    }
  }
  view.reportButton.hidden = run.spec?.mode !== 'explore' || !run.explorationReportAvailable;
  setText(view.basisBody, json({ runId: run.spec.runId, sessionId: run.sessionId, configurationRevision: run.configuration?.revision ?? null, workspaceRevision: run.workspaceRevision, budget: run.spec.budget }));
  if (run.spec?.mode === 'explore') {
    view.verifications.hidden=true;
    setText(view.verdict,'探索报告：'+(run.explorationState ?? '等待状态同步')+'；本次未运行项目测试。');
    delete view.verdict.dataset.verdict;
  } else updateVerifications(view, run);
  for (const event of run.trace ?? []) {
    const key = event.sequence + ':' + event.type;
    if (event.type === 'tool.started') view.calls.set(event.data?.call?.callId, event.data?.call);
    if (view.eventViews.has(key)) continue;
    if (event.type === 'assistant.message_completed' && event.data?.message?.content?.trim()) {
      const node = element('article', 'live-assistant'); node.dataset.eventKey = key;
      const meta = element('div', 'live-event-meta'); meta.append(element('strong', '', 'Agent'), element('small', '', at(event.at)));
      const body = element('div', 'markdown-body'); body.innerHTML = renderMarkdown(event.data.message.content);
      node.append(meta, body); view.events.append(node); view.eventViews.set(key, node);
    } else if (/^tool\.(started|completed|failed|outcome_unknown)$/.test(event.type)) {
      const id = event.data?.callId ?? event.data?.call?.callId ?? key;
      let tool = view.tools.get(id);
      if (!tool) { tool = createTool(event); tool.root.dataset.toolCallId = id; view.events.append(tool.root); view.tools.set(id, tool); }
      updateTool(tool, event, view.calls.get(id));
      view.eventViews.set(key, tool.root);
    } else view.eventViews.set(key, null);
  }
  view.empty.hidden = view.events.childElementCount > 0;
}
export function createLiveRunsView({ messages, scroller }) {
  const views = new Map();
  let scopeKey = null;
  return {
    reset() { views.clear(); scopeKey = null; },
    render(runs, key) {
      const first = scopeKey !== key;
      if (first) { views.clear(); messages.replaceChildren(); scopeKey = key; }
      const scroll = scroller.scrollTop;
      const selection = document.getSelection();
      const hasSelection = selection && !selection.isCollapsed && messages.contains(selection.anchorNode);
      // Refreshing history never moves the reader. Follow newly arriving content only
      // when the reader was already at the bottom and is not selecting text.
      const follow = !first && !hasSelection && scroller.scrollHeight - scroller.clientHeight - scroll < 80;
      const present = new Set();
      for (const run of runs) {
        const id = run.spec.runId; present.add(id);
        let view = views.get(id);
        if (!view || !messages.contains(view.root)) { view = createRun(run); messages.append(view.root); views.set(id, view); }
        updateRun(view, run);
      }
      for (const [id, view] of views) if (!present.has(id)) { view.root.remove(); views.delete(id); }
      scroller.scrollTop = first ? 0 : follow ? scroller.scrollHeight : scroll;
    },
  };
}
