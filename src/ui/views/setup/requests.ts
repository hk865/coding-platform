import { callCore } from '../../api/http.js';
import { submit } from '../../api/submit.js';
import { detailsBlock, escapeHtml, shown } from '../../components/html.js';
import type { ProjectValue, ScopeState, WorkspaceValue } from '../../state/scope-state.js';
import { record, selectedIndex } from '../../state/values.js';
import {
  freshRequestId,
  renderScopeIfSelected,
  reviewArchitectures,
  reviewGoals,
  reviewPlans,
  reviewPolicies,
  state,
} from '../../state/workbench.js';

// ---------------------------------------------------------------------------
// Request builders (one concrete body, built fresh per explicit operation)
// ---------------------------------------------------------------------------

export function pinOf(value: { ref: unknown; revision: number }): { ref: unknown; revision: number } {
  return { ref: value.ref, revision: value.revision };
}

export function buildProjectRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const projectId = current.forms.projectId.trim() || scope.projectId;
  const projectRef = { aggregateType: 'Project', projectId: scope.projectId };
  return { scope, request: { input: { projectId }, meta: {
    requestId: freshRequestId('projects/create'), expected: [{ ref: projectRef, revision: 0 }] } } };
}

export function buildWorkspaceRequest(): unknown | null {
  const current = state();
  if (current.project === null) return null;
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  return { scope, request: { input: { workspace: scope }, meta: {
    requestId: freshRequestId('workspaces/register'), expected: [pinOf(current.project), { ref: workspaceRef, revision: 0 }] } } };
}

export function buildPolicyInstallRequest(): unknown | null {
  const current = state();
  if (current.project === null) return null;
  const policies = reviewPolicies();
  const policy = policies[selectedIndex(current.forms.policyIndex, policies.length)];
  if (policy === undefined) return null;
  const scope = current.config.scope;
  const revisionRef = { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: policy.policyId, revision: policy.contentRevision };
  return { scope, request: { input: { policyId: policy.policyId, contentRevision: policy.contentRevision, content: policy.content },
    meta: { requestId: freshRequestId('completion-policies/install'), expected: [pinOf(current.project), { ref: revisionRef, revision: 0 }] } } };
}

export function buildPolicyActivateRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.policyInstall === null) return null;
  const scope = current.config.scope;
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId };
  return { scope, request: { input: { target: { ref: current.policyInstall.ref, digest: current.policyInstall.contentDigest } },
    meta: { requestId: freshRequestId('completion-policies/activate'), expected: [pinOf(current.project), { ref: activeRef, revision: 0 }] } } };
}

