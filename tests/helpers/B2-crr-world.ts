/**
 * K3 L19a test world: a REAL blocked `UnknownCallReview` record (created by the
 * production RUN-20/RUN-22 chain over a real Kernel Turn), its `skip_as_done`
 * disposition through the real UCR owner (which writes `blockedCommands`), and a
 * `CommandRerunRequest` through the real CRR owner. No record, request, item or
 * event is hand-encoded: the Run is claimed, prepared and started by the shared
 * real-Run harness (`openRealRunHarness`), and the item list is the production
 * draft reader's output over the Kernel's own facts.
 */
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { expect } from 'vitest';
import { decisionSourceKey, type DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { KernelCommandReader } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readKernelCommandFacts as readProductionKernelCommandFacts } from '../../src/core/agent-runtime/context-assembler.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';
import { openRealRunHarness } from './K3-35-continuation-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';
import { shellSeam } from './K3-tool-seams.js';
import { GOAL_B, PLAN_B2, WORKSPACE_SCOPE } from './S5-decision-fixture.js';

export const CRR_COMMAND = 'prisma migrate deploy';

/** One shell call the scripted model declares; the command is the Kernel's fact. */
export type BlockedCallSpec = { callId: string; command: string; cwd?: string | null };

/**
 * The harness's claim owner allocates a Run id per claim. Two Runs of one Task
 * need ids from ONE stream: a fresh harness would restart the sequence and the
 * reclaim would name its own predecessor's Run ("requeueRef cannot cover its
 * own Run"). The generator is an injected dependency; ids are not facts.
 */
const runIdSequences = new WeakMap<K3ReviewCardWorld, { seq: number }>();
/**
 * The world's ONE Run-id source: every claim of a Run of this world's Tasks
 * draws its id from this stream, so a later Run can never reuse its
 * predecessor's id (which the requeue owner refuses). Exported for the other
 * B2 harness users (`B2-blocked-runtime.ts`).
 */
export function runIdGeneratorOf(world: K3ReviewCardWorld): () => string {
  let state = runIdSequences.get(world);
  if (state === undefined) {
    state = { seq: 0 };
    runIdSequences.set(world, state);
  }
  return () => `00000000-0000-4000-8000-${String(++state.seq).padStart(12, '0')}`;
}

