/**
 * Slice 2B round-2 fix helpers (R4/R5/R7/R8). Nothing here writes a record
 * except `seedActivityRun`/`authorizeOnlyRun`, which build the shapes the
 * accepted fixtures cannot reach: a Run with a V2 authorization, a Run with a
 * position record but no activity record, and a `starting` Run that is
 * authorized but not yet entered. Everything else goes through the public
 * reads/services.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type {
  ExecutionAuthorizationV2, RunOutcome, RunRef, RunSnapshot, RunStatus,
} from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { GoalExecutedFilesPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import type { S2BActivityFixture } from './S2B-activity-fixture.js';

/** A real workspace in the fixture's project that is not the Goal's workspace. */
export const FOREIGN_WORKSPACE_ID = 's2b-r2-foreign-workspace';

/** The same call context with a different bound workspace (same project). */
export function withForeignWorkspace(
  f: S2BActivityFixture, workspaceId = FOREIGN_WORKSPACE_ID,
): CoreCallContext {
  return { ...f.ctx, workspaceId };
}

/** The real L13 reader over the fixture's records port. */
export function activityGoalExecutedFiles(
  f: S2BActivityFixture,
): GoalExecutedFilesPort {
  return createGoalExecutedFilesReader({ records: f.records as never });
}

export type SeededActivityRun = {
  taskId: string; runId: string; status: RunStatus; outcome?: RunOutcome | null;
  startedAt: string | null; endedAt: string | null;
  authorization?: ExecutionAuthorizationV2;
  history?: RunExecutionHistoryV1;
};

/** Commits one Run in the activity Goal at the storage boundary (fixture shape). */
export async function seedActivityRun(
  f: S2BActivityFixture, input: SeededActivityRun,
): Promise<RunRef> {
  const goalRead = await f.b2.base.plans.queryGoal(f.ctx, f.goalRef);
  if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
    throw new Error('the S2B activity Goal has no accepted plan');
  }
  const ref: RunRef = { aggregateType: 'Run', projectId: f.b2.base.scope.projectId,
    goalId: f.goalRef.goalId, runId: input.runId };
  const snapshot: RunSnapshot = {
    ref, revision: 1, schemaVersion: 1,
    task: { projectId: f.b2.base.scope.projectId, goalId: f.goalRef.goalId, taskId: input.taskId },
    attemptId: `s2b-r2-attempt-${input.runId}`, planRef: goalRead.value.goal.activePlanRevision,
    roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget,
    workspaceSnapshot: { workspaceId: f.b2.base.scope.workspaceId, revision: 1 },
    status: input.status, outcome: input.outcome ?? null, exitCode: null, lastEventSeq: 0,
    lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
    startedAt: input.startedAt, endedAt: input.endedAt, previousRun: null,
    ...(input.authorization === undefined ? {} : { executionAuthorization: input.authorization }),
    ...(input.history === undefined ? {} : { executionHistory: input.history }),
  };
  const written = await f.b2.base.commitRaw([{ refKey: canonicalJson(ref as unknown as JsonValue),
    schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(snapshot) }]);
  if (written.status !== 'committed') throw new Error(`S2B round-2 Run seed failed: ${JSON.stringify(written)}`);
  return ref;
}

/**
 * Runs the real claim + `authorizeRuntimeEntry` only, leaving a real
 * `starting` Run with a V2 `authorized` authorization and no position record
 * (the RUN-02 shape). Mirrors the accepted fixture's `enter` without the
 * begin/entered steps.
 */
export async function authorizeOnlyRun(
  f: S2BActivityFixture, taskId: string, sessionRef: SessionRef,
): Promise<RunRef> {
  const goalRead = await f.b2.base.plans.queryGoal(f.ctx, f.goalRef);
  if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
    throw new Error('the S2B activity Goal has no accepted plan');
  }
  const request: GraphWrite<ClaimTaskInput> = {
    input: { goalRef: f.goalRef, planRef: goalRead.value.goal.activePlanRevision, taskId, sessionRef,
      roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget },
    meta: { requestId: `s2b-r2-authorize-claim-${taskId}`, expected: [
      { ref: f.goalRef, revision: goalRead.value.goal.revision },
      { ref: f.b2.base.workspaceRef, revision: 1 },
      await f.b2.base.sessionPin(sessionRef),
    ] },
  };
  const claimed = await f.b2.base.service.claimTask(f.ctx, request);
  if (claimed.status !== 'committed') throw new Error(`S2B round-2 claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;
  const prepared = await f.b2.buildPrepared({ claim });
  const sessionKernel = await f.b2.kernelFor(claim);
  const read = await createRunStateReader({ records: f.records }).readExecution(f.ctx, claim.runRef);
  if (read.status !== 'ready') throw new Error(`S2B round-2 Run read failed: ${JSON.stringify(read)}`);
  const pin: VersionPin = { ref: claim.runRef, revision: read.value.run.revision };
  const authorized = await f.b2.entry.authorizeRuntimeEntry(f.ctx, {
    input: { prepared, consumerId: 's2b-r2-authorize-runtime' },
    meta: { requestId: `s2b-r2-authorize-${taskId}`, expected: [pin] },
  });
  if (authorized.status !== 'committed') {
    throw new Error(`S2B round-2 authorize failed: ${JSON.stringify(authorized)}`);
  }
  void sessionKernel;
  return claim.runRef;
}
