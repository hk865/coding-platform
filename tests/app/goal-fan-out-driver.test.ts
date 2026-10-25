/**
 * A.2 step 5.5: the Host G7 fan-out driver (docs/refactor/STATE-MACHINES-SPEC.md
 * §2.3 GOAL-09..16, GOAL-28 and the 扇出身份与重驱协议) over the public platform
 * ports and two real claimed Runs on SQLite (no Runtime: both Runs never entered,
 * so the platform applies each control at once, D-7).
 *
 * - One intent per Run per epoch: a second pass reads the deterministic intent
 *   and submits nothing; the epoch with no change fans out nothing.
 * - A Run a person paused is skipped by the Goal pause, keeps its pause through
 *   the Goal resume (A7-G5), and is ended by the Goal cancel (GOAL-13).
 * - A fan-out whose Goal moved on meanwhile is refused by its Goal fence and
 *   reported stale; a concurrent same-identity submission is read back.
 * - GOAL-28: a resume waits while the fan-out pause outcome is unknown.
 * - The fan-out reads only the affected set (`queryGoalLiveRuns`), never the
 *   display facts.
 * - Re-drive over doubles (an entered Run): a resume waiting for a queued
 *   fan-out pause follows once a commit shows the pause landed; a later pass
 *   delivers a still-queued resume and re-enters the Turn again; a failed
 *   re-entry is shown, a running one is never doubled; the per-Run work runs
 *   on the driver's own signal; `close()` drains the re-entries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { makeCommitCursor, type GoalRef, type GoalSnapshot } from '../../src/contracts/ledger.js';
import { GOAL_FAN_OUT_ACTOR } from '../../src/contracts/task-requeue.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createGoalFanOutDriver, type GoalFanOutDriverDependencies } from '../../src/app/goal-fan-out-driver.js';
import { goalFanOutRequestId, type GoalDisplayV1 } from '../../src/core/work-graph/state/goal-machine.js';
import { controlIntentRefFor } from '../../src/core/work-graph/tasks/control-service.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Two claimed, never-entered Runs (first and second Task) and the reopened platform. */
async function setup(): Promise<{ fixture: TaskClaimFixture; platform: Platform; runA: RunRef; runB: RunRef }> {
  const fixture = await createTaskClaimFixture('sqlite');
  cleanups.push(() => fixture.close());
  const a = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  const b = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({
    input: { taskId: fixture.tasks.second.taskId, sessionRef: fixture.sessions.second } }));
  if (a.status !== 'committed' || b.status !== 'committed') throw new Error(`claims: ${JSON.stringify([a, b])}`);
  await fixture.closeBackend();
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: fixture.directory },
    workspace: {
      async resolveRoot() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no workspace root needed' }; },
      async authorize() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no source grant needed' }; },
    },
  });
  cleanups.push(() => platform.close().catch(() => undefined));
  return { fixture, platform, runA: a.value.runRef, runB: b.value.runRef };
}

function driverOn(platform: Platform, controls: RunControlPort = platform.controls) {
  const deps: GoalFanOutDriverDependencies = { goals: platform.goals, plans: platform.plans, executions: platform.executions,
    controls, runtime: platform.runtime, claims: { requeueTask: (...args) => platform.claims.requeueTask!(...args) } };
  const driver = createGoalFanOutDriver(deps);
  cleanups.push(() => driver.close());
  return driver;
}

async function goalOf(platform: Platform, fixture: TaskClaimFixture): Promise<GoalSnapshot> {
  const read = await platform.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (read.status !== 'ready') throw new Error('the Goal must be readable');
  return read.value.goal;
}

/** A Goal control pinned to the Goal and its GoalPhase as the task graph reads it (decision 29; 0 = none stored). */
async function control(platform: Platform, fixture: TaskClaimFixture, kind: 'pause' | 'resume' | 'cancel', requestId: string) {
  const graph = await platform.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const completion = graph.value.completion;
  return { input: { goalRef: fixture.goalRef, control: kind, reason: `operator ${kind}` },
    meta: { requestId, expected: [{ ref: fixture.goalRef, revision: (await goalOf(platform, fixture)).revision },
      { ref: { aggregateType: 'GoalPhase' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId },
        revision: completion?.status === 'recorded' ? completion.snapshot.revision : 0 }] } };
}

