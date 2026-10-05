/**
 * A.2 step 5.5: `setGoalControl` (docs/refactor/STATE-MACHINES-SPEC.md §2
 * GOAL-04…06, §2.4, D-9, LA-7) and the control fan-out's Goal fence (§2.3),
 * through the public platform ports over the real claim fixture on SQLite.
 *
 * - The Goal commit writes the desired state, its epoch (`desiredStateRevision`)
 *   and requester with one `GoalDesiredStateChanged` event; a lost-ack replay
 *   restores the ORIGINAL snapshot from that event, also after the platform
 *   reopens and after a later control.
 * - The pins, the §2.4 refusals and LA-7 (an operator's pause is resumed only
 *   by an operator; a Host started with a `kind:'system'` actor is an operator).
 * - D-9: a paused Goal makes a claim `busy`, no Task eligible and the
 *   completion `busy`; nothing is written.
 * - The Goal fence of a control submission is a read-only Goal CAS:
 *   a stale fence writes nothing; `controlIntentRefFor` names the intent.
 * - Races (real R3e verification fixture on SQLite): a `completeGoal` landing
 *   inside a pause refuses the pause by its GoalPhase CAS, a pause landing
 *   inside a `completeGoal` refuses the completion by its Goal CAS (never
 *   paused + COMPLETED, §2.4); a pause landing inside `beginCheck` refuses the
 *   begin by its VD-9 read set (VR-02), no ticket is issued.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { controlIntentRefFor } from '../../src/core/work-graph/tasks/control-service.js';
import type { GraphWrite, SetGoalControlInput } from '../../src/core/work-graph/tasks/contracts.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, R3E_GATE_TASK_ID, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function openPlatform(directory: string): Promise<Platform> {
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory },
    workspace: {
      async resolveRoot() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no workspace root needed' }; },
      async authorize() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no source grant needed' }; },
    },
  });
  cleanups.push(() => platform.close().catch(() => undefined));
  return platform;
}

/** The claim fixture with one claimed Run, its ledger reopened by the public composition root. */
async function setup(): Promise<{ fixture: TaskClaimFixture; platform: Platform; secondClaim: Awaited<ReturnType<TaskClaimFixture['buildRequest']>> }> {
  const fixture = await createTaskClaimFixture('sqlite');
  cleanups.push(() => fixture.close());
  const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  if (claimed.status !== 'committed') throw new Error(`claim: ${JSON.stringify(claimed)}`);
  // A claim of the second Task, built (pins read) while the Goal is active and sent later.
  const secondClaim = await fixture.buildRequest({ input: { taskId: fixture.tasks.second.taskId, sessionRef: fixture.sessions.second } });
  await fixture.closeBackend();
  return { fixture, platform: await openPlatform(fixture.directory), secondClaim };
}

function hostContext(fixture: TaskClaimFixture, actor: Extract<ActorRef, { kind: 'human' | 'system' }>): CoreCallContext {
  return { projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, principal: { kind: 'host', actor: { ...actor } },
    materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, actor: { ...actor } },
    signal: new AbortController().signal };
}

async function goalOf(platform: Platform, fixture: TaskClaimFixture): Promise<GoalSnapshot> {
  const read = await platform.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (read.status !== 'ready') throw new Error('the Goal must be readable');
  return read.value.goal;
}

function request(fixture: TaskClaimFixture, control: SetGoalControlInput['control'], requestId: string,
  expected: VersionPin[], reason: string | null = `operator ${control}`): GraphWrite<SetGoalControlInput> {
  return { input: { goalRef: fixture.goalRef, control, reason }, meta: { requestId, expected } };
}

