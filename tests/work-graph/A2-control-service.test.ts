/**
 * A.2 step 5.1: the control service on the real B2 records (SQLite), driven
 * only through the public `submitControl` / `recordControlObservation` and the
 * real claim/entry/result writers (docs/refactor/STATE-MACHINES-SPEC.md §6
 * RUN-09..15, §7 CTL-01/02/04/06/09, §5 ATT-05/23/30, §8 SES-05).
 *
 * - D-7: a pause, cancel or resume of a Run that never entered is applied at
 *   once; a cancel ends the Run and its claim's Attempt, Outbox, Lease and
 *   Session occupancy in the same commit, and supersedes the queued steers.
 * - D-8: a submission supersedes the still-queued older pointer intent in the
 *   same commit; an observation that committed first wins the CAS.
 * - D-9: a resume needs the Goal active. The paused/cancelled Goal is written by
 *   the public `setGoalControl` owner (two independent fixtures), and the entered
 *   Run comes from the real Runtime held at its A3 model gate
 *   (tests/helpers/S2B-runtime-steps-fixture.ts); pause and cancel of a Run stay
 *   accepted while its Goal is not active.
 * - CTL-06 and CTL-09: terminal_without_cancel is recorded only after a known
 *   terminal; the same Kernel fact again is a no-op on an applied or
 *   superseded intent, other content is stale.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ControlIntentKindV1, ControlIntentRef, ControlObservationV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import type { RunControlPort, ControlObservationPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import type { ExecutionReadPort } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import {
  B2_AT, createB2ExecutionFixture, type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(): Promise<B2ExecutionFixture> {
  // GoalPhase (the public Goal control's second pin) is registered alongside the
  // control records; the conversion reads and writes the real Goal through it.
  const fixture = await createB2ExecutionFixture('sqlite', {
    records: [...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records],
    events: [...CONTROL_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events],
    lookups: [...(CONTROL_RECORD_SCHEMAS.lookups ?? []), ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
  });
  fixtures.push(fixture);
  return fixture;
}
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

type Controls = RunControlPort & ControlObservationPort;
function controlsOn(records: B2Records, tag: string, reads: ExecutionReadPort = createRunStateReader({ records })): Controls {
  let seq = 0;
  return createRunControlService({ records, authority: createMaterialRecordReaders(records).authority, reads,
    now: () => B2_AT, eventId: () => `a2-control-${tag}-${++seq}` });
}

async function submit(
  fixture: B2ExecutionFixture, controls: Controls, requestId: string, kind: ControlIntentKindV1, reason: string | null = null,
): Promise<SubmittedControl> {
  const result = await controls.submitControl(fixture.ctx, { input: { runRef: fixture.claim.runRef, kind, reason },
    meta: { requestId, expected: [await fixture.pin()] } });
  expect(result, `${kind} (${requestId})`).toMatchObject({ status: 'committed', replayed: false });
  if (result.status !== 'committed') throw Error(`${kind} must commit`);
  return result.value;
}

async function readIntent(controls: Controls, fixture: B2ExecutionFixture, ref: ControlIntentRef) {
  const read = await controls.readControl(fixture.ctx, ref);
  if (read.status !== 'ready') throw Error('the control intent must be readable');
  return read.value;
}

/** Counts the commits a wrapped records port sends. */
function countingCommits(records: B2Records): { records: B2Records; commits(): number } {
  let commits = 0;
  return { records: { ...records, async commit(batch) { commits++; return records.commit(batch); } }, commits: () => commits };
}