async function pointerOf(platform: Platform, ctx: CoreCallContext, runRef: RunRef) {
  const read = await platform.executions.readExecution(ctx, runRef);
  if (read.status !== 'ready') throw new Error('the Run must be readable');
  const pointer = read.value.run.controlState;
  if (pointer === undefined) return { run: read.value.run, intent: null };
  const intent = await platform.controls.readControl(ctx, pointer.intentRef);
  if (intent.status !== 'ready') throw new Error('the pointer intent must be readable');
  return { run: read.value.run, intent: intent.value };
}

describe('Goal fan-out driver (§2.3)', () => {
  it('submits one deterministic intent per Run per epoch; a second pass and an unchanged Goal submit nothing', async () => {
    const { fixture, platform, runA, runB } = await setup();
    const driver = driverOn(platform);
    expect(await driver.fanOut(fixture.ctx, fixture.goalRef)).toEqual({ goalRef: fixture.goalRef, epoch: 1, control: null,
      runs: [], problem: null });
    const paused = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-pause-1'));
    if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    const epoch = paused.value.goal.desiredStateRevision!;
    const expectedRef = (runRef: RunRef) => controlIntentRefFor(GOAL_FAN_OUT_ACTOR, fixture.scope,
      goalFanOutRequestId(fixture.goalRef, epoch, runRef, 'pause'));
    expect(paused.value.fanOut).toEqual({ goalRef: fixture.goalRef, epoch, control: 'pause', problem: null, runs: [
      { runRef: runA, outcome: 'submitted', intentRef: expectedRef(runA), reason: null },
      { runRef: runB, outcome: 'submitted', intentRef: expectedRef(runB), reason: null },
    ] });
    for (const runRef of [runA, runB]) {
      const { run, intent } = await pointerOf(platform, fixture.ctx, runRef);
      expect(run.revision).toBeGreaterThan(1);
      expect(intent).toMatchObject({ ref: expectedRef(runRef), status: 'applied', observation: { kind: 'paused' } });
    }
    const revisions = await Promise.all([runA, runB].map(async runRef => (await pointerOf(platform, fixture.ctx, runRef)).run.revision));
    const again = await driver.fanOut(fixture.ctx, fixture.goalRef);
    expect(again.runs.map(run => run.outcome)).toEqual(['already_submitted', 'already_submitted']);
    expect(await Promise.all([runA, runB].map(async runRef => (await pointerOf(platform, fixture.ctx, runRef)).run.revision)))
      .toEqual(revisions);
    // The display shows each Run's actual state; the platform paused both (D-7) without a Runtime.
    const shown = await driver.readGoalDisplay(fixture.ctx, { goalRef: fixture.goalRef });
    expect(shown).toMatchObject({ status: 'ready', value: { display: { phase: 'PAUSED',
      runStops: [{ runRef: runA, stop: { kind: 'paused' } }, { runRef: runB, stop: { kind: 'paused' } }] } } });
  });

  it('a person\'s pause is skipped by the Goal pause, kept through the Goal resume (A7-G5), and ended by the Goal cancel (GOAL-13)', async () => {
    const { fixture, platform, runA, runB } = await setup();
    const driver = driverOn(platform);
    const own = await pointerOf(platform, fixture.ctx, runA);
    const personal = await platform.controls.submitControl(fixture.ctx, { input: { runRef: runA, kind: 'pause', reason: 'mine' },
      meta: { requestId: 'drv-own-pause', expected: [{ ref: runA, revision: own.run.revision }] } });
    if (personal.status !== 'committed') throw new Error(`own pause: ${JSON.stringify(personal)}`);
    const paused = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-a7-pause'));
    expect(paused.status === 'committed' && paused.value.fanOut.runs).toMatchObject([
      { runRef: runA, outcome: 'skipped', intentRef: null, reason: 'the Run already carries a paused intent' },
      { runRef: runB, outcome: 'submitted' }]);
    const resumed = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'resume', 'drv-a7-resume'));
    expect(resumed.status === 'committed' && resumed.value.fanOut.runs).toMatchObject([
      { runRef: runA, outcome: 'skipped', reason: 'the Run is not paused by this Goal\'s fan-out; a pause of its own stays' },
      { runRef: runB, outcome: 'submitted' }]);
    expect((await pointerOf(platform, fixture.ctx, runA)).intent?.ref).toEqual(personal.value.intent.ref);
    expect((await pointerOf(platform, fixture.ctx, runB)).run.controlState?.desiredState).toBe('running');
    const cancelled = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'cancel', 'drv-a7-cancel'));
    expect(cancelled.status === 'committed' && cancelled.value.fanOut.runs).toMatchObject([
      { runRef: runA, outcome: 'submitted' }, { runRef: runB, outcome: 'submitted' }]);
    for (const runRef of [runA, runB]) {
      expect((await pointerOf(platform, fixture.ctx, runRef)).run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
    }
    // The ended Runs leave the fan-out set (GOAL-15); the display shows their ends.
    expect((await driver.fanOut(fixture.ctx, fixture.goalRef)).runs).toEqual([]);
    expect(await driver.readGoalDisplay(fixture.ctx, { goalRef: fixture.goalRef })).toMatchObject({ status: 'ready',
      value: { display: { phase: 'CANCELLED', runStops: [{ runRef: runA, stop: { kind: 'ended', outcome: 'cancelled' } },
        { runRef: runB, stop: { kind: 'ended', outcome: 'cancelled' } }] } } });
  });

  it('a fan-out whose Goal moved to a new epoch is refused by its Goal fence and reported stale', async () => {
    const { fixture, platform, runA, runB } = await setup();
    let interleaved = false;
    const controls: RunControlPort = {
      readControl: (...args) => platform.controls.readControl(...args),
      async submitControl(ctx, request) {
        if (!interleaved) {
          interleaved = true;
          // The operator resumes the Goal between the fan-out's reads and its commit.
          const resumed = await platform.goals.setGoalControl(fixture.ctx, await control(platform, fixture, 'resume', 'drv-stale-resume'));
          if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
        }
        return platform.controls.submitControl(ctx, request);
      },
    };
    const driver = driverOn(platform, controls);
    const paused = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-stale-pause'));
    if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    expect(paused.value.fanOut.runs).toMatchObject([
      { runRef: runA, outcome: 'stale', intentRef: null }, { runRef: runB, outcome: 'stale', intentRef: null }]);
    for (const runRef of [runA, runB]) expect((await pointerOf(platform, fixture.ctx, runRef)).run.controlState).toBeUndefined();
    expect((await goalOf(platform, fixture)).desiredState).toBe('active');
  });

  it('a concurrent submission of the same identity is read back as already submitted', async () => {
    const { fixture, platform, runA } = await setup();
    let raced = false;
    const controls: RunControlPort = {
      readControl: (...args) => platform.controls.readControl(...args),
      async submitControl(ctx, request) {
        if (!raced && request.input.runRef.runId === runA.runId) {
          raced = true;
          // Another Host process committed the same fan-out identity with another reason first.
          const other = await platform.controls.submitControl(ctx, { ...request, input: { ...request.input, reason: 'raced' } });
          if (other.status !== 'committed') throw new Error(`race: ${JSON.stringify(other)}`);
        }
        return platform.controls.submitControl(ctx, request);
      },
    };
    const driver = driverOn(platform, controls);
    const paused = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-race-pause'));
    expect(paused.status === 'committed' && paused.value.fanOut.runs[0]).toMatchObject({ runRef: runA, outcome: 'already_submitted' });
  });

  it('GOAL-28: the resume of a Run whose fan-out pause outcome is unknown waits for reconcile', async () => {
    const { fixture, platform, runA } = await setup();
    const driver = driverOn(platform);
    await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-g28-pause'));
    const pauseRef = (await pointerOf(platform, fixture.ctx, runA)).intent!.ref;
    // An outcome_unknown fan-out pause needs a Kernel (CD-2); the read is answered as that state.
    const unknownControls: RunControlPort = {
      submitControl: (...args) => platform.controls.submitControl(...args),
      async readControl(ctx, ref) {
        const read = await platform.controls.readControl(ctx, ref);
        if (read.status !== 'ready' || read.value.ref.intentId !== pauseRef.intentId || read.value.status !== 'applied') return read;
        return { status: 'ready', value: { ...read.value, status: 'outcome_unknown' } as typeof read.value };
      },
    };
    const waiting = driverOn(platform, unknownControls);
    const resumed = await waiting.setGoalControl(fixture.ctx, await control(platform, fixture, 'resume', 'drv-g28-resume'));
    expect(resumed.status === 'committed' && resumed.value.fanOut.runs[0]).toEqual({ runRef: runA, outcome: 'skipped', intentRef: null,
      reason: 'the fan-out pause outcome is unknown; the resume waits for reconcile (GOAL-28)' });
    expect((await pointerOf(platform, fixture.ctx, runA)).intent?.ref).toEqual(pauseRef);
  });

  it('reads only the affected set: a display read that fails never stops the fan-out of a committed Goal control', async () => {
    const { fixture, platform, runA, runB } = await setup();
    const driver = createGoalFanOutDriver({ goals: platform.goals, executions: platform.executions, controls: platform.controls,
      runtime: platform.runtime, plans: {
        queryGoal: (...args) => platform.plans.queryGoal(...args),
        queryGoalLiveRuns: (...args) => platform.plans.queryGoalLiveRuns(...args),
        queryGoalResumeContinuations: (...args) => platform.plans.queryGoalResumeContinuations(...args),
        async queryGoalDisplay() { throw new Error('a display-only fact is damaged'); },
      }, claims: { requeueTask: (...args) => platform.claims.requeueTask!(...args) } });
    cleanups.push(() => driver.close());
    const paused = await driver.setGoalControl(fixture.ctx, await control(platform, fixture, 'pause', 'drv-narrow-pause'));
    expect(paused.status === 'committed' && paused.value.fanOut).toMatchObject({ problem: null, runs: [
      { runRef: runA, outcome: 'submitted' }, { runRef: runB, outcome: 'submitted' }] });
  });
});