describe('setGoalControl (GOAL-04…06)', () => {
  it('commits the desired state, its epoch and requester; a replay restores the original snapshot', async () => {
    const { fixture, platform: first } = await setup();
    let platform = first;
    const before = await goalOf(platform, fixture);
    expect(before).toMatchObject({ desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null });
    const pause = request(fixture, 'pause', 'a2-goal-svc-pause', [{ ref: fixture.goalRef, revision: before.revision }]);
    const paused = await platform.goals.setGoalControl(fixture.ctx, pause);
    if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    const operator = fixture.ctx.principal.kind === 'host' ? fixture.ctx.principal.actor : null;
    expect(paused).toMatchObject({ replayed: false, value: { ...before, desiredState: 'paused', revision: before.revision + 1,
      desiredStateRevision: before.revision + 1, desiredStateRequestedBy: operator } });
    expect(await goalOf(platform, fixture)).toEqual(paused.value);

    // GOAL-05 with a GoalPhase pin of 0 (none read): not compared for a resume.
    const resumed = await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'resume', 'a2-goal-svc-resume',
      [{ ref: fixture.goalRef, revision: paused.value.revision }, { ref: { aggregateType: 'GoalPhase', projectId: fixture.goalRef.projectId,
        goalId: fixture.goalRef.goalId }, revision: 0 }]));
    expect(resumed).toMatchObject({ status: 'committed', value: { desiredState: 'active', desiredStateRevision: before.revision + 2 } });

    // The lost-ack replay returns the ORIGINAL paused snapshot, also after the platform reopens.
    expect(await platform.goals.setGoalControl(fixture.ctx, pause))
      .toMatchObject({ status: 'committed', replayed: true, value: paused.value, cursor: paused.cursor });
    await platform.close();
    platform = await openPlatform(fixture.directory);
    expect(await platform.goals.setGoalControl(fixture.ctx, pause))
      .toMatchObject({ status: 'committed', replayed: true, value: paused.value });
    // The same identity with other content is not the original request.
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'pause', 'a2-goal-svc-pause',
      [{ ref: fixture.goalRef, revision: before.revision }], 'another reason'))).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('checks the input and the pins; a stale pin names the current Goal and writes nothing', async () => {
    const { fixture, platform } = await setup();
    const goal = await goalOf(platform, fixture);
    const goalPin = { ref: fixture.goalRef, revision: goal.revision };
    const control = (input: unknown, expected: unknown[], requestId = 'a2-goal-svc-bad') =>
      platform.goals.setGoalControl(fixture.ctx, { input, meta: { requestId, expected } } as unknown as GraphWrite<SetGoalControlInput>);
    expect(await control({ goalRef: fixture.goalRef, control: 'stop', reason: null }, [goalPin])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: '' }, [goalPin])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: 'x'.repeat(2049) }, [goalPin])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: null, extra: 1 }, [goalPin])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: null }, [])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: null },
      [goalPin, { ref: fixture.planRef, revision: 1 }])).toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: { ...fixture.goalRef, projectId: 'p-other' }, control: 'pause', reason: null }, [goalPin]))
      .toMatchObject({ code: 'invalid' });
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: null }, [{ ...goalPin, revision: goal.revision - 1 }]))
      .toEqual({ status: 'rejected', code: 'revision_conflict', reason: 'the Goal changed since the caller read it', current: [goalPin] });
    // A stale GoalPhase pin names the current GoalPhase; 0 when none is stored.
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId };
    expect(await control({ goalRef: fixture.goalRef, control: 'pause', reason: null }, [goalPin, { ref: phaseRef, revision: 2 }]))
      .toEqual({ status: 'rejected', code: 'revision_conflict', reason: 'the GoalPhase changed since the caller read it',
        current: [{ ref: phaseRef, revision: 0 }] });
    expect(await goalOf(platform, fixture)).toEqual(goal);
    // §2.4: a resume of an active Goal is busy.
    expect(await control({ goalRef: fixture.goalRef, control: 'resume', reason: null }, [goalPin]))
      .toMatchObject({ code: 'busy', reason: 'the Goal is not paused' });
  });

  it('LA-7: an operator pause is resumed only by an operator; the platform actors are refused, a kind:system operator is not', async () => {
    const { fixture, platform } = await setup();
    const pin = async () => [{ ref: fixture.goalRef, revision: (await goalOf(platform, fixture)).revision }];
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'pause', 'a2-la7-pause', await pin())))
      .toMatchObject({ status: 'committed' });
    const paused = await goalOf(platform, fixture);
    for (const automation of [WORKFLOW_AUTOMATION_ACTOR, GOAL_FAN_OUT_ACTOR]) {
      expect(await platform.goals.setGoalControl(hostContext(fixture, automation),
        request(fixture, 'resume', `a2-la7-resume-${automation.id}`, await pin())))
        .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'an operator paused this Goal; only an operator resumes it' });
    }
    expect(await goalOf(platform, fixture)).toEqual(paused);
    // A Host started with a kind:'system' actor is still an operator (reworkActorClassOf).
    const console = { kind: 'system' as const, id: 'host:operator-console' };
    const resumed = await platform.goals.setGoalControl(hostContext(fixture, console), request(fixture, 'resume', 'a2-la7-console', await pin()));
    expect(resumed).toMatchObject({ status: 'committed', value: { desiredState: 'active', desiredStateRequestedBy: console } });
    // A pause by the platform's automation actor is resumed by either.
    expect(await platform.goals.setGoalControl(hostContext(fixture, WORKFLOW_AUTOMATION_ACTOR),
      request(fixture, 'pause', 'a2-la7-system-pause', await pin()))).toMatchObject({ status: 'committed' });
    expect(await platform.goals.setGoalControl(hostContext(fixture, GOAL_FAN_OUT_ACTOR),
      request(fixture, 'resume', 'a2-la7-system-resume', await pin()))).toMatchObject({ status: 'committed', value: { desiredState: 'active' } });
    // A work Run is never a Goal controller.
    const workRun: CoreCallContext = { ...fixture.ctx, principal: { kind: 'work_run', runRef: { aggregateType: 'Run',
      projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId, runId: 'r-agent' },
      roleBinding: fixture.roleBinding } } as CoreCallContext;
    expect(await platform.goals.setGoalControl(workRun, request(fixture, 'pause', 'a2-la7-agent', await pin())))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('D-9: a paused Goal refuses a claim and the completion and shows no Task eligible; a cancel is terminal', async () => {
    const { fixture, platform, secondClaim } = await setup();
    const goal = await goalOf(platform, fixture);
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'pause', 'a2-d9-pause',
      [{ ref: fixture.goalRef, revision: goal.revision }]))).toMatchObject({ status: 'committed' });
    const pausedGoal = await goalOf(platform, fixture);
    // A claim pinned to the paused Goal (fresh pins): `busy` by D-9 (claim-service :514), and nothing is written.
    const freshClaim = { ...secondClaim, meta: { requestId: 'a2-d9-claim-fresh', expected: secondClaim.meta.expected.map(pin =>
      pin.ref.aggregateType === 'Goal' ? { ref: pin.ref, revision: pausedGoal.revision } : pin) } };
    const graphBefore = await platform.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
    if (graphBefore.status !== 'ready') throw new Error('the task graph must be readable');
    expect(await platform.claims.claimTask(fixture.ctx, freshClaim))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is not active' });
    const graph = await platform.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
    if (graph.status !== 'ready') throw new Error('the task graph must be readable');
    expect(graph.value.sourceCursor, 'the refused claim committed nothing').toEqual(graphBefore.value.sourceCursor);
    const second = graph.value.tasks.find(row => row.ref.taskId === fixture.tasks.second.taskId);
    expect(second).toMatchObject({ execution: null, currentAttempt: null });
    expect(second?.eligibility.reasons).toContainEqual({ code: 'goal_not_active', message: 'goal desiredState is not active' });
    expect(await platform.goals.completeGoal(fixture.ctx, { input: { goalRef: fixture.goalRef }, meta: { requestId: 'a2-d9-complete',
      expected: [{ ref: fixture.goalRef, revision: pausedGoal.revision }, { ref: { aggregateType: 'GoalPhase',
        projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId }, revision: 0 }] } }))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is paused; a Goal that is not active is not completed' });
    // GOAL-06 from paused; then the Goal is terminal.
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'cancel', 'a2-d9-cancel',
      [{ ref: fixture.goalRef, revision: pausedGoal.revision }]))).toMatchObject({ status: 'committed', value: { desiredState: 'cancelled' } });
    const cancelled = await goalOf(platform, fixture);
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'resume', 'a2-d9-resume',
      [{ ref: fixture.goalRef, revision: cancelled.revision }]))).toMatchObject({ code: 'invalid' });
    expect(await platform.goals.setGoalControl(fixture.ctx, request(fixture, 'cancel', 'a2-d9-cancel-2',
      [{ ref: fixture.goalRef, revision: cancelled.revision }]))).toMatchObject({ code: 'busy' });
    expect(await goalOf(platform, fixture)).toEqual(cancelled);
  });
});

