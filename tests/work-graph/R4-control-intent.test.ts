/**
 * R4.1 durable control-intent behaviour tests (stage-1 skeleton).
 *
 * These are FINAL behaviour assertions, not skeleton expectations. Every
 * prerequisite (claim -> authorize/begin/entered -> model issue/consume) is
 * produced by the real public domain writers on the shared B2 fixture; the
 * control records are registered through `CONTROL_RECORD_SCHEMAS`. Until the
 * stage-2 implementation lands, `submitControl`/`readControl` return
 * `unsupported`, so each test stops at its first real control assertion. The
 * later barriers of a test are NOT reached and must not be reported as verified.
 *
 * Specification: docs/refactor/tasks/R4-control-recovery-skeleton.md §9.6.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ControlIntentKindV1, SubmitControlInput, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import {
  B2_AT, b2Key, createB2ExecutionFixture, synchronizeB2Commits,
  type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory'): Promise<B2ExecutionFixture> {
  const fixture = await createB2ExecutionFixture(kind, CONTROL_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** Build the raw control service the composition root owns, over the same records. */
function controlsOn(records: B2Records, tag = 'wg'): RunControlPort {
  let seq = 0;
  return createRunControlService({
    records,
    authority: createMaterialRecordReaders(records).authority,
    now: () => B2_AT,
    eventId: () => `r4-control-event-${tag}-${++seq}`,
  });
}

/** Submit a real control request and require the durable receipt (first red target). */
async function submitControl(
  fixture: B2ExecutionFixture,
  controls: RunControlPort,
  tag: string,
  kind: ControlIntentKindV1 = 'cancel',
  reason: string | null = null,
  runRef = fixture.claim.runRef,
  expected?: readonly VersionPin[],
): Promise<Awaited<ReturnType<RunControlPort['submitControl']>>> {
  const pin = expected ?? [await fixture.pin()];
  const result = await controls.submitControl(fixture.ctx, { input: { runRef, kind, reason },
    meta: { requestId: `r4-control-${tag}`, expected: [...pin] } });
  expect(result, `durable ${kind} control request (${tag})`).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw Error(`durable ${kind} control request required`);
  return result;
}