/** The UCR card of one record, read through the REAL UCR card source. */
export async function reviewCardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1): Promise<DecisionCardV1> {
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const page = await world.cardSource.readPage(world.fixture.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(JSON.stringify(page));
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the review card ${key} is not on the page`);
  return card;
}

/** Options of the ONE real blocked-record path (below). */
export type BlockedRecordOptions = {
  /**
   * The public requeue of a previous Run of the SAME Task. The new public claim
   * covers it, so one Task can leave two real records from two real Runs.
   */
  requeue?: TaskRequeueSnapshotV1['ref'];
  /**
   * `true` (default): settle the real record to `needs_decision` and apply the
   * real `skip_as_done` disposition. `false`: stop at the real `pending_review`
   * record once its Run has ended (the undisposed record, no fact written).
   */
  dispose?: boolean;
};

/** The real record plus the real public `TaskClaim` its Run was entered with. */
export type BlockedRecordOutcome = { record: UnknownCallReviewV1; claim: TaskClaim };

/**
 * A real blocked record: the shared real-Run harness claims, prepares and starts
 * ONE Run whose scripted model declares the `shell` calls; the §5.1 stand-in
 * holds the first handler, so the Kernel records it as an unresolved real call.
 * `createRecord` then reads the production draft and runs RUN-20/RUN-22 over the
 * real Kernel Turn. The process item makes the record `pending_review`; the
 * real settlement owner (`review_unavailable`, the L16 3 trigger) is the
 * production step to `needs_decision`, the state the public `skip_as_done`
 * answer (①) and disposition application (②) require. Both blocked-command
 * facts (`command`/`cwd`) are read by the production Kernel reader over the
 * SAME store, never from a test-written map.
 */
export async function blockedRecord(
  world: K3ReviewCardWorld, taskId: string, label: string, calls: readonly BlockedCallSpec[],
  options: BlockedRecordOptions = {},
): Promise<UnknownCallReviewV1> {
  return (await blockedRecordWithClaim(world, taskId, label, calls, options)).record;
}

/**
 * The same ONE real blocked-record path, also returning the real `TaskClaim`
 * (for the public requeue of that Run, then a second Run of the same Task).
 */
export async function blockedRecordWithClaim(
  world: K3ReviewCardWorld, taskId: string, label: string, calls: readonly BlockedCallSpec[],
  options: BlockedRecordOptions = {},
): Promise<BlockedRecordOutcome> {
  if (calls.length === 0) throw new Error('a blocked record needs at least one declared call');
  const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
  let started: { started: Promise<unknown> } | undefined;
  try {
    const sessionRef = await world.fixture.createS5Session(`${label}-session`);
    const claim = await harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId, requestId: `${label}-claim`,
      ...(options.requeue === undefined ? {} : { requeueRef: options.requeue }) });
    rememberClaim(world, claim);
    const model = createScriptedModel([{ kind: 'calls', calls: calls.map(call => ({
      callId: call.callId, name: 'shell',
      args: { command: call.command, ...(call.cwd == null ? {} : { cwd: call.cwd }) } })) }]);
    started = await harness.prepareAndStart(claim, {
      model, tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
    });
    const created = await harness.createRecord(claim);
    if (options.dispose === false) {
      // Release the held shell and await the Run's real end first; then read the
      // record back at the revision the Run left it at. No settle, no answer.
      shellSeam.release();
      if (started !== undefined) {
        await started.started.catch(() => undefined);
        started = undefined;
      }
      const read = await world.reviews.readReview(world.fixture.ctx, { runRef: claim.runRef });
      if (read.status !== 'ready') throw new Error(`the undisposed record is not readable: ${JSON.stringify(read)}`);
      if (read.value.status !== 'pending_review') {
        throw new Error(`the real record is ${read.value.status}, not pending_review`);
      }
      return { record: read.value, claim };
    }
    const record = created.status === 'needs_decision' ? created
      : await settleUnavailable(world, created, label);
    if (record.status !== 'needs_decision') {
      throw new Error(`the real record settled to ${record.status}, not needs_decision`);
    }
    const card = await reviewCardOf(world, record);
    const answered = await world.decisions.answerDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'skip_as_done' }, text: '', annotations: [] },
      meta: { requestId: `${label}-answer`, expected: card.source.pins },
    });
    expect(answered.status).toBe('committed');
    if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
    const applied = await world.reviews.applyDisposition(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'skip_as_done' },
        decisionMessageRef: answered.value.ref },
      meta: { requestId: `${label}-disposition`, expected: card.source.pins },
    });
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error(JSON.stringify(applied));
    // The REAL item count of the Kernel Turn (the serial batch enters only the
    // first shell call, so this is what the platform actually produced).
    expect(applied.value.blockedCommands.length).toBe(record.items.length);
    return { record: applied.value, claim };
  } finally {
    shellSeam.release();
    if (started !== undefined) await started.started.catch(() => undefined);
    await harness.closeUnion();
  }
}

/**
 * The public requeue of the real blocked record's ended Run, through the same
 * harness chain. The returned ref is the basis of the next Run's public claim.
 */
const requeuesByRun = new WeakMap<K3ReviewCardWorld, Map<string, TaskRequeueSnapshotV1>>();

export async function requeueBlockedRecord(
  world: K3ReviewCardWorld, claim: TaskClaim, note: string,
): Promise<TaskRequeueSnapshotV1> {
  const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
  try {
    const requeue = await harness.requeue(claim, note);
    let stored = requeuesByRun.get(world);
    if (stored === undefined) { stored = new Map(); requeuesByRun.set(world, stored); }
    stored.set(claim.runRef.runId, requeue);
    return requeue;
  } finally {
    await harness.closeUnion();
  }
}

/** The ONE requeue of a Run (a second requeue of the same Run is an identity conflict). */
async function requeueOnce(world: K3ReviewCardWorld, claim: TaskClaim, note: string): Promise<TaskRequeueSnapshotV1> {
  const existing = requeuesByRun.get(world)?.get(claim.runRef.runId);
  return existing ?? await requeueBlockedRecord(world, claim, note);
}

/** The real settlement owner's `review_unavailable` step (L16 3) to `needs_decision`. */
async function settleUnavailable(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, label: string,
): Promise<UnknownCallReviewV1> {
  const settled = await world.reviews.settleReview(world.fixture.ctx, {
    input: { reviewRef: record.ref, cause: 'review_unavailable' },
    meta: { requestId: `${label}-settle`, expected: [{ ref: record.ref, revision: record.revision }] },
  });
  if (settled.status !== 'committed') throw new Error(`the record settlement failed: ${JSON.stringify(settled)}`);
  return settled.value;
}

/**
 * The production Kernel command reader over the SAME Kernel store the shared
 * harness's Runs write. A test that wraps the records port (read accounting)
 * still hands the CRR card source the real `command`/`cwd` reader.
 */
export async function realKernelCommandReaderOf(world: K3ReviewCardWorld): Promise<KernelCommandReader> {
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: world.fixture.base.scope,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  return (ctx, input) => readProductionKernelCommandFacts({ kernelStores, kernel }, ctx, input);
}

/**
 * The reviewed Run's snapshot through the PUBLIC execution read. Kept as an
 * existing export for `K3-UR7-crr-failed-set`; the F-008 request path never
 * reads a Run snapshot (the request Run is the continuation Run's principal).
 */
export async function runSnapshotOf(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1,
): Promise<RunSnapshot> {
  const read = await createRunStateReader({ records: world.records })
    .readExecution(world.fixture.ctx, record.runRef);
  if (read.status !== 'ready') throw new Error(`the record Run is not readable: ${JSON.stringify(read)}`);
  return read.value.run;
}

/** The latest Run claim of each Task in this world (a public execution read fills a gap). */
const latestClaims = new WeakMap<K3ReviewCardWorld, Map<string, TaskClaim>>();

function rememberClaim(world: K3ReviewCardWorld, claim: TaskClaim): void {
  let claims = latestClaims.get(world);
  if (claims === undefined) { claims = new Map(); latestClaims.set(world, claims); }
  claims.set(claim.task.taskId, claim);
}

/** The claim the next public requeue must cover: the Task's latest real Run. */
async function latestClaimOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1): Promise<TaskClaim> {
  const remembered = latestClaims.get(world)?.get(record.task.taskId);
  if (remembered !== undefined) return remembered;
  const read = await createRunStateReader({ records: world.records })
    .readExecution(world.fixture.ctx, record.runRef);
  if (read.status !== 'ready') throw new Error(`the reviewed Run is not readable: ${JSON.stringify(read)}`);
  const claim = read.value.outbox.claim;
  rememberClaim(world, claim);
  return claim;
}

/**
 * Compatibility for an older consumer (`K3-UR7-crr-failed-set`) that builds its
 * own owner call: the real Run's principal through the PUBLIC execution read.
 * The F-008 request path above never uses it; a request in this slice's rows
 * comes only from the continuation Run's `request_command_rerun` tool.
 */
export async function workRunCtx(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1,
): Promise<CoreCallContext> {
  const read = await createRunStateReader({ records: world.records })
    .readExecution(world.fixture.ctx, record.runRef);
  if (read.status !== 'ready') throw new Error(`the record Run is not readable: ${JSON.stringify(read)}`);
  return { ...world.fixture.ctx, principal: { kind: 'work_run', runRef: record.runRef,
    roleBinding: read.value.run.roleBinding } };
}

let continuationSeq = 0;

/**
 * F-008 opt-in: one REAL `request_command_rerun` call from a CONTINUATION Run
 * of the reviewed Run's Task. The reviewed Run ended; the public requeue admits
 * the next claim, the production Runtime enters it, and the scripted model calls
 * the SAME `request_command_rerun` tool a real agent sees. The returned request
 * is read back through the public request owner (`world.commandRerun`). Only
 * the F-008 row uses this path; the default `requestRerunOf` keeps the old
 * direct-owner shape so existing consumers' ordering is unchanged.
 */
export async function requestRerunFromContinuation(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string,
  command = CRR_COMMAND, reason = 'the migration must really run',
  rewriteOf?: { review: string; alias: number },
): Promise<CommandRerunRequestV1> {
  const taskId = record.task.taskId;
  const requeued = await requeueOnce(world, await latestClaimOf(world, record),
    `${taskId}: the continuation Run requests the rerun`);
  const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
  let started: { started: Promise<unknown> } | undefined;
  continuationSeq += 1;
  const label = `b2-crr-request-${String(continuationSeq)}`;
  try {
    const sessionRef = await world.fixture.createS5Session(`${label}-session`);
    const claim = await harness.claimRun({
      sessionRef, planRef: PLAN_B2, taskId, requeueRef: requeued.ref,
      requestId: `${label}-claim`,
    });
    rememberClaim(world, claim);
    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: requestId, name: 'request_command_rerun',
        args: { command, reason, ...(rewriteOf === undefined ? {} : { rewriteOf }) } }] },
      { kind: 'text', text: 'the rerun request is recorded' },
    ]);
    // The tool is a platform-state write, not a workspace write; the Run still
    // needs the ordinary write grant the production Host gives a Work Run.
    started = await harness.prepareAndStart(claim, {
      model, tools: ['read'], writeScope: ['.'], blockOnShell: false });
    const ended = await started.started;
    started = undefined;
    const page = await world.commandRerun.listRequests(world.fixture.ctx, {
      workspace: { projectId: record.task.projectId, workspaceId: record.workspaceId },
      filter: { goalId: record.task.goalId, taskId }, page: { limit: 200 },
    });
    if (page.status !== 'ready') throw new Error(`the request list is not readable: ${JSON.stringify(page)}`);
    const request = [...page.value.items].reverse().find(candidate =>
      candidate.reviewRef.runId === record.ref.runId && candidate.command === command);
    if (request === undefined) {
      throw new Error(`the continuation Run wrote no request for ${record.ref.runId}: ${JSON.stringify({
        ended, modelCalls: model.calls(), items: page.value.items })}`);
    }
    // This exact continuation Run wrote the request; the reviewed Run did not.
    expect(request.runRef.runId).toBe(claim.runRef.runId);
    expect(request.runRef.runId).not.toBe(record.ref.runId);
    return request;
  } finally {
    if (started !== undefined) await started.started.catch(() => undefined);
    await harness.closeUnion();
  }
}

/**
 * The default shape used by the older consumers: ONE write through the world's
 * CRR owner with the reviewed Run's real principal (public execution read).
 * F-008's own row uses `requestRerunFromContinuation` instead, so the default
 * keeps every existing caller's ordering (notably the allowance-before-next-Run
 * sequence in `B2-07-crr-card-closed`).
 */
export async function requestRerunOf(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string,
  command = CRR_COMMAND, reason = 'the migration must really run',
  rewriteOf?: { review: string; alias: number },
): Promise<CommandRerunRequestV1> {
  const ctx = await workRunCtx(world, record);
  const written = await world.commandRerun.requestRerun(ctx, {
    input: { reviewRef: record.ref, runRef: record.runRef, task: record.task, command, reason,
      ...(rewriteOf === undefined ? {} : { rewriteOf }) } as never,
    meta: { requestId, expected: [] },
  });
  expect(written.status).toBe('committed');
  if (written.status !== 'committed') throw new Error(JSON.stringify(written));
  expect(written.value.outcome.status).toBe('requested');
  if (written.value.outcome.status !== 'requested') throw new Error(JSON.stringify(written.value));
  return written.value.request;
}

/** The one CRR card of the Goal, read through the REAL request card source. */
export async function crrCardOf(world: K3ReviewCardWorld): Promise<DecisionCardV1> {
  const page = await world.commandRerunCardSource.readPage(world.fixture.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(JSON.stringify(page));
  expect(page.value.items).toHaveLength(1);
  return page.value.items[0]!;
}

/** The source of a CRR record at its current revision. */
export function crrSourceOf(request: CommandRerunRequestV1, revision = request.revision, goalRef = GOAL_B): DecisionSourceV1 {
  return { kind: 'command_rerun_request',
    key: decisionSourceKey({ kind: 'command_rerun_request', requestRef: request.ref, revision }),
    goalRef, pins: [] };
}
