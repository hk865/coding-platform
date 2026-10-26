/**
 * The manual archive's owner rows: a duplicate root is refused, each item's saved routing input is replayed before the
 * owner is called again, a committed child is read through its receipt and never re-judged, and a changed choice is a
 * new command.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { advanceCommandId, archiveContextOf } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import { seedS6BArchiveSource } from '../helpers/S6B1-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  s6b2Archive, s6b2Backend, s6b2FailCommit, s6b2Facts, s6b2ManualArchiveChain, s6b2Scene, s6b2Workspace,
  type S6B2Captured, type S6B2WorldValue,
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

type ArchiveService = ReturnType<typeof s6b2Archive>;

function archiveService(world: S6B2WorldValue) {
  return s6b2Archive(world, captured);
}


async function openArchiveWorld(backend: 'memory' | 'sqlite' = 'memory') {
  const openedWorld = await scene.open(backend);
  const ws = await s6b2Workspace(openedWorld.world);
  return { openedWorld, ws };
}

/** Advance one write; the caller commits the routing child when a saved item input appears. */
async function step(service: ArchiveService, world: S6B2WorldValue,
  operation: OperationRef, revision: number) {
  const advanced = await service.advanceArchive(world.humanContext(), { kind: 'continue', operation, expectedRevision: revision });
  if (advanced.status !== 'committed') throw new Error(`archive advance failed: ${JSON.stringify(advanced)}`);
  return advanced.value;
}

describe('rejects: the manual archive command', () => {
  it('refuses a duplicate request root with invalid and leaves the source unchanged', async () => {
    const { openedWorld, ws } = await openArchiveWorld();
    const { world } = openedWorld;
    const seeded = await seedS6BArchiveSource(ws, 'archive-duplicate');
    const service = archiveService(world);
    const before = await world.readSession(seeded.source);
    const root = seeded.requests[0]!.requestRoot;
    const refused = await service.acceptArchive(world.humanContext(), { commandId: 's6b2-archive-duplicate',
      source: seeded.source, choices: [{ requestRoot: root, to: seeded.other }, { requestRoot: root, to: null }] });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await world.readSession(seeded.source)).toEqual(before);
  }, 60_000);
});

