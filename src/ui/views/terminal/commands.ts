/// <reference lib="dom" />

import type {
  CommandsReadResponse,
  CommandsStartResponse,
  CommandsStopResponse,
} from '../../../app/core-http-types.js';
import { callCore, payloadOf } from '../../api/http.js';
import { noticeMark, startPoll, stopPoll } from '../../api/refresh.js';
import { escapeHtml } from '../../components/html.js';
import type { WorkbenchTab } from '../../state/layout.js';
import type { ScopeState } from '../../state/scope-state.js';
import { freshRequestId, renderScopeIfSelected, state } from '../../state/workbench.js';
import type { ActionTable } from '../shell/actions.js';
import { openTab, syncActiveLayout } from '../tabs/aux-layout.js';
import { renderWorkbenchCommand } from './render.js';

// --- Command handles -----------------------------------------------------------

function workspaceAllowsCommands(scope: ScopeState): boolean {
  return scope.config.commandsAllowed === true;
}

export async function startCommand(scope: ScopeState, command: string, cwd: string): Promise<void> {
  if (!workspaceAllowsCommands(scope)) {
    scope.error = '本工作区未授权命令执行（Host 未配置 allowCommands）。';
    renderScopeIfSelected(scope);
    return;
  }
  if (command.trim().length === 0) { scope.error = '请输入要执行的命令。'; renderScopeIfSelected(scope); return; }
  const requestId = freshRequestId('commands/start');
  scope.sending = true;
  scope.error = null;
  renderScopeIfSelected(scope);
  const mark = noticeMark();
  const outcome = await callCore('commands/start', { scope: scope.config.scope, input: { requestId, command, cwd } });
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = `命令启动结果未确认：${outcome.reason}`; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as CommandsStartResponse;
  if (payload.status !== 'ready') {
    scope.error = `命令未启动（${payload.code}）：${payload.reason}`;
    renderScopeIfSelected(scope);
    return;
  }
  const snapshot = payload.value;
  scope.commands.set(snapshot.commandId, { commandId: snapshot.commandId, command, cwd, requestId, result: payload,
    state: snapshot.state, poll: null, stopping: false });
  openTab(scope, { tabId: `terminal:${snapshot.commandId}`, kind: 'terminal',
    title: `${command.slice(0, 24)} · ${snapshot.commandId.replace("workbench-command-", "")}`, commandId: snapshot.commandId, command, cwd });
  if (snapshot.state !== 'settled') beginCommandPoll(scope, snapshot.commandId, mark);
  renderScopeIfSelected(scope);
}

/** Read on this handle's notices (the 700 ms poll is the fallback). `since` is
 * the notice mark taken before the start/stop request was sent. */
function beginCommandPoll(scope: ScopeState, commandId: string, since: number): void {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  stopPoll(command.poll);
  command.poll = startPoll(700, () => readCommand(scope, commandId),
    { kind: 'command', scope: scope.config.scope, commandId }, { since });
}

async function readCommand(scope: ScopeState, commandId: string): Promise<void> {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  const outcome = await callCore('commands/read', { scope: scope.config.scope, input: { commandId } });
  if (outcome.kind !== 'response') return;
  const payload = payloadOf(outcome) as CommandsReadResponse;
  if (payload.status !== 'ready') return;
  command.result = payload;
  command.state = payload.value.state;
  if (payload.value.state === 'settled' && command.poll !== null) { stopPoll(command.poll); command.poll = null; }
  // A hidden/switched tab does not cancel the handle; only the visible page redraws.
  const layout = syncActiveLayout(scope);
  if (layout.activeTabId === `terminal:${commandId}`) renderScopeIfSelected(scope);
}

export async function stopCommand(scope: ScopeState, commandId: string): Promise<void> {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  command.stopping = true;
  const mark = noticeMark();
  const outcome = await callCore('commands/stop', { scope: scope.config.scope, input: { commandId } });
  if (outcome.kind === 'network') { scope.error = '停止请求结果未确认。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as CommandsStopResponse;
  if (payload.status === 'ready') { command.result = payload; command.state = payload.value.state; }
  command.stopping = false;
  if (command.poll === null) beginCommandPoll(scope, commandId, mark);
  renderScopeIfSelected(scope);
}

export function renderTerminalTab(tab: Extract<WorkbenchTab, { kind: 'terminal' }>): string {
  const current = state();
  const command = current.commands.get(tab.commandId) ?? null;
  if (tab.commandId === 'new') {
    return `<section class="panel" data-view="terminal-tab" data-command-id="new"><header><h3>命令</h3>`
      + `<p class="muted">每个命令是独立句柄与独立页签；隐藏/切换页签不会取消。无交互 stdin / 非 PTY。</p></header>`
      + renderCommandForm() + `</section>`;
  }
  const settled = command !== null && command.state === 'settled';
  return `<section class="panel" data-view="terminal-tab" data-command-id="${escapeHtml(tab.commandId)}">`
    + renderWorkbenchCommand(command?.result ?? null, { command: tab.command, cwd: tab.cwd, state: command?.state ?? 'starting' })
    + `<div class="buttons"><button data-action="stop-command" data-command="${escapeHtml(tab.commandId)}"${settled ? ' disabled' : ''}>停止并等待实际结果</button></div>`
    + (command?.stopping ? '<p class="muted">已请求停止，等待 Kernel 实际结果…</p>' : '')
    + `<p class="muted">命令执行页没有交互 stdin；隐藏或切换页签不会取消命令。</p></section>`;
}

export function renderCommandForm(): string {
  const current = state();
  const allowed = current.config.commandsAllowed === true;
  return `<section class="panel" data-view="command-form"><h3>终端命令</h3>`
    + (allowed ? '' : '<p class="muted">本工作区未授权命令执行（Host 未配置 allowCommands）。</p>')
    + `<label class="inline">命令 <input data-field="commandLine" value="${escapeHtml(current.forms.commandLine)}" placeholder="例如：node --version"></label>`
    + `<label class="inline">cwd <input data-field="commandCwd" value="${escapeHtml(current.forms.commandCwd)}" placeholder="."></label>`
    + `<div class="buttons"><button data-action="start-command"${allowed ? '' : ' disabled'}>运行命令（无交互 stdin / 非 PTY）</button></div>`
    + `<p class="muted">每个命令是独立句柄与独立页签；隐藏/切页不取消，停止会等待实际结果。</p></section>`;
}

export const terminalActions = {
  'start-command': async scope => {
    await startCommand(scope, scope.forms.commandLine, scope.forms.commandCwd.trim().length === 0 ? '.' : scope.forms.commandCwd);
    return;
  },
  'stop-command': async (scope, element) => { await stopCommand(scope, element.dataset.command ?? ''); return; },
} satisfies ActionTable;
