/**
 * K3 L19a `rewriteOf` prefix row (binding item 11): TWO real blocked
 * `UnknownCallReview` records on ONE Task whose original Run ids are minted by
 * an INJECTED id generator with a shared 8-character prefix.
 *
 * Every fact is produced by a production owner through the SAME §5.1 stand-in
 * chain as `K3-blocked-command-fixture.ts`:
 *   - each Run is claimed by the real `createTaskClaimService` with an injected
 *     `newId` (an injected dependency, not a hand-written Run); the second
 *     claim is admitted by the real `createTaskRequeueService` after the first
 *     Run ended;
 *   - the Run is prepared by the real `createExecutionPreparation`, started by
 *     the real Runtime with a scripted model whose call is served by the
 *     blocking `shell` seam, then RUN-20 (`reconcileRunAtStartup`) + RUN-22
 *     (`resolveUnknownRun`) read the production classifier/draft and write the
 *     real `needs_decision` record;
 *   - `blockedCommands` is written by the real `skip_as_done` answer through the
 *     real decision coordinator (①) and the real UCR owner (②).
 *
 * No review item, Kernel call fact, Run, claim, blocked command or request is
 * hand-encoded here.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef, TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';
import {
  openK3BlockedReviewServices, type K3BlockedReviewServices,
} from './K3-blocked-command-fixture.js';
import { GOAL_B, T } from './S5-decision-fixture.js';

export type K3PrefixReview = {
  record: UnknownCallReviewV1;
  claim: TaskClaim;
  run: RunSnapshot;
};

// The blocked Run chain is expensive to assemble; one bundle per world keeps the
// production Kernel store and the counting readers stable across a test.
const servicesByWorld = new WeakMap<K3ReviewCardWorld, Promise<K3BlockedReviewServices>>();

function servicesOf(world: K3ReviewCardWorld): Promise<K3BlockedReviewServices> {
  const existing = servicesByWorld.get(world);
  if (existing !== undefined) return existing;
  const opened = openK3BlockedReviewServices(world, {});
  servicesByWorld.set(world, opened);
  return opened;
}

/**
 * ONE blocked record for an existing world: a REAL Run (claim → prepare →
 * startRun → classifier/draft/RUN-22) then the real `skip_as_done` answer. The
 * caller injects the Run id (`runId`), so two Runs can share a prefix.
 */
export async function createBlockedRecord(
  world: K3ReviewCardWorld,
  options: {
    taskId: string;
    runId: string;
    label: string;
    command: string;
    callId?: string;
    requeueRef?: TaskRequeueRef;
    /** A8 clock input for this seed; changes the record's `createdAt`. */
    now?: () => string;
  },
): Promise<K3PrefixReview> {
  const callId = options.callId ?? `k3-prefix-process-${options.label}`;
  const services = await servicesOf(world);
  if (options.now !== undefined) services.setNow(options.now);
  const seeded = await services.seed({
    taskId: options.taskId, label: options.label, runId: options.runId,
    commands: { [callId]: { command: options.command } },
    ...(options.requeueRef === undefined ? {} : { requeueRef: options.requeueRef }),
  });
  const record = await services.answer(seeded.record, 'skip_as_done', { text: '跳过：已经做过了' });
  if (record.blockedCommands.length === 0) {
    throw new Error('K3 prefix fixture: skip_as_done wrote no blocked command');
  }
  return { record, claim: seeded.claim, run: seeded.run };
}

/** Requeue the Task after one ended Run through the real requeue owner. */
export async function requeueAfterRun(
  world: K3ReviewCardWorld, taskId: string, afterRunRef: TaskClaim['runRef'], label: string,
): Promise<TaskRequeueSnapshotV1> {
  const f = world.fixture;
  const reads = createRunStateReader({ records: f.records });
  let sequence = 0;
  const requeues = createTaskRequeueService({
    records: f.records, reads,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: '/tmp/k3-prefix-fixture', workspaceRevision: 1 } };
    } },
    source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: 'a'.repeat(64) }; } },
    materials: { async storeArtifact() { throw new Error('the prefix fixture stores no artifact'); },
      async openArtifact() { throw new Error('the prefix fixture opens no artifact'); } },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now: () => T,
    eventId: () => `k3-prefix-requeue-event-${label}-${String(++sequence)}`,
  });
  const goal = await f.b2.base.plans.queryGoal(f.ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`K3 prefix fixture: the Goal is not readable: ${JSON.stringify(goal)}`);
  const runRead = await reads.readExecution(f.ctx, afterRunRef);
  if (runRead.status !== 'ready') throw new Error(`K3 prefix fixture: the Run is not readable: ${JSON.stringify(runRead)}`);
  const task = { projectId: afterRunRef.projectId, goalId: afterRunRef.goalId, taskId };
  const requeued = await requeues.requeueTask(f.ctx, {
    input: { taskRef: task, afterRunRef, reason: `K3 prefix fixture: continue as ${label}` },
    meta: { requestId: `k3-prefix-requeue-${label}`, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: afterRunRef, revision: runRead.value.run.revision },
    ] },
  });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`K3 prefix fixture: the requeue failed: ${JSON.stringify(requeued)}`);
  }
  return requeued.value.requeue;
}

/** A trusted `work_run` context of the record's original Run. */
export function workRunContextOf(world: K3ReviewCardWorld, run: RunSnapshot): CoreCallContext {
  return { projectId: run.ref.projectId, workspaceId: world.fixture.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: run.ref },
    signal: world.fixture.ctx.signal };
}