describe('D-7: a control on a Run that never entered is applied at once (RUN-09..11, CTL-02)', () => {
  it('a cancel of an authorized Run ends it and its claim records in ONE commit, superseding the queued steer', async () => {
    const fixture = await open();
    const counted = countingCommits(fixture.base.records);
    const controls = controlsOn(counted.records, 'stop');
    await fixture.authorize();
    const before = await fixture.read();

    const pause = await submit(fixture, controls, 'a2-pause', 'pause');
    expect(pause.intent).toMatchObject({ status: 'applied', revision: 2,
      observation: { origin: 'platform_not_entered', kind: 'paused', detail: { entryPhase: 'authorized' },
        runRevision: before.run.revision + 1 } });
    const steer = await submit(fixture, controls, 'a2-steer', 'steer', 'read the failing test first');
    expect(steer.intent).toMatchObject({ status: 'queued', revision: 1 });
    const paused = await fixture.read();
    expect(paused.run).toMatchObject({ status: 'starting', controlState: { intentRef: pause.intent.ref, desiredState: 'paused' } });

    const commitsBefore = counted.commits();
    const cancel = await submit(fixture, controls, 'a2-cancel', 'cancel', 'stop before entering');
    expect(counted.commits() - commitsBefore, 'the stop is one commit').toBe(1);
    expect(cancel).toMatchObject({ runRevision: paused.run.revision + 1, intent: { status: 'applied', revision: 2,
      observation: { origin: 'platform_not_entered', kind: 'cancelled', detail: { entryPhase: 'authorized' },
        runRevision: paused.run.revision + 1 } } });

    const after = await fixture.read();
    const auth = before.run.executionAuthorization;
    if (auth === undefined || !('schemaVersion' in auth)) throw Error('a V2 authorization is required');
    // RUN-09: ended cancelled, the authorized binding revoked, no Runtime event and no terminalPayload.
    expect(after.run).toMatchObject({ status: 'ended', outcome: 'cancelled', exitCode: null, endedAt: B2_AT, startedAt: null,
      lastEventSeq: before.run.lastEventSeq, controlState: { intentRef: cancel.intent.ref, desiredState: 'cancelled' },
      executionAuthorization: { ...auth, revision: auth.revision + 1, phase: 'revoked' } });
    expect(after.run.terminalPayload).toBeUndefined();
    // ATT-05 / ATT-30 (AD-2) / ATT-23 / SES-05.
    expect(after.attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled', startedAt: null, endedAt: B2_AT,
      revision: before.attempt.revision + 1 });
    expect(after.outbox).toMatchObject({ status: 'settled', revision: before.outbox.revision + 1,
      dispatchState: { schemaVersion: 2, phase: 'settled', settlement: 'not_entered', consumerId: auth.consumerId,
        entryGeneration: auth.generation, sessionGeneration: fixture.claim.generation } });
    expect(after.lease?.release).toMatchObject({ runRef: fixture.claim.runRef, attemptRef: fixture.claim.attemptRef,
      sessionRef: fixture.claim.sessionRef, generation: fixture.claim.generation, releasedAt: B2_AT });
    expect(after.session).toMatchObject({ occupancy: null, historyCursor: before.session.historyCursor,
      lastExecutionRef: fixture.claim.runRef, revision: before.session.revision + 1 });
    expect(await fixture.sessionAvailability()).toBe('idle');
    // CTL-04(b): the queued steer is superseded by the cancel that ended the Run; the applied pause stays.
    expect(await readIntent(controls, fixture, steer.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
      observation: { origin: 'platform_superseded', kind: 'superseded_by_newer', detail: { supersededBy: cancel.intent.ref },
        runRevision: cancel.runRevision } });
    expect(await readIntent(controls, fixture, pause.intent.ref)).toEqual(pause.intent);

    // The receipt replays; a new control on the ended Run is refused.
    expect(await controls.submitControl(fixture.ctx, { input: { runRef: fixture.claim.runRef, kind: 'cancel', reason: 'stop before entering' },
      meta: { requestId: 'a2-cancel', expected: [{ ref: fixture.claim.runRef, revision: paused.run.revision }] } }))
      .toMatchObject({ status: 'committed', replayed: true, value: cancel });
    expect(await controls.submitControl(fixture.ctx, { input: { runRef: fixture.claim.runRef, kind: 'steer', reason: 'too late' },
      meta: { requestId: 'a2-late-steer', expected: [await fixture.pin()] } }))
      .toEqual({ status: 'rejected', code: 'busy', reason: 'the Run already ended; no new control intent is accepted' });
  });

  it('a pause and a resume of a claimed Run move the pointer only; the resumed Run can be authorized', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'pause-resume');
    const before = await fixture.read();
    const pause = await submit(fixture, controls, 'a2-claimed-pause', 'pause');
    expect(pause.intent).toMatchObject({ status: 'applied', observation: { kind: 'paused', detail: { entryPhase: 'none' } } });
    // The pause fences a fresh entry.
    const prepared = await fixture.buildPrepared();
    expect(await fixture.entry.authorizeRuntimeEntry(fixture.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'a2-authorize-paused', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    const resume = await submit(fixture, controls, 'a2-claimed-resume', 'resume');
    expect(resume.intent).toMatchObject({ status: 'applied', revision: 2,
      observation: { origin: 'platform_not_entered', kind: 'resumed', detail: { entryPhase: 'none' } } });
    const resumed = await fixture.read();
    // Only the revision and the pointer moved; the claim records are untouched.
    expect(resumed.run).toEqual({ ...before.run, revision: before.run.revision + 2,
      controlState: { intentRef: resume.intent.ref, desiredState: 'running' } });
    expect([resumed.attempt, resumed.outbox, resumed.lease, resumed.session])
      .toEqual([before.attempt, before.outbox, before.lease, before.session]);
    // The applied pause the resume moved off stays applied.
    expect(await readIntent(controls, fixture, pause.intent.ref)).toEqual(pause.intent);
    expect(await fixture.entry.authorizeRuntimeEntry(fixture.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'a2-authorize-resumed', expected: [await fixture.pin()] } })).toMatchObject({ status: 'committed' });
  });
});

