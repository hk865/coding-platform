/** Pure execution entry renderers and the continuation seam. */

import type {
  ArtifactRecord,
  BootstrapExecution,
  CoreRejection,
  InitialPlanningGoalInputResult,
  QueryJobAnswerSnapshot,
  ReadResult,
  WorkflowAdvanceResult,
} from '../../../app/core-http-types.js';
import { detailsFor, escapeHtml, rejectionPanel, renderGap } from '../../components/html.js';

// ---------------------------------------------------------------------------
// R6 execution entry: display of the trusted execution projection and of the
// real Query / initial-Plan / Workflow receipts. These are PURE display: they
// never send a request, never reduce a receipt to "completed" and never invent
// an answer, a source or a continuation. The continuation seam below forwards
// only a real owner `next` (with its original input) or reports a real stop.
// ---------------------------------------------------------------------------

const EXECUTION_STATE_TEXT: Record<'advance' | 'waiting' | 'completed', string> = {
  advance: '下一步已就绪', waiting: '等待中', completed: '正式完成',
};

/** Narrow a result union to its ready variant for the continuation input types. */
type ExecutionReady<T> = Extract<T, { status: 'ready' }>;
type InitialPlanningContinuationInput =
  Extract<NonNullable<ExecutionReady<InitialPlanningGoalInputResult>['value']['next']>, { kind: 'goal_input' }>['input'];
type WorkflowContinuationInput = NonNullable<ExecutionReady<WorkflowAdvanceResult>['value']['next']>;

export type ExecutionContinuation =
  | { status: 'next'; route: 'workflow/goal-input'; input: InitialPlanningContinuationInput }
  | { status: 'next'; route: 'workflow/advance'; input: WorkflowContinuationInput }
  | { status: 'stop'; reason: string | null }
  | CoreRejection;

/** The production continuation seam: a real `next` is forwarded with its exact
 * original input and its owning route, while a null `next` (waiting/completed)
 * is a real stop. A rejected owner result is preserved unchanged. The seam never
 * fabricates a request, never re-derives an identity and never marks a result
 * complete. */
export function planExecutionContinuation(
  result: WorkflowAdvanceResult | InitialPlanningGoalInputResult,
): ExecutionContinuation {
  if (result.status === 'rejected') return result;
  const value = result.value;
  const next = value.next;
  if (next === null) return { status: 'stop', reason: 'reason' in value ? value.reason : null };
  if (next.kind === 'goal_input') return { status: 'next', route: 'workflow/goal-input', input: next.input };
  if (next.kind === 'work') return { status: 'next', route: 'workflow/advance', input: next.input };
  return { status: 'next', route: 'workflow/advance', input: next };
}

