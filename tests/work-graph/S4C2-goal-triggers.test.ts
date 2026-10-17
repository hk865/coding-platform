/**
 * S4C2-3 (spec §11.5, U-9): the three-step `readGoalTriggerRecords` reader.
 *
 * Every record is a real encoded literal: Runs are hand-built JSON (the reader
 * only `parseRun`s them), TaskReductions are minimal `parseReduction`-valid
 * JSON, TaskRequeues and the T2 source Plan go through the real
 * `encodeTaskRequeueSnapshot` / `encodePlanRevisionSnapshot` codecs so the
 * strict decoders accept them. `records` is a small fake with a canned
 * `lookup` page and a `readMany` map; no real backend is opened.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { RunRef, TaskAttemptRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { encodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { encodeTaskRequeueSnapshot } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { readGoalTriggerRecords } from '../../src/core/work-graph/tasks/plan-readers.js';

const P = 's4c2-project';
const G = 's4c2-goal';
const W = 's4c2-workspace';
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const sha = (c: string): string => c.repeat(64);
const planRefOf = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: P, planId });
const taskTriple = (taskId: string): TaskTriple => ({ projectId: P, goalId: G, taskId });
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (taskId: string, attemptId: string): TaskAttemptRef =>
  ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId, attemptId });

const PLAN_AT = '2026-10-01T00:00:00.000Z';
const SOURCE_AT = '2026-09-01T00:00:00.000Z';
const REDUCED_AT = '2026-10-05T00:00:00.000Z';
const REWORK_AT = '2026-10-06T00:00:00.000Z';
const ARCHIVE_AT = '2026-10-07T00:00:00.000Z';

function runtimeTask(taskId: string, disposition: RuntimeTask['disposition'] = 'active'): RuntimeTask {
  return { taskId, stageId: 's1', title: taskId, requirementLevel: 'required', taskKind: 'work',
    disposition, phase: 'pending', scope: { kind: 'stage', stageId: 's1' } };
}

function planSnapshot(planId: string, acceptedAt: string, tasks: RuntimeTask[], planRevision = 7): PlanRevisionSnapshot {
  return { schemaVersion: 1, ref: planRefOf(planId), revision: 1, goalRef, planId, planRevision, acceptedAt,
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P,
      policyId: 'policy', revision: 1 }, digest: sha('a') },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P,
      baselineId: 'baseline', revision: 1 }, digest: sha('b') },
    stages: [{ stageId: 's1', title: 'Stage 1' }], tasks, obligations: [],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
}

function runRecord(runId: string, taskId: string, status: 'starting' | 'running' | 'ended',
  requeue?: TaskRequeueSnapshotV1['ref']): EncodedRecord {
  const body: Record<string, unknown> = { ref: runRef(runId), task: taskTriple(taskId), planRef: planRefOf('plan-1'),
    status, attemptId: `${runId}-attempt`, startedAt: null, endedAt: null };
  if (requeue !== undefined) body['requeueRef'] = requeue;
  return { refKey: canonicalJson(runRef(runId) as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1,
    json: JSON.stringify(body) };
}

function reductionRecord(taskId: string, phase: string, revision: number, reducedAt: string): EncodedRecord {
  const ref = { aggregateType: 'TaskReduction', projectId: P, goalId: G, taskId };
  return { refKey: canonicalJson(ref as unknown as JsonValue), schemaId: 'TaskReductionSnapshot@1', revision,
    json: JSON.stringify({ ref, revision, schemaVersion: 1, phase, reducedAt }) };
}

function requeueBasis(): NoProgressKeyV1 {
  return { taskRef: taskTriple('t1'), actionKind: 'requeue',
    failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null,
      checks: [{ checkId: 'lint', phase: 'finished', outcome: 'FAIL', cause: null }], gapCodes: [] },
    source: { workspaceRevision: 4, sourceDigest: sha('5') }, plan: planRefOf('plan-1'),
    newInputDigest: null, digest: sha('b') };
}

function requeueSnapshot(afterRunId: string, requestedAt: string,
  archiveOrigin: TaskRequeueSnapshotV1['archiveOrigin'] = null): TaskRequeueSnapshotV1 {
  const requestedBy: ActorRef = { kind: 'system', id: 'workflow:auto-rework' };
  return { ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: 't1', afterRunId }, revision: 1,
    schemaVersion: 1, task: taskTriple('t1'), planRef: planRefOf('plan-1'), afterRunRef: runRef(afterRunId),
    afterAttemptRef: attemptRef('t1', `${afterRunId}-attempt`), afterOutcome: 'completed', afterRoundRef: null,
    failureClass: 'check_failed', interruption: null, stopIntentRef: null, stopRequester: 'none',
    basis: requeueBasis(), basisComparison: 'compared', supersededEvidenceIds: [], newInputRefs: [], budget: null,
    reason: 'retry the failed work', requestedBy, requestedAt, agentProvenance: null,
    automation: { automatic: true, counted: true, autoCount: 1, cap: 3 }, historySource: null, archiveOrigin };
}

type FakeInput = { runs: EncodedRecord[]; present?: EncodedRecord[] };

function fakeRecords(input: FakeInput): GoalRecordTransactionPort & RecordLookupPort {
  const present = new Map([...input.runs, ...(input.present ?? [])].map(record => [record.refKey, record]));
  return {
    async readMany(refKeys: readonly string[]) {
      const records: EncodedRecord[] = [];
      const missing: string[] = [];
      for (const refKey of refKeys) {
        const record = present.get(refKey);
        if (record === undefined) missing.push(refKey); else records.push(record);
      }
      return { status: 'ready' as const, value: { records, missing, readThrough: null } };
    },
    async lookup(_request: RecordLookupRequest) {
      return { status: 'ready' as const, value: { records: [...input.runs], next: null, readThrough: null } };
    },
  } as unknown as GoalRecordTransactionPort & RecordLookupPort;
}

const byKey = (left: { key: string }, right: { key: string }): number =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : 0;

describe('S4C2-3 readGoalTriggerRecords (spec §11.5, U-9)', () => {
  it('S4C2-3a: T1 reads a satisfied TaskReduction as task_end#r<revision> at reducedAt', async () => {
    const plan = planSnapshot('plan-1', PLAN_AT, [runtimeTask('t1')]);
    const records = fakeRecords({ runs: [runRecord('run-1', 't1', 'ended')],
      present: [reductionRecord('t1', 'satisfied', 2, REDUCED_AT)] });
    const result = await readGoalTriggerRecords(records, goalRef, plan);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect([...result.triggers].sort(byKey)).toEqual([
      { key: 'plan:p7', at: PLAN_AT, kind: 'plan', taskId: null },
      { key: 'task_end:t1#r2', at: REDUCED_AT, kind: 'task_end', taskId: 't1' },
    ]);
  });

  it('S4C2-3b: a TaskReduction that is not satisfied produces no task_end', async () => {
    const plan = planSnapshot('plan-1', PLAN_AT, [runtimeTask('t1')]);
    const records = fakeRecords({ runs: [runRecord('run-1', 't1', 'ended')],
      present: [reductionRecord('t1', 'verifying', 1, REDUCED_AT)] });
    const result = await readGoalTriggerRecords(records, goalRef, plan);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect([...result.triggers].sort(byKey)).toEqual([
      { key: 'plan:p7', at: PLAN_AT, kind: 'plan', taskId: null },
    ]);
  });

  it('S4C2-3c: T2 uses the FIRST terminal source plan acceptedAt when setIn is an older plan', async () => {
    const source = planSnapshot('plan-1', SOURCE_AT, [runtimeTask('t2')], 3);
    const active = { ...planSnapshot('plan-2', PLAN_AT, [runtimeTask('t2', 'cancelled')]), schemaVersion: 2,
      dispositionRecord: { schemaVersion: 1, entries: [{ taskId: 't2', from: 'active', to: 'cancelled',
        replacedByTaskId: null, traced: false, setIn: planRefOf('plan-1'),
        proposalRef: { aggregateType: 'PlanProposal', projectId: P, workspaceId: W, proposalId: 'prop-1' },
        reason: { text: 'cancel t2', sources: [], affectedTaskIds: [] },
        actor: { kind: 'human', id: 'operator' } }] } } as unknown as PlanRevisionSnapshot;
    const records = fakeRecords({ runs: [], present: [encodePlanRevisionSnapshot(source)] });
    const result = await readGoalTriggerRecords(records, goalRef, active);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect([...result.triggers].sort(byKey)).toEqual([
      { key: 'plan:p7', at: PLAN_AT, kind: 'plan', taskId: null },
      { key: 'task_end:t2@p3', at: SOURCE_AT, kind: 'task_end', taskId: 't2' },
    ]);
  });

  it('S4C2-3d: T3 makes one rework trigger per requeue; archiveOrigin replaces it with archive', async () => {
    const run1 = runRecord('run-1', 't1', 'ended');
    const run2 = runRecord('run-2', 't1', 'ended');
    const claimedRef = { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: 't1', afterRunId: 'run-2' } as const;
    const run3 = runRecord('run-3', 't1', 'running', claimedRef);
    const rework = encodeTaskRequeueSnapshot(requeueSnapshot('run-1', REWORK_AT));
    const archive = encodeTaskRequeueSnapshot(requeueSnapshot('run-2', ARCHIVE_AT,
      { kind: 'execution', anchorRef: { aggregateType: 'SessionAnomalyAnchor', projectId: P, goalId: G, runId: 'run-2' },
        archiveSessionRef: { projectId: P, sessionId: 'archive-session' }, archiveRequestId: 'archive-req-2' }));
    const plan = planSnapshot('plan-1', PLAN_AT, [runtimeTask('t1')]);
    const records = fakeRecords({ runs: [run1, run2, run3], present: [rework, archive] });
    const result = await readGoalTriggerRecords(records, goalRef, plan);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect([...result.triggers].sort(byKey)).toEqual([
      { key: 'archive:t1/run-2', at: ARCHIVE_AT, kind: 'archive', taskId: 't1' },
      { key: 'plan:p7', at: PLAN_AT, kind: 'plan', taskId: null },
      { key: 'rework:t1/run-1', at: REWORK_AT, kind: 'rework', taskId: 't1' },
    ]);
    expect([...result.claimedArchiveKeys]).toEqual(['archive:t1/run-2']);
  });

  it('S4C2-3e: plan === null drops T1/T2/T4 but still builds T3', async () => {
    const rework = encodeTaskRequeueSnapshot(requeueSnapshot('run-1', REWORK_AT));
    const records = fakeRecords({ runs: [runRecord('run-1', 't1', 'ended')], present: [rework] });
    const result = await readGoalTriggerRecords(records, goalRef, null);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.triggers).toEqual([{ key: 'rework:t1/run-1', at: REWORK_AT, kind: 'rework', taskId: 't1' }]);
  });

  it('S4C2-3h: a requeue key is only built for ended Runs', async () => {
    const requeue = encodeTaskRequeueSnapshot(requeueSnapshot('run-1', REWORK_AT));
    const records = fakeRecords({ runs: [runRecord('run-1', 't1', 'running')], present: [requeue] });
    const result = await readGoalTriggerRecords(records, goalRef, null);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.triggers).toEqual([]);
  });
});