describe('the fan-out Goal fence of a control submission (§2.3)', () => {
  it('is a read-only Goal CAS: a stale fence writes nothing, a current one commits under the deterministic intent', async () => {
    const { fixture, platform } = await setup();
    const runRef = (await platform.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef }))
    const row = runRef.status === 'ready' ? runRef.value.tasks.find(task => task.ref.taskId === fixture.tasks.first.taskId) : undefined;
    const run = row?.execution;
    if (run === undefined || run === null) throw new Error('the first Task must be claimed');
    const read = await platform.executions.readExecution(fixture.ctx, run);
    if (read.status !== 'ready') throw new Error('the Run must be readable');
    const goal = await goalOf(platform, fixture);
    const actorCtx = hostContext(fixture, GOAL_FAN_OUT_ACTOR);
    const submit = (requestId: string, goalRevision: number) => platform.controls.submitControl(actorCtx, {
      input: { runRef: run, kind: 'pause', reason: 'goal fence' },
      meta: { requestId, expected: [{ ref: run, revision: read.value.run.revision }, { ref: fixture.goalRef, revision: goalRevision }] } });
    expect(await submit('a2-fence-stale', goal.revision - 1)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = await platform.executions.readExecution(fixture.ctx, run);
    expect(after.status === 'ready' && after.value.run).toEqual(read.value.run);
    expect(await platform.controls.readControl(actorCtx, controlIntentRefFor(GOAL_FAN_OUT_ACTOR, fixture.scope, 'a2-fence-stale')))
      .toEqual({ status: 'not_found' });
    const committed = await submit('a2-fence-current', goal.revision);
    expect(committed).toMatchObject({ status: 'committed', value: { intent: {
      ref: controlIntentRefFor(GOAL_FAN_OUT_ACTOR, fixture.scope, 'a2-fence-current'), status: 'applied', requestedBy: GOAL_FAN_OUT_ACTOR } } });
    // The fence is part of the request: the same request replays its receipt.
    expect(await submit('a2-fence-current', goal.revision)).toMatchObject({ status: 'committed', replayed: true });
    // A pin of another Goal is not a fence: exactly one Run pin is required.
    expect(await platform.controls.submitControl(actorCtx, { input: { runRef: run, kind: 'cancel', reason: null },
      meta: { requestId: 'a2-fence-other', expected: [{ ref: run, revision: read.value.run.revision + 1 },
        { ref: { ...fixture.goalRef, goalId: 'other-goal' }, revision: 1 }] } })).toMatchObject({ code: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
// Races over the real R3e verification fixture on SQLite: a formal round per
// Task, then a concurrent write lands between an operation's reads and its
// commit (the records' `commit` or the source capture is the interposition).
// ---------------------------------------------------------------------------

async function openR3e(): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture('sqlite', COMPLETION_RECORD_SCHEMAS);
  cleanups.push(() => fixture.close());
  return fixture;
}

function executed(text: string): CheckProcessObservation {
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'a2-goal-race-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

async function roundOf(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error('the round must be readable');
  return read.value;
}

/** The formal begin/record of every check, then the finalize: a PASS round. */
async function passRound(fixture: R3eEvidenceFixture, opened: RoundSnapshot): Promise<RoundSnapshot> {
  let round = opened;
  for (const check of round.checks) {
    const begun = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, check.checkId));
    if (begun.status !== 'committed') throw new Error(`begin: ${JSON.stringify(begun)}`);
    round = await roundOf(fixture, round.ref);
    const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
      fixture.recordRequest(round, check.checkId, begun.value.invocationId, executed(`A2_OK_${check.checkId}\n`)));
    if (recorded.status !== 'committed') throw new Error(`record: ${JSON.stringify(recorded)}`);
    round = recorded.value;
  }
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  if (finalized.status !== 'committed' || finalized.value.outcome !== 'PASS') throw new Error(`finalize: ${JSON.stringify(finalized)}`);
  return finalized.value.snapshot;
}

async function r3eGoal(fixture: R3eEvidenceFixture): Promise<GoalSnapshot> {
  const read = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (read.status !== 'ready') throw new Error('the Goal must be readable');
  return read.value.goal;
}

/** The work Task and the Goal gate satisfied through formal PASS rounds: the Goal can complete. */
async function completableGoal(fixture: R3eEvidenceFixture): Promise<void> {
  const opened = async (overrides: Parameters<R3eEvidenceFixture['openRequest']>[0]) => {
    const round = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest(overrides));
    if (round.status !== 'committed') throw new Error(`open: ${JSON.stringify(round)}`);
    return round.value;
  };
  const workRound = await passRound(fixture, await opened({}));
  const gateSubject = { ...fixture.subject, taskId: R3E_GATE_TASK_ID };
  const gateRound = await passRound(fixture, await opened({ subject: gateSubject, gateSubject: 'goal' }));
  const goalAt = (await r3eGoal(fixture)).revision;
  for (const [taskRef, round] of [[fixture.subject, workRound], [gateSubject, gateRound]] as const) {
    const completed = await fixture.b2.base.goals.completeTask(fixture.ctx, { input: { taskRef, planRef: fixture.planRef, roundRef: round.ref },
      meta: { requestId: `a2-goal-race-complete-${taskRef.taskId}`, expected: [{ ref: fixture.goalRef, revision: goalAt },
        { ref: { aggregateType: 'TaskReduction', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId,
          taskId: taskRef.taskId }, revision: 0 }] } });
    if (completed.status !== 'committed') throw new Error(`completeTask: ${JSON.stringify(completed)}`);
  }
}

/** The fixture's records whose NEXT commit first runs `before` (a concurrent writer on the real records). */
function recordsCommittingFirst(fixture: R3eEvidenceFixture, before: () => Promise<void>): R3eEvidenceFixture['records'] & { fired(): boolean } {
  let armed = true;
  return {
    async commit(input) {
      if (armed) {
        armed = false;
        await before();
      }
      return fixture.records.commit(input);
    },
    readMany: (...args) => fixture.records.readMany(...args),
    lookupCommit: (...args) => fixture.records.lookupCommit(...args),
    eventAt: (...args) => fixture.records.eventAt(...args),
    lookup: (...args) => fixture.records.lookup(...args),
    fired: () => !armed,
  };
}

describe('the GoalPhase CAS of a Goal pause (§2.4: never paused + COMPLETED for the active plan)', () => {
  it('a completion committed between the pause read and its commit refuses the pause; nothing of it is written', async () => {
    const fixture = await openR3e();
    await completableGoal(fixture);
    const goal = await r3eGoal(fixture);
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId };
    const records = recordsCommittingFirst(fixture, async () => {
      const completed = await fixture.b2.base.goals.completeGoal(fixture.ctx, { input: { goalRef: fixture.goalRef },
        meta: { requestId: 'a2-phase-race-complete', expected: [{ ref: fixture.goalRef, revision: goal.revision },
          { ref: phaseRef, revision: 0 }] } });
      if (completed.status !== 'committed') throw new Error(`completeGoal: ${JSON.stringify(completed)}`);
    });
    const racing = createGoalService({ records, now: () => B2_AT, eventId: () => 'a2-phase-race-event' }).tasks;
    // No GoalPhase pin: the commit still CASes the GoalPhase as read (∅).
    const pause = { input: { goalRef: fixture.goalRef, control: 'pause' as const, reason: 'race' },
      meta: { requestId: 'a2-phase-race-pause', expected: [{ ref: fixture.goalRef, revision: goal.revision }] } };
    const refused = await racing.setGoalControl(fixture.ctx, pause);
    expect(records.fired(), 'the completion ran inside the pause').toBe(true);
    expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await r3eGoal(fixture)).toEqual(goal);
    const phase = await readGoalPhase(fixture.records, phaseRef);
    expect(phase.status === 'ready' && phase.snapshot).toMatchObject({ phase: 'COMPLETED', revision: 1 });
    // No receipt of the pause exists: the same request now meets the completed Goal instead of a replay.
    expect(await fixture.b2.base.goals.setGoalControl(fixture.ctx, pause)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the Goal is completed for its active Plan; it has no work to stop' });
  });

  it('a pause committed between the completion read and its commit refuses the completion; the Goal stays paused, not COMPLETED', async () => {
    const fixture = await openR3e();
    await completableGoal(fixture);
    const goal = await r3eGoal(fixture);
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: fixture.goalRef.projectId, goalId: fixture.goalRef.goalId };
    const records = recordsCommittingFirst(fixture, async () => {
      const paused = await fixture.b2.base.goals.setGoalControl(fixture.ctx, { input: { goalRef: fixture.goalRef, control: 'pause',
        reason: 'race' }, meta: { requestId: 'a2-phase-race-pause-first', expected: [{ ref: fixture.goalRef, revision: goal.revision }] } });
      if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
    });
    const racing = createGoalService({ records, now: () => B2_AT, eventId: () => 'a2-phase-race-event-2' }).tasks;
    const complete = (requestId: string, goalRevision: number) => ({ input: { goalRef: fixture.goalRef },
      meta: { requestId, expected: [{ ref: fixture.goalRef, revision: goalRevision }, { ref: phaseRef, revision: 0 }] } });
    const refused = await racing.completeGoal(fixture.ctx, complete('a2-phase-race-complete-2', goal.revision));
    expect(records.fired(), 'the pause ran inside the completion').toBe(true);
    expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const paused = await r3eGoal(fixture);
    expect(paused).toMatchObject({ desiredState: 'paused', revision: goal.revision + 1 });
    const phase = await readGoalPhase(fixture.records, phaseRef);
    expect(phase.status === 'ready' && phase.snapshot).toBeNull();
    // With fresh pins the paused Goal is not completed (GOAL-07 desired-state guard).
    expect(await fixture.b2.base.goals.completeGoal(fixture.ctx, complete('a2-phase-race-complete-3', paused.revision)))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the Goal is paused; a Goal that is not active is not completed' });
  });
});

