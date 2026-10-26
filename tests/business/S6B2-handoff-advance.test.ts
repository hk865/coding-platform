/**
 * H-B primitive rows for the advance protocol: the saved before write replays its input, the after write replays the
 * child's original cursor, the caller's principal never reaches a write, and a transfer committed before the parent's
 * progress is recovered by the read-only receipt entry. Owner-level rows drive the one advance owner the composition
 * root injects; composite rows drive `world.platform.workflow.sessionHandoff` and observe the ports that composite
 * itself holds.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { responsibleLinkRef, transferPinsOf } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { archiveContextOf } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan, governS6B, holdS6BRequestRound, seedS6BArchiveSource,
  seedS6BHandoffLines } from '../helpers/S6B1-fixture.js';
import { deferred, readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { driveS6BHandoff, seedS6BTooLongSecretary } from '../helpers/S6B2-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { createAlwaysAdmitCapacity, createLineCreation } from '../../src/business/workflow/line-creation.js';
import {
  s6b2Accept, s6b2Advance, s6b2Archive, s6b2Backend, s6b2Basis, s6b2FailCommit, s6b2Scene, s6b2Workspace,
  type S6B2Backend, type S6B2Captured, type S6B2WorldValue,
} from '../helpers/S6B2-handoff-scene.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealInMemory(captured,
    await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>(), true));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealSqlite(captured,
    await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>(), true));

const scene = s6b2Scene();
afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });
afterAll(() => scene.closeAll());

/** The one advance owner the composition root injects into the published composite (the owner-level rows' seam). */
function services(world: S6B2WorldValue, records?: S6B2Backend['records']) {
  return s6b2Advance(world, captured, { records: records ?? s6b2Backend(captured).records });
}
/** The composite the composition root publishes; the composite rows drive this one, never a second assembly. */
function published(world: S6B2WorldValue) {
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the Workflow publishes no handoff composite');
  return owner;
}
/** The advance owner the composition root injects into that composite: its own child call, never a second owner. */
function handoffOwner(world: S6B2WorldValue) {
  const owner = world.platform.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the platform publishes no handoff owner');
  return owner;
}
type AdvanceAnswer = Awaited<ReturnType<ReturnType<typeof handoffOwner>['advanceHandoff']>>;

/**
 * A3: the advance owner the composite itself calls, wrapped. It reads every real answer back and holds the composite
 * at the first answer `at` names — after that write committed, before the composite reads it — until `release`; the
 * real answer is returned unchanged and `restore` opens the gate and puts the real method back on every path.
 */
function holdAdvanceHandoff(world: S6B2WorldValue, at: (answer: AdvanceAnswer) => boolean) {
  const owner = handoffOwner(world);
  const real = owner.advanceHandoff;
  const writes: { commandId: string; stage: string; item: string; phase: string; replayed: boolean }[] = [];
  const reached = deferred<void>();
  const held = deferred<void>();
  let stopped = false;
  owner.advanceHandoff = async (ctx, input) => {
    const answer = await real(ctx, input);
    if (answer.status === 'committed') {
      const write = answer.value.write;
      writes.push({ commandId: write.commandId, stage: write.stage, item: write.item, phase: write.phase,
        replayed: answer.replayed });
    }
    if (!stopped && at(answer)) {
      stopped = true;
      reached.resolve();
      await held.promise;
    }
    return answer;
  };
  return { reached: reached.promise, writes, release: () => held.resolve(),
    restore: () => { held.resolve(); owner.advanceHandoff = real; } };
}
/** A real source line, an existing target and an operation sitting at its first transfer's before write. */
async function transferBefore(label: string, backend: 'memory' | 'sqlite' = 'memory', taskCount = 1) {
  const { world } = await scene.open(backend);
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, ws, world.goals);
  const lines = await seedS6BHandoffLines(ws, world.goals.first);
  const operation = await s6b2Accept(world, { commandId: `s6b-advance-${label}`, source: lines.source.ref,
    target: lines.target.ref, tasks: lines.tasks.slice(0, taskCount) });
  const advance = services(world);
  const step = stepper(world, advance, operation);
  for (let index = 0; index < 4; index += 1) await step();
  const before = await step();
  const saved = before.write.savedInput;
  if (saved?.kind !== 'transfer') throw new Error('the transfer before write saved no input');
  const write: GraphWrite<{ from: typeof saved.from; to: typeof saved.to; target: typeof saved.target }> = {
    input: { from: saved.from, to: saved.to, target: saved.target },
    meta: { requestId: saved.requestId, expected: transferPinsOf(saved) } };
  return { world, operation, before, saved, write, step, advance };
}

describe('replay and continue are separate', () => {
  it('replays the before write with its saved input and the after write with the original cursor', async () => {
    const setup = await transferBefore('replay');
    const { world, operation, before, saved, write } = setup;
    const advance = services(world);
    const replayBefore = await advance.advanceHandoff(world.humanContext(),
      { kind: 'replay', operation, commandId: before.write.commandId });
    expect(replayBefore).toMatchObject({ status: 'committed', replayed: true });
    if (replayBefore.status !== 'committed') return;
    expect(replayBefore.value.revision).toBe(before.revision);
    expect(replayBefore.value.write.phase).toBe('before');
    expect(replayBefore.value.write.savedInput).toEqual(saved);
    const child = await world.platform.responsibilities.transferSessionResponsibility(world.humanContext(), write);
    expect(child.status).toBe('committed');
    if (child.status !== 'committed') return;
    // A new service instance is the recovery after a crash: it writes the after mark from the child's receipt.
    const after = await setup.step();
    expect(after.write.phase).toBe('after');
    expect(after.write.receipt).toEqual({ cursor: child.cursor });
    const replayAfter = await advance.advanceHandoff(world.humanContext(),
      { kind: 'replay', operation, commandId: after.write.commandId });
    expect(replayAfter).toMatchObject({ status: 'committed', replayed: true });
    if (replayAfter.status !== 'committed') return;
    expect(replayAfter.value.revision).toBe(after.revision);
    expect(replayAfter.value.write.receipt).toEqual({ cursor: child.cursor });
  }, 60_000);
});

describe.each(['memory', 'sqlite'] as const)('AH-12 on %s: a replay answers from the original event', backend => {
  it('keeps the before write receipt null after the after write committed', async () => {
    const setup = await transferBefore(`original-${backend}`, backend);
    const { world, operation, before, saved, write } = setup;
    const child = await world.platform.responsibilities.transferSessionResponsibility(world.humanContext(), write);
    expect(child.status).toBe('committed');
    if (child.status !== 'committed') return;
    const after = await setup.step();
    expect(after.write.phase).toBe('after');
    expect(after.write.receipt).toEqual({ cursor: child.cursor });
    const replay = await setup.advance.advanceHandoff(world.humanContext(),
      { kind: 'replay', operation, commandId: before.write.commandId });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status !== 'committed') return;
    expect(replay.value.revision).toBe(before.revision);
    expect(replay.value.write.savedInput).toEqual(saved);
    expect(replay.value.write.receipt).toBeNull();
  }, 60_000);
});