describe('the injected clock and event id of a submission', () => {
  it('a refusal keeps its own code with an empty clock and draws no event id; an accepted decision answers unsupported', async () => {
    const fixture = await open();
    const counted = countingCommits(fixture.base.records);
    let eventIds = 0;
    const emptyClock = createRunControlService({ records: counted.records,
      authority: createMaterialRecordReaders(counted.records).authority, reads: createRunStateReader({ records: counted.records }),
      now: () => '', eventId: () => `a2-empty-clock-${++eventIds}` });
    const submitWith = async (kind: ControlIntentKindV1, requestId: string) => emptyClock.submitControl(fixture.ctx, {
      input: { runRef: fixture.claim.runRef, kind, reason: null }, meta: { requestId, expected: [await fixture.pin()] } });
    expect(await submitWith('resume', 'a2-empty-clock-resume'))
      .toEqual({ status: 'rejected', code: 'busy', reason: 'resume requires a formal pause' });
    expect(eventIds).toBe(0);
    expect(await submitWith('pause', 'a2-empty-clock-pause'))
      .toEqual({ status: 'rejected', code: 'unsupported', reason: 'the injected id/clock source produced an empty value' });
    expect(counted.commits()).toBe(0);
    expect((await fixture.read()).run.controlState).toBeUndefined();
  });
});