describe('the manual archive command', () => {
  it('records the committed routing receipt and continues past a moved request', async () => {
    const { openedWorld, ws } = await openArchiveWorld();
    const { world } = openedWorld;
    const seeded = await seedS6BArchiveSource(ws, 'archive-routed');
    // A third request owned by the source: the item after the moved one.
    const third = await ws.submit({ label: 'archive-routed-3', goalId: null });
    expect(await ws.route('requests/route', { commandId: 's6b2-archive-routed-3', round: third.requestRoot,
      to: seeded.source, reason: 'manual' })).toMatchObject({ status: 'routed' });
    const service = archiveService(world);
    const roots = [seeded.requests[0]!.requestRoot, seeded.requests[1]!.requestRoot, third.requestRoot];
    const accepted = await service.acceptArchive(world.humanContext(), { commandId: 's6b2-archive-routed',
      source: seeded.source, choices: roots.map(requestRoot => ({ requestRoot, to: seeded.other })) });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    const operation = accepted.value.operation;
    const before = await step(service, world, operation, 1);
    expect(before.stage).toBe('items');
    expect(before.item.savedInput).not.toBeNull();
    if (before.item.savedInput === null) return;
    const appended = await world.platform.requestRounds.append(world.systemContext(), { command: {
      kind: 'archived', operationId: before.item.savedInput.operationId, requestRoot: before.item.requestRoot,
      to: before.item.savedInput.to, expectedSource: before.item.savedInput.expectedSource } });
    expect(appended.status).not.toBe('rejected');
    const after = await step(service, world, operation, before.revision);
    expect(after.item.receipt).not.toBeNull();
    expect(after.item.receipt?.routingRound).not.toBeNull();
    const replay = await service.advanceArchive(world.humanContext(), { kind: 'replay', operation,
      commandId: after.item.commandId });
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status !== 'committed') return;
    expect(replay.value.revision).toBe(after.revision);
    expect(replay.value.item.receipt).toEqual(after.item.receipt);
    // The first child committed and routed its request away: no later pass re-judges it. The second request moves
    // before its child, so its saved input can never commit; the third must still be archived after it.
    expect(await ws.route('requests/route', { commandId: 's6b2-archive-moved-2', round: roots[1]!,
      to: seeded.other, reason: 'manual' })).toMatchObject({ status: 'routed' });
    // The Workflow's published manual-archive entry over the real archive owner: it drives the advance and appends
    // each item.
    const done = await world.platform.workflow.sessionHandoff!.manualArchive(world.humanContext(), { operation });
    expect(done.status).toBe('ready');
    if (done.status !== 'ready') return;
    expect(done.value.items.map(item => [item.outcome, item.reason])).toEqual([
      ['routed', null], ['failed', 'owner_changed'], ['routed', null],
    ]);
  }, 60_000);
  it('keeps the first item and saves the same routing input across a crash before the parent progress', async () => {
    const { openedWorld, ws } = await openArchiveWorld();
    const { world } = openedWorld;
    const seeded = await seedS6BArchiveSource(ws, 'archive-crash');
    const service = archiveService(world);
    const accepted = await service.acceptArchive(world.humanContext(), { commandId: 's6b2-archive-crash',
      source: seeded.source, choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    if (accepted.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
    const before = await step(service, world, accepted.value.operation, 1);
    const saved = before.item.savedInput;
    expect(saved).not.toBeNull();
    if (saved === null) return;
    const appended = await world.platform.requestRounds.append(world.systemContext(), { command: {
      kind: 'archived', operationId: saved.operationId, requestRoot: before.item.requestRoot,
      to: saved.to, expectedSource: saved.expectedSource } });
    expect(appended.status).not.toBe('rejected');
    // A new service instance is the recovery: it reads the child's receipt instead of calling the owner again.
    const recovered = archiveService(world);
    const after = await step(recovered, world, accepted.value.operation, before.revision);
    expect(after.item.receipt).not.toBeNull();
    const record = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready' || record.value.action.kind !== 'secretary_archive') return;
    expect(record.value.action.progress.items[0]?.outcome).toBe('routed');
  }, 60_000);
  it('records the archive request before the owner call and stops on an unregistered request', async () => {
    const { openedWorld, ws } = await openArchiveWorld();
    const { world } = openedWorld;
    const seeded = await seedS6BArchiveSource(ws, 'archive-pending');
    const service = archiveService(world);
    const accepted = await service.acceptArchive(world.humanContext(), { commandId: 's6b2-archive-pending',
      source: seeded.source, choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })) });
    if (accepted.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
    let revision = 1;
    let stage = 'accepted';
    for (let index = 0; index < 10 && stage !== 'archive'; index += 1) {
      const advanced = await step(service, world, accepted.value.operation, revision);
      revision = advanced.revision;
      stage = advanced.stage;
      if (stage === 'archive') expect(advanced.item.requestRoot).toEqual(seeded.requests[0]!.requestRoot);
      if (advanced.item.savedInput !== null) {
        const saved = advanced.item.savedInput;
        await world.platform.requestRounds.append(world.systemContext(), { command: { kind: 'archived',
          operationId: saved.operationId, requestRoot: advanced.item.requestRoot, to: saved.to,
          expectedSource: saved.expectedSource } });
      }
    }
    expect(stage).toBe('archive');
    // The loop's last advance already saved the archive request before the owner call.
    const record = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready' || record.value.action.kind !== 'secretary_archive') return;
    expect(record.value.revision).toBe(revision);
    const saved = record.value.action.progress.archiveRequest?.savedInput;
    expect(saved).not.toBeNull();
    expect(saved?.input.mode).toBe('secretary_handoff');
    // The unregistered request is not re-marked: the original before write comes back and the after id stays free.
    const refused = await step(service, world, accepted.value.operation, revision);
    expect(refused.stop).toBe('replayed');
    const after = await world.platform.sessions.getSessionOperation(world.humanContext(), accepted.value.operation);
    if (after.status !== 'ready' || after.value.action.kind !== 'secretary_archive') return;
    expect(after.value.revision).toBe(revision);
    expect(after.value.action.progress.lastRefusal).toBeNull();
    const afterId = advanceCommandId(accepted.value.operation, 'archive', '-', 'after',
      after.value.action.progress.advanceGeneration);
    expect(await service.advanceArchive(world.humanContext(), { kind: 'replay', operation: accepted.value.operation,
      commandId: afterId })).toMatchObject({ status: 'rejected', code: 'not_found' });
  }, 60_000);
});