describe('R4.1 durable control intent', () => {
  // --------------------------------------------------------------------- //
  // Group 1: durable receipt, pause -> cancel supersession and replay      //
  // --------------------------------------------------------------------- //
  it('persists a pause intent together with the Run and replays the exact receipt after SQLite reopen', async () => {
    const fixture = await open('sqlite');
    const controls = controlsOn(fixture.base.records, 'persist');
    const before = await fixture.read();
    const pin = await fixture.pin();
    const request = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: 'operator requested pause' },
      meta: { requestId: 'r4-pause-persist', expected: [pin] } };

    const submitted = await controls.submitControl(fixture.ctx, request);
    expect(submitted).toMatchObject({ status: 'committed', replayed: false, value: {
      runRevision: pin.revision + 1,
      intent: { schemaVersion: 1, revision: 1, runRef: fixture.claim.runRef, kind: 'pause',
        desiredState: 'paused', status: 'queued', reason: 'operator requested pause' } } });
    if (submitted.status !== 'committed') throw Error('durable pause receipt required');

    const after = await fixture.read();
    expect(after.run.controlState).toEqual({ intentRef: submitted.value.intent.ref, desiredState: 'paused' });
    expect(after.run.revision).toBe(pin.revision + 1);
    // Only revision and controlState changed: no execution/occupancy field moved.
    const beforeRest = JSON.parse(JSON.stringify(before.run)) as Record<string, unknown>;
    const afterRest = JSON.parse(JSON.stringify(after.run)) as Record<string, unknown>;
    delete beforeRest.controlState; delete beforeRest.revision;
    delete afterRest.controlState; delete afterRest.revision;
    expect(afterRest).toEqual(beforeRest);
    // The pause request itself releases nothing: the original Session and Lease
    // facts are byte-identical to the pre-request read.
    expect(after.session).toEqual(before.session);
    expect(after.lease).toEqual(before.lease);

    expect(await controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toEqual({ status: 'ready', value: submitted.value.intent });

    await fixture.base.closeBackend();
    const reopened = await fixture.base.reopenService();
    try {
      const reopenedControls = controlsOn(reopened.records, 'reopen');
      expect(await reopenedControls.readControl(fixture.ctx, submitted.value.intent.ref))
        .toEqual({ status: 'ready', value: submitted.value.intent });
      expect(await reopenedControls.submitControl(fixture.ctx, request)).toEqual({ ...submitted, replayed: true });
    } finally { await reopened.close(); }
  });

  it('cancel supersedes a queued pause while the original pause still replays and a new pause cannot weaken cancel', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'supersede');
    const pauseRequest = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'r4-pause-before-cancel', expected: [await fixture.pin()] } };
    const pause = await controls.submitControl(fixture.ctx, pauseRequest);
    expect(pause).toMatchObject({ status: 'committed', value: { intent: { kind: 'pause', desiredState: 'paused', status: 'queued' } } });
    if (pause.status !== 'committed') throw Error('pause receipt required');

    const cancel = await controls.submitControl(fixture.ctx, {
      input: { runRef: fixture.claim.runRef, kind: 'cancel', reason: 'stop now' },
      meta: { requestId: 'r4-cancel-after-pause', expected: [await fixture.pin()] } });
    expect(cancel).toMatchObject({ status: 'committed', value: { intent: { kind: 'cancel', desiredState: 'cancelled', status: 'queued' } } });
    if (cancel.status !== 'committed') throw Error('cancel receipt required');
    expect((await fixture.read()).run.controlState)
      .toEqual({ intentRef: cancel.value.intent.ref, desiredState: 'cancelled' });

    // The superseded pause stays a queued historical fact and its exact request replays.
    expect(await controls.readControl(fixture.ctx, pause.value.intent.ref))
      .toEqual({ status: 'ready', value: pause.value.intent });
    expect(await controls.submitControl(fixture.ctx, pauseRequest)).toEqual({ ...pause, replayed: true });

    // Same requestId with changed kind/reason/expected is an idempotency conflict.
    expect(await controls.submitControl(fixture.ctx, { input: { ...pauseRequest.input, kind: 'cancel' },
      meta: { requestId: pauseRequest.meta.requestId, expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

    // A new pause request cannot weaken the cancelled fence.
    expect(await controls.submitControl(fixture.ctx, { input: pauseRequest.input,
      meta: { requestId: 'r4-pause-after-cancel', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
  });

  // --------------------------------------------------------------------- //
  // Group 2: an existing control blocks each of the four fresh actions     //
  // --------------------------------------------------------------------- //
  it('a queued control blocks fresh authorize and leaves the missing authorization unchanged', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'block-authorize');
    const prepared = await fixture.buildPrepared();
    const before = (await fixture.read()).run;
    await submitControl(fixture, controls, 'block-authorize', 'cancel');
    expect(await fixture.entry.authorizeRuntimeEntry(fixture.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'r4-fresh-authorize-blocked', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    // The rejected fresh action left no side effect on the entry authorization.
    expect((await fixture.read()).run.executionAuthorization).toEqual(before.executionAuthorization);
  });

  it('a queued control blocks fresh begin and leaves the authorized phase unchanged', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'block-begin');
    const admitted = await fixture.authorize();
    const before = (await fixture.read()).run;
    await submitControl(fixture, controls, 'block-begin', 'cancel');
    expect(await fixture.entry.beginRuntimeEntry(fixture.ctx, {
      input: { permit: admitted.permit, kernel: await fixture.kernelFor(fixture.claim) },
      meta: { requestId: 'r4-fresh-begin-blocked', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    // The rejected fresh action left the authorized phase and its revision intact.
    expect((await fixture.read()).run.executionAuthorization).toEqual(before.executionAuthorization);
  });

  it('a queued control blocks fresh model issue for an entered Run', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'block-issue');
    const entered = await fixture.enter();
    await submitControl(fixture, controls, 'block-issue', 'cancel');
    expect(await fixture.model.authorizeModelRequest(fixture.ctx, {
      input: fixture.actualRequest(entered), meta: { requestId: 'r4-fresh-issue-blocked', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
  });

  it('a queued control blocks fresh consume of an already issued permit and leaves it unconsumed', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'block-consume');
    const entered = await fixture.enter();
    const request = fixture.actualRequest(entered);
    const issued = await fixture.model.authorizeModelRequest(fixture.ctx, { input: request,
      meta: { requestId: 'r4-issue-before-control', expected: [await fixture.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('real issued permit required');

    await submitControl(fixture, controls, 'block-consume', 'cancel');
    expect(await fixture.model.recordModelRequestAttempt(fixture.ctx, {
      input: { request, permitRef: issued.value.permitRef, attemptId: 'blocked-consume', observedAt: B2_AT },
      meta: { requestId: 'r4-fresh-consume-blocked', expected: [await fixture.pin(), { ref: issued.value.permitRef, revision: 1 }] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    const rows = await fixture.base.records.readMany([b2Key(issued.value.permitRef)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') {
      expect(rows.value.records[0]?.revision).toBe(1);
      expect(JSON.parse(rows.value.records[0]!.json).permit.consumedByAttemptId).toBeNull();
    }
  });

  // --------------------------------------------------------------------- //
  // Group 3: a control committed after the last read wins the CAS          //
  // --------------------------------------------------------------------- //
  type Race = { records: B2Records; control: Promise<Awaited<ReturnType<RunControlPort['submitControl']>>> | undefined };

  /** Thin wrapper: before the barrier's original batch commits, run the real control writer. */
  function raceControl(original: B2Records, controls: RunControlPort, fixture: B2ExecutionFixture,
    pin: VersionPin, tag: string): Race {
    const state: Race = { records: undefined as unknown as B2Records, control: undefined };
    let fired = false;
    state.records = { ...original, async commit(batch) {
      if (!fired) {
        fired = true;
        state.control = controls.submitControl(fixture.ctx, { input: { runRef: fixture.claim.runRef, kind: 'pause', reason: null },
          meta: { requestId: `r4-race-control-${tag}`, expected: [pin] } });
        await state.control;
      }
      return original.commit(batch);
    } };
    return state;
  }

  it('control committed before the authorize batch makes the stale Run guard lose', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'race-authorize');
    const prepared = await fixture.buildPrepared();
    const pin = await fixture.pin();
    const race = raceControl(fixture.base.records, controls, fixture, pin, 'authorize');
    const action = await fixture.ports(race.records).entry.authorizeRuntimeEntry(fixture.ctx, {
      input: { prepared, consumerId: 'runtime-a' }, meta: { requestId: 'r4-race-authorize', expected: [pin] } });
    await expect(race.control, 'control writer must commit first').resolves.toMatchObject({ status: 'committed' });
    expect(action).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = (await fixture.read()).run;
    expect(after.executionAuthorization).toBeUndefined();
    expect(after.controlState).toMatchObject({ desiredState: 'paused' });
  });

  it('control committed before the begin batch makes the stale Run guard lose', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'race-begin');
    const admitted = await fixture.authorize();
    const before = (await fixture.read()).run;
    const pin = await fixture.pin();
    const race = raceControl(fixture.base.records, controls, fixture, pin, 'begin');
    const action = await fixture.ports(race.records).entry.beginRuntimeEntry(fixture.ctx, {
      input: { permit: admitted.permit, kernel: await fixture.kernelFor(fixture.claim) },
      meta: { requestId: 'r4-race-begin', expected: [pin] } });
    await expect(race.control, 'control writer must commit first').resolves.toMatchObject({ status: 'committed' });
    expect(action).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = (await fixture.read()).run;
    expect(after.executionAuthorization).toEqual(before.executionAuthorization);
    expect(after.controlState).toMatchObject({ desiredState: 'paused' });
  });

  it('control committed before the model-issue batch makes the stale Run guard lose', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'race-issue');
    const entered = await fixture.enter();
    const request = fixture.actualRequest(entered, 'r4-race-issue-request');
    const pin = await fixture.pin();
    const race = raceControl(fixture.base.records, controls, fixture, pin, 'issue');
    const action = await fixture.ports(race.records).model.authorizeModelRequest(fixture.ctx, {
      input: request, meta: { requestId: 'r4-race-issue', expected: [pin] } });
    await expect(race.control, 'control writer must commit first').resolves.toMatchObject({ status: 'committed' });
    expect(action).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect((await fixture.read()).run.controlState).toMatchObject({ desiredState: 'paused' });
  });

  it('control committed before the model-consume batch makes the stale Run guard lose and keeps the permit at @1', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'race-consume');
    const entered = await fixture.enter();
    const request = fixture.actualRequest(entered, 'r4-race-consume-request');
    const issued = await fixture.model.authorizeModelRequest(fixture.ctx, { input: request,
      meta: { requestId: 'r4-race-consume-issue', expected: [await fixture.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('real permit required');
    const pin = await fixture.pin();
    const race = raceControl(fixture.base.records, controls, fixture, pin, 'consume');
    const action = await fixture.ports(race.records).model.recordModelRequestAttempt(fixture.ctx, {
      input: { request, permitRef: issued.value.permitRef, attemptId: 'race-consume', observedAt: B2_AT },
      meta: { requestId: 'r4-race-consume', expected: [pin, { ref: issued.value.permitRef, revision: 1 }] } });
    await expect(race.control, 'control writer must commit first').resolves.toMatchObject({ status: 'committed' });
    expect(action).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const rows = await fixture.base.records.readMany([b2Key(issued.value.permitRef)]);
    expect(rows.status).toBe('ready');
    if (rows.status === 'ready') {
      expect(rows.value.records[0]?.revision).toBe(1);
      expect(JSON.parse(rows.value.records[0]!.json).permit.consumedByAttemptId).toBeNull();
    }
  });

  // --------------------------------------------------------------------- //
  // Group 4: occurred facts and original receipts survive a later control  //
  // --------------------------------------------------------------------- //
  it('a later control does not erase an earlier authorize receipt: the exact original request replays', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'replay-authorize');
    const prepared = await fixture.buildPrepared();
    const pin = await fixture.pin();
    const request = { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'r4-original-authorize', expected: [pin] } };
    const original = await fixture.entry.authorizeRuntimeEntry(fixture.ctx, request);
    expect(original).toMatchObject({ status: 'committed', replayed: false });
    if (original.status !== 'committed') throw Error('original authorize required');
    await submitControl(fixture, controls, 'after-original-authorize');
    expect(await fixture.entry.authorizeRuntimeEntry(fixture.ctx, request)).toEqual({ ...original, replayed: true });
  });

  it('an occurred entering fact is still recorded after a later control but the next fresh model action is blocked', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'entered-after-control');
    const admitted = await fixture.authorize();
    const began = await fixture.entry.beginRuntimeEntry(fixture.ctx, {
      input: { permit: admitted.permit, kernel: await fixture.kernelFor(fixture.claim) },
      meta: { requestId: 'r4-begin-before-control', expected: [await fixture.pin()] } });
    expect(began).toMatchObject({ status: 'committed' });
    if (began.status !== 'committed') throw Error('begin required');
    const enteringPermit = { ...admitted.permit, authorizationRevision: began.value.authorization.revision };
    const boundKernel = await fixture.kernelFor(fixture.claim);
    await submitControl(fixture, controls, 'after-begin', 'pause');

    const entered = await fixture.entry.recordExecutionEntered(fixture.ctx, {
      input: { permit: enteringPermit, enteredAt: B2_AT, kernelSource: { ...boundKernel, position: 3 },
        history: { ...fixture.observedHistory(3), kernel: boundKernel } },
      meta: { requestId: 'r4-entered-after-control', expected: [await fixture.pin()] } });
    expect(entered).toMatchObject({ status: 'committed',
      value: { status: 'running', executionAuthorization: { phase: 'entered' } } });

    const current = await fixture.currentPermit(fixture.claim);
    expect(await fixture.model.authorizeModelRequest(fixture.ctx, {
      input: fixture.actualRequest({ prepared: admitted.prepared, permit: current }),
      meta: { requestId: 'r4-issue-after-entered-control', expected: [await fixture.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
  });

  it('a queued cancel cannot rewrite an already-occurred natural completion, which still releases per the real result', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'natural-completed');
    const admitted = await fixture.enter();
    const observation = fixture.terminalObservation(admitted);
    await submitControl(fixture, controls, 'before-natural-completed', 'cancel');
    const result = await fixture.entry.recordRunResult(fixture.ctx, {
      input: observation,
      meta: { requestId: 'r4-natural-completed', expected: [await fixture.pin()] } });
    expect(result).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'completed' } });
    // The real terminal fact, not the queued intent, drives the original
    // Session/Lease release through the existing formal result logic.
    const ended = await fixture.read();
    expect(ended.session).toMatchObject({ occupancy: null, historyCursor: observation.completedHistoryBoundary.cursor });
    expect(ended.lease?.release).toMatchObject({ runRef: fixture.claim.runRef, attemptRef: fixture.claim.attemptRef,
      sessionRef: fixture.claim.sessionRef, generation: fixture.claim.generation });
  });

  // --------------------------------------------------------------------- //
  // Group 5: operator boundary and commit atomicity                        //
  // --------------------------------------------------------------------- //
  it('a revoked Host execution configuration still accepts a cancel and its read', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'revoked-host');
    fixture.host.enabled = false;
    const submitted = await controls.submitControl(fixture.ctx, {
      input: { runRef: fixture.claim.runRef, kind: 'cancel', reason: 'Host revoked the execution grant' },
      meta: { requestId: 'r4-cancel-after-host-revoke', expected: [await fixture.pin()] } });
    expect(submitted).toMatchObject({ status: 'committed',
      value: { intent: { kind: 'cancel', desiredState: 'cancelled', status: 'queued' } } });
    if (submitted.status !== 'committed') throw Error('revocation must not block the stop request');
    expect(await controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toEqual({ status: 'ready', value: submitted.value.intent });
  });

  it('rejects a non-Host principal, a cross-scope context and malformed control input', async () => {
    const fixture = await open();
    const controls = controlsOn(fixture.base.records, 'boundaries');
    const runPin = await fixture.pin();
    const actor = { kind: 'human' as const, id: 'r4-boundary-operator' };
    const workRunCtx: CoreCallContext = { ...fixture.ctx,
      principal: { kind: 'work_run', runRef: fixture.claim.runRef, roleBinding: fixture.base.roleBinding },
      materialReader: { kind: 'run', requester: fixture.claim.runRef } };
    const crossCtx: CoreCallContext = { projectId: fixture.ctx.projectId, workspaceId: 'r4-other-workspace',
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: fixture.ctx.projectId, workspaceId: 'r4-other-workspace', actor },
      signal: new AbortController().signal };
    const badKind = { runRef: fixture.claim.runRef, kind: 'unknown-control', reason: null } as unknown as SubmitControlInput;
    const base = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'r4-boundary-base', expected: [runPin] } };

    expect(await controls.submitControl(workRunCtx, base)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await controls.submitControl(crossCtx, { ...base, meta: { ...base.meta, requestId: 'r4-boundary-cross' } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await controls.submitControl(fixture.ctx, { input: badKind, meta: { ...base.meta, requestId: 'r4-boundary-kind' } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await controls.submitControl(fixture.ctx, { input: { ...base.input, reason: 'x'.repeat(2049) },
      meta: { ...base.meta, requestId: 'r4-boundary-reason' } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('two controls on the same Run and pin have one fresh winner and leave the other Run untouched', async () => {
    const fixture = await open();
    const pin = await fixture.pin();
    const racer = synchronizeB2Commits(fixture.base.records);
    const controls = controlsOn(racer.records, 'race-controls');
    const request = (id: string, kind: ControlIntentKindV1): { input: SubmitControlInput; meta: { requestId: string; expected: VersionPin[] } } =>
      ({ input: { runRef: fixture.claim.runRef, kind, reason: null },
        meta: { requestId: id, expected: [pin] } });
    const [first, second] = await Promise.all([
      controls.submitControl(fixture.ctx, request('r4-race-controls-a', 'pause')),
      controls.submitControl(fixture.ctx, request('r4-race-controls-b', 'cancel')),
    ]);
    expect([first, second].filter(result => result.status === 'committed' && !result.replayed), 'exactly one fresh winner')
      .toHaveLength(1);
    const losers = [first, second].filter(result => result.status === 'rejected');
    expect(losers, 'the other control must lose the Run CAS').toHaveLength(1);
    expect(losers[0]).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(racer.arrivals()).toBe(2);
    const winner = [first, second].find(result => result.status === 'committed');
    if (!winner || winner.status !== 'committed') throw Error('one control must commit');
    expect(await controls.readControl(fixture.ctx, winner.value.intent.ref))
      .toEqual({ status: 'ready', value: winner.value.intent });
    expect((await fixture.read()).run.controlState).toEqual({ intentRef: winner.value.intent.ref,
      desiredState: winner.value.intent.desiredState });
    expect((await fixture.read(fixture.secondClaim)).run.controlState).toBeUndefined();
  });

  it('replays a same-identity winner committed after both lookup misses but before the delayed authority read', async () => {
    const fixture = await open();
    const original = fixture.base.records;
    const pin = await fixture.pin();
    const request = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'r4-same-identity-before-load', expected: [pin] } };
    const firstLookups = new Map<string, {
      input: Parameters<B2Records['lookupCommit']>[0];
      result: Awaited<ReturnType<B2Records['lookupCommit']>>;
    }>();
    let commitCalls = 0;
    const trackedRecords = (side: string): B2Records => ({ ...original,
      async lookupCommit(input) {
        const result = await original.lookupCommit(input);
        if (!firstLookups.has(side)) firstLookups.set(side, { input, result });
        return result;
      },
      async commit(batch) { commitCalls++; return original.commit(batch); },
    });
    const recordsA = trackedRecords('a');
    const recordsB = trackedRecords('b');
    const realAuthority = createMaterialRecordReaders(recordsB).authority;
    let reached!: () => void;
    let release!: () => void;
    const beforeLoad = new Promise<void>(resolve => { reached = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    let gated = false;
    const controlsB = createRunControlService({
      records: recordsB,
      authority: { async load(ref) {
        if (!gated && b2Key(ref) === b2Key(fixture.claim.runRef)) {
          gated = true;
          reached();
          await proceed;
        }
        return realAuthority.load(ref);
      } },
      now: () => B2_AT, eventId: () => 'r4-control-event-same-identity-b',
    });
    const delayed = controlsB.submitControl(fixture.ctx, request);
    try {
      // A skeleton/early rejection wins this race and fails immediately; it
      // cannot leave the test waiting for an authority call it never reaches.
      expect(await Promise.race([beforeLoad.then(() => 'load'), delayed.then(() => 'result')]))
        .toBe('load');
      expect(firstLookups.get('b')?.result).toMatchObject({ status: 'rejected', code: 'not_found' });
      const winner = await controlsOn(recordsA, 'same-identity-a').submitControl(fixture.ctx, request);
      expect(firstLookups.get('a')?.result).toMatchObject({ status: 'rejected', code: 'not_found' });
      expect(firstLookups.get('a')?.input).toEqual(firstLookups.get('b')?.input);
      expect(winner).toMatchObject({ status: 'committed', replayed: false });
      if (winner.status !== 'committed') throw Error('the same-identity winner must really commit');
      release();
      expect(await delayed).toEqual({ ...winner, replayed: true });
      expect(commitCalls, 'the delayed retry must recover the receipt without a second commit').toBe(1);
      expect((await fixture.read()).run.revision).toBe(pin.revision + 1);
    } finally {
      release();
      await Promise.allSettled([delayed]);
    }
  });

  it('a lost commit acknowledgement is recovered from the real receipt, and a blocked recovery read stays unconfirmed until retried', async () => {
    const fixture = await open();

    // Window A: the commit landed but its response was lost while the receipt
    // lookup stays readable. Recovery must return the real receipt, never
    // report it unavailable merely because the acknowledgement was lost.
    const pinA = await fixture.pin();
    const requestA = { input: { runRef: fixture.claim.runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'r4-lost-ack-a', expected: [pinA] } };
    let commitsA = 0;
    const wrappedA: B2Records = { ...fixture.base.records, async commit(batch) {
      commitsA++;
      await fixture.base.records.commit(batch);
      throw new Error('simulated lost commit acknowledgement');
    } };
    const controlsA = controlsOn(wrappedA, 'lost-ack-a');
    const recoveredA = await controlsA.submitControl(fixture.ctx, requestA);
    expect(recoveredA).toMatchObject({ status: 'committed', replayed: true });
    if (recoveredA.status !== 'committed') throw Error('a readable receipt must be recovered');
    expect(await controlsA.submitControl(fixture.ctx, requestA)).toEqual({ ...recoveredA, replayed: true });
    expect(commitsA, 'recovery must restore the original receipt without a new commit').toBe(1);

    // Window B: the commit landed and lookup found its receipt, but eventAt is
    // unavailable. The first call is unconfirmed ("unknown"), not "did not
    // commit" and not a safe retry; lifting the read fault and retrying the
    // original key recovers the same real receipt without a second write.
    const pinB = await fixture.pin(fixture.secondClaim);
    const requestB = { input: { runRef: fixture.secondClaim.runRef, kind: 'cancel' as const, reason: null },
      meta: { requestId: 'r4-lost-ack-b', expected: [pinB] } };
    let commitsB = 0;
    let breakRecoveryRead = true;
    const wrappedB: B2Records = { ...fixture.base.records,
      async eventAt(cursor) {
        if (breakRecoveryRead) throw new Error('simulated unreadable committed event');
        return fixture.base.records.eventAt(cursor);
      },
      async commit(batch) {
        commitsB++;
        await fixture.base.records.commit(batch);
        throw new Error('simulated lost commit acknowledgement');
      },
    };
    const controlsB = controlsOn(wrappedB, 'lost-ack-b');
    expect(await controlsB.submitControl(fixture.ctx, requestB))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    breakRecoveryRead = false;
    const recoveredB = await controlsB.submitControl(fixture.ctx, requestB);
    expect(recoveredB).toMatchObject({ status: 'committed', replayed: true });
    if (recoveredB.status !== 'committed') throw Error('the original key must recover the same real receipt');
    expect(commitsB, 'the retry must not write a second commit').toBe(1);
  });
});
