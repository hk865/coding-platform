/**
 * K3-15 (六)(七) at the Workflow seam (L21, §3.4 UR3h, M1): a person directly
 * holds a review record while its round was claimed but never entered; the next
 * advance cancels that round through the Workflow's automation control
 * (`cancel_review_round`, RUN-09(U)), then UR4 settles it (UCR-08b).
 *
 * The record is the real blocked Run the Host recognition path produced
 * (`createK3PendingReview` over `openK3ReviewCardWorld(kind)`, memory and
 * SQLite); the round
 * is the real TASK-03r claim (claimed, not yet entered), the pause and the
 * cancel are real control submissions through the real control owner, and the
 * late start is the production Runtime's own `startRun` over the manifest the
 * Workflow asked it to prepare. No record, item, draft, event or prepared value
 * is hand-built. Expected values are the spec's literal ones; the scripted
 * model must stay at zero calls.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef, RunSnapshot, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { WorkflowAdvanceInput, WorkflowOperation } from '../../src/business/workflow/contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, readK3Review,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { createK3_35Runtime } from '../helpers/K3-35-runtime.js';
import { GOAL_B, PLAN_B2, WORKSPACE } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

type Fixture = {
  world: K3ReviewCardWorld;
  controls: ReturnType<typeof createRunControlService>;
  workflow: ReturnType<typeof createWorkflow>;
  /** The production Runtime the Workflow drives (its scripted model never runs here). */
  runtime: ReturnType<typeof createK3_35Runtime>['runtime'];
  model: ScriptedModel;
  /** Every `settleReview` call the Workflow makes through the real owner. */
  settleCalls(): number;
};

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

function configurationOf(world: K3ReviewCardWorld): WorkflowHostConfiguration {
  return {
    consumerId: 'k3-15-ur3h-consumer',
    bindings: [{
      workspace: world.fixture.base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: world.fixture.runRA.roleBinding,
      budget: world.fixture.runRA.budget as TaskBudgetV1,
    }],
  };
}

/** The production Runtime's own Kernel store: the same `s5-kernel.sqlite` the world writes. */
async function kernelStoresOf(world: K3ReviewCardWorld): Promise<KernelStoreRegistry> {
  return await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: world.fixture.base.scope,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
}

/** The real Workspace revision the Runtime's `resolveRoot` must agree with. */
async function workspaceRevision(world: K3ReviewCardWorld): Promise<number> {
  const read = await world.records.readMany([canonicalJson(WORKSPACE)]);
  if (read.status !== 'ready') throw new Error(`the Workspace is not readable: ${JSON.stringify(read)}`);
  const record = read.value.records[0];
  if (record === undefined) throw new Error('the Workspace snapshot is missing');
  return (JSON.parse(record.json) as { revision: number }).revision;
}

