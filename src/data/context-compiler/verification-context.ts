import { RunOutputFacts } from './run-output-materials.js';
import { reworkPlanIdFor, type ReworkProposalV1 } from '../../contracts/rework/proposal.js';
import type { VerificationReworkMaterialResult } from '../../contracts/verification-context.js';
import type { RoleOutputWitnessChannelV1 } from '../../contracts/run-output-materials.js';
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { StateLedger, AggregateSnapshot, GoalSnapshot, WorkspaceSnapshot } from '../../contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { PatchRecordSnapshot } from '../../contracts/patch.js';
import type { WorkspaceWriteLeaseSnapshot } from '../../contracts/workspace-lease.js';
import type { VerificationScope as Scope } from '../../contracts/verification-import.js';
import type { VerificationContextPort, VerificationMaterialResult, VerificationRuntimeFacts, VerificationRoundScope, VerificationRoundMaterialIdentity, VerificationRoundMaterialResult, VerificationRoundSourcePort } from '../../contracts/verification-context.js';
import type { VerificationRequestV1, VerificationIssue } from '../../contracts/verification.js';
import { resolveArchitectureBaselineRevision, resolveCompletionPolicyRevision } from '../state-ledger/governance-records.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { governanceContentDigest } from '../../contracts/governance.js';
import type { CandidateWorkspaceSourcePort } from '../../contracts/verification-source.js';
import type { ReviewWorkRef, ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import type { ReviewerRuntimeObservations } from '../../contracts/reviewer-context.js';
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
function vScope(value: Scope): Scope {
  return {
    projectId: value.projectId,
    workspaceId: value.workspaceId,
    goalId: value.goalId,
    runId: value.runId
  };
}
function isGoalSnapshot(s: AggregateSnapshot): s is GoalSnapshot {
  return s.ref.aggregateType === "Goal";
}
function isWorkspaceSnapshot(s: AggregateSnapshot): s is WorkspaceSnapshot {
  return s.ref.aggregateType === "Workspace";
}
function isPlanSnapshot(s: AggregateSnapshot): s is PlanRevisionSnapshot {
  return s.ref.aggregateType === "PlanRevision";
}
type RoundRejectionCode = Extract<VerificationRoundMaterialResult, { status: 'rejected' }>['code'];
class RoundMaterialError extends Error {
  constructor(readonly code: RoundRejectionCode, readonly path: string, message: string) { super(message); }
}
function roundEnsure(value: unknown, code: RoundRejectionCode, path: string, message: string): asserts value {
  if (!value) throw new RoundMaterialError(code, path, message);
}
const same = (a: unknown, b: unknown) => canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue);
const fingerprint = (value: unknown) => sha256Hex(canonicalJson(value as JsonValue));
const roundScope = (scope: VerificationRoundScope): VerificationRoundScope => ({ ...vScope(scope), taskId: scope.taskId });
export type VerificationContextDeps = {
  ledger: StateLedger;
  vault: Pick<ArtifactPort, 'open'>;
  runtime?: VerificationRuntimeFacts;
  rootFor?: (projectId: string, workspaceId: string) => string;
  workspaceSource?: CandidateWorkspaceSourcePort;
  roundSource?: VerificationRoundSourcePort;
};
/** Select canonical verification facts and exact-source materials; never authorize state changes. */
export class VerificationContextCompiler implements VerificationContextPort {
  async runOutputWitness(run: RunSnapshot, channel: Exclude<RoleOutputWitnessChannelV1, null>) {
    return new RunOutputFacts(run, this.deps.ledger).witness(channel);
  }