describe.each(['memory', 'sqlite'] as const)('AH-21 on %s: the one write executor owns the commit and its recovery', backend => {
  it('finds the original receipt after a commit outcome is lost once', async () => {
    const { world } = await scene.open(backend);
    const source = await world.createSecretary('s6b2-lost-commit-source');
    const target = await world.createSecretary('s6b2-lost-commit-target');
    const operation = await s6b2Accept(world, { commandId: 's6b2-lost-commit-accept', source: source.ref, target: target.ref });
    const capturedBackend = s6b2Backend(captured);
    let lost = false;
    const flaky = { ...capturedBackend.records, commit: async (prepared: Parameters<typeof capturedBackend.records.commit>[0]) => {
      const receipt = await capturedBackend.records.commit(prepared);
      if (!lost && prepared.identityKey.startsWith('handoff.advance:') && receipt.status === 'committed') {
        lost = true;
        throw new Error('S6B2: the commit outcome was lost after the write landed');
      }
      return receipt;
    } };
    const advance = services(world, flaky);
    const first = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    expect(lost).toBe(true);
    expect(first).toMatchObject({ status: 'committed', replayed: true });
    if (first.status !== 'committed') return;
    expect(first.value.write.stage).toBe('fence');
    const replay = await advance.advanceHandoff(world.humanContext(), { kind: 'replay',
      operation, commandId: first.value.write.commandId });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status !== 'committed') return;
    expect(replay.value.revision).toBe(first.value.revision);
    expect(replay.cursor).toBe(first.cursor);
  }, 60_000);
});

describe('the fixture driver is late-binding', () => {
  it('drives a real operation through the published Workflow owner', async () => {
    const { world } = await scene.open('memory');
    const source = await world.createSecretary('s6b2-late-binding-source');
    const target = await world.createSecretary('s6b2-late-binding-target');
    const operation = await s6b2Accept(world, { commandId: 's6b2-late-binding', source: source.ref, target: target.ref });
    // The same public entry the fixture uses resolves `world.platform.workflow.sessionHandoff`.
    const driven = await driveS6BHandoff(world, { operation });
    expect(driven.progress?.stage).toBe('finished');
  }, 60_000);
});

describe('the saved principal and the read-only transfer receipt', () => {
  it('ignores the caller principal and never calls the transfer child while recovering', async () => {
    const setup = await transferBefore('principal');
    const { world, operation, write } = setup;
    const advance = services(world);
    // The accept ran as the Host person; a system caller must still replay the same write.
    const replay = await advance.advanceHandoff(world.systemContext(),
      { kind: 'replay', operation, commandId: setup.before.write.commandId });
    expect(replay.status).toBe('committed');
    const child = await world.platform.responsibilities.transferSessionResponsibility(world.humanContext(), write);
    expect(child.status).toBe('committed');
    let calls = 0;
    const original = world.platform.responsibilities.transferSessionResponsibility;
    world.platform.responsibilities.transferSessionResponsibility = async (...args) => {
      calls += 1;
      return await original(...args);
    };
    try {
      const after = await setup.step();
      expect(after.write.receipt).toEqual({ cursor: child.status === 'committed' ? child.cursor : null });
      expect(calls).toBe(0);
    } finally {
      world.platform.responsibilities.transferSessionResponsibility = original;
    }
  }, 60_000);
});
/** Drive one operation from revision 1, one committed advance write per call. */
function stepper(world: S6B2WorldValue,
  advance: ReturnType<typeof services>,
  operation: Parameters<typeof advance.advanceHandoff>[1]['operation']) {
  let revision = 1;
  return async (from?: number) => {
    if (from !== undefined) revision = from;
    const result = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: revision });
    if (result.status !== 'committed') throw new Error(`advance failed: ${JSON.stringify(result)}`);
    revision = result.value.revision;
    return result.value;
  };
}
/** A secretary source that owns one goal root: coverage is short, so its understanding stage appends a round. */
async function understandingScene(label: string, backend: 'memory' | 'sqlite' = 'memory') {
  const { world } = await scene.open(backend);
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const source = await world.createSecretary(`${label}-source`);
  const target = await world.createSecretary(`${label}-target`);
  await governS6B(world, ws, world.goals);
  await ws.submit({ label: `${label}-goal`, goalId: world.goals.first.goalId, recipient: source.ref });
  const operation = await s6b2Accept(world, { commandId: `${label}-accept`, source: source.ref, target: target.ref });
  return { world, ws, source, target, operation };
}

describe('AH-19: a stop that writes nothing returns the L1 stop', () => {
describe.each(['memory', 'sqlite'] as const)('AH-19 on %s: the fence CAS writes nothing for another holder', backend => {
  it('answers fenced for another holder without faking a cursor or a commit', async () => {
    const { world } = await scene.open(backend);
    const source = await world.createSecretary('s6b2-fenced-source');
    const target = await world.createSecretary('s6b2-fenced-target');
    const advance = services(world);
    const hold = commitBarrier.hold(byIdentityPrefix('handoff.accept:'), 'the first accept commit');
    const firstPending = world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's6b2-fenced-accept-1', workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'existing', session: target.ref }, tasks: [] }],
    });
    await hold.reached;
    const second = await s6b2Accept(world, { commandId: 's6b2-fenced-accept-2', source: source.ref, target: target.ref });
    hold.release();
    const first = await firstPending;
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') return;
    const fence = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation: first.value.operation, expectedRevision: 1 });
    expect(fence).toMatchObject({ status: 'committed' });
    if (fence.status !== 'committed') return;
    expect(fence.value.write.stage).toBe('fence');
    const refused = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation: second, expectedRevision: 1 });
    expect(refused).toMatchObject({ status: 'stopped', stop: 'fenced', revision: 1, stage: 'accepted',
      generation: 1, operation: second });
    if (refused.status !== 'stopped') return;
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), second);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    expect(read.value.revision).toBe(1);
    expect(read.value.action.progress.stage).toBe('accepted');
    expect(read.value.action.progress.fence).toBeNull();
  }, 60_000);
});
  it('answers wait_writer for a writer that has not stopped, then moves under the current generation', async () => {
    const { world } = await scene.open('memory');
    const target = await world.createSecretary('s6b2-wait-target');
    const advance = services(world);
    const held = await holdS6BRequestRound(world, { label: 'writer', goalId: null }, async round => {
      const operation = await s6b2Accept(world, { commandId: 's6b2-wait-accept', source: round.secretary.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
      const fence = await advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: 1 });
      expect(fence).toMatchObject({ status: 'committed' });
      if (fence.status !== 'committed') throw new Error('the fence take was refused');
      const stopped = await advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: fence.value.revision });
      return { operation, stopped };
    });
    expect(held.value.stopped).toMatchObject({ status: 'stopped', stop: 'wait_writer', revision: 2,
      stage: 'wait_writer', generation: 1 });
    if (held.value.stopped.status !== 'stopped') return;
    const stopped = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation: held.value.operation, expectedRevision: held.value.stopped.revision });
    expect(stopped).toMatchObject({ status: 'committed' });
    if (stopped.status !== 'committed') return;
    expect(stopped.value.write.stage).toBe('wait_writer');
    expect(stopped.value.write.generation).toBe(1);
    const waitBasis = (await handoffProgress(world, held.value.operation)).stoppedWriter?.lastExecution?.runId;
    const replayWait = await advance.advanceHandoff(world.humanContext(), { kind: 'replay', operation: held.value.operation, commandId: stopped.value.write.commandId });
    expect(replayWait).toMatchObject({ status: 'committed', replayed: true, value: { write: { savedInput: { kind: 'wait', basis: `stopped:${waitBasis}` } } } });
    expect(stopped.value.next).toBe('recheck');
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), held.value.operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    expect(read.value.action.progress.stage).toBe('recheck');
    expect(read.value.action.progress.advanceGeneration).toBe(1);
    expect(read.value.action.progress.stoppedWriter?.lastExecution).not.toBeNull();
    const recheck = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation: held.value.operation, expectedRevision: stopped.value.revision });
    expect(recheck).toMatchObject({ status: 'committed' });
    if (recheck.status !== 'committed') return;
    expect(recheck.value.write.stage).toBe('recheck');
    expect(recheck.value.write.generation).toBe(1);
    expect(recheck.value.next).toBe('successor');
  }, 60_000);
  // The source's real duty, never the target's shape or the trigger, opens the secretary steps: both triggers read
  // coverage first and reach the same understanding write.
  it.each(['too_long', 'manual'] as const)('answers incomplete for a saved understanding command whose round has not committed (AH-17 %s)', async trigger => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary(`s6b2-incomplete-source-${trigger}`);
    const target = await world.createSecretary(`s6b2-incomplete-target-${trigger}`);
    await governS6B(world, ws, world.goals);
    await ws.submit({ label: `incomplete-goal-${trigger}`, goalId: world.goals.first.goalId, recipient: source.ref });
    const operation = await s6b2Accept(world, { commandId: `s6b2-incomplete-accept-${trigger}`, source: source.ref,
      target: target.ref, trigger, actor: trigger === 'manual' ? 'human' : 'system' });
    const advance = services(world);
    const saved = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    expect(saved).toMatchObject({ status: 'committed' });
    if (saved.status !== 'committed') return;
    expect(saved.value.write.stage).toBe('understanding');
    expect(saved.value.write.phase).toBe('before');
    expect(saved.value.write.generation).toBe(2);
    expect(saved.value.stop).toBe('incomplete');
    const stopped = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: saved.value.revision });
    expect(stopped).toMatchObject({ status: 'stopped', stop: 'incomplete', revision: saved.value.revision,
      stage: 'understanding', generation: 2 });
    if (stopped.status !== 'stopped') return;
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    expect(read.value.revision).toBe(stopped.revision);
    expect(read.value.action.progress.stage).toBe('understanding');
    expect(read.value.action.progress.advanceGeneration).toBe(2);
    expect(read.value.action.progress.understanding[0]?.round).toBeNull();
    expect(read.value.action.progress.fence).toBeNull();
    expect(read.value.action.progress.coverage).not.toBeNull();
  }, 60_000);
});

