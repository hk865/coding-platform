/** Pure setup renderers: bootstrap summary, module list, Goal and Plan details and the generic route reply. */

import type {
  BootstrapResponse,
  CoreRejection,
  CoreRouteSuffix,
  ModuleDefinition,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, list, record, rejectionPanel, renderGap, shown } from '../../components/html.js';

export function renderBootstrap(bootstrap: BootstrapResponse): string {
  const rows = bootstrap.workspaces.map(workspace =>
    `<li><strong>${escapeHtml(workspace.name)}</strong> `
    + `<code>${escapeHtml(workspace.scope.projectId)}/${escapeHtml(workspace.scope.workspaceId)}</code> `
    + `<span>workspaceRevision=${escapeHtml(workspace.workspaceRevision)}</span></li>`).join('');
  const review = bootstrap.review;
  const summary = review === null ? '<p class="muted">没有提供初始审阅资料</p>' : [
    review.notes === undefined ? '' : `<p>${escapeHtml(review.notes)}</p>`,
    `<p>政策 ${list(review.policies).length} · 目标 ${list(review.goals).length} · `
    + `初始架构 ${list(review.architectures).length} · Plan 草案 ${list(review.plans).length}</p>`,
  ].join('');
  const execution = bootstrap.execution;
  const executionSummary = `<p class="muted">执行配置 · 只读调查 profile ${execution.queryProfiles.length}`
    + ` · Workflow 范围 ${execution.workflowScopes.length}</p>`;
  return `<section class="panel" data-view="bootstrap"><h2>工作台</h2>`
    + `<ul class="workspaces">${rows}</ul>${summary}${executionSummary}</section>`;
}

export function renderModuleList(modules: ModuleDefinition[]): string {
  if (modules.length === 0) return '<p class="muted">采用图没有任何模块</p>';
  return `<ul class="modules">${modules.map(module =>
    `<li data-module="${escapeHtml(module.ref.moduleId)}"><code>${escapeHtml(module.ref.moduleId)}</code> <strong>${escapeHtml(module.name)}</strong>`
    + `<br><span>${escapeHtml(module.responsibility)}</span>`
    + `<br><span class="muted">paths: ${escapeHtml(module.paths.join(', '))}</span>`
    + `<br><button class="link" data-action="open-module-detail"`
    + ` data-project-id="${escapeHtml(module.ref.projectId)}" data-module-id="${escapeHtml(module.ref.moduleId)}">打开模块详情</button></li>`).join('')}</ul>`;
}

/** `goals/read` detail: the current Goal plus any pending proposal. */
export function renderGoalDetail(result: unknown): string {
  const envelope = record(result);
  if (envelope.status === 'rejected') return rejectionPanel(envelope as unknown as CoreRejection);
  if (envelope.status === 'not_found') return renderGap('goals/read', '该 Goal 不存在');
  if (envelope.status === 'not_ready') return renderGap('goals/read', 'Goal 投影尚未就绪');
  const detail = record(envelope.value);
  const goal = record(detail.goal);
  const ref = record(goal.ref);
  const pending = detail.pendingPlan === undefined || detail.pendingPlan === null ? null : record(detail.pendingPlan);
  return `<section class="panel" data-view="goal-read"><header><h3>目标</h3>`
    + `<p>版本 ${shown(goal.revision)} · 目标意图 ${shown(goal.desiredState)}</p></header>`
    + `<p>${shown(goal.objective)}</p>`
    + detailsFor('查看引用', `<p>目标 ID <code>${shown(ref.goalId)}</code></p>`
      + `<p>activePlan ${goal.activePlanRevision === null || goal.activePlanRevision === undefined ? 'none' : shown(JSON.stringify(goal.activePlanRevision))}</p>`)
    + (pending === null ? '<p class="muted">没有待采用的计划草案</p>'
      : `<p>有待采用的计划草案（版本 ${shown(pending.revision)}，校验问题 ${list(pending.issues).length}）</p>`)
    + `</section>`;
}

/** `plans/proposal` read: proposal identity, status and validation issues. */
export function renderPlanProposal(result: unknown): string {
  const envelope = record(result);
  if (envelope.status === 'rejected') return rejectionPanel(envelope as unknown as CoreRejection);
  if (envelope.status === 'not_found') return renderGap('plans/proposal', '该 Plan 草案不存在');
  if (envelope.status === 'not_ready') return renderGap('plans/proposal', 'Plan 投影尚未就绪');
  const proposal = record(envelope.value);
  const ref = record(proposal.ref);
  const goalRef = record(proposal.goalRef);
  const draft = record(proposal.draft);
  const issues = list(proposal.issues);
  return `<section class="panel" data-view="proposal"><header><h3>计划草案</h3>`
    + `<p>版本 ${shown(proposal.revision)} · 状态 ${shown(proposal.status)} · 任务 ${list(draft.tasks).length}</p></header>`
    + detailsFor('查看引用', `<p>草案 ID <code>${shown(ref.proposalId)}</code> · ${shown(proposal.kind)}</p>`
      + `<p>目标 ${shown(goalRef.goalId)} · basedOn ${proposal.basedOn === null || proposal.basedOn === undefined ? 'none' : 'yes'}</p>`)
    + (issues.length === 0 ? '<p class="muted">校验问题：0</p>'
      : `<ul class="diagnostics">${issues.map(issue => `<li>${shown(record(issue).message)}（${shown(record(issue).code)}）</li>`).join('')}</ul>`)
    + `</section>`;
}

/** Renders any route response by shape, preserving committed/cursor/rejection. */
export function renderRouteResponse(suffix: CoreRouteSuffix | string, payload: unknown): string {
  const value = record(payload);
  if (value.status === 'rejected') return rejectionPanel(value as unknown as CoreRejection);
  if (value.status === 'not_found') return renderGap(suffix, 'not found');
  if (value.status === 'not_ready') return renderGap(suffix, 'not ready');
  if (value.status === 'committed') {
    return `<section class="panel committed" data-route="${escapeHtml(suffix)}"><h3>已提交</h3>`
      + `<p>replayed=${String(value.replayed)} cursor=${escapeHtml(record(value.cursor).sequence ?? value.cursor ?? '')}</p>`
      + `<pre>${escapeHtml(JSON.stringify(value.value))}</pre></section>`;
  }
  if (value.status === 'accepted' || value.status === 'completed') {
    return `<section class="panel" data-route="${escapeHtml(suffix)}"><h3>操作回执</h3>`
      + `<pre>${escapeHtml(JSON.stringify(payload))}</pre></section>`;
  }
  return `<section class="panel" data-route="${escapeHtml(suffix)}"><pre>${escapeHtml(JSON.stringify(payload))}</pre></section>`;
}