function originalRequestHtml(originalRequest: unknown): string {
  if (originalRequest === undefined) return '';
  return detailsFor('已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(originalRequest, null, 2))}</pre>`);
}

/** Trusted execution configuration selection. It shows only the safe projection
 * fields and states that the formal RoleBinding/budget are still owner-checked;
 * it grants nothing and never names an environment variable, secret or model. */
export function renderExecutionProfiles(execution: BootstrapExecution, selectedId?: string, disabled = false): string {
  if (execution.queryProfiles.length === 0)
    return `<section class="panel gap" data-view="execution-profiles"><h3>执行配置</h3>`
      + `<p>没有配置可用的只读调查 profile；模型入口明确未配置，其余页面保持可用。</p></section>`;
  const options = execution.queryProfiles.map(profile =>
    `<option value="${escapeHtml(profile.id)}"${profile.id === selectedId ? ' selected' : ''}`
    + ` data-profile-id="${escapeHtml(profile.id)}"`
    + ` data-scope="${escapeHtml(`${profile.scope.projectId}/${profile.scope.workspaceId}`)}">${escapeHtml(profile.label)}</option>`).join('');
  // The default row keeps only the chosen configuration name; the internal
  // scope/consumer/Role/budget references live in a collapsed detail.
  const rows = execution.queryProfiles.map(profile =>
    `<li data-profile="${escapeHtml(profile.id)}"><strong>${escapeHtml(profile.label)}</strong>`
    + detailsFor('配置详情（范围 / consumer / 角色 / 预算）', `<pre>${escapeHtml(JSON.stringify({
      scope: profile.scope, consumerId: profile.consumerId,
      sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
      runtimeBudget: profile.runtimeBudget, budget: profile.budget,
    }, null, 2))}</pre><p class="muted">这些正式引用仍由 Host/owner 复核；投影不授予领域许可。</p>`)
    + `</li>`).join('');
  const scopes = execution.workflowScopes.length === 0 ? '<p class="muted">没有配置 Workflow 推进范围</p>'
    : detailsFor('Workflow 推进范围', `<pre>${escapeHtml(JSON.stringify(execution.workflowScopes, null, 2))}</pre>`);
  return `<section class="panel" data-view="execution-profiles"><header><h3>执行配置</h3></header>`
    + `<label>只读调查 profile <select data-action="select-query-profile">${options}</select></label>`
    + `<button data-action="run-investigation"${disabled ? ' disabled' : ''}>调查</button>`
    + `<button data-action="run-planning"${disabled ? ' disabled' : ''}>规划并执行</button>`
    + `<ul class="profiles">${rows}</ul>${scopes}</section>`;
}

/** The official answer. `body` is the real `materials/open` read of the answer's
 * `bodyRef` with `historical_explanation`; the ref alone is never shown as text. */
export function renderQueryAnswer(answer: ReadResult<QueryJobAnswerSnapshot>, body?: ReadResult<ArtifactRecord>): string {
  if (answer.status === 'rejected') return rejectionPanel(answer);
  if (answer.status === 'not_found') return renderGap('queries/answer', '该调查还没有正式回答');
  if (answer.status === 'not_ready') return renderGap('queries/answer', '回答尚未就绪');
  const value = answer.value;
  const sourceCount = value.answer.sources.length;
  const sources = sourceCount === 0 ? '<p class="muted">没有记录来源</p>'
    : `<ul class="answer-sources">${value.answer.sources.map(source =>
      `<li data-source="${escapeHtml(source.refKey)}"><code>${escapeHtml(source.kind)}</code> `
      + `${escapeHtml(source.label ?? '')} <span class="muted">@${escapeHtml(source.version ?? 'unknown')}</span></li>`).join('')}</ul>`;
  const stale = value.answer.stale
    ? `<p class="stale" data-answer-stale="true">来源已过期：${escapeHtml(value.answer.staleReason ?? '')}</p>` : '';
  let bodyHtml: string;
  if (body === undefined) bodyHtml = '<p class="muted">正文尚未读取</p>';
  else if (body.status === 'ready') bodyHtml = `<pre data-answer-body>${escapeHtml(body.value.body)}</pre>`;
  else if (body.status === 'not_found') bodyHtml = '<p class="muted">回答正文工件不存在</p>';
  else if (body.status === 'not_ready') bodyHtml = '<p class="muted">回答正文尚未就绪</p>';
  else bodyHtml = rejectionPanel(body);
  // The default view stays short: received/status/source count/stale. The full
  // original answer, every source and the read body stay available expanded and
  // every field is preserved, unfiltered.
  return `<section class="panel" data-view="query-answer" data-answer="${escapeHtml(value.answer.answerId)}">`
    + `<header><h3>原回答</h3><p class="muted">已收到正式回答 · round ${escapeHtml(value.answer.roundIndex)} · `
    + `<span data-answer-status>${value.answer.stale ? 'stale' : 'settled'}</span> · `
    + `来源 ${escapeHtml(sourceCount)} 条</p></header>`
    + stale
    + detailsFor('完整原回答', `<pre>${escapeHtml(value.answer.answer)}</pre>`)
    + detailsFor('回答来源', sources)
    + detailsFor('回答正文引用', `<p>bodyRef <code>${escapeHtml(JSON.stringify(value.answer.bodyRef))}</code></p>`)
    + detailsFor('回答正文', bodyHtml)
    + detailsFor('完整回答记录', `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`)
    + `</section>`;
}

/** The real Workflow advancement result. `waiting`/`completed` keep their own
 * state and never show as success; a `next` is shown as the complete original
 * request, never flattened. */
export function renderWorkflowAdvance(result: WorkflowAdvanceResult, originalRequest?: unknown): string {
  if (result.status === 'rejected')
    return `<section class="panel rejected" data-view="workflow-advance" data-state="rejected">`
      + rejectionPanel(result) + originalRequestHtml(originalRequest) + `</section>`;
  const value = result.value;
  const receipt = value.receipt === null ? '<p class="muted">没有调用 owner</p>'
    : `<p>回执 <code data-receipt-kind="${escapeHtml(value.receipt.kind)}">${escapeHtml(value.receipt.kind)}</code></p>`
      + detailsFor('完整回执', `<pre>${escapeHtml(JSON.stringify(value.receipt.result, null, 2))}</pre>`);
  const next = value.next === null ? '<p class="muted">没有下一步</p>'
    : detailsFor('下一步原请求', `<pre>${escapeHtml(JSON.stringify(value.next, null, 2))}</pre>`);
  return `<section class="panel" data-view="workflow-advance" data-state="${escapeHtml(value.state)}">`
    + `<header><h3>执行推进</h3><p>${escapeHtml(EXECUTION_STATE_TEXT[value.state])}</p></header>`
    + (value.reason === null ? '' : `<p class="muted">${escapeHtml(value.reason)}</p>`)
    + receipt + next + originalRequestHtml(originalRequest) + `</section>`;
}

/** The initial-planning/answer handoff. The real state and `next.kind` are
 * preserved; the candidate/adoption receipt is never upgraded to completed. */
export function renderInitialPlanning(result: InitialPlanningGoalInputResult, originalRequest?: unknown): string {
  if (result.status === 'rejected')
    return `<section class="panel rejected" data-view="initial-planning" data-state="rejected">`
      + rejectionPanel(result) + originalRequestHtml(originalRequest) + `</section>`;
  const value = result.value;
  const nextKind = value.next === null ? 'none' : value.next.kind;
  const next = value.next === null ? '<p class="muted">没有下一步</p>'
    : detailsFor('下一步原请求', `<pre>${escapeHtml(JSON.stringify(value.next.input, null, 2))}</pre>`);
  return `<section class="panel" data-view="initial-planning" data-state="${escapeHtml(value.state)}"`
    + ` data-next-kind="${escapeHtml(nextKind)}"><header><h3>初始规划</h3><p>${escapeHtml({ proposed: '候选待采用', needs_decision: '需要补充决定', advance: '已采用，可以执行', waiting: '等待处理' }[value.state])}</p></header>`
    + (value.receipt.status === 'rejected' ? rejectionPanel(value.receipt) : '')
    + detailsFor('候选/采用回执', `<pre>${escapeHtml(JSON.stringify(value.receipt, null, 2))}</pre>`)
    + next + originalRequestHtml(originalRequest) + `</section>`;
}