describe('AH-09 and L2: the failed recheck releases the fence and the re-pass raises once', () => {
  it('returns to understanding, clears the wait basis and re-takes the fence under the raised generation', async () => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b2-repass-source');
    const other = await world.createSecretary('s6b2-repass-other');
    await governS6B(world, ws, world.goals);
    await ws.submit({ label: 'repass-hold', goalId: null, recipient: source.ref });
    const operation = await s6b2Accept(world, { commandId: 's6b2-repass-accept', source: source.ref,
      trigger: 'too_long', actor: 'system' });
    const advance = services(world);
    const step = stepper(world, advance, operation);
    const fence = await step();
    expect(fence.write.stage).toBe('fence');
    expect(fence.write.generation).toBe(1);
    const waited = await step();
    expect(waited.write.stage).toBe('wait_writer');
    expect(waited.write.generation).toBe(1);
    const goal = await ws.submit({ label: 'repass-goal', goalId: world.goals.first.goalId, recipient: null });
    const moved = await world.route({ commandId: 's6b2-repass-to-source', round: goal.round, to: source.ref });
    expect(moved.status).toBe('routed');
    const failed = await step();
    expect(failed.write.stage).toBe('recheck');
    expect(failed.write.generation).toBe(1);
    expect(failed.write.savedInput).toEqual({ kind: 'recheck', basis: 'incomplete' });
    expect(failed.stop).toBe('incomplete');
    expect(failed.next).toBe('understanding');
    const afterFailure = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterFailure.status).toBe('ready');
    if (afterFailure.status !== 'ready' || afterFailure.value.action.kind !== 'handoff') return;
    const progress = afterFailure.value.action.progress;
    expect(progress.stage).toBe('understanding');
    expect(progress.stoppedWriter).toBeNull();
    expect(progress.fence?.state).toBe('released');
    expect(progress.lastRefusal?.stage).toBe('recheck');
    expect(progress.advanceGeneration).toBe(1);
    const away = await world.route({ commandId: 's6b2-repass-away', round: goal.round, to: other.ref });
    expect(away.status).toBe('routed');
    const retaken = await step();
    expect(retaken.write.stage).toBe('fence');
    expect(retaken.write.generation).toBe(2);
    const afterRetake = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterRetake.status).toBe('ready');
    if (afterRetake.status !== 'ready' || afterRetake.value.action.kind !== 'handoff') return;
    expect(afterRetake.value.action.progress.advanceGeneration).toBe(2);
    expect(afterRetake.value.action.progress.lastRefusal).toBeNull();
    expect(afterRetake.value.action.progress.fence?.state).toBe('held');
    const waitedAgain = await step();
    expect(waitedAgain.write.stage).toBe('wait_writer');
    expect(waitedAgain.write.generation).toBe(2);
    const rechecked = await step();
    expect(rechecked.write.stage).toBe('recheck');
    expect(rechecked.write.generation).toBe(2);
    expect(rechecked.next).toBe('successor');
  }, 60_000);
});

describe('AH-02: the successor before write stores the exact create input', () => {
  describe.each(['memory', 'sqlite'] as const)('AH-02 on %s: the create input persists through the record', backend => {
  it('persists createInput so the next advance replays the saved child instead of rebuilding it', async () => {
    const { world } = await scene.open(backend);
    const source = await world.createSecretary('s6b2-create-source');
    const operation = await s6b2Accept(world, { commandId: 's6b2-create-accept', source: source.ref });
    const advance = services(world);
    const step = stepper(world, advance, operation);
    for (let index = 0; index < 3; index += 1) await step();
    const before = await step();
    expect(before.write.stage).toBe('successor');
    expect(before.write.phase).toBe('before');
    expect(before.write.item).toBe('assignment:0');
    const saved = before.write.savedInput;
    expect(saved?.kind).toBe('create');
    if (saved?.kind !== 'create') return;
    expect(saved.input.commandId).toBe(`${operation.operationId}:create:0`);
    expect(saved.input.duty).toBe('secretary');
    expect(saved.input.provenance).toEqual({ schemaVersion: 1, kind: 'handoff', from: source.ref });
    expect(saved.input.roleConfiguration).toEqual(source.role);
    expect(saved.input.replaces).toEqual(source.ref);
    expect(saved.input.parentOperation).toEqual(operation);
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    expect(read.value.action.progress.assignments[0]?.createInput).toEqual(saved.input);
  }, 60_000);
  });
});


describe('AH-04 and AH-16: the composite resumes the child whose before write committed', () => {
  describe.each(['memory', 'sqlite'] as const)('AH-04/AH-16 on %s: the saved arm is restored after a child failure', backend => {
  it('calls the create owner again with the saved arm and the created Session records its parent operation', async () => {
    const { world } = await scene.open(backend);
    const source = await world.createSecretary('s6b2-resume-source');
    const operation = await s6b2Accept(world, { commandId: 's6b2-resume-accept', source: source.ref });
    const advance = services(world);
    const composite = published(world);
    // A2: the create child's own register commit fails once at its named point; the real owner answers unavailable.
    const fault = s6b2FailCommit(s6b2Backend(captured).records, { prefix: 'session-create:' });
    try {
      const first = await composite.advance(world.humanContext(), { operation });
      expect(first).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const held = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
      expect(held.status).toBe('ready');
      if (held.status !== 'ready' || held.value.action.kind !== 'handoff') return;
      const window = held.value.action.progress;
      expect(window.stage).toBe('successor');
      expect(window.assignments[0]?.createInput).not.toBeNull();
      expect(window.assignments[0]?.createOperation).toBeNull();
      expect(window.assignments[0]?.successor).toBeNull();
      const resumed = await advance.advanceHandoff(world.humanContext(),
        { kind: 'continue', operation, expectedRevision: held.value.revision });
      expect(resumed).toMatchObject({ status: 'committed', replayed: true });
      if (resumed.status !== 'committed') return;
      expect(resumed.value.write).toMatchObject({ stage: 'successor', item: 'assignment:0', phase: 'before',
        generation: window.advanceGeneration, receipt: null,
        savedInput: { kind: 'create', requestId: `${operation.operationId}:create:0`,
          input: window.assignments[0]!.createInput } });
      // The replay answers the before write's own revision, and that write is the one write before the refusal mark:
      // exactly one behind the revision this public record read returned. The replay adds nothing.
      expect(resumed.value.revision).toBe(held.value.revision - 1);
      const afterResume = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
      expect(afterResume.status === 'ready' ? afterResume.value.revision : null).toBe(held.value.revision);
      // The create commits; the published composite then drives the rest of the handoff to its finished notice.
      const second = await composite.advance(world.humanContext(), { operation });
      expect(second).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
      if (second.status !== 'ready') return;
      const done = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
      expect(done.status).toBe('ready');
      if (done.status !== 'ready' || done.value.action.kind !== 'handoff') return;
      const marked = done.value.action.progress.assignments[0];
      expect(marked?.successor).not.toBeNull();
      expect(marked?.createOperation).not.toBeNull();
      expect(done.value.action.progress.advanceGeneration).toBe(1);
      const created = await world.platform.sessions.getSessionOperation(world.humanContext(), marked!.createOperation!);
      expect(created.status).toBe('ready');
      if (created.status !== 'ready') return;
      expect(created.value.action.kind === 'create' ? created.value.action.parentOperation : null).toEqual(operation);
      // The same operation's replay answers the same completed progress and writes nothing.
      const replay = await composite.advance(world.humanContext(), { operation });
      expect(replay).toMatchObject({ status: 'ready',
        value: { stage: 'finished', phase: 'completed', revision: second.value.revision } });
    } finally {
      fault.restore();
    }
  }, 60_000);
  });
});