describe('D-8: the newer submission supersedes the still-queued older pointer intent (CTL-04)', () => {
  it('a cancel over a queued pause of an entered Run supersedes it in the same commit; the pause receipt still replays', async () => {
    const fixture = await open();
    const counted = countingCommits(fixture.base.records);
    const controls = controlsOn(counted.records, 'supersede');
    await fixture.enter();
    const pauseRequest = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'a2-entered-pause', expected: [await fixture.pin()] } };
    const pause = await controls.submitControl(fixture.ctx, pauseRequest);
    expect(pause).toMatchObject({ status: 'committed', value: { intent: { status: 'queued', revision: 1 } } });
    if (pause.status !== 'committed') throw Error('pause receipt required');

    const commitsBefore = counted.commits();
    const cancel = await submit(fixture, controls, 'a2-entered-cancel', 'cancel', 'stop now');
    expect(counted.commits() - commitsBefore).toBe(1);
    expect(cancel.intent).toMatchObject({ status: 'queued', revision: 1 });
    expect((await fixture.read()).run).toMatchObject({ status: 'running',
      controlState: { intentRef: cancel.intent.ref, desiredState: 'cancelled' } });
    expect(await readIntent(controls, fixture, pause.value.intent.ref)).toEqual({ ...pause.value.intent, revision: 2,
      status: 'superseded', observation: { schemaVersion: 1, origin: 'platform_superseded', kind: 'superseded_by_newer',
        runRevision: cancel.runRevision, detail: { supersededBy: cancel.intent.ref }, observedAt: B2_AT } });
    // The original pause receipt is the immutable queued@1 submission.
    expect(await controls.submitControl(fixture.ctx, pauseRequest)).toEqual({ ...pause, replayed: true });
  });

  it('an observation that commits first wins: the supersede loses the intent CAS, and the retry leaves the applied pause', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'race');
    await fixture.enter();
    const pause = await submit(fixture, controls, 'a2-race-pause', 'pause');
    const { run } = await fixture.read();
    const auth = run.executionAuthorization;
    const locator = run.executionHistory;
    if (auth === undefined || !('schemaVersion' in auth) || locator === undefined) throw Error('an entered Run is required');
    const paused: ControlObservationV1 = { schemaVersion: 1, kind: 'paused',
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
      history: { ...locator, endPosition: null }, source: { ...locator.kernel, position: locator.observedThroughPosition },
      kernelEventId: 'a2-race-paused', kernelEventSequence: 3, observedAt: B2_AT };
    // Before the cancel's batch commits, the Runtime observer records the real pause.
    let fired = false;
    const racing: B2Records = { ...fixture.base.records, async commit(batch) {
      if (!fired) {
        fired = true;
        const observed = await controls.recordControlObservation(fixture.ctx, {
          input: { intentRef: pause.intent.ref, runRef: fixture.claim.runRef, observation: paused },
          meta: { requestId: 'a2-race-observed', expected: [{ ref: pause.intent.ref, revision: 1 }, await fixture.pin()] } });
        expect(observed).toMatchObject({ status: 'committed', value: { status: 'applied' } });
      }
      return fixture.base.records.commit(batch);
    } };
    const cancelRequest = { input: { runRef: fixture.claim.runRef, kind: 'cancel' as const, reason: null },
      meta: { requestId: 'a2-race-cancel', expected: [await fixture.pin()] } };
    expect(await controlsOn(racing, 'race-cancel').submitControl(fixture.ctx, cancelRequest))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await fixture.read()).run.controlState).toEqual({ intentRef: pause.intent.ref, desiredState: 'paused' });
    // The same request retried: the pause is already applied, so nothing is superseded.
    const cancel = await controls.submitControl(fixture.ctx, cancelRequest);
    expect(cancel).toMatchObject({ status: 'committed', replayed: false, value: { intent: { status: 'queued' } } });
    const appliedPause = await readIntent(controls, fixture, pause.intent.ref);
    expect(appliedPause).toMatchObject({ status: 'applied', revision: 2,
      observation: { kind: 'paused', kernelEventId: 'a2-race-paused' } });

    // CTL-09: the same Kernel fact under a new request identity is a no-op that
    // returns the recorded snapshot; other content is stale; nothing is written.
    const counted = countingCommits(fixture.base.records);
    const late = controlsOn(counted.records, 'race-late');
    const observeAgain = async (requestId: string, observation: ControlObservationV1) => late.recordControlObservation(fixture.ctx, {
      input: { intentRef: pause.intent.ref, runRef: fixture.claim.runRef, observation },
      meta: { requestId, expected: [{ ref: pause.intent.ref, revision: 2 }, await fixture.pin()] } });
    expect(await observeAgain('a2-race-observed-again', paused))
      .toMatchObject({ status: 'committed', replayed: true, value: appliedPause });
    expect(await observeAgain('a2-race-observed-other', { ...paused, kernelEventId: 'a2-race-paused-later' }))
      .toEqual({ status: 'rejected', code: 'revision_conflict',
        reason: 'the control intent is already applied; a later observation does not change it',
        current: [{ ref: pause.intent.ref, revision: 2 }] });
    expect(counted.commits()).toBe(0);
    expect(await readIntent(controls, fixture, pause.intent.ref)).toEqual(appliedPause);
  });
});