describe('the full archive chain', () => {
  let chain!: Awaited<ReturnType<typeof s6b2ManualArchiveChain>>;
  let partial!: Awaited<ReturnType<typeof s6b2ManualArchiveChain>>;
  beforeAll(async () => {
    chain = await s6b2ManualArchiveChain((await scene.open('memory')).world, captured, 'archive-chain');
    partial = await s6b2ManualArchiveChain((await scene.open('memory')).world, captured, 'archive-chain-partial',
      { failFinalCommit: true });
  });
  // AH3-03's partial side: the final archive step's own commit fails once, so the real owner answers partial; the
  // saved GraphWrite stays, the source stays active, and the published owner's next drive resumes it.
  it('stops on the real partial child with its items routed and its request saved (pending/partial)', async () => {
    expect(partial.driven).toMatchObject({ stage: 'archive', lastRefusal: 'the archive child is still partial' });
    expect(partial.driven.items.map(item => item.outcome)).toEqual(['routed', 'routed']);
    expect(partial.saved?.input.mode).toBe('secretary_handoff');
    expect((await partial.world.readSession(partial.seeded.source)).record.lifecycle).toBe('active');
    // The source stays active and the condition still holds until the published owner's next drive completes it.
    const checked = await s6b2Facts(partial.world, captured).checkArchiveCondition(partial.world.humanContext(), {
      condition: { kind: 'secretary_handoff', operation: partial.operation }, session: partial.seeded.source });
    expect(checked).toMatchObject({ status: 'ready', value: { ok: true, commit: { fence: null } } });
    const registered = await partial.world.platform.sessions.readSessionArchiveRequestReceipt(
      archiveContextOf(partial.world.humanContext()), partial.saved!);
    expect(registered).toMatchObject({ status: 'ready' });
    // The same saved GraphWrite completes the archive on the published owner's next drive.
    const resumed = await partial.world.platform.workflow.sessionHandoff!.manualArchive(
      partial.world.humanContext(), { operation: partial.operation });
    expect(resumed).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
    expect((await partial.world.readSession(partial.seeded.source)).record.lifecycle).toBe('archived');
  });
  // AH3-01's registration arm: the archived operation keeps the child's own registration receipt.
  it('registers the request and archives the source under the final after write (registration/final)', async () => {
    const registered = await chain.world.platform.sessions.readSessionArchiveRequestReceipt(
      archiveContextOf(chain.world.humanContext()), chain.saved!);
    expect(registered).toMatchObject({ status: 'ready' });
    if (registered.status !== 'ready') return;
    const record = await chain.world.platform.sessions.getSessionOperation(chain.world.humanContext(), chain.operation);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready' || record.value.action.kind !== 'secretary_archive') return;
    expect(record.value.action.progress.archiveRequest?.receipt).toEqual(registered.value.session.archiveRequest?.receipt);
    const card = await chain.world.readSession(chain.seeded.source);
    expect(card.record.lifecycle).toBe('archived');
  });
});