async function makeWorld(kind: 'memory' | 'sqlite'): Promise<Fixture> {
  const world = await openK3ReviewCardWorld(kind);
  const records = world.records;
  const reads = createRunStateReader({ records });
  const { authority } = createMaterialRecordReaders(records);
  let seq = 0;
  const controls = createRunControlService({ records, authority, reads,
    now: () => world.fixture.now(), eventId: () => `k3-15-ur3h-control-event-${String(++seq)}` });
  const requeues = createTaskRequeueService({ records, reads,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: world.fixture.base.directory, workspaceRevision: 1 } };
    } },
    source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: 'a'.repeat(64) }; } },
    materials: { async storeArtifact() { throw new Error('the requeue carries no note'); },
      async openArtifact() { throw new Error('the requeue reads no artifact'); } },
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now: () => world.fixture.now(), eventId: () => `k3-15-ur3h-requeue-event-${String(++seq)}` });
  // The scripted model is an injected dependency; the stale start is refused
  // before any model request, so its call count must stay zero.
  const model = createScriptedModel([{ kind: 'text', text: 'the review round must never reach the model' }]);
  const { runtime: runtimeService, deps: runtimeDeps } = createK3_35Runtime(world, {
    model, tools: ['read', 'run_readonly_command'], writeScope: [], now: () => world.fixture.now(),
    eventId: () => `k3-15-ur3h-runtime-event-${String(++seq)}`, newId: () => world.fixture.newId(),
    kernelStores: await kernelStoresOf(world), workspaceRevision: () => workspaceRevision(world),
  });
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('a review row never opens checks'),
    readVerification: async () => unsupported('no round read'),
    beginCheck: async () => unsupported('no begin'),
    recordCheckResult: async () => unsupported('no record'),
    finalizeChecks: async () => unsupported('no finalize'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('no checks') };
  // A3: count the Workflow's real settlement calls, returning the owner result
  // unchanged. The source row (K3 UR8) asserted the held record is not settled.
  let settleCalls = 0;
  const reviews = {
    ...world.reviews,
    settleReview: async (...args: Parameters<K3ReviewCardWorld['reviews']['settleReview']>) => {
      settleCalls += 1;
      return await world.reviews.settleReview(...args);
    },
  };
  const dependencies: WorkflowDependencies = {
    tasks: world.fixture.b2.base.goals, plans: world.fixture.b2.base.plans, sessions: world.fixture.b2.base.sessionsPort,
    claims: { ...world.fixture.b2.base.service, requeueTask: requeues.requeueTask }, executions: reads,
    runtime: { ...runtimeService.port,
      createSession: runtimeDeps.sessionOperations.createSession.bind(runtimeDeps.sessionOperations) }, evidence, checks,
    configuration: configurationOf(world),
    sourceAuthority: createSourceAuthorityReader({ authority }),
    controls,
    unknownCallReviews: reviews,
  };
  const workflow = createWorkflow(dependencies);
  return { world, controls, workflow, runtime: runtimeService, model, settleCalls: () => settleCalls };
}

