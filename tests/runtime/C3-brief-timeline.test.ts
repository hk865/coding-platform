/**
 * Lead decision LA-10 (docs/refactor/STATE-MACHINES-SPEC.md §6.1 contract (e) `workspace`, appendix B LA-10):
 * the workspace timeline of a continuation brief, assembled by the pure `assembleContinuationBrief`.
 *
 * When the afterRun never entered the Kernel, the brief's facts come from an earlier Run (`factsFrom`). The
 * `round_open` checkpoint is that Run's round, stamped at that Run's end, and the unobserved window starts at the
 * same end, so the section speaks of one Run and no interval runs backwards. The scenario
 * `tests/scenarios/C3-not-entered-chain.test.ts` runs on a fixed clock, where every Run ends at the same instant;
 * here the facts Run, the never-entered afterRun and the requeues each have their own time.
 *
 * Pure: no RecordStore, no Kernel, no clock. Only the fields the assembler reads are real; the rest are cast.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import {
  continuationBriefShapeProblem, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { RoundCheckSnapshot, RoundSnapshot } from '../../src/contracts/verification.js';
import type { VerificationRoundMaterialIdentity } from '../../src/contracts/verification-context.js';
import { assembleContinuationBrief } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';

const P = 'c3t-project', G = 'c3t-goal', T = 'c3t-task', W = 'c3t-workspace';
const sha = (char: string): string => char.repeat(64);
const at = (minute: number): string => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
/** Run 1 (the facts Run) ends first; Run 2 (never entered) ends much later; Run 3 gets the brief. */
const RUN1_END = at(5), REQUEUE1_AT = at(6), RUN2_END = at(20), REQUEUE2_AT = at(30), BRIEF_AT = at(31);

const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const SESSION: SessionRef = { projectId: P, sessionId: 'session-1' };
const HUMAN = { kind: 'human', id: 'operator-1' } as const;
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });

function runOf(runId: string, over: Partial<RunSnapshot>): RunSnapshot {
  return {
    ref: runRef(runId), revision: 4, schemaVersion: 1, task: { ...task }, attemptId: `${runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 3 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`,
    lastFactEventId: `ev-${runId}`, envelope: null, startedAt: at(1), endedAt: RUN1_END, ...over,
  };
}
/** Only `run`, the attempt ref and the claim Session are read. */
const recordOf = (run: RunSnapshot): TaskExecutionRecord => ({ run,
  attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: run.attemptId } },
  outbox: { claim: { sessionRef: SESSION } } }) as unknown as TaskExecutionRecord;

const report: ArtifactRef = { kind: 'artifact', contentType: 'application/json', digest: sha('d'), sizeBytes: 40,
  source: { kind: 'workspace', refId: `${W}:c1`, revision: '1' } };
const failedCheck: RoundCheckSnapshot = {
  checkId: 'c1', definition: { checkId: 'c1', kind: 'static', command: 'npm run c1', cwd: '.', timeoutMs: 60_000, taskIds: 'all' },
  coverage: [], phase: 'finished', invocationId: 'inv-c1', outcome: 'FAIL', reportRef: report, sourceStatus: 'matched',
  incompleteCause: null,
};
/** The round that checked `runId`, captured on source `seed` at workspace revision 3. */
function roundOf(runId: string, seed: string): RoundSnapshot {
  return {
    ref: { aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId: T, runId, roundId: `round-${runId}` },
    revision: 3, schemaVersion: 1, subject: { ...task }, subjectRunRef: runRef(runId), adoptedPlanRef: PLAN, taskBasisRef: PLAN,
    executor: HUMAN, configuration: {} as RoundSnapshot['configuration'], configurationDigest: sha('c'),
    identity: { sourceDigest: sha(seed), workspaceRevision: 3 } as unknown as VerificationRoundMaterialIdentity,
    sourceProof: {} as RoundSnapshot['sourceProof'], verificationPlan: {} as RoundSnapshot['verificationPlan'],
    status: 'finalized', outcome: 'FAIL', checks: [structuredClone(failedCheck)], gaps: [], evidenceRefs: [],
    chain: { schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null, supersededEvidenceIds: [],
      basisDigests: [], autoCount: 0, reverify: null },
  };
}

const KEY: NoProgressKeyV1 = { taskRef: task, actionKind: 'requeue',
  failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('1') }, plan: PLAN, newInputDigest: null, digest: sha('2') };
function requeueOf(afterRunId: string, over: Partial<TaskRequeueSnapshotV1>): TaskRequeueSnapshotV1 {
  return {
    ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId }, revision: 1, schemaVersion: 1, task,
    planRef: PLAN, afterRunRef: runRef(afterRunId),
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: `${afterRunId}-attempt` },
    afterOutcome: 'completed', afterRoundRef: null, failureClass: 'check_failed', interruption: null, stopIntentRef: null,
    stopRequester: 'none', basis: KEY, basisComparison: 'compared', supersededEvidenceIds: [], newInputRefs: [], budget: null,
    reason: 'auto-rework:check_failed#1', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, requestedAt: REQUEUE1_AT,
    agentProvenance: null, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 }, historySource: null, ...over,
  };
}

/**
 * Run 1 ends at RUN1_END (checked by `round1` when `checked`, otherwise crashed without a round); the Workflow
 * requeues it, and Run 2 is claimed from that requeue and cancelled before it starts (RUN2_END, never entered); a
 * person requeues after Run 2 and Run 3 gets the brief. Nothing changed the source in between.
 */