// ---------------------------------------------------------------------------
// Re-drive of a resume (§2.3 GOAL-14 / GOAL-28) over doubles: one ENTERED Run
// (the platform applies a control of a never-entered Run at once, so a queued
// intent needs an entered Run), its intents and a recording Runtime.
// ---------------------------------------------------------------------------

const AT = '2026-10-05T00:00:00.000Z';
const P = 'p-drv';
const SCOPE = { projectId: P, workspaceId: 'w-drv' };
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: 'g-drv' };
const RUN_REF: RunRef = { aggregateType: 'Run', projectId: P, goalId: 'g-drv', runId: 'r-drv' };
const OPERATOR = { kind: 'human' as const, id: 'drv-operator' };
const HOST_CTX: CoreCallContext = { projectId: P, workspaceId: SCOPE.workspaceId, principal: { kind: 'host', actor: OPERATOR },
  materialReader: { kind: 'host', projectId: P, workspaceId: SCOPE.workspaceId, actor: OPERATOR }, signal: new AbortController().signal };
const CONTROL_NOTICE = { cursor: makeCommitCursor(1), aggregates: [{ aggregateType: 'ControlIntent', projectId: P }] };
const CANCELLED = { status: 'rejected' as const, code: 'cancelled' as const, reason: 'the call signal was aborted' };

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Lets the driver's background work (commit checks, passes, re-entries) run. */
async function idle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => { setImmediate(resolve); });
}