  constructor(private readonly deps: VerificationContextDeps) { }
  async resolveRework(scope: VerificationRoundScope): Promise<VerificationReworkMaterialResult> {
    const proposals: ReworkProposalV1[] = [];
    let cursor: import('../../contracts/command-event.js').CommitCursor | null = null;
    for (;;) {
      const page = await this.deps.ledger.events({ afterCursor: cursor, limit: 500 });
      for (const { event } of page.events) {
        if (event.eventType !== 'PlanProposalRecorded' || event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) continue;
        const proposal = event.payload.proposal as ReworkProposalV1;
        if (proposal.sourceGoalRef.goalId === scope.goalId && proposal.rework?.tasks.some(task => task.taskId === scope.taskId)) proposals.push(proposal);
      }
      if (!page.hasMore) break;
      if (page.throughCursor === cursor) return { status: 'incomplete', code: 'material_unavailable', missing: ['Rework event cursor did not advance'] };
      cursor = page.throughCursor;
    }
    if (proposals.length === 0) return { status: 'not_rework' };
    const current = await this.resolveRound(scope);
    if (current.status !== 'ready') return current;
    const matches: ReworkProposalV1[] = [];
    for (const proposal of proposals) {
      // A recorded proposal alone is not an applied plan. Resolve the immutable
      // revision produced by the existing formal acceptance path as well.
      const accepted = await this.deps.ledger.load({ aggregateType: 'PlanRevision', projectId: scope.projectId, planId: reworkPlanIdFor(proposal.proposalId) });
      if (accepted.status !== 'found' || !isPlanSnapshot(accepted.snapshot)) continue;
      const task = accepted.snapshot.tasks.find(task => task.taskId === scope.taskId);
      if (task?.disposition !== 'active' || !same(accepted.snapshot.tasks, proposal.planDraft.tasks)) continue;
      matches.push(proposal);
    }
    if (matches.length !== 1) return { status: 'rejected', code: 'scope_mismatch', issues: [{ path: 'rework', message: 'Exactly one formally applied rework origin is required' }] };
    const proposal = matches[0]!, task = proposal.rework.tasks.find(task => task.taskId === scope.taskId)!;
    const issues = proposal.rework.issues.filter(issue => task.issueIds.includes(issue.issueId));
    if (!issues.length || issues.length !== task.issueIds.length || issues.some(issue => issue.taskId !== task.supersedesTaskId || issue.projectId !== scope.projectId || issue.workspaceId !== scope.workspaceId || issue.goalId !== scope.goalId)) {
      return { status: 'rejected', code: 'scope_mismatch', issues: [{ path: 'rework.issues', message: 'Rework origins do not match the current carrier scope' }] };
    }
    const stable = await this.resolveRound(scope, current.material.identity);
    if (stable.status !== 'ready') return stable;
    return { status: 'ready', material: stable.material, proposalId: proposal.proposalId, issues: structuredClone(issues) };
  }
  async resolveRound(scope: VerificationRoundScope, expected?: VerificationRoundMaterialIdentity): Promise<VerificationRoundMaterialResult> {
    return this.resolveRoundMaterial(scope, expected);
  }
  async resolveReviewRound(workRef: ReviewWorkRef): Promise<VerificationRoundMaterialResult> {
    const loaded = await this.deps.ledger.load(workRef);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'ReviewWork' || !same(loaded.snapshot.ref, workRef)) return { status: 'rejected', code: 'not_found', issues: [{ path: 'workRef', message: 'Canonical review work is unavailable' }] };
    const work = loaded.snapshot as ReviewWorkSnapshot;
    return this.resolveRoundMaterial(work.descriptor.subject.scope, work.descriptor.materialIdentity, workRef);
  }
  private async resolveRoundMaterial(scope: VerificationRoundScope, expected?: VerificationRoundMaterialIdentity, reviewWorkRef?: ReviewWorkRef): Promise<VerificationRoundMaterialResult> {
    try {
      roundEnsure(scope && ['projectId', 'workspaceId', 'goalId', 'runId', 'taskId'].every(key => {
        const value = scope[key as keyof VerificationRoundScope];
        return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
      }), 'invalid_scope', 'scope', 'A complete project/workspace/goal/task/run scope is required.');
      if (!this.deps.runtime || !this.deps.rootFor || !this.deps.roundSource) return { status: 'incomplete', code: 'material_unavailable', missing: ['Canonical runtime observations, registered workspace root, and round source reader must be configured.'] };
      const before = await this.roundBasis(roundScope(scope), reviewWorkRef);
      if (expected) {
        const { sourceDigest: _source, sourceProofDigest: _proof, ...canonicalExpected } = expected;
        roundEnsure(same(before.identity, canonicalExpected), 'stale_material', 'identity', 'Canonical verification material changed from the frozen round.');
      }
      const source = await this.deps.roundSource.capture(before.root);
      if (source.status !== 'ready') return source;
      roundEnsure(/^[a-f0-9]{64}$/.test(source.sourceDigest), 'source_changed', 'sourceDigest', 'Source reader did not provide a complete source digest.');
      // Filesystem I/O may overlap a new plan, numeric workspace revision or
      // unresolved run. Re-read all canonical bindings before exposing material.
      const after = await this.roundBasis(roundScope(scope), reviewWorkRef);
      roundEnsure(same(before.identity, after.identity), 'stale_material', 'identity', 'Canonical verification material changed during source capture.');
      const identity: VerificationRoundMaterialIdentity = {
        ...after.identity,
        sourceDigest: source.sourceDigest,
        sourceProofDigest: fingerprint(source.sourceProof),
      };
      roundEnsure(!expected || same(identity, expected), 'stale_material', 'identity', 'Workspace source or comparison base changed from the frozen round.');
      return { status: 'ready', material: structuredClone({
        run: after.run, plan: after.plan, task: after.task, root: after.root,
        workspaceRevision: after.identity.workspaceRevision,
        policyContent: after.policyContent, baselineContent: after.baselineContent,
        sourceDigest: source.sourceDigest, sourceProof: source.sourceProof,
        changeScope: source.changeScope, semanticChange: 'semantic' as const,
        risks: [], gaps: source.gaps, identity,
      }) };
    } catch (error) {
      if (error instanceof RoundMaterialError) return { status: 'rejected', code: error.code, issues: [{ path: error.path, message: error.message }] };
      return { status: 'incomplete', code: 'material_unavailable', missing: [error instanceof Error ? error.message : 'Canonical verification material is unavailable.'] };
    }
  }

  private async roundBasis(scope: VerificationRoundScope, reviewWorkRef?: ReviewWorkRef) {
    const observations = this.deps.runtime!.all();
    const matching = observations.filter(record => same(vScope(record.spec), vScope(scope)));
    roundEnsure(matching.length === 1, 'not_found', 'runRef', 'Exactly one persisted runtime observation must match this scope.');
    const record = matching[0]!;
    roundEnsure(['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(record.status), 'run_unsettled', 'runRef', 'Runtime observation has not ended with known effects.');
    let ownReviewRunId: string | null = null;
    if (reviewWorkRef) {
      const loaded = await this.deps.ledger.load(reviewWorkRef);
      roundEnsure(loaded.status === 'found' && loaded.snapshot.ref.aggregateType === 'ReviewWork' && same(loaded.snapshot.ref, reviewWorkRef), 'not_found', 'workRef', 'Canonical review work is unavailable');
      const work = loaded.snapshot as ReviewWorkSnapshot;
      roundEnsure(work.protocol === 'independent-review-v1' && same(work.descriptor.subject.scope, scope) && work.reviewerRunRef.runId !== scope.runId &&
        work.reviewerProfile.mode === 'review' && work.reviewerProfile.permissions.writeScope.length === 0 && same(work.reviewerProfile.permissions.tools, ['read']) && same(work.roleBinding, work.reviewerProfile.roleBinding),
      'scope_mismatch', 'workRef', 'Review currentness requires the exact independent readonly work');
      const reviewRun = await this.deps.ledger.load(work.reviewerRunRef);
      roundEnsure(reviewRun.status === 'found' && reviewRun.snapshot.ref.aggregateType === 'Run', 'not_found', 'reviewerRunRef', 'Canonical Reviewer Run is unavailable');
      const run = reviewRun.snapshot as RunSnapshot;
      roundEnsure(run.outcome !== 'outcome_unknown', 'run_unsettled', 'reviewerRunRef', 'Canonical Reviewer outcome requires reconciliation');
      roundEnsure(same(run.work, { kind: 'review', reviewWorkRef }) && same(run.roleBinding, work.roleBinding) && same(run.planRef, work.planRef) && same(run.task, work.subject) && run.attemptId === work.reviewerAttemptRef.attemptId && run.workspaceSnapshot.workspaceId === scope.workspaceId,
        'scope_mismatch', 'reviewerRunRef', 'Reviewer Run does not match canonical work');
      if (run.envelope) roundEnsure(same(run.envelope.work, run.work) && same(run.envelope.permissions.tools, ['read']) && run.envelope.permissions.writeScope.length === 0,
        'scope_mismatch', 'reviewerRunRef', 'Reviewer envelope is not readonly');
      for (const other of observations as ReturnType<ReviewerRuntimeObservations['all']>) {
        if (other.spec.runId !== run.ref.runId || other.spec.projectId !== scope.projectId || other.spec.goalId !== scope.goalId) continue;
        roundEnsure(other.spec.workspaceId === scope.workspaceId && other.spec.taskId === scope.taskId && other.spec.mode === 'review' && same(other.spec.review, { workRef: reviewWorkRef, profile: work.reviewerProfile }) && same(other.spec.budget, work.reviewerProfile.budget),
          'scope_mismatch', 'reviewerRunRef', 'Persisted reviewer preparation disagrees with work/profile');
        roundEnsure(other.status !== 'outcome_unknown', 'run_unsettled', 'reviewerRunRef', 'Reviewer outcome requires reconciliation');
        roundEnsure(!(['prepared', 'running'].includes(other.status) && run.status === 'ended'), 'run_unsettled', 'reviewerRunRef', 'Canonical and observed Reviewer lifecycle disagree');
        if (['prepared', 'running'].includes(other.status)) ownReviewRunId = run.ref.runId;
      }
    }
    roundEnsure(!observations.some(other => other.spec.projectId === scope.projectId && other.spec.workspaceId === scope.workspaceId && ['prepared', 'running', 'outcome_unknown'].includes(other.status) &&
      !(other.spec.goalId === scope.goalId && other.spec.runId === ownReviewRunId && ['prepared', 'running'].includes(other.status))), 'run_unsettled', 'workspaceRef', 'Workspace has an active or unreconciled runtime observation.');
    if ('taskId' in record.spec) roundEnsure(record.spec.taskId === scope.taskId, 'scope_mismatch', 'taskId', 'Runtime observation belongs to another task.');

    const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId };
    const loadedRun = await this.deps.ledger.load(runRef);
    roundEnsure(loadedRun.status === 'found', 'not_found', 'runRef', 'Canonical Run was not found.');
    roundEnsure(loadedRun.snapshot.ref.aggregateType === 'Run' && same(loadedRun.snapshot.ref, runRef), 'scope_mismatch', 'runRef', 'Canonical Run identity does not match.');
    const run = loadedRun.snapshot as RunSnapshot;
    roundEnsure(run.status === 'ended' && run.outcome !== null && run.outcome !== 'outcome_unknown' && run.envelope, 'run_unsettled', 'runRef', 'Canonical Run has not ended with a known outcome.');
    const envelope = run.envelope;
    const expectedOutcome = record.status === 'failed' ? ['failed', 'crashed'] : [record.status];
    roundEnsure(expectedOutcome.includes(run.outcome), 'run_unsettled', 'runRef', 'Persisted runtime and canonical Run outcomes disagree.');
    roundEnsure(same(run.task, { projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId }) &&
      same(envelope.runRef, runRef) && envelope.projectId === scope.projectId && envelope.workspaceId === scope.workspaceId && envelope.goalId === scope.goalId && envelope.taskId === scope.taskId &&
      envelope.attemptRef.projectId === scope.projectId && envelope.attemptRef.goalId === scope.goalId && envelope.attemptRef.taskId === scope.taskId && envelope.attemptRef.attemptId === run.attemptId &&
      run.workspaceSnapshot.workspaceId === scope.workspaceId && same(run.workspaceSnapshot, envelope.workspaceSnapshot) && same(run.planRef, envelope.planRef) && same(run.roleBinding, envelope.roleBinding),
    'scope_mismatch', 'envelope', 'Run, task, attempt, workspace and frozen envelope identities must agree.');

    const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: scope.goalId };
    const loadedGoal = await this.deps.ledger.load(goalRef);
    roundEnsure(loadedGoal.status === 'found', 'not_found', 'goalRef', 'Canonical Goal was not found.');
    roundEnsure(isGoalSnapshot(loadedGoal.snapshot) && same(loadedGoal.snapshot.ref, goalRef), 'scope_mismatch', 'goalRef', 'Canonical Goal identity does not match.');
    const goal = loadedGoal.snapshot;
    const workspaceRef = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
    roundEnsure(same(goal.workspaceRef, workspaceRef), 'scope_mismatch', 'workspaceRef', 'Goal belongs to another workspace.');
    roundEnsure(goal.activePlanRevision && goal.activePlanRevision.projectId === scope.projectId && same(goal.activePlanRevision, run.planRef), 'stale_material', 'planRef', 'Run is not bound to the current active plan.');
    const loadedPlan = await this.deps.ledger.load(goal.activePlanRevision);
    roundEnsure(loadedPlan.status === 'found', 'not_found', 'planRef', 'Accepted Plan was not found.');
    roundEnsure(isPlanSnapshot(loadedPlan.snapshot) && same(loadedPlan.snapshot.ref, goal.activePlanRevision), 'scope_mismatch', 'planRef', 'Accepted Plan identity does not match.');
    const plan = loadedPlan.snapshot;
    roundEnsure(same(plan.goalRef, goalRef) && plan.ref.projectId === scope.projectId && plan.planId === plan.ref.planId, 'scope_mismatch', 'planRef', 'Accepted Plan belongs to another goal or project.');
    const tasks = plan.tasks.filter(task => task.taskId === scope.taskId);
    roundEnsure(tasks.length === 1, 'not_found', 'taskId', 'Task is not uniquely present in the accepted Plan.');
    const task = tasks[0]!;
    roundEnsure(task.disposition === 'active', 'stale_material', 'taskId', 'Task is not active in the accepted Plan.');
    const loadedWorkspace = await this.deps.ledger.load(workspaceRef);
    roundEnsure(loadedWorkspace.status === 'found', 'not_found', 'workspaceRef', 'Canonical Workspace was not found.');
    roundEnsure(isWorkspaceSnapshot(loadedWorkspace.snapshot) && same(loadedWorkspace.snapshot.ref, workspaceRef), 'scope_mismatch', 'workspaceRef', 'Canonical Workspace identity does not match.');
    const workspace = loadedWorkspace.snapshot;
    roundEnsure(workspace.revision >= run.workspaceSnapshot.revision, 'stale_material', 'workspaceRevision', 'Workspace predates the canonical Run.');

    const policyPin = plan.effectiveCompletionPolicy, baselinePin = plan.effectiveArchitectureBaseline;
    roundEnsure(policyPin.ref.projectId === scope.projectId && baselinePin.ref.projectId === scope.projectId, 'scope_mismatch', 'pins', 'Plan governance pins belong to another project.');
    const policy = await this.policy(plan), baseline = await this.baseline(plan);
    roundEnsure(policy.status === 'found' && baseline.status === 'found', 'dangling_ref', 'pins', 'Pinned policy or baseline cannot be resolved exactly.');
    roundEnsure(same(policy.snapshot.ref, policyPin.ref) && same(baseline.snapshot.ref, baselinePin.ref) &&
      governanceContentDigest({ schemaVersion: policy.snapshot.schemaVersion, identity: { policyId: policy.snapshot.policyId }, revision: policy.snapshot.contentRevision, content: policy.snapshot.content }) === policyPin.digest &&
      governanceContentDigest({ schemaVersion: baseline.snapshot.schemaVersion, identity: { baselineId: baseline.snapshot.baselineId }, revision: baseline.snapshot.contentRevision, content: baseline.snapshot.content }) === baselinePin.digest,
    'dangling_ref', 'pins', 'Pinned governance body or identity does not match its digest.');
    const root = this.deps.rootFor!(scope.projectId, scope.workspaceId);
    roundEnsure(typeof root === 'string' && root.length > 0, 'not_found', 'workspaceRoot', 'Workspace root is not registered.');
    return {
      run, plan, task, root, policyContent: policy.snapshot.content, baselineContent: baseline.snapshot.content,
      identity: {
        schemaVersion: 1 as const, scope, runRef, runRevision: run.revision, runDigest: fingerprint(run),
        planRef: plan.ref, planRevision: plan.planRevision, planDigest: fingerprint(plan), taskDigest: fingerprint(task),
        goalRevision: goal.revision, goalDigest: fingerprint(goal), workspaceRevision: workspace.revision,
        workspaceDigest: fingerprint(workspace), workspaceRoot: root, policyPin, baselinePin,
      },
    };
  }
  async resolveVerification(request: VerificationRequestV1): Promise<VerificationMaterialResult> {
    const issue = (path: string, message: string): VerificationIssue => ({ path, message });
    // -- 1. Resolve the goal + workspace (canonical facts; not_found when missing).
    const goalResult = await this.deps.ledger.load({
      aggregateType: "Goal",
      projectId: request.projectId,
      goalId: request.goalId,
    });
    if (goalResult.status !== "found" || !isGoalSnapshot(goalResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [
          issue("goalRef", "goal not found for project '" + request.projectId + "' goal '" + request.goalId + "'"),
        ],
      };
    }
    const goalSnapshot = goalResult.snapshot as GoalSnapshot;
    const workspaceResult = await this.deps.ledger.load(goalSnapshot.workspaceRef);
    if (workspaceResult.status !== "found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [issue("workspaceRef", "workspace not found for the goal")],
      };
    }
    const canonicalWorkspaceRevision = (workspaceResult.snapshot as WorkspaceSnapshot).revision;
    // workspaceRevision: default = the canonical workspace revision. An explicit
    // value that diverges from canonical is stale — the engine cannot compile a
    // valid plan for a workspace revision that is not the current one. Stable code:
    // "invalid" (the request references a revision that does not exist as current);
    // it is NOT a pin/ref resolution failure and NOT a budget exhaustion.
    if (request.workspaceRevision !== undefined && request.workspaceRevision !== canonicalWorkspaceRevision) {
      return {
        status: "rejected",
        code: "invalid",
        issues: [
          issue(
            "workspaceRevision",
            "requested workspace revision " +
            request.workspaceRevision +
            " != canonical " +
            canonicalWorkspaceRevision
          ),
        ],
      };
    }
    const workspaceRevision = request.workspaceRevision ?? canonicalWorkspaceRevision;
    // -- 2. Load the plan by the request.planRef (not_found).
    const planResult = await this.deps.ledger.load(request.planRef);
    if (planResult.status !== "found" || !isPlanSnapshot(planResult.snapshot)) {
      return {
        status: "rejected",
        code: "not_found",
        issues: [issue("planRef", "plan revision not found")],
      };
    }
    const planSnapshot = planResult.snapshot as PlanRevisionSnapshot;
    // -- 3. Resolve the pinned policy + baseline by the plan snapshot's frozen
    //        pins (triple match via the read-only governance helpers).
    const policyPin = planSnapshot.effectiveCompletionPolicy;
    const policyResolution = await resolveCompletionPolicyRevision(this.deps.ledger, policyPin.ref, policyPin.digest);
    if (policyResolution.status !== "found") {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue("pinnedCompletionPolicy", "installed CompletionPolicy revision does not match the plan snapshot pin"),
        ],
      };
    }
    const baselinePin = planSnapshot.effectiveArchitectureBaseline;
    const baselineResolution = await resolveArchitectureBaselineRevision(this.deps.ledger, baselinePin.ref, baselinePin.digest);
    if (baselineResolution.status !== "found") {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue("pinnedArchitectureBaseline", "installed ArchitectureBaseline revision does not match the plan snapshot pin"),
        ],
      };
    }
    const policyContent = policyResolution.snapshot.content;
    // Caller-declared pins, when present, must be exactly the plan snapshot's
    // frozen pins — a stale declaration is rejected (no fallback).
    if (request.pinnedCompletionPolicy !== undefined &&
      canonicalJson(request.pinnedCompletionPolicy) !== canonicalJson(policyPin)) {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue("pinnedCompletionPolicy", "request's declared CompletionPolicy pin is stale (does not match the plan snapshot pin)"),
        ],
      };
    }
    if (request.pinnedArchitectureBaseline !== undefined &&
      canonicalJson(request.pinnedArchitectureBaseline) !== canonicalJson(baselinePin)) {
      return {
        status: "rejected",
        code: "dangling_ref",
        issues: [
          issue("pinnedArchitectureBaseline", "request's declared ArchitectureBaseline pin is stale (does not match the plan snapshot pin)"),
        ],
      };
    }
    return { status: 'ready', planSnapshot, workspaceRevision, policyContent };
  }
  async run(scope: Scope) {
    ensure(this.deps.runtime && this.deps.rootFor, '运行核验 Context 未配置');
    const record = this.deps.runtime.all().find(r => canonicalJson(vScope(r.spec)) === canonicalJson(vScope(scope)));
    ensure(record && !['prepared', 'running', 'outcome_unknown'].includes(record.status), '该作用域无已结束且结果明确的运行');
    ensure(
      !this.deps.runtime.all().some(r => r.spec.projectId === scope.projectId && r.spec.workspaceId === scope.workspaceId && ['prepared', 'running', 'outcome_unknown'].includes(r.status)),
      '工作区存在活动或待对账运行'
    );
    const loaded = await this.deps.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId });
    ensure(loaded.status === 'found', '运行缺少正式控制记录');
    const run = loaded.snapshot as RunSnapshot;
    ensure(run.status === 'ended' && run.envelope && run.envelope.workspaceId === scope.workspaceId, '正式运行尚未结束或工作区不匹配');
    const g = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    ensure(g.status === 'found', '目标不存在');
    const goal = g.snapshot as GoalSnapshot;
    ensure(goal.workspaceRef.workspaceId === scope.workspaceId && goal.activePlanRevision, '目标工作区或计划不匹配');
    const p = await this.deps.ledger.load(goal.activePlanRevision);
    ensure(p.status === 'found', '计划不存在');
    const plan = p.snapshot as PlanRevisionSnapshot;
    ensure(canonicalJson(run.envelope.planRef) === canonicalJson(plan.ref), '运行计划已过期');
    const w = await this.deps.ledger.load(goal.workspaceRef);
    ensure(w.status === 'found', '工作区不存在');
    return {
      run,
      plan,
      workspaceRevision: w.snapshot.revision,
      root: this.deps.rootFor(scope.projectId, scope.workspaceId)
    };
  }
  policy(plan: PlanRevisionSnapshot) {
    return resolveCompletionPolicyRevision(this.deps.ledger, plan.effectiveCompletionPolicy.ref, plan.effectiveCompletionPolicy.digest);
  }
  baseline(plan: PlanRevisionSnapshot) {
    return resolveArchitectureBaselineRevision(this.deps.ledger, plan.effectiveArchitectureBaseline.ref, plan.effectiveArchitectureBaseline.digest);
  }
  async taskReductionRevision(scope: {
    projectId: string;
    goalId: string;
    taskId: string;
  }) {
    const result = await this.deps.ledger.load({
      aggregateType: 'TaskReduction',
      projectId: scope.projectId,
      goalId: scope.goalId,
      taskId: scope.taskId
    });
    return result.status === 'found' ? result.snapshot.revision : 0;
  }
  async goalPhaseRevision(scope: {
    projectId: string;
    goalId: string;
  }) {
    const result = await this.deps.ledger.load({
      aggregateType: 'GoalPhase',
      projectId: scope.projectId,
      goalId: scope.goalId
    });
    return result.status === 'found' ? result.snapshot.revision : 0;
  }
  async writeLease(projectId: string, leaseId: string) {
    const result = await this.deps.ledger.load({ aggregateType: 'WorkspaceWriteLease', projectId, leaseId });
    return result.status === 'found' ? result.snapshot as WorkspaceWriteLeaseSnapshot : null;
  }
  async patchRecord(projectId: string, patchId: string) {
    const result = await this.deps.ledger.load({ aggregateType: 'PatchRecord', projectId, patchId });
    return result.status === 'found' ? result.snapshot as PatchRecordSnapshot : null;
  }
  openReport(ref: ArtifactRef, owner: RunRef) {
    return this.deps.vault.open(ref, { requesterRunRef: owner });
  }
  workspaceDigest(scope: Scope) {
    ensure(this.deps.rootFor && this.deps.workspaceSource, '工作区核验 Context 未配置');
    return this.deps.workspaceSource.digest(this.deps.rootFor(scope.projectId, scope.workspaceId));
  }
}
