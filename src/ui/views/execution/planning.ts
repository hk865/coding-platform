/// <reference lib="dom" />
/** Initial planning: the read-only planning question and adopting a verified initial-plan candidate. */

import type { CoreRouteSuffix, CoreScope } from '../../../app/core-http-types.js';
import { callCore, createHostSettingsPort, outcomeProblem, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import { submit } from '../../api/submit.js';
import type {
  AdoptInitialPlanInput,
  ExecutionRun,
  InitialPlanProposalRef,
  InitialPlanSetupCandidate,
  ProjectValue,
  QueryJobAnswerRef,
  ScopeState,
  WorkspaceValue,
} from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { bootstrap, renderScopeIfSelected } from '../../state/workbench.js';
import { drainContinuation } from './continuation.js';
import { driveRun, executionCall, executionRequestId } from './run.js';
import { pinOf } from '../setup/requests.js';

/** The investigation/planning flow. Every identity and the selected Session are
 * read from the captured `run` only, so a later navigation cannot change the
 * in-flight action. */
/**
 * R6 cold-start: assemble the REAL read-only context the model needs to form a
 * plan. It reads the current CompletionPolicy and the adopted architecture
 * through their original core routes and names the real available
 * role/templateId. It never puts records into the Runtime, never guesses a
 * policy/baseline and never treats the context as authorization.
 */
export async function buildPlanningQuestion(scope: ScopeState, run: ExecutionRun, target: CoreScope): Promise<string> {
  const lines: string[] = [
    '## 本请求真实只读上下文（仅供形成方案；不构成任何授权，也不代表测试已经存在）',
    `projectId: ${target.projectId}`,
    `workspaceId: ${target.workspaceId}`,
  ];
  const policyRead = await executionCall(scope, run, 'completion-policies/read', { scope: target, input: { projectId: target.projectId } });
  const policyPayload = record(payloadOf(policyRead));
  if (outcomeProblem(policyRead) === null && policyPayload.status === 'ready') {
    const policyValue = record(record(policyPayload.value).policy);
    const content = record(policyValue.content);
    lines.push(`现有完成策略: ${JSON.stringify({
      policyId: policyValue.policyId, contentRevision: policyValue.contentRevision,
      requirementKinds: content.requirementKinds,
      minimumRequiredRequirementsPerObligation: content.minimumRequiredRequirementsPerObligation,
    })}`);
  } else if (policyPayload.status === 'not_found'
    || (policyPayload.status === 'rejected' && policyPayload.code === 'not_found')) {
    lines.push('现有完成策略: 未采用（可提出最小真实策略；绝不能编造空策略来自动 PASS）');
  } else {
    lines.push('现有完成策略: 暂不可读（不得当作缺省；需先人工处理后再形成方案）');
  }
  const architectureRead = await executionCall(scope, run, 'architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  const architecturePayload = record(payloadOf(architectureRead));
  if (outcomeProblem(architectureRead) === null && architecturePayload.status === 'ready') {
    const baseline = record(record(architecturePayload.value).baseline);
    lines.push(`现有采用架构: ${JSON.stringify({
      baselineId: baseline.baselineId, revision: baseline.revision,
      hasCatalog: record(architecturePayload.value).catalog !== null && record(architecturePayload.value).catalog !== undefined,
    })}`);
  } else if (architecturePayload.status === 'not_found') {
    lines.push('现有采用架构: 未采用（模块 ref 必须使用上面的真实 projectId）');
  } else {
    lines.push('现有采用架构: 暂不可读（不得当作缺省；需先人工处理后再形成方案）');
  }
  const roles = new Set<string>();
  for (const profile of bootstrap()?.execution.queryProfiles ?? []) {
    if (profile.scope.projectId !== target.projectId || profile.scope.workspaceId !== target.workspaceId) continue;
    const role = record(profile.sessionRole);
    if (typeof role.templateId === 'string') roles.add(role.templateId);
  }
  lines.push(`合法 assignments[].role（仅 templateId，不加 @revision）: ${roles.size === 0 ? '(none)' : [...roles].join(', ')}`);
  lines.push('', '## 用户请求', run.question);
  return lines.join('\n');
}

/** Browser SHA-256 used ONLY to verify the saved Answer against the candidate's
 * recorded origin digest. When SubtleCrypto is unavailable the digest is
 * unverifiable and the candidate never becomes adopt-eligible. */
async function sha256HexText(text: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * R6 cold-start durable recovery. The ONLY adopt-eligible source is the CURRENT
 * displayed Goal's formal pending candidate: its `draft.origin.answerRef` must
 * match project/workspace/Goal and proposal identity, and the freshly read saved
 * Answer must match the candidate's recorded origin digest. A stale Goal, a
 * different scope, an old history answer or a run-local Answer never enables the
 * adoption control. Any failure leaves `planCandidate` null (read-only display).
 */
export async function loadPlanCandidate(scope: ScopeState): Promise<void> {
  const target = scope.config.scope;
  const selectedGoalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  scope.planCandidate = null;
  if (selectedGoalId.length === 0 || scope.pending !== null) return;
  const current = await callCore('goals/read', { scope: target,
    input: { aggregateType: 'Goal', projectId: target.projectId, goalId: selectedGoalId } });
  if ((scope.forms.goalId.trim() || scope.goal?.ref.goalId || '') !== selectedGoalId) return;
  if (current.kind !== 'response' || record(current.payload).status !== 'ready') return;
  scope.goalRead = current.payload as ScopeState['goalRead'];
  const goalDetail = record(scope.goalRead);
  const goalValue = record(record(goalDetail.value).goal);
  const goalRefValue = record(goalValue.ref);
  const goalId = typeof goalRefValue.goalId === 'string' ? goalRefValue.goalId : '';
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  const pending = record(record(goalDetail.value).pendingPlan);
  const pendingRef = record(pending.ref);
  const pendingGoalRef = record(pending.goalRef);
  const origin = record(record(pending.draft).origin);
  const answerRefValue = record(origin.answerRef);
  const answerDigest = typeof origin.answerDigest === 'string' ? origin.answerDigest : '';
  const proposalRevision = typeof pending.revision === 'number' && Number.isSafeInteger(pending.revision)
    && pending.revision > 0 ? pending.revision : null;
  const eligible = goalId.length > 0 && goalRevision !== null && proposalRevision !== null
    && typeof pendingRef.proposalId === 'string' && pendingRef.proposalId.length > 0
    && pendingRef.projectId === target.projectId && pendingRef.workspaceId === target.workspaceId
    && pendingGoalRef.projectId === target.projectId && pendingGoalRef.goalId === goalId
    && answerRefValue.projectId === target.projectId && answerRefValue.workspaceId === target.workspaceId
    && typeof answerRefValue.queryJobId === 'string' && typeof answerRefValue.answerId === 'string'
    && answerDigest.length === 64;
  if (!eligible) { scope.planCandidate = null; return; }
  const answerRef: QueryJobAnswerRef = {
    aggregateType: 'QueryJobAnswer', projectId: target.projectId, workspaceId: target.workspaceId,
    queryJobId: answerRefValue.queryJobId as string, answerId: answerRefValue.answerId as string,
  };
  const outcome = await callCore('queries/answer', { scope: target, input: answerRef });
  if (outcome.kind !== 'response') { scope.planCandidate = null; return; }
  const payload = record(outcome.payload);
  if (payload.status !== 'ready') { scope.planCandidate = null; return; }
  const savedAnswer = record(payload.value);
  const savedRef = record(savedAnswer.ref);
  if (savedRef.answerId !== answerRef.answerId || savedRef.queryJobId !== answerRef.queryJobId) {
    scope.planCandidate = null;
    return;
  }
  const answerText = record(savedAnswer.answer).answer;
  if (typeof answerText !== 'string') { scope.planCandidate = null; return; }
  const digest = await sha256HexText(answerText);
  if ((scope.forms.goalId.trim() || scope.goal?.ref.goalId || '') !== selectedGoalId) return;
  if (digest === null || digest !== answerDigest) { scope.planCandidate = null; return; }
  let parsed: unknown;
  try { parsed = JSON.parse(answerText); } catch { scope.planCandidate = null; return; }
  const response = record(parsed);
  if (response.schemaVersion !== 2 || response.kind !== 'plan' || response.setup === undefined) {
    scope.planCandidate = null;
    return;
  }
  const setup = record(response.setup);
  const workspace = bootstrap()?.workspaces.find(candidate =>
    candidate.scope.projectId === target.projectId && candidate.scope.workspaceId === target.workspaceId);
  const writable = workspace?.writeAllowed === true && workspace?.commandsAllowed === true;
  scope.planCandidate = {
    setup: response.setup,
    plan: pending.draft,
    answerRef,
    answerDigest,
    checks: Array.isArray(setup.checks) ? setup.checks : [],
    proposalRef: { aggregateType: 'PlanProposal', projectId: target.projectId,
      workspaceId: target.workspaceId, proposalId: pendingRef.proposalId as string },
    proposalRevision,
    goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
    goalRevision,
    writable,
    readonlyReason: '当前目录以只读登记，不能执行写文件或运行命令；本页仍可形成并保存方案，但不能采用执行。',
  };
}

/** Stable per-candidate/step owner request identity. A transport retry reuses
 * the SAME pending body (handled by `submit`); this id keeps a genuine rebuild
 * (for example after a reload) on the owner's exact idempotency semantics. */
function candidateStepRequestId(candidate: InitialPlanSetupCandidate, step: string): string {
  return `cold-start:${step}:${candidate.answerDigest.slice(0, 16)}:${candidate.proposalRef.proposalId}`;
}

/** Stable policy id for the one candidate, derived from the saved Answer. */
function candidatePolicyId(candidate: InitialPlanSetupCandidate): string {
  return `cold-start-policy-${candidate.answerDigest.slice(0, 32)}`;
}

/** Submit one GraphWrite and report ONLY its ACTUAL response. A non-null
 * `scope.pending` means the transport outcome was unknown: the original request
 * is preserved and the caller must stop before overwriting pending. */
async function submitStep(scope: ScopeState, route: CoreRouteSuffix, body: unknown):
Promise<{ ok: boolean; unknown: boolean; payload: unknown }> {
  await submit(scope, route, body);
  if (scope.pending !== null) return { ok: false, unknown: true, payload: null };
  const last = scope.lastResponse;
  if (last === null || last.route !== route) return { ok: false, unknown: false, payload: null };
  const envelope = record(last.payload);
  return { ok: envelope.status === 'committed' || envelope.status === 'completed', unknown: false, payload: last.payload };
}

/** Report a failed step without claiming a prior owner write never happened. */
function reportStepFailure(scope: ScopeState, result: { unknown: boolean; payload: unknown }, label: string): void {
  scope.error = result.unknown
    ? `${label}：连接中断，原请求已保留；请先重试同一请求，再继续后续步骤。`
    : `${label}：${outcomeRejectionReason(result.payload)}；已成功步骤的正式回执保留，不会重复。`;
  renderScopeIfSelected(scope);
}

/**
 * Reconstruct the EXISTING workflow `adopt_initial_plan` input from the current
 * formal pending proposal and the real Goal revision. Used when a reload lost
 * `run.resumeIntent`; it never starts `select_work` while a Plan is pending and
 * never creates a new planning/model call.
 */
export function reconstructAdoptInitialPlan(scope: ScopeState): AdoptInitialPlanInput | null {
  const target = scope.config.scope;
  const goalDetail = record(scope.goalRead);
  const goalValue = record(record(goalDetail.value).goal);
  const goalRefValue = record(goalValue.ref);
  const goalId = typeof goalRefValue.goalId === 'string' ? goalRefValue.goalId : '';
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  const pending = record(record(goalDetail.value).pendingPlan);
  const pendingRef = record(pending.ref);
  const proposalRevision = typeof pending.revision === 'number' && Number.isSafeInteger(pending.revision)
    && pending.revision > 0 ? pending.revision : null;
  if (goalId.length === 0 || goalRevision === null || proposalRevision === null
    || typeof pendingRef.proposalId !== 'string' || pendingRef.proposalId.length === 0
    || pendingRef.projectId !== target.projectId || pendingRef.workspaceId !== target.workspaceId) {
    return null;
  }
  const ref: InitialPlanProposalRef = { aggregateType: 'PlanProposal', projectId: target.projectId,
    workspaceId: target.workspaceId, proposalId: pendingRef.proposalId };
  const goalRef = { aggregateType: 'Goal' as const, projectId: target.projectId, goalId };
  return {
    schemaVersion: 1, goalRef, flowId: `cold-start-adopt-${pendingRef.proposalId}`,
    sessionHint: null, executeWithinRequest: true, kind: 'adopt_initial_plan',
    request: { input: { proposalRef: ref, expectedProposalRevision: proposalRevision, decisionRefs: [] },
      meta: { requestId: `cold-start:plan-adopt:${pendingRef.proposalId}`,
        expected: [{ ref: goalRef, revision: goalRevision }] } },
  };
}

/** Refresh members and the two graphs through their existing reads, stopping if
 * any transport outcome is unknown so pending is never overwritten. */
async function refreshAdoptedFacts(scope: ScopeState, target: CoreScope): Promise<boolean> {
  await submit(scope, 'sessions/find', { scope: target, input: {
    workspace: target, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
  if (scope.pending !== null) return false;
  await submit(scope, 'architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  if (scope.pending !== null) return false;
  const goalRef = scope.execution.goalRef;
  if (goalRef !== null) {
    await submit(scope, 'tasks/query', { scope: target, input: { goalRef } });
    if (scope.pending !== null) return false;
  }
  return true;
}

/**
 * R6 cold-start explicit adoption. Every presence/absence decision comes from a
 * FRESH owner read of the real facts, never from a cached `scope.adopted`/
 * `scope.policyInstall` or a non-null field:
 *   - architecture: only an explicit `architecture/read` owner `not_found` is
 *     absence; `ready` retains the existing baseline; anything else stops;
 *   - completion policy: only an explicit `completion-policies/read` owner
 *     `not_found` is absence; `ready` retains the existing policy; else stops;
 *   - checks approval only after the saved-Answer authority reader accepts.
 * Each write validates its ACTUAL response, keeps its formal receipt on a later
 * failure and never re-fires a transport-unknown request (pending is preserved).
 */
export async function adoptInitialPlanSetup(scope: ScopeState, candidate: InitialPlanSetupCandidate): Promise<void> {
  const target = scope.config.scope;
  if (!candidate.writable) {
    scope.error = candidate.readonlyReason;
    renderScopeIfSelected(scope);
    return;
  }
  const setup = record(candidate.setup);
  // 1. Real registration pins.
  if (scope.project === null || scope.workspace === null) {
    const read = await callCore('workspaces/registration', { scope: target, input: target });
    if (read.kind !== 'response' || read.status === 403) {
      scope.error = '项目/工作区登记不可读，未采用。';
      renderScopeIfSelected(scope);
      return;
    }
    const registration = record(read.payload);
    if (registration.status !== 'ready') {
      scope.error = '项目/工作区登记未就绪，未采用。';
      renderScopeIfSelected(scope);
      return;
    }
    const value = record(registration.value);
    scope.project = value.project as ProjectValue;
    scope.workspace = value.workspace as WorkspaceValue;
  }
  if (scope.project === null || scope.workspace === null) {
    scope.error = '缺少正式项目/工作区版本，未采用。';
    renderScopeIfSelected(scope);
    return;
  }

  // 2. Fresh current architecture read.
  const architectureRead = await callCore('architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  if (architectureRead.kind !== 'response') {
    scope.error = '采用架构读取结果未确认；未采用，也不盲目重复。';
    renderScopeIfSelected(scope);
    return;
  }
  const architecturePayload = record(architectureRead.payload);
  const architectureAbsent = architecturePayload.status === 'not_found';
  if (architecturePayload.status === 'ready') {
    scope.architectureRead = architectureRead.payload;
  } else if (architectureAbsent) {
    const result = await submitStep(scope, 'architecture/adopt-initial', { scope: target, request: {
      input: setup.architecture,
      meta: { requestId: candidateStepRequestId(candidate, 'architecture'),
        expected: [pinOf(scope.project), pinOf(scope.workspace)] } } });
    if (!result.ok) { reportStepFailure(scope, result, '初始架构未采用'); return; }
    if (!await refreshAdoptedFacts(scope, target)) {
      scope.error = '初始架构已采用，但后续读取结果未确认；原请求已保留，且不会重复采用。';
      renderScopeIfSelected(scope);
      return;
    }
  } else {
    scope.error = `采用架构不可读（${String(architecturePayload.code ?? architecturePayload.status)}）：`
      + `${String(architecturePayload.reason ?? '')}；未采用。`;
    renderScopeIfSelected(scope);
    return;
  }

  // 3. Fresh current completion policy read.
  const policyRead = await callCore('completion-policies/read', { scope: target, input: { projectId: target.projectId } });
  if (policyRead.kind !== 'response') {
    scope.error = '完成策略读取结果未确认；未继续，也不盲目重复。';
    renderScopeIfSelected(scope);
    return;
  }
  const policyPayload = record(policyRead.payload);
  const policyAbsent = policyPayload.status === 'not_found'
    || (policyPayload.status === 'rejected' && policyPayload.code === 'not_found');
  if (policyAbsent) {
    const policyId = candidatePolicyId(candidate);
    const revisionRef = { aggregateType: 'CompletionPolicyRevision', projectId: target.projectId, policyId, revision: 1 };
    const installResult = await submitStep(scope, 'completion-policies/install', { scope: target, request: {
      input: { policyId, contentRevision: 1, content: setup.completionPolicy },
      meta: { requestId: candidateStepRequestId(candidate, 'policy-install'),
        expected: [pinOf(scope.project), { ref: revisionRef, revision: 0 }] } } });
    if (!installResult.ok) { reportStepFailure(scope, installResult, '完成策略安装未成功'); return; }
    const installValue = record(record(installResult.payload).value);
    const installRef = record(installValue.ref);
    const installDigest = typeof installValue.contentDigest === 'string' ? installValue.contentDigest : '';
    if (typeof installRef.policyId !== 'string' || installDigest.length === 0) {
      scope.error = '完成策略安装回执缺少正式 ref/digest；后续步骤停止，已完成回执保留。';
      renderScopeIfSelected(scope);
      return;
    }
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: target.projectId };
    const activateResult = await submitStep(scope, 'completion-policies/activate', { scope: target, request: {
      input: { target: { ref: installRef, digest: installDigest } },
      meta: { requestId: candidateStepRequestId(candidate, 'policy-activate'),
        expected: [pinOf(scope.project), { ref: activeRef, revision: 0 }] } } });
    if (!activateResult.ok) { reportStepFailure(scope, activateResult, '完成策略启用未成功'); return; }
  } else if (policyPayload.status !== 'ready') {
    scope.error = `完成策略不可读（${String(policyPayload.code ?? policyPayload.status)}）：`
      + `${String(policyPayload.reason ?? '')}；未继续。`;
    renderScopeIfSelected(scope);
    return;
  }

  // 4. Explicit approval of the saved Answer's checks (the authority reader
  // re-reads the same saved Answer and rejects any mismatch).
  if (candidate.checks.length > 0) {
    const approved = await createHostSettingsPort().call('checks/approve', {
      scope: target, answerRef: candidate.answerRef, checks: candidate.checks as never,
    });
    if (approved.status !== 'ready') {
      scope.error = `检查审批未成功：${approved.reason}。已完成的架构/策略步骤保留其正式回执。`;
      renderScopeIfSelected(scope);
      return;
    }
  }

  // 5. Continue the ORIGINAL Plan adopt. Prefer the saved continuation; after a
  // reload reconstruct it from the current formal pending proposal. Never fall
  // back to select_work while a Plan is pending.
  if (scope.pending !== null) {
    scope.error = '存在尚未确认的原请求，请先重试后再继续采用。';
    renderScopeIfSelected(scope);
    return;
  }
  const resume = scope.execution.resumeIntent;
  if (resume !== null && resume.route === 'workflow/goal-input') {
    scope.execution.resumeCount += 1;
    const pendingAdopt = resume.input as AdoptInitialPlanInput;
    const input: AdoptInitialPlanInput = {
      ...pendingAdopt,
      request: { ...pendingAdopt.request, meta: { ...pendingAdopt.request.meta,
        requestId: executionRequestId(scope.execution, `workflow/goal-input:resume:${scope.execution.resumeCount}`) } },
    };
    await driveRun(scope, scope.execution, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input }));
  } else {
    const reconstructed = reconstructAdoptInitialPlan(scope);
    if (reconstructed === null) {
      scope.error = '没有可续办的正式待采用计划草案；设置步骤已保留正式回执，未发起计划采用。';
      renderScopeIfSelected(scope);
      return;
    }
    await driveRun(scope, scope.execution, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input: reconstructed }));
  }
  // 6. Refresh members and both graphs after the actual adopted steps.
  if (!await refreshAdoptedFacts(scope, target)) {
    scope.error = '采用后的读取结果未确认；原读取请求已保留。';
  }
  await loadPlanCandidate(scope);
  renderScopeIfSelected(scope);
}