describe('AH-01: the automatic entry reads the unfinished operation before the threshold', () => {
  it('continues the same handoff without an accept and refuses a short source with no operation', async () => {
    const { world } = await scene.open('memory');
    const seeded = await seedS6BTooLongSecretary(world, { windowTokens: 1_000_000, inputTokens: 1, label: 'start-short' });
    const source = seeded.secretary.ref;
    const target = await world.createSecretary('s6b2-start-target');
    const existing = await s6b2Accept(world, { commandId: 's6b2-start-existing', source, target: target.ref });
    let accepts = 0;
    const composite = published(world);
    const port = world.platform.sessionHandoff;
    // A3: a counting wrapper over the composite's own injected accept port; its answer passes through unchanged.
    const acceptHandoff = port.acceptHandoff;
    port.acceptHandoff = async (...args: Parameters<typeof acceptHandoff>) => {
      accepts += 1;
      return await acceptHandoff(...args);
    };
    const basis = await s6b2Basis(s6b2Backend(captured).records)(source, S6A_SCOPE);
    expect(basis.status).toBe('ready');
    if (basis.status !== 'ready') return;
    expect(basis.value.tooLong).toBe(false);
    // The drive continues the existing operation instead of accepting a second one.
    try {
      await composite.startHandoff(world.humanContext(), { source, basis: basis.value });
    } finally {
      port.acceptHandoff = acceptHandoff;
    }
    expect(accepts).toBe(0);
    const moved = await world.platform.sessions.getSessionOperation(world.humanContext(), existing);
    expect(moved.status).toBe('ready');
    if (moved.status !== 'ready') return;
    expect(moved.value.revision).toBeGreaterThan(1);
    const fresh = await world.createSecretary('s6b2-start-fresh');
    const short = await s6b2Basis(s6b2Backend(captured).records)(fresh.ref, S6A_SCOPE);
    expect(short.status).toBe('ready');
    if (short.status !== 'ready') return;
    const refused = await composite.startHandoff(world.humanContext(), { source: fresh.ref, basis: short.value });
    expect(refused).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(accepts).toBe(0);
  }, 120_000);
});

describe('AH-03: the routing child is called with the post-write saved item', () => {
  it('appends the route named by the write item and records its receipt', async () => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await world.createSecretary('s6b2-route-composite-source');
    const target = await world.createSecretary('s6b2-route-composite-target');
    await ws.submit({ label: 'composite-route', goalId: null, recipient: source.ref });
    const operation = await s6b2Accept(world, { commandId: 's6b2-route-composite-accept', source: source.ref, target: target.ref, trigger: 'too_long', actor: 'system' });
    const composite = published(world);
    // The route commits and the same drive reaches the finished notice.
    const result = await composite.advance(world.humanContext(), { operation });
    expect(result).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') return;
    expect(read.value.action.progress.routing?.roots).toHaveLength(1);
    expect(read.value.action.progress.routing?.roots[0]?.receipt).not.toBeNull();
    // The same operation again answers the completed progress at the revision it already reached.
    expect(await composite.advance(world.humanContext(), { operation })).toMatchObject({
      status: 'ready', value: { stage: 'finished', phase: 'completed', revision: read.value.revision } });
  }, 120_000);
});

describe('AH-05: the understanding close belongs to the composite', () => {
  it('appends one round per drive and waits for the real round before a new generation', async () => {
    const { world, operation } = await understandingScene('s6b2-understanding-composite');
    const composite = published(world);
    const first = await composite.advance(world.humanContext(), { operation });
    expect(first.status).toBe('ready');
    // The stop's progress is the operation after the drive's own writes, not the record the loop started from.
    expect(first.status === 'ready' ? first.value.stage : null).toBe('understanding');
    const afterFirst = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterFirst.status).toBe('ready');
    if (afterFirst.status !== 'ready' || afterFirst.value.action.kind !== 'handoff') return;
    expect(first.status === 'ready' ? first.value.revision : null).toBe(afterFirst.value.revision);
    expect(afterFirst.value.action.progress.understanding).toHaveLength(1);
    expect(afterFirst.value.action.progress.understanding[0]?.round).not.toBeNull();
    const second = await composite.advance(world.humanContext(), { operation });
    expect(second.status).toBe('ready');
    const afterSecond = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(afterSecond.status).toBe('ready');
    if (afterSecond.status !== 'ready' || afterSecond.value.action.kind !== 'handoff') return;
    expect(afterSecond.value.action.progress.understanding).toHaveLength(1);
  }, 120_000);
});
/** The handoff progress of one operation, as the owner records it. */
async function handoffProgress(world: S6B2WorldValue, operation: OperationRef) {
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  if (read.status !== 'ready' || read.value.action.kind !== 'handoff') {
    throw new Error(`the handoff ${operation.operationId} is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.action.progress;
}
/** One Session card through the public Session read; its `links` carry both refs and revisions. */
async function handoffSessionCard(world: S6B2WorldValue, ref: S6ASession['ref']) {
  const read = await world.platform.sessions.readSession(world.humanContext(), ref);
  if (read.status !== 'ready') throw new Error(`the Session card is not readable: ${JSON.stringify(read)}`);
  return read.value;
}
/** The `responsible` link of one task target on a card, open or closed; `undefined` without one. */
function taskLink(card: Awaited<ReturnType<typeof handoffSessionCard>>,
  task: { projectId: string; goalId: string; taskId: string }) {
  return card.links.find(link => link.ref.relation === 'responsible' && link.ref.target.kind === 'task'
    && link.ref.target.ref.projectId === task.projectId && link.ref.target.ref.goalId === task.goalId
    && link.ref.target.ref.taskId === task.taskId);
}
/** One operation revision through the public operation read. */
async function operationRevision(world: S6B2WorldValue, operation: OperationRef) {
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  if (read.status !== 'ready') throw new Error(`the operation is not readable: ${JSON.stringify(read)}`);
  return read.value.revision;
}
/** Run the appended understanding round to its end through the public routes (claim, prepare, open, start). */
async function endUnderstandingRound(world: S6B2WorldValue, source: S6ASession, round: QueryJobRef, label: string) {
  await claimWithSecretaryProfile(world, round, source, `${label}-claim`);
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `${label}-prepare`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`the round preparation failed: ${JSON.stringify(prepared)}`);
  // The appended round is a semantic-query round: one valid answer of that kind ends it normally.
  await world.scripted.script(source, [{ kind: 'text', text: JSON.stringify({ schemaVersion: 1, body: 'S6B2 answer',
    ideas: [], goalCardDrafts: [] }) }]);
  const gate = await world.gates.modelRequest(source);
  const started = world.post('queries/start', plain(S6A_SCOPE, { prepared: prepared.value,
    consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` }));
  await gate.reached;
  gate.release();
  await started;
  const ended = await readQuery(world.ag2b, round);
  if (ended.run.run.status !== 'answered') throw new Error(`the round did not answer: ${JSON.stringify(ended)}`);
  return ended;
}