/** TASK-03r: the real claim owner writes `activeRound`; the Run stays unentered. */
async function reviewClaim(world: K3ReviewCardWorld, ref: UnknownCallReviewRef, revision: number,
  taskId: string): Promise<RunRef> {
  const session = await world.fixture.createS5Session(`k3-15-ur3h-review-${ref.runId}`);
  const claim = await world.fixture.claimRun({ requestId: `k3-15-ur3h-claim-${ref.runId}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId, sessionRef: session,
    review: { reviewRef: ref, expectedRevision: revision, phase: 'review' } });
  return claim.runRef;
}

async function readReview(world: K3ReviewCardWorld, reviewRef: UnknownCallReviewRef) {
  return await readK3Review(world, reviewRef);
}

async function hold(world: K3ReviewCardWorld, reviewRef: UnknownCallReviewRef, requestId: string): Promise<void> {
  const current = await readReview(world, reviewRef);
  const held = await world.reviews.holdReview(world.fixture.ctx, { input: { reviewRef, text: null },
    meta: { requestId, expected: [{ ref: reviewRef, revision: current.revision }] } });
  expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', replayed: false, value: {
    status: 'resolved', disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
}

function selectInput(taskId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-15-ur3h', sessionHint: null,
    kind: 'select_work', taskId };
}

function performInput(operation: WorkflowOperation): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-15-ur3h', sessionHint: null,
    kind: 'perform', operation };
}

function operationOf(result: Awaited<ReturnType<Fixture['workflow']['advanceWork']>>): WorkflowOperation {
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready', value: { state: 'advance' } });
  if (result.status !== 'ready' || result.value.next === null || result.value.next.kind !== 'perform') {
    throw new Error(`expected a perform step, got ${JSON.stringify(result)}`);
  }
  return result.value.next.operation;
}

async function readRun(f: Fixture, runRef: RunRef): Promise<RunSnapshot> {
  const read = await createRunStateReader({ records: f.world.records }).readExecution(f.world.fixture.ctx, runRef);
  if (read.status !== 'ready') throw new Error(`the Run must read: ${JSON.stringify(read)}`);
  return read.value.run;
}

/** A legal human pause on the claimed-but-unentered round, keeping the Run `starting`. */
async function pauseRound(f: Fixture, roundRef: RunRef): Promise<void> {
  const run = await readRun(f, roundRef);
  const submitted = await f.controls.submitControl(f.world.fixture.ctx,
  { input: { runRef: roundRef, kind: 'pause', reason: 'pause the review round before entry' },
    meta: { requestId: 'k3-15-ur3h-pause', expected: [{ ref: roundRef, revision: run.revision }] } });
  expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'committed' });
  expect((await readRun(f, roundRef)).controlState).toMatchObject({ desiredState: 'paused' });
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const fixture of fixtures.splice(0)) await fixture.world.close();
});

describe('K3-15 (六) UR3h cancels a claimed-but-unentered review round', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (六) K3 UR8 %s: hold then the next advance cancels the round (RUN-09(U)), UR4 settles it (UCR-08b), zero model calls', async kind => {
    const f = await makeWorld(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-ur3h', callId: 'k3-15-ur3h-call-1', command: 'echo hi',
    });
    expect(created).toMatchObject({ status: 'pending_review', revision: 1 });
    const reviewRef: UnknownCallReviewRef = created.ref;
    const roundRef = await reviewClaim(f.world, reviewRef, created.revision, created.task.taskId);
    await hold(f.world, reviewRef, 'k3-15-ur3h-hold');
    const held = await readReview(f.world, reviewRef);
    expect(held).toMatchObject({ status: 'resolved', disposition: { hold: 'held' },
      activeRound: { runRef: roundRef, phase: 'review' } });

    // UR3h: the Workflow's own automation submits the cancel, pinned to the Run
    // revision it read.
    const roundBefore = await readRun(f, roundRef);
    const cancel = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(cancel).toMatchObject({ kind: 'cancel_review_round', request: {
      input: { runRef: roundRef, kind: 'cancel' }, meta: { expected: [{ ref: roundRef, revision: roundBefore.revision }] } } });
    // K3 UR8: the held record with a claimed round is not settled or prepared;
    // the next advance only plans the automation's cancel.
    expect(f.settleCalls(), 'the held record is not settled before the cancel').toBe(0);
    const cancelled = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(cancel));
    expect(cancelled).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'cancel_review_round', result: { status: 'committed' } } } });
    const roundAfter = await readRun(f, roundRef);
    expect(roundAfter).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    expect(roundAfter.executionHistory, 'the round never entered the Kernel').toBeUndefined();

    // UR4: the known end settles the round; UCR-08b only closes it.
    const settle = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(settle).toMatchObject({ kind: 'settle_review', request: { input: { reviewRef, cause: 'round_ended' } } });
    const settled = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(settle));
    expect(settled).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'settle_review', result: { status: 'committed' } } } });
    const afterSettle = await readReview(f.world, reviewRef);
    expect(afterSettle).toMatchObject({ status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });
    // The input (`callId` at the top of this row) names one command; the
    // expected target is that hand-computed literal, not a production projection.
    expect(afterSettle.disposition?.targets).toEqual(['k3-15-ur3h-call-1']);
    expect(f.model.calls(), 'no model call').toBe(0);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-15 (六) %s: UR3a read the record, the late start gets RUN-02 stale, the next advance goes UR3h', async kind => {
    const f = await makeWorld(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-ur3h-late', callId: 'k3-15-ur3h-late-call-1', command: 'echo hi',
    });
    const reviewRef: UnknownCallReviewRef = created.ref;
    const claim = await f.world.fixture.claimRun({ requestId: 'k3-15-ur3h-late-review-claim',
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: created.task.taskId,
      sessionRef: await f.world.fixture.createS5Session('k3-15-ur3h-late-review'),
      review: { reviewRef, expectedRevision: created.revision, phase: 'review' } });
    const roundRef = claim.runRef;
    // The first advance reads the record and plans UR3a's prepare with the same claim.
    const prepare = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(prepare).toMatchObject({ kind: 'prepare', request: { runRef: roundRef } });
    // The Workflow's own prepare step runs the production preparation now; it
    // reads the record before the person's hold.
    const performed = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(prepare));
    if (performed.status !== 'ready' || performed.value.receipt?.kind !== 'prepare'
      || performed.value.receipt.result.status !== 'ready') {
      throw new Error(`the production prepare must succeed: ${JSON.stringify(performed)}`);
    }
    const prepared = performed.value.receipt.result.value;
    await hold(f.world, reviewRef, 'k3-15-ur3h-late-hold');
    // The prepare had already read the record; the late start through the same
    // Runtime reaches RUN-02 and is `stale` before any model request.
    const late = await f.runtime.port.startRun(f.world.fixture.ctx,
      { prepared, consumerId: 'runtime-a', requestId: 'k3-15-ur3h-late-start' });
    expect(late, JSON.stringify(late)).toMatchObject({ status: 'rejected', code: 'source_stale' });

    const cancel = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(cancel).toMatchObject({ kind: 'cancel_review_round', request: { input: { runRef: roundRef, kind: 'cancel' } } });
    // F-045: the planned cancel is really performed (the row before only
    // planned it), so the round reaches the public `cancelled` end and the
    // Workflow receipt keeps the real owner receipt unchanged.
    const cancelled = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(cancel));
    expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'cancel_review_round', result: { status: 'committed', replayed: false,
        value: { intent: { kind: 'cancel', status: 'applied', observation: { kind: 'cancelled' } } },
        cursor: expect.any(String) } } } });
    if (cancelled.status !== 'ready' || cancelled.value.receipt?.kind !== 'cancel_review_round'
      || cancelled.value.receipt.result.status !== 'committed') {
      throw new Error(`the real cancel must commit: ${JSON.stringify(cancelled)}`);
    }
    const cancelReceipt = cancelled.value.receipt.result;
    expect(cancelReceipt.value.intent).toBeDefined();
    if (cancelReceipt.value?.intent === undefined) throw new Error('the committed cancel carries its control intent');
    const controlRead = await f.controls.readControl(f.world.fixture.ctx, cancelReceipt.value.intent.ref);
    expect(controlRead).toEqual({ status: 'ready', value: cancelReceipt.value.intent });
    const cancelledRun = await readRun(f, roundRef);
    // The receipt's `runRevision` is the Run revision the same commit produced.
    expect(cancelReceipt.value.runRevision).toBe(cancelledRun.revision);
    expect(cancelledRun).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
    expect((await readRun(f, roundRef)).executionHistory, 'the round never entered the Kernel').toBeUndefined();

    // UR4 settles only this round after the cancelled end; the record closes.
    const settle = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(settle).toMatchObject({ kind: 'settle_review', request: { input: { reviewRef, cause: 'round_ended' } } });
    const settled = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(settle));
    expect(settled).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'settle_review', result: { status: 'committed' } } } });
    expect(await readReview(f.world, reviewRef)).toMatchObject({ status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });
    expect(f.model.calls(), 'no model call').toBe(0);
  }, 120_000);
});

describe('K3-15 (七) UR3h accepts a round paused before entry and a moved revision refuses', () => {
  it.each(['memory', 'sqlite'] as const)('K3-15 (七) %s: a paused unentered round is cancelled (isUnadmittedStarting false), settled, released and continued', async kind => {
    const f = await makeWorld(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-ur3h-paused', callId: 'k3-15-ur3h-paused-call-1', command: 'echo hi',
    });
    const reviewRef: UnknownCallReviewRef = created.ref;
    const pauseClaim = await f.world.fixture.claimRun({ requestId: 'k3-15-ur3h-paused-review-claim',
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: created.task.taskId,
      sessionRef: await f.world.fixture.createS5Session('k3-15-ur3h-paused-review'),
      review: { reviewRef, expectedRevision: created.revision, phase: 'review' } });
    const roundRef = pauseClaim.runRef;
    await pauseRound(f, roundRef);
    await hold(f.world, reviewRef, 'k3-15-ur3h-paused-hold');

    const paused = await readRun(f, roundRef);
    expect(paused.controlState).toMatchObject({ desiredState: 'paused' });

    const cancel = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(cancel).toMatchObject({ kind: 'cancel_review_round', request: {
      input: { runRef: roundRef, kind: 'cancel' },
      meta: { expected: [{ ref: roundRef, revision: paused.revision }] } } });
    await f.workflow.advanceWork(f.world.fixture.ctx, performInput(cancel));
    expect(await readRun(f, roundRef)).toMatchObject({ status: 'ended', outcome: 'cancelled' });

    // UR4 settles only the round; the record's status, disposition and hold stay.
    const settle = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(settle).toMatchObject({ kind: 'settle_review' });
    await f.workflow.advanceWork(f.world.fixture.ctx, performInput(settle));
    const settled = await readReview(f.world, reviewRef);
    expect(settled).toMatchObject({ status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });

    // The person's "continue" is now accepted (`activeRound` empty) and the next
    // advance plans the ordinary continuation.
    const released = await f.world.reviews.releaseHold(f.world.fixture.ctx, { input: { reviewRef },
      meta: { requestId: 'k3-15-ur3h-release', expected: [{ ref: reviewRef, revision: settled.revision }] } });
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: null, disposition: { hold: 'released' } } });
    const continuation = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    expect(continuation.kind).toBe('requeue_task');
    expect(f.model.calls(), 'no model call').toBe(0);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-15 (七) %s: a Run revision moved before the cancel commit returns revision_conflict and nothing changes', async kind => {
    const f = await makeWorld(kind);
    fixtures.push(f);
    const created = await createK3PendingReview(f.world, {
      label: 'k3-15-ur3h-moved', callId: 'k3-15-ur3h-moved-call-1', command: 'echo hi',
    });
    const reviewRef: UnknownCallReviewRef = created.ref;
    const movedClaim = await f.world.fixture.claimRun({ requestId: 'k3-15-ur3h-moved-review-claim',
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: created.task.taskId,
      sessionRef: await f.world.fixture.createS5Session('k3-15-ur3h-moved-review'),
      review: { reviewRef, expectedRevision: created.revision, phase: 'review' } });
    const roundRef = movedClaim.runRef;
    await hold(f.world, reviewRef, 'k3-15-ur3h-moved-hold');
    const cancel = operationOf(await f.workflow.advanceWork(f.world.fixture.ctx, selectInput(created.task.taskId)));
    const pinned = (cancel as Extract<WorkflowOperation, { kind: 'cancel_review_round' }>).request.meta.expected[0]!.revision;
    // Another legal control moves the Run revision between the read and the commit.
    const submitted = await f.controls.submitControl(f.world.fixture.ctx,
    { input: { runRef: roundRef, kind: 'steer', reason: 'a later operator note' },
      meta: { requestId: 'k3-15-ur3h-move', expected: [{ ref: roundRef, revision: pinned }] } });
    expect(submitted, JSON.stringify(submitted)).toMatchObject({ status: 'committed' });
    const moved = await readRun(f, roundRef);
    expect(moved.revision).not.toBe(pinned);

    const refused = await f.workflow.advanceWork(f.world.fixture.ctx, performInput(cancel));
    expect(refused).toMatchObject({ status: 'ready', value: { receipt: {
      kind: 'cancel_review_round', result: { status: 'rejected', code: 'revision_conflict' } } } });
    // Nothing changed: the round is still `starting`, the record still held with
    // the round active.
    expect(await readRun(f, roundRef)).toEqual(moved);
    expect(await readReview(f.world, reviewRef)).toMatchObject({ status: 'resolved',
      disposition: { hold: 'held' }, activeRound: { runRef: roundRef } });
    expect(f.model.calls(), 'no model call').toBe(0);
  }, 120_000);
});