describe('D-9: a resume needs the Goal active', () => {
  /** The public Goal owner writes the desired state; the task graph supplies the GoalPhase pin. */
  async function setGoal(fixture: B2ExecutionFixture, control: 'pause' | 'resume' | 'cancel', requestId: string) {
    const goal = await fixture.base.plans.queryGoal(fixture.ctx, fixture.base.goalRef);
    const graph = await fixture.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.base.goalRef });
    if (goal.status !== 'ready' || graph.status !== 'ready') throw Error('the Goal and its task graph must be readable');
    const completion = graph.value.completion;
    return fixture.base.goals.setGoalControl(fixture.ctx, {
      input: { goalRef: fixture.base.goalRef, control, reason: `operator ${control}` },
      meta: { requestId, expected: [
        { ref: fixture.base.goalRef, revision: goal.value.goal.revision },
        { ref: { aggregateType: 'GoalPhase' as const, projectId: fixture.base.goalRef.projectId,
          goalId: fixture.base.goalRef.goalId },
          revision: completion?.status === 'recorded' ? completion.snapshot.revision : 0 },
      ] } });
  }

  it('refuses a resume of a not-entered and of an entered Run while the Goal is paused or cancelled; pause and cancel stay accepted', async () => {
    // ---- paused Goal, not-entered Run -------------------------------------------------
    const pausedFixture = await open();
    const pausedControls = controlsOn(pausedFixture.base.records, 'goal-paused');
    await submit(pausedFixture, pausedControls, 'a2-goal-pause', 'pause');
    expect(await setGoal(pausedFixture, 'pause', 'a2-goal-paused')).toMatchObject({ status: 'committed',
      value: { desiredState: 'paused' } });
    const counted = countingCommits(pausedFixture.base.records);
    expect(await controlsOn(counted.records, 'goal-paused').submitControl(pausedFixture.ctx, {
      input: { runRef: pausedFixture.claim.runRef, kind: 'resume', reason: null },
      meta: { requestId: 'a2-goal-paused-resume', expected: [await pausedFixture.pin()] } }))
      .toEqual({ status: 'rejected', code: 'busy',
        reason: 'the Goal is paused; a single Run is not resumed while its Goal is not active' });
    expect(counted.commits()).toBe(0);
    expect(await setGoal(pausedFixture, 'resume', 'a2-goal-resumed')).toMatchObject({ status: 'committed',
      value: { desiredState: 'active' } });
    expect((await submit(pausedFixture, pausedControls, 'a2-goal-active-resume', 'resume')).intent)
      .toMatchObject({ status: 'applied' });

    // A paused Goal does not stop a pause or a cancel of the Run.
    await setGoal(pausedFixture, 'pause', 'a2-goal-paused-again');
    const stillPaused = controlsOn(pausedFixture.base.records, 'goal-paused-pause');
    expect((await submit(pausedFixture, stillPaused, 'a2-goal-paused-pause', 'pause')).intent).toMatchObject({ status: 'applied' });

    // ---- cancelled Goal (not resumable), not-entered Run --------------------------------
    // Its own fixture: a cancelled Goal cannot be made active again. The refused resume
    // goes through an A3 commit counter on the real records: it writes nothing.
    const notEnteredFixture = await open();
    const notEnteredControls = controlsOn(notEnteredFixture.base.records, 'goal-cancelled-not-entered');
    await submit(notEnteredFixture, notEnteredControls, 'a2-goal-not-entered-pause', 'pause');
    expect(await setGoal(notEnteredFixture, 'cancel', 'a2-goal-not-entered-cancelled')).toMatchObject({ status: 'committed',
      value: { desiredState: 'cancelled' } });
    const countedNotEntered = countingCommits(notEnteredFixture.base.records);
    expect(await controlsOn(countedNotEntered.records, 'goal-cancelled-not-entered-resume').submitControl(notEnteredFixture.ctx, {
      input: { runRef: notEnteredFixture.claim.runRef, kind: 'resume', reason: null },
      meta: { requestId: 'a2-goal-cancelled-not-entered-resume', expected: [await notEnteredFixture.pin()] } }))
      .toEqual({ status: 'rejected', code: 'busy',
        reason: 'the Goal is cancelled; a single Run is not resumed while its Goal is not active' });
    expect(countedNotEntered.commits()).toBe(0);

    // ---- cancelled Goal (not resumable), entered Run from the real Runtime -------------
    const cancelledFixture = await open();
    const steps = await createS2BRuntimeSteps({
      base: cancelledFixture.base, bodies: cancelledFixture.bodies, ctx: cancelledFixture.ctx,
      directory: cancelledFixture.base.directory, scope: cancelledFixture.base.scope,
      now: () => B2_AT, setClock: () => undefined,
      eventId: () => 'a2-goal-event', newId: () => 'a2-goal-id', consumerId: 'runtime-a',
    });
    try {
      const enteredControls = controlsOn(cancelledFixture.base.records, 'goal-cancelled');
      const handle = await steps.start(cancelledFixture.claim, { at: B2_AT, replies: [
        { kind: 'calls', calls: [{ callId: 'a2-goal-read', name: 'read', args: { path: 'package.json' } }] },
        { kind: 'text', text: 'A2 goal cancelled after the pause' },
      ] });
      await handle.entered;
      // A real pause on the entered Run: the model reply is held at the A3 gate; releasing
      // it lets the Runtime reach its tool-group safe point, which applies the pause.
      const pause = await submit(cancelledFixture, enteredControls, 'a2-goal-entered-pause', 'pause');
      expect(pause.intent).toMatchObject({ status: 'queued' });
      handle.release();
      await handle.settled;
      expect(await readIntent(enteredControls, cancelledFixture, pause.intent.ref))
        .toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

      expect(await setGoal(cancelledFixture, 'cancel', 'a2-goal-cancelled')).toMatchObject({ status: 'committed',
        value: { desiredState: 'cancelled' } });
      const countedEntered = countingCommits(cancelledFixture.base.records);
      expect(await controlsOn(countedEntered.records, 'goal-cancelled-resume').submitControl(cancelledFixture.ctx, {
        input: { runRef: cancelledFixture.claim.runRef, kind: 'resume', reason: null },
        meta: { requestId: 'a2-goal-cancelled-resume', expected: [await cancelledFixture.pin()] } }))
        .toEqual({ status: 'rejected', code: 'busy',
          reason: 'the Goal is cancelled; a single Run is not resumed while its Goal is not active' });
      expect(countedEntered.commits()).toBe(0);
      // A cancelled Goal is terminal: the public owner refuses to resume it.
      expect(await setGoal(cancelledFixture, 'resume', 'a2-goal-cancelled-resume-goal'))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the Goal is cancelled (terminal); a resume has no effect' });
      const stillCancelled = await cancelledFixture.base.plans.queryGoal(cancelledFixture.ctx, cancelledFixture.base.goalRef);
      expect(stillCancelled).toMatchObject({ status: 'ready', value: { goal: { desiredState: 'cancelled' } } });
    } finally {
      await steps.close();
    }
  });
});