// AH-04's composite understanding-recovery branch: the saved understanding arm is restored through the published
// owner and called once before the ordinary continue; this row is its proof.
describe.each(['memory', 'sqlite'] as const)('AH-04, AH-19 and L6 on %s: the understanding window is resumed before the ordinary continue', backend => {
  it('restores the saved arm first and calls no child on a stopped drive', async () => {
    const { world, operation } = await understandingScene('s6b2-window', backend);
    const advance = services(world);
    // The crash window: the before write committed and the child was never called (the advance calls no child).
    const saved = await advance.advanceHandoff(world.humanContext(),
      { kind: 'continue', operation, expectedRevision: 1 });
    expect(saved).toMatchObject({ status: 'committed',
      value: { stop: 'incomplete', write: { stage: 'understanding', phase: 'before' } } });
    if (saved.status !== 'committed') return;
    const arm = saved.value.write.savedInput;
    if (arm?.kind !== 'understanding') throw new Error('the understanding before write saved no command');
    // A3: an observer over the advance port the composition root injects into the composite. The window is restored
    // by its own identity with the exact saved arm before the ordinary continue; the real answers pass through.
    const composite = published(world);
    const port = world.platform.sessionHandoff;
    const calls: { input: Parameters<typeof port.advanceHandoff>[1];
      result: Awaited<ReturnType<typeof port.advanceHandoff>> }[] = [];
    const injected = port.advanceHandoff;
    port.advanceHandoff = async (ctx, input) => {
      const result = await injected(ctx, input);
      calls.push({ input, result });
      return result;
    };
    const replays = () => calls.filter(call => call.input.kind === 'replay');
    try {
      const driven = await composite.advance(world.humanContext(), { operation });
      expect(calls[0]?.input.kind).toBe('replay');
      expect(replays()).toHaveLength(1);
      expect(replays()[0]?.result).toMatchObject({ status: 'committed', replayed: true,
        value: { write: { stage: 'understanding', phase: 'before', savedInput: arm } } });
      expect(driven.status).toBe('ready');
      // The same command's receipt is recorded in this drive: the recovery ran and the continue wrote its receipt.
      const progress = await handoffProgress(world, operation);
      expect(progress.understanding.at(-1)?.round).not.toBeNull();
      expect(progress.understanding.at(-1)?.command?.commandId).toBe(arm.command.commandId);
      // The round has not ended: the stopped drive re-reads the progress and restores no second window.
      const stopped = await composite.advance(world.humanContext(), { operation });
      expect(stopped.status).toBe('ready');
      expect(replays()).toHaveLength(1);
    } finally {
      port.advanceHandoff = injected;
    }
  });
});

describe('AH-05 and AH2-01: the close runs under the fixed system principal', () => {
  it('closes the round that really ended and records the next generation', async () => {
    const { world, ws, operation, source } = await understandingScene('s6b2-close');
    const composite = published(world);
    expect((await composite.advance(world.humanContext(), { operation })).status).toBe('ready');
    const before = await handoffProgress(world, operation);
    const round = before.understanding[0]?.round;
    if (round === null || round === undefined) throw new Error('the first drive recorded no understanding round');
    expect(before.advanceGeneration).toBe(2);
    // One processing request per secretary: a second root opens elsewhere and is routed onto the source, so the
    // coverage stays short after the round ends and the re-pass needs a new understanding generation.
    const hold = await ws.submit({ label: 's6b2-close-hold', goalId: world.goals.first.goalId });
    expect(await ws.route('requests/route', { commandId: 's6b2-close-hold-route', round: hold.requestRoot,
      to: source.ref, reason: 'manual' })).toMatchObject({ status: 'routed' });
    // The understanding round really ends, so the command it carried is no longer live.
    await endUnderstandingRound(world, source, round, 's6b2-close');
    const second = await composite.advance(world.humanContext(), { operation });
    expect(second.status).toBe('ready');
    // The close reached the request owner: the round's own terminal commit consumed the command, so the close
    // answers `already_terminal` instead of writing `closed`; a saved human actor would be forbidden there.
    const query = await readQuery(world.ag2b, round);
    expect(query.job.job.understanding?.state).toBe('consumed');
    const progress = await handoffProgress(world, operation);
    // The closed command's round stays and the next generation's command is saved under the raised generation.
    expect(progress.understanding).toHaveLength(2);
    expect(progress.understanding[0]?.round).toEqual(round);
    expect(progress.advanceGeneration).toBe(3);
  });
});