function fanOutIntent(epoch: number, control: 'pause' | 'resume', status: 'queued' | 'applied'): ControlIntentSnapshotV1 {
  const requestId = goalFanOutRequestId(GOAL_REF, epoch, RUN_REF, control);
  const request = { schemaVersion: 1 as const, ref: controlIntentRefFor(GOAL_FAN_OUT_ACTOR, SCOPE, requestId), runRef: RUN_REF,
    kind: control, desiredState: control === 'pause' ? 'paused' as const : 'running' as const,
    reason: `goal:${GOAL_REF.goalId}:${control}@${String(epoch)}`, requestedAt: AT, requestedBy: { ...GOAL_FAN_OUT_ACTOR } };
  return status === 'queued' ? { ...request, revision: 1, status }
    : { ...request, revision: 2, status, observation: { kind: control === 'pause' ? 'paused' : 'resumed' } } as unknown as ControlIntentSnapshotV1;
}

/**
 * A Goal resumed at epoch 3 whose entered Run still points at the queued fan-out
 * pause of epoch 2; or (`paused`) a Goal paused at epoch 2 whose entered Run
 * carries no control yet.
 */
function resumeWorld(goalState: { desiredState: 'active' | 'paused'; epoch: number } = { desiredState: 'active', epoch: 3 }) {
  const goal = { ref: GOAL_REF, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: SCOPE.workspaceId },
    objective: 'drv', desiredState: goalState.desiredState, desiredStateRevision: goalState.epoch, desiredStateRequestedBy: OPERATOR,
    activePlanRevision: null, revision: goalState.epoch,
    settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
    continuedFrom: null, copiedInterventions: [], since: 'c0000000001' } as unknown as GoalSnapshot;
  const resumed = goalState.desiredState === 'active';
  const pause = fanOutIntent(2, 'pause', 'queued');
  const intents = new Map<string, ControlIntentSnapshotV1>(resumed ? [[pause.ref.intentId, pause]] : []);
  let run = { ref: RUN_REF, revision: 5, status: 'running', controlState: resumed
    ? { desiredState: 'paused', intentRef: pause.ref } : undefined,
  envelope: { kind: 'drv-envelope' }, inputBinding: { kind: 'drv-binding' },
  executionAuthorization: { schemaVersion: 2, phase: 'entered', consumerId: 'drv-consumer' } } as unknown as RunSnapshot;
  const submissions: Array<{ signal: AbortSignal; requestId: string; expected: unknown }> = [];
  const deliveries: string[] = [];
  const starts: string[] = [];
  const startAnswers: Array<Promise<ReadResult<TaskExecutionRecord>>> = [];
  const reads = { count: 0 };
  const record = () => ({ run, outbox: { claim: { kind: 'drv-claim' } } }) as unknown as TaskExecutionRecord;
  const controls: RunControlPort = {
    async readControl(_ctx, ref) {
      reads.count += 1;
      const intent = intents.get(ref.intentId);
      return intent === undefined ? { status: 'not_found' } : { status: 'ready', value: structuredClone(intent) };
    },
    async submitControl(ctx, request) {
      submissions.push({ signal: ctx.signal, requestId: request.meta.requestId, expected: request.meta.expected });
      if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the request signal was aborted' };
      const control = request.input.kind === 'resume' ? 'resume' : 'pause';
      const intent = fanOutIntent(goal.desiredStateRevision!, control, 'queued');
      intents.set(intent.ref.intentId, intent);
      run = { ...run, revision: run.revision + 1,
        controlState: { desiredState: control === 'resume' ? 'running' : 'paused', intentRef: intent.ref } } as RunSnapshot;
      return { status: 'committed', value: { intent, runRevision: run.revision }, replayed: false, cursor: makeCommitCursor(2) };
    },
  };
  const deps: GoalFanOutDriverDependencies = {
    goals: { async setGoalControl() { return { status: 'committed', value: goal, replayed: false, cursor: makeCommitCursor(1) }; } },
    // Like the real owners, every read refuses a call whose signal is aborted.
    plans: {
      async queryGoal(ctx) { return (ctx.signal.aborted ? CANCELLED : { status: 'ready', value: { goal } }) as never; },
      async queryGoalLiveRuns(ctx) {
        if (ctx.signal.aborted) return CANCELLED;
        return { status: 'ready', value: { goal, liveRuns: run.status === 'ended' ? [] : [RUN_REF], sourceCursor: null } };
      },
      async queryGoalResumeContinuations(ctx) {
        return ctx.signal.aborted ? CANCELLED : { status: 'ready', value: { goal, continuations: [] } };
      },
      async queryGoalDisplay() {
        const pointer = run.controlState === undefined ? undefined : intents.get(run.controlState.intentRef.intentId);
        return { status: 'ready', value: { goal, display: { phase: 'RUNNING' } as unknown as GoalDisplayV1, liveRuns: [RUN_REF],
          resumePending: pointer === undefined ? [] : [{ runRef: RUN_REF, intentRef: pointer.ref, intentKind: pointer.kind as 'pause' | 'resume',
            status: pointer.status }], sourceCursor: null } };
      },
    },
    executions: { async readExecution(ctx) { return ctx.signal.aborted ? CANCELLED : { status: 'ready', value: record() }; } },
    controls,
    claims: { async requeueTask() { return { status: 'rejected', code: 'unsupported', reason: 'no requeue in this test' }; } },
    runtime: {
      async capabilities() { return { status: 'rejected', code: 'unsupported', reason: 'no Kernel in this test' }; },
      async deliverControl(_ctx, request) {
        deliveries.push(request.intentRef.intentId);
        return { status: 'ready', value: intents.get(request.intentRef.intentId)! };
      },
      async startRun(_ctx, request) {
        starts.push(request.requestId);
        return startAnswers.shift() ?? { status: 'ready', value: record() };
      },
    },
  };
  return { goal, pause, intents, deps, submissions, deliveries, starts, startAnswers, reads,
    land(intent: ControlIntentSnapshotV1) { intents.set(intent.ref.intentId, intent); },
    end() { run = { ...run, status: 'ended' } as RunSnapshot; } };
}

