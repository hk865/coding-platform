/**
 * The archive condition view: the core predicate (no request the source still owns is processing), the source and
 * activity guards, the operation holder and the two kinds' fence. A manual archive holds no fence.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { S6A_SCOPE, S6A_SECRETARY_ROLE } from '../helpers/S6A-request-fixture.js';
import { seedS6BArchiveSource, createS6BLine } from '../helpers/S6B1-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { driveS6BHandoff, teardownS6BHandoff } from '../helpers/S6B2-fixture.js';
import {
  s6b2Advance, s6b2Archive, s6b2Facts, s6b2Scene, s6b2Workspace,
  type S6B2Captured, type S6B2WorldValue,
} from '../helpers/S6B2-handoff-scene.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';

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

function services(world: S6B2WorldValue) {
  return { facts: s6b2Facts(world, captured), archive: s6b2Archive(world, captured) };
}

type HandoffAnswer = { status: string; value?: {
  operation: OperationRef; stage: string; phase: string; archived: boolean; lastRefusal: string | null;
  successor: { projectId: string; sessionId: string } | null } };

/** The operation as the platform records it, through the published `sessions.getSessionOperation` read. */
async function recordedProgress(world: S6B2WorldValue, operation: OperationRef) {
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  if (read.status !== 'ready' || read.value.action.kind !== 'handoff') {
    throw new Error(`the handoff operation is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.action.progress;
}

/**
 * The probe's public registration-window setup: the source's handoff is held at the real archive-registration
 * commit, a no-goal request lands on the source, and releasing the gate leaves the source active with the
 * registered request and the archive's partial mark.
 */
async function lateInputHandoff(world: S6B2WorldValue, label: string) {
  const source = await world.createSecretary(`s6b2-${label}-source`);
  const registration = commitBarrier.hold(byIdentityPrefix('session-archive:'), `${label} registration`);
  const answer = world.post('secretaries/handoff', { scope: S6A_SCOPE,
    input: { commandId: `s6b2-${label}-handoff`, session: source.ref } });
  await registration.reached;
  const atRegistration = (await world.readSession(source.ref)).record;
  const late = await world.submit({ commandId: `s6b2-${label}-late`, goalId: null, recipient: source.ref,
    text: `${label} late input` });
  if (late.status !== 'queued' || late.secretary === null) {
    throw new Error(`the late request was not queued on the source: ${JSON.stringify(late)}`);
  }
  const lateView = await world.readRequest(late.requestRoot);
  registration.release();
  const body = (await answer).body as HandoffAnswer;
  if (body.status !== 'ready' || body.value === undefined) {
    throw new Error(`the held handoff did not answer its progress: ${JSON.stringify(body)}`);
  }
  return { source, late, atRegistration, lateView, partial: body.value };
}

/** Drive the published handoff to its end, one stopped pass at a time. */
async function finishHandoff(world: S6B2WorldValue, operation: OperationRef) {
  let driven = await driveS6BHandoff(world, { operation });
  for (let step = 0; step < 3 && driven.progress?.stage !== 'finished'; step += 1) {
    driven = await driveS6BHandoff(world, { operation });
  }
  return driven;
}

describe('the archive condition', () => {
  it('refuses while the source still owns a processing request', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const seeded = await seedS6BArchiveSource(ws, 'condition-busy');
    const { facts, archive } = services(world);
    const accepted = await archive.acceptArchive(world.humanContext(), { commandId: 's6b2-condition-busy',
      source: seeded.source, choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const checked = await facts.checkArchiveCondition(world.humanContext(), {
      condition: { kind: 'secretary_handoff', operation: accepted.value.operation }, session: seeded.source });
    expect(checked).toMatchObject({ status: 'ready', value: { ok: false } });
    if (checked.status !== 'ready' || checked.value.ok) return;
    expect(checked.value.reason).toContain('processing');
  }, 60_000);
  it('accepts a manual archive with no fence once the source owns no processing request', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const seeded = await seedS6BArchiveSource(ws, 'condition-quiet');
    const { facts, archive } = services(world);
    const accepted = await archive.acceptArchive(world.humanContext(), { commandId: 's6b2-condition-quiet',
      source: seeded.source, choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot,
        to: seeded.other })) });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    // The composite's child calls: one real archived command per saved item input, then the next advance.
    let revision = 1;
    let stage = 'accepted';
    for (let step = 0; step < 8 && stage !== 'archive'; step += 1) {
      const advanced = await archive.advanceArchive(world.humanContext(), { kind: 'continue',
        operation: accepted.value.operation, expectedRevision: revision });
      if (advanced.status !== 'committed') throw new Error(`archive advance failed: ${JSON.stringify(advanced)}`);
      revision = advanced.value.revision;
      stage = advanced.value.stage;
      if (advanced.value.stage === 'items' && advanced.value.item.savedInput !== null) {
        const saved = advanced.value.item.savedInput;
        const appended = await world.platform.requestRounds.append(world.systemContext(), { command: {
          kind: 'archived', operationId: saved.operationId, requestRoot: advanced.value.item.requestRoot,
          to: saved.to, expectedSource: saved.expectedSource } });
        if (appended.status === 'rejected') throw new Error(`the archived command failed: ${JSON.stringify(appended)}`);
      }
    }
    expect(stage).toBe('archive');
    const checked = await facts.checkArchiveCondition(world.humanContext(), {
      condition: { kind: 'secretary_handoff', operation: accepted.value.operation }, session: seeded.source });
    expect(checked.status).toBe('ready');
    if (checked.status !== 'ready' || !checked.value.ok) throw new Error(`condition refused: ${JSON.stringify(checked)}`);
    expect(checked.value.commit.fence).toBeNull();
    expect(checked.value.commit.guards.length).toBe(2);
    expect(typeof checked.value.commit.guards[1]?.expectedRevision).toBe('number');
  }, 60_000);
  it('returns the source and activity guards and the handoff fence, held by this operation', async () => {
    const { world } = await scene.open('memory');
    const ws = await s6b2Workspace(world);
    const source = await createS6BLine(ws, { label: 'condition-handoff', role: S6A_SECRETARY_ROLE });
    const target = await createS6BLine(ws, { label: 'condition-handoff-target', role: S6A_SECRETARY_ROLE });
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's6b2-condition-handoff', workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'existing', session: target.ref }, tasks: [] }] });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const facts = s6b2Facts(world, captured);
    const advance = s6b2Advance(world, captured, { coverage: facts });
    let revision = 1;
    let stage = 'accepted';
    for (let step = 0; step < 12 && stage !== 'archive'; step += 1) {
      const result = await advance.advanceHandoff(world.humanContext(), { kind: 'continue',
        operation: accepted.value.operation, expectedRevision: revision });
      if (result.status !== 'committed') throw new Error(`advance failed: ${JSON.stringify(result)}`);
      revision = result.value.revision;
      stage = result.value.stage;
    }
    expect(stage).toBe('archive');
    const checked = await facts.checkArchiveCondition(world.humanContext(), {
      condition: { kind: 'secretary_handoff', operation: accepted.value.operation }, session: source.ref });
    expect(checked.status).toBe('ready');
    if (checked.status !== 'ready' || !checked.value.ok) return;
    expect(checked.value.commit.guards.length).toBe(2);
    expect(checked.value.commit.fence).not.toBeNull();
    expect(checked.value.commit.fence?.expectedOwner).toBe(checked.value.commit.fence?.nextOwner);
    // The fresh line has no SessionActivity record, so its guard pins the absent revision.
    expect(checked.value.commit.guards[1]?.expectedRevision).toBeNull();
  }, 60_000);
  it('a late input before the archive commit reopens routing once and the first brief names it (memory)', async () => {
    const { world } = await scene.open('memory');
    const run = await lateInputHandoff(world, 'late-routing');
    expect(run.atRegistration).toMatchObject({ lifecycle: 'active', archiveRequest: null });
    expect(run.lateView).toMatchObject({ processing: true, owner: run.source.ref });
    expect(run.partial).toMatchObject({ stage: 'archive', archived: false,
      lastRefusal: 'the archive child is still partial' });
    const before = await recordedProgress(world, run.partial.operation);
    const driven = await finishHandoff(world, run.partial.operation);
    expect(driven.progress).toMatchObject({ stage: 'finished', phase: 'completed', archived: true });
    const after = await recordedProgress(world, run.partial.operation);
    expect(after.advanceGeneration).toBe(before.advanceGeneration + 1);
    const lateRoots = (after.routing?.roots ?? [])
      .filter(root => root.requestRoot.queryJobId === run.late.requestRoot.queryJobId);
    expect(lateRoots).toHaveLength(1);
    expect(lateRoots[0]?.receipt).not.toBeNull();
    expect((await world.readRequest(run.late.requestRoot)).owner).toEqual(run.partial.successor);
    expect((await world.readSession(run.source.ref)).record.lifecycle).toBe('archived');
    const successor = run.partial.successor;
    if (successor === null) throw new Error('the handoff recorded no successor');
    const brief = await s6b2Facts(world, captured).readBriefState(world.humanContext(), { session: successor });
    expect(brief).toMatchObject({ status: 'ready', value: { state: 'ready' } });
    if (brief.status === 'ready' && brief.value.state === 'ready') {
      expect(brief.value.brief.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestRoot: run.late.requestRoot, text: 'late-routing late input' })]));
    }
  }, 120_000);
  it('SQLite only: a crash after the late routing child keeps the route and the original archive write (recovery)', async () => {
    const { world } = await scene.open('sqlite');
    const run = await lateInputHandoff(world, 'late-recovery');
    expect(run.partial).toMatchObject({ stage: 'archive', archived: false,
      lastRefusal: 'the archive child is still partial' });
    const before = await recordedProgress(world, run.partial.operation);
    if (before.archiveRequest === null) throw new Error('the archive request was not saved');
    const originalWrite = before.archiveRequest.savedInput;
    const originalReceipt = before.archiveRequest.receipt;
    const roundsBefore = (await world.readRequest(run.late.requestRoot)).rounds.length;
    // The real gate sits on the parent's routing receipt: the child route is committed, the parent receipt is not.
    const crashed = await driveS6BHandoff(world, { operation: run.partial.operation, hold: [{ stage: 'routing',
      item: `root:${run.late.requestRoot.queryJobId}`, phase: 'after',
      generation: before.advanceGeneration + 1 }] });
    try {
      let driven = crashed;
      for (let step = 0; step < 3 && driven.progress?.stage !== 'finished'; step += 1) {
        driven = await driveS6BHandoff(world, { operation: run.partial.operation });
      }
      expect(driven.progress).toMatchObject({ stage: 'finished', phase: 'completed', archived: true });
      const after = await recordedProgress(world, run.partial.operation);
      expect(after.advanceGeneration).toBe(before.advanceGeneration + 1);
      expect(after.archiveRequest?.requestId).toBe(before.archiveRequest.requestId);
      expect(after.archiveRequest?.savedInput).toEqual(originalWrite);
      expect(after.archiveRequest?.receipt).toEqual(originalReceipt);
      const lateRoots = (after.routing?.roots ?? [])
        .filter(root => root.requestRoot.queryJobId === run.late.requestRoot.queryJobId);
      expect(lateRoots).toHaveLength(1);
      expect(lateRoots[0]?.receipt).not.toBeNull();
      const lateAfter = await world.readRequest(run.late.requestRoot);
      expect(lateAfter).toMatchObject({ processing: true, owner: run.partial.successor });
      expect(lateAfter.rounds.length).toBe(roundsBefore + 1);
      expect((await world.readSession(run.source.ref)).record.lifecycle).toBe('archived');
    } finally {
      await teardownS6BHandoff(crashed);
    }
  }, 180_000);
});

describe('a pending operator archive request on the fenced source', () => {
  it('makes the handoff archive arm wait over it, then finish once it is released (memory)', async () => {
    const { world } = await scene.open('memory');
    const source = await world.createSecretary('s6b2-pending-release');
    await world.requestArchive(source);
    const answer = world.post('secretaries/handoff', { scope: S6A_SCOPE,
      input: { commandId: 's6b2-pending-release-handoff', session: source.ref } });
    const body = (await answer).body as HandoffAnswer;
    if (body.status !== 'ready' || body.value === undefined) {
      throw new Error(`the handoff did not answer its progress: ${JSON.stringify(body)}`);
    }
    expect(body.value).toMatchObject({ stage: 'archive', archived: false });
    const operation = body.value.operation;
    const before = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    if (before.status !== 'ready') throw new Error(`the handoff operation is not readable: ${JSON.stringify(before)}`);
    const driven = await driveS6BHandoff(world, { operation });
    expect(driven.operation.revision).toBe(before.value.revision);
    expect((await recordedProgress(world, operation)).archiveRequest).toBeNull();
    const card = await world.readSession(source.ref);
    const pending = card.record.archiveRequest;
    if (pending === null || pending === undefined) throw new Error('the pending archive request is gone');
    const released = await world.post('sessions/archive-release', graphWrite(S6A_SCOPE, {
      sessionRef: source.ref, archiveRequestId: pending.requestId, reason: 'the operator releases its archive',
    }, 's6b2-pending-release-release', [{ ref: card.record.ref, revision: card.record.revision }]));
    expect(released.body).toMatchObject({ status: 'committed' });
    const finished = await finishHandoff(world, operation);
    expect(finished.progress).toMatchObject({ stage: 'finished', phase: 'completed', archived: true });
    expect((await world.readSession(source.ref)).record.lifecycle).toBe('archived');
  }, 120_000);
});