describe('AH-07 and L5: a child refusal is kept and recorded on its item', () => {
  it('records the real child refusal, keeps the first receipt and commits the arm on the next drive', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const lines = await seedS6BHandoffLines(ws, world.goals.first);
    const operation = await s6b2Accept(world, { commandId: 's6b2-refusal-accept', source: lines.source.ref,
      target: lines.target.ref, tasks: lines.tasks.slice(0, 2) });
    const composite = published(world);
    // A2: the second transfer item's own commit fails once at its named point, after the first item committed.
    const fault = s6b2FailCommit(s6b2Backend(captured).records, { prefix: 'session-responsibility-transfer:', nth: 2 });
    try {
      const result = await composite.advance(world.humanContext(), { operation });
      // The child's own answer is the drive's answer and the item carries that same answer; one commit per item.
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(fault.seen.count).toBe(2);
      const progress = await handoffProgress(world, operation);
      expect(progress).toMatchObject({ stage: 'transfer', archiveRequest: null, advanceGeneration: 1,
        lastRefusal: { stage: 'transfer', code: 'unavailable' } });
      expect(progress.lastRefusal?.reason).toBe(result.status === 'rejected' ? result.reason : null);
      expect(progress.assignments[0]?.transfers[0]?.receipt).not.toBeNull();
      expect(progress.assignments[0]?.transfers[1]?.receipt).toBeNull();
      // The next drive calls the same saved arm again and the transfer commits.
      await composite.advance(world.humanContext(), { operation });
      expect((await handoffProgress(world, operation)).assignments[0]?.transfers[1]?.receipt).not.toBeNull();
    } finally {
      fault.restore();
    }
  }, 120_000);
  it('answers the child refusal even when the progress re-read after its mark fails once (AH3-04)', async () => {
    const { world, operation } = await transferBefore('reread-fault');
    const records = s6b2Backend(captured).records;
    const realCommit = records.commit;
    let transferFault = false, cancelled = 0;
    const controller = new AbortController();
    // A2: the transfer's own commit fails once; once its refusal mark commits, the caller's read signal is cancelled,
    // so the progress re-read after that mark answers a real cancellation.
    records.commit = async (prepared) => {
      if (!transferFault && prepared.identityKey.startsWith('session-responsibility-transfer:')) {
        transferFault = true;
        throw new Error('S6B2: the transfer commit failed once');
      }
      const receipt = await realCommit(prepared);
      if (transferFault && receipt.status === 'committed' && cancelled === 0) {
        cancelled = 1;
        controller.abort();
      }
      return receipt;
    };
    const composite = published(world);
    try {
      const refused = await composite.advance({ ...world.humanContext(), signal: controller.signal }, { operation });
      // The child's own answer is the drive's answer even though the progress re-read after its mark was cancelled.
      expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const progress = await handoffProgress(world, operation);
      expect(progress.lastRefusal).toMatchObject({ stage: 'transfer', code: 'unavailable' });
      expect([cancelled, progress.lastRefusal?.reason])
        .toEqual([1, refused.status === 'rejected' ? refused.reason : null]);
    } finally {
      records.commit = realCommit;
    }
  }, 120_000);
  describe.each(['memory', 'sqlite'] as const)('AH-07 and L5 on %s: a refusal mark replays after the stage moved', backend => {
  it('records a refusal once while it stays the same, keeps the child answer and replays a mark after the stage moved', async () => {
    const setup = await transferBefore('refusal-mark', backend, 3);
    const { world, operation } = setup;
    // A2: the first commit attempt of each transfer item fails once, at the real store's own named point.
    const records = s6b2Backend(captured).records;
    const realCommit = records.commit;
    let attempts = 0;
    records.commit = async (prepared) => {
      if (prepared.identityKey.startsWith('session-responsibility-transfer:')) {
        attempts += 1;
        if (attempts === 1 || attempts === 3) throw new Error('S6B2: the transfer commit failed once');
      }
      return await realCommit(prepared);
    };
    // A3: an observer over the advance port the composition root injects keeps every refusal and its real answer.
    const composite = published(world);
    const port = world.platform.sessionHandoff;
    const marks: { input: Parameters<typeof port.advanceHandoff>[1];
      result: Awaited<ReturnType<typeof port.advanceHandoff>> }[] = [];
    const injected = port.advanceHandoff;
    port.advanceHandoff = async (ctx, input) => {
      const result = await injected(ctx, input);
      if (input.kind === 'refusal') marks.push({ input, result });
      return result;
    };
    try {
      // The child's own answer is the drive's answer, and its mark names the item the child answered for.
      const first = await composite.advance(world.humanContext(), { operation });
      expect(first).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const afterFirst = await handoffProgress(world, operation);
      expect(afterFirst.lastRefusal).toMatchObject({ stage: 'transfer', code: 'unavailable' });
      expect(afterFirst.lastRefusal?.reason).toBe(first.status === 'rejected' ? first.reason : null);
      expect(afterFirst.assignments[0]?.transfers[0]?.receipt).toBeNull();
      const second = await composite.advance(world.humanContext(), { operation });
      expect(second).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const afterSecond = await handoffProgress(world, operation);
      expect(afterSecond.assignments[0]?.transfers[0]?.receipt).not.toBeNull();
      expect(afterSecond.assignments[0]?.transfers[1]?.receipt).toBeNull();
      expect(afterSecond.lastRefusal).toMatchObject({ stage: 'transfer', code: 'unavailable' });
      expect(afterSecond.lastRefusal?.reason).toBe(second.status === 'rejected' ? second.reason : null);
      expect(afterSecond.advanceGeneration).toBe(1);
      // The mark keeps the identity the one recipe builds: the before write it marks and the revision it guards. The
      // second item's refusal has the same stage, code and reason, so it is answered (above) but not recorded (D1).
      expect(marks.map(mark => [mark.input.kind === 'refusal' ? mark.input.expectedRevision : null, mark.result.status === 'committed' ? mark.result.value.write.commandId.slice(-9) : null])).toEqual([[6, 'refused:6']]);
      expect(marks[0]!.result).toMatchObject({ status: 'committed', value: { stop: 'refused', next: null, generation: 1,
        write: { commandId: `${operation.operationId}:transfer:transfer:0:0:refused:6`, stage: 'transfer',
          item: 'transfer:0:0', phase: 'after', savedInput: null, receipt: null } } });
      await composite.advance(world.humanContext(), { operation });
      const afterStageMove = await handoffProgress(world, operation);
      // All three tasks are named, so the drive runs past transfer to the finished operation.
      expect(afterStageMove.stage).toBe('finished');
      expect(afterStageMove.assignments[0]?.transfers[1]?.receipt).not.toBeNull();
      // A crashed retry replays the recorded mark before any stage or receipt check, with the item's arms free.
      const retried = await setup.advance.advanceHandoff(world.humanContext(), marks[0]!.input);
      expect(retried).toMatchObject({ status: 'committed', replayed: true, value: { revision: 7, stop: 'replayed',
        write: { commandId: `${operation.operationId}:transfer:transfer:0:0:refused:6`, stage: 'transfer',
          item: 'transfer:0:0', phase: 'after', savedInput: null, receipt: null } } });
      const replayedMark = await setup.advance.advanceHandoff(world.humanContext(), { kind: 'replay', operation,
        commandId: `${operation.operationId}:transfer:transfer:0:0:refused:6` });
      expect(replayedMark).toMatchObject({ status: 'committed', replayed: true, value: { revision: 7, write: { phase: 'after', item: 'transfer:0:0', savedInput: null, receipt: null } } });
      expect(await handoffProgress(world, operation)).toEqual(afterStageMove);  // A replay writes nothing.
    } finally {
      port.advanceHandoff = injected;
      records.commit = realCommit;
    }
  });
  });
});

describe('D2: a residual responsibility stops the handoff before the archive', () => {
  const RESIDUAL = 'the source still owns work the handoff does not name';
  /** The AH-07 world: the source owns three tasks and the primitive accept names only the first two. */
  async function residualScene(label: string) {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const lines = await seedS6BHandoffLines(ws, world.goals.first, label);
    const operation = await s6b2Accept(world, { commandId: `${label}-accept`, source: lines.source.ref,
      target: lines.target.ref, tasks: lines.tasks.slice(0, 2) });
    return { world, ws, lines, operation };
  }
  it('stops at the transfer stage with the third task still on the source', async () => {
    const { world, lines, operation } = await residualScene('s6b2-d2-residual');
    const composite = published(world);
    const driven = await composite.advance(world.humanContext(), { operation });
    expect(driven).toMatchObject({ status: 'ready', value: { stage: 'transfer', phase: 'running', archived: false,
      noticeItemKey: null, lastRefusal: RESIDUAL } });
    const progress = await handoffProgress(world, operation);
    expect(progress.stage).toBe('transfer');
    expect(progress.archiveRequest).toBeNull();
    expect(progress.noticeItemKey).toBeNull();
    expect(progress.fence?.state).toBe('held');
    expect(progress.lastRefusal).toMatchObject({ stage: 'transfer', code: 'incomplete', reason: RESIDUAL });
    // The two named transfers committed; the third responsibility is still the source's.
    expect(progress.assignments[0]?.transfers.map(entry => entry.receipt !== null)).toEqual([true, true]);
    const card = await handoffSessionCard(world, lines.source.ref);
    expect(card.record.lifecycle).toBe('active');
    expect(card.record.archiveRequest ?? null).toBeNull();
    expect(taskLink(card, lines.tasks[2]!)?.until).toBeNull();
    expect(taskLink(card, lines.tasks[0]!)?.until).not.toBeNull();
    expect(taskLink(card, lines.tasks[1]!)?.until).not.toBeNull();
    // A second drive replays the same stop mark and writes nothing.
    const revision = await operationRevision(world, operation);
    const again = await composite.advance(world.humanContext(), { operation });
    expect(again).toMatchObject({ status: 'ready', value: { stage: 'transfer', lastRefusal: RESIDUAL } });
    expect(await operationRevision(world, operation)).toBe(revision);
  }, 120_000);
  it('finishes the same operation after the person moves the remaining task', async () => {
    const { world, ws, lines, operation } = await residualScene('s6b2-d2-continue');
    const composite = published(world);
    await composite.advance(world.humanContext(), { operation });
    const stopped = await handoffProgress(world, operation);
    const receipts = stopped.assignments[0]!.transfers.map(entry => entry.receipt);
    // Fresh public pins: the two Session cards of this moment and the open link's own revision.
    const sourceCard = await handoffSessionCard(world, lines.source.ref);
    const targetCard = await handoffSessionCard(world, lines.target.ref);
    const third = lines.tasks[2]!;
    const target = { kind: 'task' as const, ref: third };
    const sourceLink = taskLink(sourceCard, third);
    if (sourceLink === undefined) throw new Error('the third task has no open responsible link on the source');
    const moved = await ws.post('sessions/transfer-responsibility', graphWrite(ws.scope, {
      from: lines.source.ref, to: lines.target.ref, target,
    }, 's6b2-d2-continue-move', [
      { ref: sourceCard.record.ref, revision: sourceCard.record.revision },
      { ref: targetCard.record.ref, revision: targetCard.record.revision },
      { ref: sourceLink.ref, revision: sourceLink.revision },
      { ref: responsibleLinkRef(lines.target.ref, target), revision: 0 },
    ]));
    expect(moved).toMatchObject({ status: 'committed' });
    const finished = await composite.advance(world.humanContext(), { operation });
    expect(finished).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed', archived: true,
      lastRefusal: null } });
    const progress = await handoffProgress(world, operation);
    expect(progress.fence?.state).toBe('released');
    expect(progress.archiveRequest?.receipt).not.toBeNull();
    // The two named transfers are the same writes: their receipts are unchanged; the third task moved by link.
    expect(progress.assignments[0]?.transfers.map(entry => entry.receipt)).toEqual(receipts);
    const archived = await handoffSessionCard(world, lines.source.ref);
    expect(archived.record.lifecycle).toBe('archived');
    const destination = await handoffSessionCard(world, lines.target.ref);
    expect(taskLink(destination, third)?.until).toBeNull();
  }, 120_000);
  it('archives normally when every task is named', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const lines = await seedS6BHandoffLines(ws, world.goals.first, 's6b2-d2-complete');
    const operation = await s6b2Accept(world, { commandId: 's6b2-d2-complete-accept', source: lines.source.ref,
      target: lines.target.ref, tasks: lines.tasks });
    const composite = published(world);
    const driven = await composite.advance(world.humanContext(), { operation });
    expect(driven).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed', archived: true,
      lastRefusal: null } });
    const progress = await handoffProgress(world, operation);
    expect(progress.fence?.state).toBe('released');
    expect(progress.archiveRequest?.receipt).not.toBeNull();
    expect(progress.assignments[0]?.transfers.map(entry => entry.receipt !== null)).toEqual([true, true, true]);
    const card = await handoffSessionCard(world, lines.source.ref);
    expect(card.record.lifecycle).toBe('archived');
  }, 120_000);
});