function notEnteredBrief(checked: boolean): { brief: ContinuationBriefV1; round1: RoundSnapshot } {
  const round1 = roundOf('run-1', '1');
  const run1 = runOf('run-1', checked ? {} : { outcome: 'crashed', exitCode: null,
    terminalPayload: { kind: 'crashed', error: 'model stream failed' } });
  const requeue1 = requeueOf('run-1', checked ? { afterRoundRef: round1.ref }
    : { afterOutcome: 'crashed', failureClass: 'run_failed', reason: 'auto-rework:run_failed#1' });
  const run2 = runOf('run-2', { outcome: 'cancelled', exitCode: null, startedAt: null, endedAt: RUN2_END, requeueRef: requeue1.ref });
  const requeue2 = requeueOf('run-2', { afterOutcome: 'cancelled', failureClass: 'cancelled', stopRequester: 'human',
    reason: 'the person continues after stopping Run 2', requestedBy: HUMAN, requestedAt: REQUEUE2_AT,
    automation: { automatic: false, counted: false, autoCount: 0, cap: null } });
  const run3 = runOf('run-3', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null,
    requeueRef: requeue2.ref });
  const basis: ContinuationBasis = { run: run3, requeue: requeue2, allRequeues: [requeue1, requeue2], previous: recordOf(run2),
    previousIntents: { pointer: null, steers: [] }, previousWait: null, round: null, newInputBodies: [], replyBodies: [],
    factsChain: [{ requeue: requeue1, run: recordOf(run1), round: checked ? round1 : null }], readThrough: null };
  const brief = assembleContinuationBrief({ basis, factsRecord: recordOf(run1), factsHops: 1, factsTruncated: false,
    turn: { kernel: 'unavailable', reason: 'the Kernel store is not registered' },
    workspace: { briefCheckpoint: { kind: 'brief', at: BRIEF_AT, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null },
      uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null } },
    claimSessionRef: SESSION });
  return { brief, round1 };
}

function unobservedLine(brief: ContinuationBriefV1): string | undefined {
  return renderContinuationBriefZh(brief, sha('e')).split('\n').find(line => line.startsWith('- 上一次执行结束'));
}

describe('LA-10: the workspace timeline after an afterRun that never entered the Kernel', () => {
  it('round_open is the facts Run\'s round at that Run\'s end, and the unobserved window starts at the same end', () => {
    const { brief, round1 } = notEnteredBrief(true);
    expect(continuationBriefShapeProblem(brief)).toBeNull();
    // The brief still names Run 2 as the previous Run; its facts and checks are Run 1's.
    expect(brief.previous).toMatchObject({ runRef: runRef('run-2'), outcome: 'cancelled', endedAt: RUN2_END });
    expect(brief.factsFrom).toEqual({ runRef: runRef('run-1'), hops: 1, truncated: false });
    expect(brief.checks).toMatchObject({ roundRef: round1.ref, failing: [{ checkId: 'c1', outcome: 'FAIL' }] });
    expect(brief.workspace.checkpoints).toEqual([
      { kind: 'round_open', at: RUN1_END, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null },
      { kind: 'requeue', at: REQUEUE2_AT, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null },
      { kind: 'brief', at: BRIEF_AT, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null }]);
    expect(brief.workspace.unobserved).toEqual({ from: 'previous_run_end', to: 0, previousEndedAt: RUN1_END });
    expect(unobservedLine(brief)).toBe(`- 上一次执行结束（${RUN1_END}）到“检查轮次开始”之间：无法从持久记录确定是否有改动。`);
  });

  it('without a round of the facts Run the timeline starts at the requeue, and the unobserved window still starts at the facts Run\'s end', () => {
    const { brief } = notEnteredBrief(false);
    expect(continuationBriefShapeProblem(brief)).toBeNull();
    expect(brief.checks).toBeNull();
    expect(brief.workspace.checkpoints.map(checkpoint => [checkpoint.kind, checkpoint.at]))
      .toEqual([['requeue', REQUEUE2_AT], ['brief', BRIEF_AT]]);
    expect(brief.workspace.unobserved).toEqual({ from: 'previous_run_end', to: 0, previousEndedAt: RUN1_END });
    expect(unobservedLine(brief)).toBe(`- 上一次执行结束（${RUN1_END}）到“重新入队”之间：无法从持久记录确定是否有改动。`);
  });

  it('an afterRun that entered keeps its own round and its own end', () => {
    const round2 = roundOf('run-2', '1');
    const run2 = runOf('run-2', { startedAt: at(10), endedAt: RUN2_END });
    const requeue2 = requeueOf('run-2', { afterRoundRef: round2.ref, requestedAt: REQUEUE2_AT });
    const run3 = runOf('run-3', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null,
      requeueRef: requeue2.ref });
    const basis: ContinuationBasis = { run: run3, requeue: requeue2, allRequeues: [requeue2], previous: recordOf(run2),
      previousIntents: { pointer: null, steers: [] }, previousWait: null, round: round2, newInputBodies: [], replyBodies: [],
      factsChain: [], readThrough: null };
    const brief = assembleContinuationBrief({ basis, factsRecord: recordOf(run2), factsHops: 0, factsTruncated: false,
      turn: { kernel: 'unavailable', reason: 'the Kernel store is not registered' },
      workspace: { briefCheckpoint: { kind: 'brief', at: BRIEF_AT, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null },
        uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null } },
      claimSessionRef: SESSION });
    expect(continuationBriefShapeProblem(brief)).toBeNull();
    expect(brief.workspace.checkpoints[0]).toEqual(
      { kind: 'round_open', at: RUN2_END, workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null });
    expect(brief.workspace.unobserved).toEqual({ from: 'previous_run_end', to: 0, previousEndedAt: RUN2_END });
  });
});