export function buildGoalRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null) return null;
  const scope = current.config.scope;
  const fallback = reviewGoals()[0];
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || fallback?.goalId || '';
  const objective = current.forms.objective.trim() || current.goal?.objective || fallback?.objective || '';
  if (goalId.length === 0 || objective.length === 0) { current.error = '请填写目标 ID 与目标内容。'; return null; }
  return { scope, request: { input: { goalId, workspace: scope, objective },
    meta: { requestId: freshRequestId('goals/create'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

export function buildAdoptRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null) return null;
  const architectures = reviewArchitectures();
  const architecture = architectures[selectedIndex(current.forms.architectureIndex, architectures.length)];
  if (architecture === undefined) return null;
  const scope = current.config.scope;
  return { scope, request: { input: architecture,
    meta: { requestId: freshRequestId('architecture/adopt-initial'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

/** Minimal JSON parse for the explicit ADVANCED architecture draft. The Plan /
 * Architecture owner still owns every domain check; this page only reports that
 * the pasted text is not JSON. */
function parseArchitectureDraft(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

/** The actual parsed candidate the user would submit, behind a disclosure. It
 * never executes or adopts the input by itself and shows no fabricated sample. */
export function architectureDraftPreview(raw: string): string {
  if (raw.trim().length === 0)
    return '<p class="muted">尚未粘贴初始架构输入；仅点击“采用粘贴的初始架构”才会提交。</p>';
  const parsed = parseArchitectureDraft(raw);
  if (!parsed.ok) return `<p class="error">JSON 解析失败：${escapeHtml(parsed.error)}</p>`;
  return detailsBlock('查看将提交的实际输入', `<pre>${escapeHtml(JSON.stringify(parsed.value, null, 2))}</pre>`);
}

/** Adopt the user's explicitly pasted, already-reviewed initial architecture
 * through the SAME `architecture/adopt-initial` route and submit/retry handling
 * as the trusted candidate. The draft text and parsed input are captured before
 * the first await; when this scope has no Project/Workspace pin yet (fresh or
 * reopened page), the action reads the real registration projection instead of
 * guessing a revision. It never infers modules from source or a plan. */
export async function adoptArchitectureDraft(scope: ScopeState): Promise<void> {
  const parsed = parseArchitectureDraft(scope.forms.architectureDraft);
  if (!parsed.ok) {
    scope.error = `初始架构 JSON 解析失败：${parsed.error}`;
    renderScopeIfSelected(scope);
    return;
  }
  const input = parsed.value;
  const target = scope.config.scope;
  if (scope.project === null || scope.workspace === null) {
    const read = await callCore('workspaces/registration', { scope: target, input: target });
    if (read.kind === 'network') {
      scope.error = `项目/工作区登记读取失败：${read.reason}`;
      renderScopeIfSelected(scope);
      return;
    }
    if (read.status === 403) {
      scope.error = '连接已失效，请刷新页面重新连接。';
      renderScopeIfSelected(scope);
      return;
    }
    const registration = record(read.payload);
    if (registration.status !== 'ready') {
      scope.error = `项目/工作区登记未就绪（${shown(registration.status)}）：不会猜测版本，也不采用。`;
      renderScopeIfSelected(scope);
      return;
    }
    const value = record(registration.value);
    scope.project = value.project as ProjectValue;
    scope.workspace = value.workspace as WorkspaceValue;
  }
  const project = scope.project;
  const workspace = scope.workspace;
  if (project === null || workspace === null) {
    scope.error = '项目/工作区登记缺少正式版本，无法采用初始架构。';
    renderScopeIfSelected(scope);
    return;
  }
  const body = { scope: target, request: { input, meta: {
    requestId: freshRequestId('architecture/adopt-initial'), expected: [pinOf(project), pinOf(workspace)] } } };
  await submit(scope, 'architecture/adopt-initial', body);
}

export function buildProposeRequest(): unknown | null {
  const current = state();
  if (current.goal === null) return null;
  const plans = reviewPlans();
  const plan = plans[selectedIndex(current.forms.planIndex, plans.length)];
  if (plan === undefined) return null;
  const scope = current.config.scope;
  const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: current.goal.ref.goalId };
  return { scope, request: { input: { goalRef, basedOn: null, draft: plan.draft, reason: { text: plan.reasonText, sources: [] } },
    meta: { requestId: freshRequestId('plans/propose'), expected: [] } } };
}

export function buildApplyRequest(): unknown | null {
  const current = state();
  if (current.proposal === null) return null;
  const scope = current.config.scope;
  return { scope, request: { input: { proposalRef: current.proposal.ref, expectedProposalRevision: current.proposal.revision, decisionRefs: [] },
    meta: { requestId: freshRequestId('plans/apply'), expected: [] } } };
}

export function buildGoalReadRequest(): unknown | null {
  const current = state();
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  if (goalId.length === 0) return null;
  return { scope: current.config.scope, input: { aggregateType: 'Goal', projectId: current.config.scope.projectId, goalId } };
}

export function buildProposalReadRequest(): unknown | null {
  const current = state();
  const proposalId = current.forms.proposalId.trim();
  if (proposalId.length === 0) return null;
  const scope = current.config.scope;
  return { scope, input: { aggregateType: 'PlanProposal', projectId: scope.projectId, workspaceId: scope.workspaceId, proposalId } };
}

export function buildArchitectureReadRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  if (current.forms.archSelection === 'revision') {
    const baselineId = current.forms.baselineId.trim();
    const revision = Number.parseInt(current.forms.baselineRevision, 10);
    if (baselineId.length === 0 || !Number.isSafeInteger(revision) || revision < 1) return null;
    return { scope, input: { selection: { kind: 'revision', ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.projectId, baselineId, revision } } } };
  }
  return { scope, input: { selection: { kind: 'current' } } };
}

export function buildObservedCaptureRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null || current.adopted === null) return null;
  // Book ruling 6 (one mapping rule): the browser sends no `mappings`; the
  // server derives them from the ACTIVE catalog, so this file never imports
  // `moduleMappingsOf` (check-boundaries allows the UI only UI modules + DTOs).
  const scope = current.config.scope;
  return { scope, request: { input: { workspace: scope, previous: current.observedCapture },
    meta: { requestId: freshRequestId('architecture/capture'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

export function buildObservedQueryRequest(): unknown | null {
  const current = state();
  if (current.observedCapture === null) return null;
  return { scope: current.config.scope, input: {
    selection: { kind: 'observed', capture: current.observedCapture },
    depth: 1, relations: ['dependency'], page: { limit: 50 } } };
}

export function buildTasksQueryRequest(): unknown | null {
  const current = state();
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  if (goalId.length === 0) return null;
  return { scope: current.config.scope, input: { goalRef: { aggregateType: 'Goal', projectId: current.config.scope.projectId, goalId } } };
}

export function buildSourceCaptureRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  const prefix = current.forms.prefix.trim();
  return { scope, input: { workspace: workspaceRef, workspaceRevision: current.config.workspaceRevision, provider: current.forms.provider,
    ...(prefix.length === 0 ? {} : { prefix }) } };
}

export function buildSourceQueryRequest(next: boolean): unknown | null {
  const current = state();
  if (current.capture === null) return null;
  const prefix = current.forms.prefix.trim();
  const cursor = next ? current.sourcePage?.nextCursor ?? null : null;
  if (next && cursor === null) return null;
  return { scope: current.config.scope, input: { capture: current.capture.ref,
    query: { kind: 'paths', ...(prefix.length === 0 ? {} : { prefix }) }, cursor, limit: 10 } };
}

export function buildFileRequest(path?: string): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  const filePath = path ?? current.forms.filePath.trim();
  if (filePath.length === 0) return null;
  const version = current.forms.readVersion === 'capture' && current.capture !== null
    ? { kind: 'capture', capture: current.capture.ref }
    : { kind: 'working_tree' };
  return { scope, input: { workspace: workspaceRef, path: filePath, maxBytes: 65536, version } };
}

export function architectureSelectionKeyOf(body: unknown): string {
  const selection = record(record(record(body).input).selection);
  if (selection.kind === 'revision') {
    const ref = record(selection.ref);
    return `revision:${String(ref.baselineId)}@${String(ref.revision)}`;
  }
  return selection.kind === 'current' ? 'current' : '';
}

export function taskGoalIdOf(body: unknown): string {
  const goalRef = record(record(record(body).input).goalRef);
  return typeof goalRef.goalId === 'string' ? goalRef.goalId : '';
}