describe('D2 at the routing close: a link added after the transfer exits stops the close', () => {
  const RESIDUAL = 'the source still owns work the handoff does not name';
  it('writes one refused mark that replays without the horizon, then closes once the link is moved', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    // One task: the only work the late link can name, so the row seeds no second task or line.
    const { tasks } = await adoptS6BPlan(ws, world.goals.first, { label: 's6b2-d2-routing',
      taskIds: ['routing'], role: S6A_WORK_ROLE.templateId });
    const task = tasks[0]!;
    const source = await world.createSecretary('s6b2-d2-routing-source');
    const target = await world.createSecretary('s6b2-d2-routing-target');
    const request = await ws.submit({ label: 's6b2-d2-routing-request', goalId: null, recipient: source.ref });
    const operation = await s6b2Accept(world, { commandId: 's6b2-d2-routing-accept', source: source.ref,
      target: target.ref, trigger: 'too_long', actor: 'system' });
    const composite = published(world);
    // A3: the composite's own child advance, held at the real routing-after answer and read back on every call.
    const gate = holdAdvanceHandoff(world, answer => answer.status === 'committed'
      && answer.value.write.stage === 'routing' && answer.value.write.phase === 'after'
      && answer.value.write.item === `root:${request.requestRoot.queryJobId}`);
    try {
      const pending = composite.advance(world.humanContext(), { operation });
      await gate.reached;
      // The routing child committed and the composite has not read the answer yet: the person adds a responsibility
      // link to the source through the public route.
      const targetLink = { kind: 'task' as const, ref: task };
      const card = await world.platform.sessions.readSession(world.humanContext(), source.ref);
      if (card.status !== 'ready') throw new Error(`the source card is not readable: ${JSON.stringify(card)}`);
      const linked = await ws.post('sessions/link', graphWrite(ws.scope, {
        sessionRef: source.ref, target: targetLink, relation: 'responsible', active: true,
      }, 's6b2-d2-routing-link', [
        { ref: card.value.record.ref, revision: card.value.record.revision },
        { ref: responsibleLinkRef(source.ref, targetLink), revision: 0 },
      ]));
      expect(linked).toMatchObject({ status: 'committed' });
      gate.release();
      // The close is refused with the mark's own token; the fingerprint carries no horizon.
      const refused = await pending;
      expect(refused).toMatchObject({ status: 'ready', value: { stage: 'routing', archived: false,
        lastRefusal: RESIDUAL } });
      expect(gate.writes.map(write => write.commandId)).toContain(`${operation.operationId}:routing:-:refused:1`);
      expect(gate.writes.some(write => write.commandId === `${operation.operationId}:routing:-:after:1`)).toBe(false);
      const stopped = await handoffProgress(world, operation);
      expect(stopped).toMatchObject({ stage: 'routing', archiveRequest: null, noticeItemKey: null,
        lastRefusal: { stage: 'routing', code: 'incomplete' } });
      expect(stopped.routing?.closed).toBe(false);
      // A later scan reads a new horizon; the same mark replays instead of conflicting on a new fingerprint.
      const markRevision = await operationRevision(world, operation);
      const replay = await composite.advance(world.humanContext(), { operation });
      expect(replay).toMatchObject({ status: 'ready', value: { stage: 'routing', lastRefusal: RESIDUAL } });
      expect(await operationRevision(world, operation)).toBe(markRevision);
      expect(await handoffProgress(world, operation)).toEqual(stopped);
      // The person moves the added link, and the same operation finishes with one close of its own after token.
      const freshSource = await world.platform.sessions.readSession(world.humanContext(), source.ref);
      const freshTarget = await world.platform.sessions.readSession(world.humanContext(), target.ref);
      if (freshSource.status !== 'ready' || freshTarget.status !== 'ready') throw new Error('a Session card is not readable');
      const sourceLink = freshSource.value.links.find(link => link.ref.relation === 'responsible'
        && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === task.taskId);
      if (sourceLink === undefined) throw new Error('the added link is not on the source card');
      const moved = await ws.post('sessions/transfer-responsibility', graphWrite(ws.scope, {
        from: source.ref, to: target.ref, target: targetLink,
      }, 's6b2-d2-routing-move', [
        { ref: freshSource.value.record.ref, revision: freshSource.value.record.revision },
        { ref: freshTarget.value.record.ref, revision: freshTarget.value.record.revision },
        { ref: sourceLink.ref, revision: sourceLink.revision },
        { ref: responsibleLinkRef(target.ref, targetLink), revision: 0 },
      ]));
      expect(moved).toMatchObject({ status: 'committed' });
      const closed = await composite.advance(world.humanContext(), { operation });
      expect(closed).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed',
        archived: true } });
      const after = await handoffProgress(world, operation);
      expect(after.stage).toBe('finished');
      expect(after.routing?.closed).toBe(true);
      // One real close write and one refused mark, each counted as a write rather than a replay of it.
      const written = (commandId: string) => gate.writes.filter(write => !write.replayed && write.commandId === commandId);
      expect(written(`${operation.operationId}:routing:-:after:1`)).toHaveLength(1);
      expect(written(`${operation.operationId}:routing:-:refused:1`)).toHaveLength(1);
    } finally {
      gate.restore();
    }
  }, 120_000);
});