describe('VD-9 begin read set (VR-02: the begin guards Goal@rev and the active Plan@rev)', () => {
  it('a Goal pause committed between the begin activity read and its commit refuses the begin; no ticket, the check stays pending', async () => {
    const fixture = await openR3e();
    const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
    if (opened.status !== 'committed') throw new Error(`open: ${JSON.stringify(opened)}`);
    const round = opened.value;
    const checkId = round.checks[0]!.checkId;
    const goal = await r3eGoal(fixture);
    // The source capture runs after the activity read (Host IO) and before the begin commit.
    let armed = false;
    const reader = new VerificationWorkspaceReader();
    let sequence = 0;
    const evidence = createEvidenceService({ records: fixture.records, materials: fixture.materials, materialFacts: fixture.materialFacts,
      executions: createRunStateReader({ records: fixture.records }), workspaceHost: fixture.workspaceHost,
      source: { async capture(root) {
        if (armed) {
          armed = false;
          const paused = await fixture.b2.base.goals.setGoalControl(fixture.ctx, { input: { goalRef: fixture.goalRef, control: 'pause',
            reason: 'race' }, meta: { requestId: 'a2-vd9-begin-pause', expected: [{ ref: fixture.goalRef, revision: goal.revision }] } });
          if (paused.status !== 'committed') throw new Error(`pause: ${JSON.stringify(paused)}`);
        }
        return reader.capture(root);
      } },
      configuration: fixture.configuration, now: () => B2_AT, newId: () => `a2-vd9-begin-${String(++sequence)}` });
    armed = true;
    const refused = await evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, checkId));
    expect(armed, 'the pause ran inside the begin').toBe(false);
    expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // No ticket: the round and its check are unchanged (still pending).
    const after = await roundOf(fixture, round.ref);
    expect(after).toEqual(round);
    expect(after.checks.find(check => check.checkId === checkId)).toMatchObject({ phase: 'pending', invocationId: null });
    // While paused the begin is refused before any Host IO; after the resume the same check begins.
    expect(await evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, checkId)))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    const paused = await r3eGoal(fixture);
    const resumed = await fixture.b2.base.goals.setGoalControl(fixture.ctx, { input: { goalRef: fixture.goalRef, control: 'resume',
      reason: null }, meta: { requestId: 'a2-vd9-begin-resume', expected: [{ ref: fixture.goalRef, revision: paused.revision }] } });
    expect(resumed).toMatchObject({ status: 'committed' });
    expect(await evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, checkId)))
      .toMatchObject({ status: 'committed', value: { roundRef: round.ref, checkId } });
  });
});