describe('CTL-06 / CD-4 at the service: the terminal settles a queued pause of any kind', () => {
  it('records terminal_without_cancel on a queued pause after a known terminal (CD-2)', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'terminal');
    const admitted = await fixture.enter();
    const pause = await submit(fixture, controls, 'a2-terminal-pause', 'pause');
    const result = await fixture.entry.recordRunResult(fixture.ctx, { input: fixture.terminalObservation(admitted),
      meta: { requestId: 'a2-terminal-result', expected: [await fixture.pin()] } });
    expect(result).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'completed' } });
    const { run } = await fixture.read();
    const auth = run.executionAuthorization;
    const locator = run.executionHistory;
    if (auth === undefined || !('schemaVersion' in auth) || locator === undefined || locator.endPosition === null) {
      throw Error('an ended Run with its terminal window is required');
    }
    const terminal: ControlObservationV1 = { schemaVersion: 1, kind: 'terminal_without_cancel',
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
      history: { ...locator }, source: { ...locator.kernel, position: locator.endPosition },
      kernelEventId: 'a2-run-completed', kernelEventSequence: 9, observedAt: B2_AT };
    const pins = async (): Promise<VersionPin[]> => [{ ref: pause.intent.ref, revision: 1 }, await fixture.pin()];
    const observed = await controls.recordControlObservation(fixture.ctx, {
      input: { intentRef: pause.intent.ref, runRef: fixture.claim.runRef, observation: terminal },
      meta: { requestId: 'a2-terminal-pause-ack', expected: await pins() } });
    expect(observed).toMatchObject({ status: 'committed', value: { status: 'superseded', revision: 2, observation: terminal } });
    if (observed.status !== 'committed') throw Error('the terminal ack must commit');
    // CTL-09: a second observer recording the same terminal is a no-op on the superseded intent.
    expect(await controls.recordControlObservation(fixture.ctx, {
      input: { intentRef: pause.intent.ref, runRef: fixture.claim.runRef, observation: terminal },
      meta: { requestId: 'a2-terminal-pause-ack-again', expected: [{ ref: pause.intent.ref, revision: 2 }, await fixture.pin()] } }))
      .toMatchObject({ status: 'committed', replayed: true, value: observed.value });
  });

  it('refuses terminal_without_cancel while the Run has not ended, and writes nothing (CTL-06 guard)', async () => {
    const fixture = await open();
    const counted = countingCommits(fixture.base.records);
    const controls = controlsOn(counted.records, 'open-terminal');
    await fixture.enter();
    const pause = await submit(fixture, controls, 'a2-open-terminal-pause', 'pause');
    const { run } = await fixture.read();
    const auth = run.executionAuthorization;
    const locator = run.executionHistory;
    if (auth === undefined || !('schemaVersion' in auth) || locator === undefined) throw Error('an entered Run is required');
    expect(run.status).toBe('running');
    const terminal: ControlObservationV1 = { schemaVersion: 1, kind: 'terminal_without_cancel',
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
      history: { ...locator, endPosition: null }, source: { ...locator.kernel, position: locator.observedThroughPosition },
      kernelEventId: 'a2-open-terminal', kernelEventSequence: 4, observedAt: B2_AT };
    const commitsBefore = counted.commits();
    expect(await controls.recordControlObservation(fixture.ctx, {
      input: { intentRef: pause.intent.ref, runRef: fixture.claim.runRef, observation: terminal },
      meta: { requestId: 'a2-open-terminal-ack', expected: [{ ref: pause.intent.ref, revision: 1 }, await fixture.pin()] } }))
      .toEqual({ status: 'rejected', code: 'busy',
        reason: 'terminal_without_cancel is recorded only after a known terminal that is not a yielded wait' });
    expect(counted.commits() - commitsBefore).toBe(0);
    expect(await readIntent(controls, fixture, pause.intent.ref)).toEqual(pause.intent);
  });
});