describe('rejects: a refusal whose commandId names another arm', () => {
  it('refuses a real before commandId with only its phase changed, and leaves the operation as it was', async () => {
    const { world, operation, before, advance } = await transferBefore('wrong-arm');
    const read = () => world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    const state = await read();
    if (state.status !== 'ready') throw new Error('the handoff operation is not readable');
    // The one wrong thing is the phase segment: the stage, item and generation are the real before write's own.
    const refused = await advance.advanceHandoff(world.humanContext(), { kind: 'refusal', operation,
      expectedRevision: state.value.revision, commandId: before.write.commandId.replace(':before:', ':after:'),
      refusal: { code: 'unavailable', reason: 'S6B2: a refusal under the wrong phase' } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await read()).toEqual(state);
  });
});

describe('rejects: a refusal for an item the parent record shows finished', () => {
  /** A real operation whose current stage already saved the parent field of its before write's item. */
  async function finishedItem(stage: 'understanding' | 'successor') {
    if (stage === 'successor') {
      const { world } = await scene.open('memory');
      const source = await world.createSecretary('s6b2-l8-successor-source');
      const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
        commandId: 's6b2-l8-successor-accept', workspace: { ...world.scope }, source: source.ref, trigger: 'manual',
        assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] },
          { target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
      if (accepted.status !== 'committed') throw new Error(`the two-assignment accept failed: ${JSON.stringify(accepted)}`);
      const operation = accepted.value.operation;
      const step = stepper(world, services(world), operation);
      for (let index = 0; index < 3; index += 1) await step();
      const before = await step();
      expect(before.write).toMatchObject({ stage: 'successor', item: 'assignment:0', phase: 'before' });
      const saved = before.write.savedInput;
      if (saved?.kind !== 'create') throw new Error('the successor before write saved no create input');
      // The composite's own create owner, called with the exact input the parent saved: the real Session is created.
      const lines = createLineCreation({ sessions: world.platform.runtime, operations: world.platform.sessions, capacity: createAlwaysAdmitCapacity() });
      expect((await lines.ensureLine(world.humanContext(), saved.input)).status).toBe('created');
      expect((await step()).write).toMatchObject({ stage: 'successor', item: 'assignment:0', phase: 'after' });
      // One assignment is filled while the other still waits: the stage is this one and item 0 is finished.
      const progressed = await handoffProgress(world, operation);
      expect([progressed.stage, progressed.assignments.map(entry => entry.successor !== null)]).toEqual(['successor', [true, false]]);
      return { world, operation, commandId: before.write.commandId };
    }
    const { world, operation } = await understandingScene('s6b2-l8-understanding');
    const saved = await services(world).advanceHandoff(world.humanContext(), { kind: 'continue', operation, expectedRevision: 1 });
    if (saved.status !== 'committed') throw new Error(`the understanding before write failed: ${JSON.stringify(saved)}`);
    expect((await published(world).advance(world.humanContext(), { operation })).status).toBe('ready');
    // The stage's own parent field for the item: the round its after write saved.
    expect((await handoffProgress(world, operation)).understanding[0]?.round).not.toBeNull();
    return { world, operation, commandId: saved.value.write.commandId };
  }
  it.each(['understanding', 'successor'] as const)('refuses a stale refusal of a finished %s item, and writes nothing', async stage => {
    const { world, operation, commandId } = await finishedItem(stage);
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    if (read.status !== 'ready' || read.value.action.kind !== 'handoff') throw new Error('the operation is not readable');
    const refused = await services(world).advanceHandoff(world.humanContext(), { kind: 'refusal', operation,
      expectedRevision: read.value.revision, commandId,
      refusal: { code: 'unavailable', reason: `S6B2: a stale refusal of the ${stage} item` } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await handoffProgress(world, operation)).toEqual(read.value.action.progress);
  });
});

describe('L8: a successor whose create child is only accepted is not finished', () => {
  it('records the refusal mark while the create is pending (createOperation saved, successor still null)', async () => {
    const { world } = await scene.open('memory');
    const operation = await s6b2Accept(world, { commandId: 's6b2-l8-pending-accept', source: (await world.createSecretary('s6b2-l8-pending-source')).ref });
    const step = stepper(world, services(world), operation);
    for (let index = 0; index < 3; index += 1) await step();
    const before = await step();
    if (before.write.savedInput?.kind !== 'create') throw new Error('the successor before write saved no create input');
    // A3 gate: the create child's admission lands and its register commit is held, so the child is only accepted.
    const hold = commitBarrier.hold(byIdentityPrefix('session-register:'), 'the create register commit');
    const created = createLineCreation({ sessions: world.platform.runtime, operations: world.platform.sessions,
      capacity: createAlwaysAdmitCapacity() }).ensureLine(world.humanContext(), before.write.savedInput.input);
    await hold.reached;
    const pending = await step();
    expect([pending.write.item, pending.stop]).toEqual(['-', 'refused']);
    expect((await handoffProgress(world, operation)).assignments[0]).toMatchObject({ successor: null, createOperation: { aggregateType: 'CoreOperation' } });
    const marked = await services(world).advanceHandoff(world.humanContext(), { kind: 'refusal', operation,
      expectedRevision: pending.revision, commandId: before.write.commandId,
      refusal: { code: 'unavailable', reason: 'S6B2: a refusal while the create is pending' } });
    hold.release();
    expect((await created).status).toBe('created');
    expect(marked).toMatchObject({ status: 'committed',
      value: { stop: 'refused', write: { stage: 'successor', item: 'assignment:0', phase: 'after' } } });
  });
});

describe('AH-15: every stop reads the operation after the stop', () => {
  it('returns the archive progress after the last write, never the loop-start snapshot', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const seeded = await seedS6BArchiveSource(ws, 'advance-fresh');
    const archive = s6b2Archive(world, captured);
    const composite = published(world);
    const accepted = await archive.acceptArchive(world.humanContext(), { commandId: 's6b2-advance-fresh',
      source: seeded.source, choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const result = await composite.manualArchive(world.humanContext(), { operation: accepted.value.operation });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const read = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(result.value.revision).toBe(read.value.revision);
    // The last write saved the archive request: a loop-start snapshot would still have null here.
    expect(result.value.archiveRequest).not.toBeNull();
  }, 120_000);
});

describe.each(['memory', 'sqlite'] as const)('AH-06 and AH2-04 on %s: the unregistered archive resumes the saved GraphWrite', backend => {
  it('writes no mark, hands the owner that exact request and calls nothing else', async () => {
    const { world } = await scene.open(backend);
    const ws = await s6b2Workspace(world);
    const seeded = await seedS6BArchiveSource(ws, 'ah06');
    const archive = s6b2Archive(world, captured);
    const accepted = await archive.acceptArchive(world.humanContext(), { commandId: 's6b2-ah06-accept',
      source: seeded.source,
      choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const composite = published(world);
    const first = await composite.manualArchive(world.humanContext(), { operation: accepted.value.operation });
    expect(first).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
    if (first.status !== 'ready') return;
    const record = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready' || record.value.action.kind !== 'secretary_archive') return;
    // The missing registration is not a mark: the original before write is restored and its saved GraphWrite is what
    // the owner is handed, so the item's after identity stays free.
    const saved = record.value.action.progress.archiveRequest?.savedInput;
    expect(saved).not.toBeNull();
    expect(record.value.action.progress.lastRefusal).toBeNull();
    // The owner was handed exactly that saved GraphWrite: the child's own registration reads back under it.
    expect(await world.platform.sessions.readSessionArchiveRequestReceipt(
      archiveContextOf(world.humanContext()), saved!)).toMatchObject({ status: 'ready' });
    // The next drive is the same operation's replay and writes nothing.
    const again = await composite.manualArchive(world.humanContext(), { operation: accepted.value.operation });
    expect(again).toMatchObject({ status: 'ready', value: { stage: 'finished', revision: first.value.revision } });
  });
});