/** The manual archive's recorded progress through the published operation read. */
async function archiveProgress(world: S6B2WorldValue, operation: OperationRef) {
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  if (read.status !== 'ready' || read.value.action.kind !== 'secretary_archive') {
    throw new Error(`the archive operation is not readable: ${JSON.stringify(read)}`);
  }
  return read.value.action.progress;
}
async function seededWorld(label: string, backend: 'memory' | 'sqlite' = 'memory') {
  const { openedWorld, ws } = await openArchiveWorld(backend);
  return { world: openedWorld.world, ws, seeded: await seedS6BArchiveSource(ws, label), owner: openedWorld.world.platform.workflow.sessionHandoff! };
}
/** Accept the one manual archive of `roots`; every row asserts the platform's own committed answer. */
async function acceptManual(world: S6B2WorldValue, label: string, source: SessionRef,
  roots: readonly QueryJobRef[], to: SessionRef | null) {
  const accepted = await world.platform.sessionArchive.acceptArchive(world.humanContext(), { commandId: `s6b2-${label}`, source, choices: roots.map(requestRoot => ({ requestRoot, to })) });
  if (accepted.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(accepted)}`);
  return accepted.value.operation;
}
describe('D4: a manual archive with an undecided request', () => {
  it('writes the after mark and no GraphWrite while the source still owns a processing root', async () => {
    const { world, ws, seeded, owner } = await seededWorld('d4-precheck');
    const operation = await acceptManual(world, 'd4-precheck', seeded.source, [seeded.requests[0]!.requestRoot], null);
    const first = await owner.manualArchive(world.humanContext(), { operation });
    expect(first).toMatchObject({ status: 'ready', value: { stage: 'archive', lastRefusal: 'a request the source still owns is processing' } });
    if (first.status !== 'ready') return;
    const again = await owner.manualArchive(world.humanContext(), { operation });
    expect(again).toMatchObject({ status: 'ready', value: { archiveRequest: null, revision: first.value.revision } });
    expect((await archiveProgress(world, operation)).archiveRequest).toBeNull();
    // The source still accepts work: a new request is routed to it and processes there.
    const fresh = await ws.submit({ label: 'd4-precheck-fresh', goalId: null });
    expect(await ws.route('requests/route', { commandId: 's6b2-d4-precheck-fresh', round: fresh.requestRoot, to: seeded.source, reason: 'manual' })).toMatchObject({ status: 'routed' });
    expect((await ws.readRequest(fresh.requestRoot))['owner']).toEqual(seeded.source);
  }, 120_000);
  it('releases the pending request after a late root fails the final check and later archives', async () => {
    const { world, ws, seeded, owner } = await seededWorld('d4-release');
    const operation = await acceptManual(world, 'd4-release', seeded.source, seeded.requests.map(request => request.requestRoot), null);
    const registration = commitBarrier.hold(byIdentityPrefix('session-archive:'), 'D4 registration');
    const driving = owner.manualArchive(world.humanContext(), { operation });
    await registration.reached;
    const late = await ws.submit({ label: 'd4-release-late', goalId: null, recipient: seeded.source });
    registration.release();
    expect(await driving).toMatchObject({ status: 'ready', value: { stage: 'archive' } });
    expect((await world.readSession(seeded.source)).record.archiveRequest).toBeNull();
    const saved = (await archiveProgress(world, operation)).archiveRequest;
    expect([saved?.savedInput, saved?.receipt]).toEqual([expect.anything(), expect.anything()]);
    const fresh = await ws.submit({ label: 'd4-release-fresh', goalId: null });
    expect(await ws.route('requests/route', { commandId: 's6b2-d4-release-fresh', round: fresh.requestRoot, to: seeded.source, reason: 'manual' })).toMatchObject({ status: 'routed' });
    for (const [index, root] of [late.requestRoot, fresh.requestRoot].entries()) {
      expect(await ws.route('requests/route', { commandId: `s6b2-d4-release-away-${String(index)}`, round: root, to: seeded.other, reason: 'manual' })).toMatchObject({ status: 'routed' });
    }
    expect(await owner.manualArchive(world.humanContext(), { operation })).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
    expect((await world.readSession(seeded.source)).record.lifecycle).toBe('archived');
  }, 120_000);
  it('SQLite only: a restart completes the release and the archive through the original receipt', async () => {
    const { world, ws, seeded, owner } = await seededWorld('d4-recovery', 'sqlite');
    const operation = await acceptManual(world, 'd4-recovery', seeded.source, seeded.requests.map(request => request.requestRoot), null);
    const registration = commitBarrier.hold(byIdentityPrefix('session-archive:'), 'D4 recovery registration');
    const release = commitBarrier.hold(byIdentityPrefix('session-archive-release:'), 'D4 recovery release');
    const driving = owner.manualArchive(world.humanContext(), { operation });
    try {
      await registration.reached;
      const late = await ws.submit({ label: 'd4-recovery-late', goalId: null, recipient: seeded.source });
      registration.release();
      await release.reached;
      const before = (await archiveProgress(world, operation)).archiveRequest;
      await world.crash();
      const restarted = world.platform.workflow.sessionHandoff!;
      for (let attempt = 0; attempt < 3 && (await world.readSession(seeded.source)).record.archiveRequest !== null;
        attempt += 1) await restarted.manualArchive(world.humanContext(), { operation });
      expect((await world.readSession(seeded.source)).record.archiveRequest).toBeNull();
      const recovered = (await archiveProgress(world, operation)).archiveRequest;
      expect(recovered?.savedInput).toEqual(before?.savedInput);
      expect(recovered?.receipt).not.toBeNull();
      expect(await ws.route('requests/route', { commandId: 's6b2-d4-recovery-away', round: late.requestRoot, to: seeded.other, reason: 'manual' })).toMatchObject({ status: 'routed' });
      expect(await restarted.manualArchive(world.humanContext(), { operation })).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
      expect((await world.readSession(seeded.source)).record.lifecycle).toBe('archived');
    } finally {
      registration.release();
      release.release();
      await driving.catch(() => undefined);
    }
  }, 180_000);
  it('replays one archive refusal mark while the real routing child keeps failing', async () => {
    const { world, ws, seeded, owner } = await seededWorld('d1-archive-mark');
    const operation = await acceptManual(world, 'd1-archive-mark', seeded.source, seeded.requests.map(request => request.requestRoot), seeded.other);
    const fault = s6b2FailCommit(s6b2Backend(captured).records, { prefix: 'request.archived:', mode: 'always' });
    const first = await owner.manualArchive(world.humanContext(), { operation });
    const again = await owner.manualArchive(world.humanContext(), { operation });
    fault.restore();
    expect(first.status).toBe('ready');
    expect(again.status).toBe('ready');
    if (first.status !== 'ready' || again.status !== 'ready') return;
    expect(first.value.lastRefusal).toBe('the archive routing child has not committed');
    expect([again.value.revision, again.value.lastRefusal]).toEqual([first.value.revision, first.value.lastRefusal]);
    expect(await owner.manualArchive(world.humanContext(), { operation })).toMatchObject({ status: 'ready', value: { stage: 'finished', phase: 'completed' } });
    expect((await world.readSession(seeded.source)).record.lifecycle).toBe('archived');
  }, 120_000);
});