describe('Goal fan-out re-drive (§2.3 GOAL-14, GOAL-28)', () => {
  it('a resume waits for a queued fan-out pause and follows when a ControlIntent commit shows it landed', async () => {
    const world = resumeWorld();
    const driver = createGoalFanOutDriver(world.deps);
    cleanups.push(() => driver.close());
    const report = await driver.fanOut(HOST_CTX, GOAL_REF);
    expect(report.runs).toEqual([{ runRef: RUN_REF, outcome: 'skipped', intentRef: null,
      reason: 'the fan-out pause is queued; the resume follows once it is applied and paused' }]);
    await idle();
    expect(world.submissions).toEqual([]);
    // Commits that cannot move the watched intent are ignored: another project, or no ControlIntent.
    const reads = world.reads.count;
    driver.committed({ cursor: makeCommitCursor(2), aggregates: [{ aggregateType: 'ControlIntent', projectId: 'p-other' }] });
    driver.committed({ cursor: makeCommitCursor(3), aggregates: [{ aggregateType: 'Run', projectId: P }] });
    await idle();
    expect(world.reads.count).toBe(reads);
    // A ControlIntent commit while the pause is still queued: read again, nothing submitted.
    driver.committed(CONTROL_NOTICE);
    await idle();
    expect(world.reads.count).toBe(reads + 1);
    expect(world.submissions).toEqual([]);
    // The Kernel observation lands: the pass runs again and resumes the Run (Run pin + Goal fence), then re-enters its Turn.
    world.land(fanOutIntent(2, 'pause', 'applied'));
    driver.committed(CONTROL_NOTICE);
    await idle();
    const resumeRequestId = goalFanOutRequestId(GOAL_REF, 3, RUN_REF, 'resume');
    expect(world.submissions).toEqual([{ signal: expect.anything(), requestId: resumeRequestId,
      expected: [{ ref: RUN_REF, revision: 5 }, { ref: GOAL_REF, revision: 3 }] }]);
    expect(world.deliveries).toEqual([controlIntentRefFor(GOAL_FAN_OUT_ACTOR, SCOPE, resumeRequestId).intentId]);
    expect(world.starts).toEqual([`goal-fan-out-start:${resumeRequestId}`]);
    // Nothing is watched any more: a later notice reads nothing.
    const settled = world.reads.count;
    driver.committed(CONTROL_NOTICE);
    await idle();
    expect(world.reads.count).toBe(settled);
  });

  it('a queued resume is delivered and re-entered again by a later pass; a failed re-entry is shown, a running one never doubled', async () => {
    const world = resumeWorld();
    world.land(fanOutIntent(2, 'pause', 'applied'));
    const driver = createGoalFanOutDriver(world.deps);
    cleanups.push(() => driver.close());
    world.startAnswers.push(Promise.resolve({ status: 'rejected', code: 'unavailable', reason: 'the Kernel store is busy' }));
    const first = await driver.fanOut(HOST_CTX, GOAL_REF);
    const resumeRef = controlIntentRefFor(GOAL_FAN_OUT_ACTOR, SCOPE, goalFanOutRequestId(GOAL_REF, 3, RUN_REF, 'resume'));
    expect(first.runs).toEqual([{ runRef: RUN_REF, outcome: 'submitted', intentRef: resumeRef,
      reason: 're-entry of the original Turn started' }]);
    await idle();
    // The background re-entry was refused: the display says so while the Run still waits for its resume.
    expect(await driver.readGoalDisplay(HOST_CTX, { goalRef: GOAL_REF })).toMatchObject({ status: 'ready', value: {
      resumePending: [{ runRef: RUN_REF, intentRef: resumeRef, intentKind: 'resume', status: 'queued' }],
      reentryFailures: [{ runRef: RUN_REF, intentRef: resumeRef, reason: 'rejected: the Kernel store is busy' }] } });
    // A later pass (a retried request) delivers the queued resume again and re-enters the Turn again.
    const running = deferred<ReadResult<TaskExecutionRecord>>();
    world.startAnswers.push(running.promise);
    const second = await driver.fanOut(HOST_CTX, GOAL_REF);
    expect(second.runs).toEqual([{ runRef: RUN_REF, outcome: 'already_submitted', intentRef: resumeRef,
      reason: 're-entry of the original Turn started again (the previous one failed: rejected: the Kernel store is busy)' }]);
    // While that re-entry runs, another pass never enters the same Turn twice.
    const third = await driver.fanOut(HOST_CTX, GOAL_REF);
    expect(third.runs[0]).toMatchObject({ outcome: 'already_submitted', reason: 're-entry of the original Turn is already running' });
    expect(world.submissions).toHaveLength(1);
    expect(world.deliveries).toEqual([resumeRef.intentId, resumeRef.intentId, resumeRef.intentId]);
    expect(world.starts).toHaveLength(2);
    // close() waits for the running re-entry.
    let closed = false;
    const closing = driver.close().then(() => { closed = true; });
    await idle();
    expect(closed).toBe(false);
    running.resolve({ status: 'ready', value: {} as TaskExecutionRecord });
    await closing;
    expect(closed).toBe(true);
    // The re-entry started: no failure is shown any more; an ended Run is not delivered again.
    expect(await driver.readGoalDisplay(HOST_CTX, { goalRef: GOAL_REF })).toMatchObject({ value: { reentryFailures: [] } });
    world.end();
    expect((await driver.fanOut(HOST_CTX, GOAL_REF)).runs).toEqual([]);
    expect(world.starts).toHaveLength(2);
  });

  it('the per-Run fan-out runs on the driver\'s own signal: an aborted request still reaches every Run', async () => {
    const world = resumeWorld({ desiredState: 'paused', epoch: 2 });
    const driver = createGoalFanOutDriver(world.deps);
    cleanups.push(() => driver.close());
    const aborted = new AbortController();
    aborted.abort('the client went away');
    const written = await driver.setGoalControl({ ...HOST_CTX, signal: aborted.signal }, { input: { goalRef: GOAL_REF, control: 'pause',
      reason: null }, meta: { requestId: 'drv-signal-pause', expected: [{ ref: GOAL_REF, revision: 1 },
        { ref: { aggregateType: 'GoalPhase', projectId: P, goalId: GOAL_REF.goalId }, revision: 0 }] } });
    expect(written.status === 'committed' && written.value.fanOut.runs).toMatchObject([{ runRef: RUN_REF, outcome: 'submitted' }]);
    expect(world.submissions).toHaveLength(1);
    expect(world.submissions[0]!.signal.aborted).toBe(false);
  });
});
