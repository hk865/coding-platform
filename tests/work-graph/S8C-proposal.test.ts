/**
 * The proposal path: the tool -> single-member batch -> card -> approval -> catalog
 * revision; a later proposal is its own single-member batch; the read returns
 * batchRef/cardKey; the approval replay writes no second revision; the frozen base
 * is re-checked at approval and a changed base closes the members stale with no
 * revision. W-C is tests/helpers/S8C-proposal-world.ts: the real staff Work world's
 * adviser line, the real propose_architecture_revision tool, and the G5 composition's
 * one proposal owner, card source and application row.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';
import type { ArchitectureProposalBatchRef, ArchitectureProposalRef,
  ProposalResult } from '../../src/contracts/architecture-proposal.js';
import { canonicalKey, canonicalOf } from '../../src/contracts/fingerprint.js';

// G5 composes the proposal schemas, card source, application row and tool owner in
// `createTargetPlatform`; the world only keeps the frozen barrier at the store seam
// for the two concurrency rows. No composition module is mocked.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: ProposalWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function world(backend: 'memory' | 'sqlite', batchWindow: boolean | { isOpen: (ctx: never,
  input: { projectRef: { projectId: string } }) => Promise<{ status: 'ready'; value: { open: boolean; operationRef: null; revision: null } }> } = false): Promise<ProposalWorld> {
  const opened = await openProposalWorld({ backend, ...(batchWindow === false ? {} : { batchWindow }) });
  worlds.push(opened);
  return opened;
}

function addModule(target: ProposalWorld, moduleId: string, path: string) {
  return { op: 'add_module' as const, module: { ref: { projectId: target.projectId, moduleId },
    name: moduleId, responsibility: `Own ${moduleId}`, paths: [path], interfaces: [] } };
}

function needsDecision(result: ProposalResult) {
  if (result.status !== 'needs_decision') throw new Error(`expected needs_decision: ${JSON.stringify(result)}`);
  return result;
}

function pendingBatch(result: ProposalResult) {
  if (result.status !== 'pending_batch') throw new Error(`expected pending_batch: ${JSON.stringify(result)}`);
  return result;
}

function proposalRefOf(value: { proposalRef?: ArchitectureProposalRef }): ArchitectureProposalRef {
  if (value.proposalRef === undefined) throw new Error('no proposal ref');
  return value.proposalRef;
}

function batchOf(value: { batchRef: ArchitectureProposalBatchRef | null }): ArchitectureProposalBatchRef {
  if (value.batchRef === null) throw new Error('no batch ref');
  return value.batchRef;
}

describe.each(['memory', 'sqlite'] as const)('R11 (%s): the proposal path, its batch read and its replay', backend => {
  it('freezes each proposal into its own single-member batch and approves exactly one revision', async () => {
    const target = await world(backend);
    const base = target.pin;
    const [first, second] = (await target.propose([
      { baseCatalogPin: base, ops: [addModule(target, 's8c-a1', 'src/a/one'),
        addModule(target, 's8c-a1b', 'src/a/two')], reason: 'R11 first' },
      { baseCatalogPin: base, ops: [addModule(target, 's8c-b1', 'src/b/one')], reason: 'R11 second' },
    ])).map(needsDecision);
    const firstRef = proposalRefOf(first!);
    const secondRef = proposalRefOf(second!);
    expect(first!.cardKey).not.toBe(second!.cardKey);

    const firstRead = await target.read(firstRef);
    const secondRead = await target.read(secondRef);
    expect(firstRead.batchRef).not.toBeNull();
    expect(firstRead.cardKey).toBe(first!.cardKey);
    expect(secondRead.batchRef).not.toBeNull();
    expect(secondRead.cardKey).toBe(second!.cardKey);
    // A later proposal is its own single-member batch, never merged into the first.
    expect(batchOf(firstRead).batchId).not.toBe(batchOf(secondRead).batchId);

    const before = await target.readCatalog();
    expect(before.revision).toBe(2); // initial adoption c1, one world-setup add -> c2
    const card = await target.cardByKey(first!.cardKey);
    expect(card).toMatchObject({ state: 'waiting_answer', source: { kind: 'structural_proposal' } });
    const answered = await target.answer(card, 'approve', 's8c-r11-approve');
    expect(answered.state).toBe('applied');
    const after = await target.readCatalog();
    expect(after.revision).toBe(3); // one approval revision over the hand-counted base c2
    // Both ops of the first batch took effect, under the one approval revision.
    expect(after.modules.map(module => module.ref.moduleId)).toContain('s8c-a1');
    expect(after.modules.map(module => module.ref.moduleId)).toContain('s8c-a1b');
    expect(after.modules.map(module => module.ref.moduleId)).not.toContain('s8c-b1');
    expect((await target.read(firstRef)).proposal).toMatchObject({ state: 'applied' });
    expect((await target.read(secondRef)).proposal).toMatchObject({ state: 'pending' });

    // The same decisions/answer request replays ① and ②: the original receipt, no second revision.
    const replay = await target.answer(card, 'approve', 's8c-r11-approve');
    expect(replay.state).toBe('applied');
    expect(replay.application).toMatchObject({ status: 'committed' });
    expect((await target.readCatalog()).revision).toBe(after.revision);
  }, 120_000);
  it('answers a real card annotated on its frozen batch and reads the same objects back', async () => {
    const target = await world(backend);
    const ops = [addModule(target, 's8c-r8-a', 'src/r8a'), addModule(target, 's8c-r8-b', 'src/r8b')];
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin, ops,
      responsibilityMoves: [], reason: 'R8 frozen member' }]).then(results => results.map(needsDecision));
    const card = await target.cardByKey(proposal!.cardKey);
    expect(card.objects).toHaveLength(2);
    const answered = await target.answer(card, 'approve', 's8c-r8-annotate',
      [{ objectKey: canonicalOf(card.objects[0]!)!, text: 'R8 batch annotation' }]);
    expect(answered.state).toBe('applied');
    const read = await target.readAnswer(card.source);
    if (read.status !== 'ready' || read.value.message === null) throw new Error(`no saved answer: ${JSON.stringify(read)}`);
    const objects = read.value.message.decision!.objects;
    expect(objects).toHaveLength(2);
    expect(JSON.parse(objects[0]!.label)).toEqual({ digest: expect.any(String), ops, responsibilityMoves: [] });
    expect(objects[1]!.label).toBe('R8 frozen member');
    expect(objects.map(object => object.kind === 'aggregate' ? object.pin : null))
      .toEqual(card.objects.map(object => object.kind === 'aggregate' ? object.pin : null));
  });
  it('commits the proposal and its single-member batch in one write', async () => {
    const target = await world(backend);
    const hold = commitBarrier.holdAfter(byIdentityPrefix('architecture-proposal-propose'), 'R11 one write');
    const proposing = target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r1', 'src/r1')], reason: 'R11 one write' }]);
    await hold.reached;
    await target.revise([addModule(target, 's8c-r1-c2', 'src/c2')]);
    hold.release();
    const result = (await proposing)[0]!;
    expect(result.status).toBe('needs_decision');
    expect((await target.read(proposalRefOf(needsDecision(result)))).batchRef).not.toBeNull();
  });
  it('replays the original pending_batch result after the window freezes the batch', async () => {
    const target = await world(backend, true);
    await target.freezeAttempt(target.pin, [pendingBatch((await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r2', 'src/r2')], reason: 'R2 window' }]))[0]!).proposalRef]);
    expect((await target.replayPropose()).status).toBe('pending_batch');
  });

  it('replays a concurrent proposal commit from its receipt', async () => {
    let signalB!: () => void;
    const bAtWindow = new Promise<void>(resolve => { signalB = resolve; });
    let releaseA!: () => void;
    const aCommitted = new Promise<void>(resolve => { releaseA = resolve; });
    let calls = 0;
    const target = await world(backend, { isOpen: async () => {
      calls += 1;
      if (calls === 1) return { status: 'ready' as const, value: { open: true, operationRef: null, revision: null } };
      signalB();
      await aCommitted;
      return { status: 'ready' as const, value: { open: false, operationRef: null, revision: null } };
    } });
    const hold = commitBarrier.hold(byIdentityPrefix('architecture-proposal-propose'), 'R1 A pending');
    const a = target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r1-race', 'src/r1race')], reason: 'R1 concurrent replay' }]);
    await hold.reached;
    const b = target.replayPropose();
    await bAtWindow;
    hold.release();
    const aResult = (await a)[0]!;
    expect(aResult.status).toBe('pending_batch');
    releaseA();
    const bResult = await b;
    expect(bResult.status).toBe('pending_batch');
    expect((await target.read(proposalRefOf(pendingBatch(bResult)))).batchRef).toBeNull();
  });
  it.each([
    { entry: 'a new base pin is a new key and the old answer cannot apply' },
  ])('$entry', async () => {
    const target = await world(backend);
    const base = target.pin;
    const [first] = await target.propose([{ baseCatalogPin: base,
      ops: [addModule(target, 's8c-r11-a', 'src/a')], reason: 'R11 old approval' }])
      .then(results => results.map(needsDecision));
    const firstRef = proposalRefOf(first!);
    const card = await target.cardByKey(first!.cardKey);
    const answered = await target.answer(card, 'approve', 's8c-r11-old');
    expect(answered.state).toBe('applied');
    const oldAnswer = answered.answer as unknown as { status: string; value: { ref: never } };
    expect(oldAnswer.status).toBe('committed');

    // The base moved to c2 by the approval itself; a proposal pinned at c2 is a new batch/key.
    const moved = await target.readCatalog();
    const movedPin = await target.currentPin();
    expect(movedPin.catalogRef.revision).toBe(moved.revision);
    const [later] = (await target.propose([{ baseCatalogPin: movedPin,
      ops: [addModule(target, 's8c-r11-b', 'src/b')], reason: 'R11 new base' }])).map(needsDecision);
    expect(later!.cardKey).not.toBe(first!.cardKey);
    const laterRef = proposalRefOf(later!);
    const laterRead = await target.read(laterRef);
    expect(batchOf(laterRead).batchId).not.toBe(batchOf(await target.read(firstRef)).batchId);

    // The frozen owner interface with the OLD answer ref: not applicable, catalog unchanged.
    const applied = await target.apply(batchOf(laterRead), oldAnswer.value.ref);
    expect(applied).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((await target.readCatalog()).revision).toBe(moved.revision);
    expect((await target.read(laterRef)).proposal).toMatchObject({ state: 'pending' });
  }, 120_000);
});

describe.each(['memory', 'sqlite'] as const)('R11 (%s): the freeze splits only content conflicts', backend => {
  it('returns an accumulated trial read failure without splitting the batch', async () => {
    const target = await world(backend, true);
    await target.revise([addModule(target, 's8c-r3-gone', 'src/r3gone')]);
    const pin = await target.currentPin();
    const addCall = { baseCatalogPin: pin, ops: [addModule(target, 's8c-r3-a', 'src/r3a')], reason: 'R3 add' };
    const removeCall = { baseCatalogPin: pin,
      ops: [{ op: 'remove_module' as const, moduleId: 's8c-r3-gone' }], reason: 'R3 remove' };
    let add: ArchitectureProposalRef | undefined;
    let remove: ArchitectureProposalRef | undefined;
    for (let attempt = 0; attempt < 16 && add === undefined; attempt += 1) {
      const [a, r] = (await target.propose([addCall, removeCall])).map(result => pendingBatch(result).proposalRef);
      if (a!.proposalId < r!.proposalId) { add = a; remove = r; }
    }
    if (add === undefined || remove === undefined) throw new Error('R3: no add sorts before a remove');
    commitBarrier.failReads(canonicalKey(target.staff.goal), 'throw-once');
    expect(await target.freezeAttempt(pin, [add, remove]))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    for (const ref of [add, remove]) {
      const readBack = await target.read(ref);
      expect(readBack.batchRef).toBeNull();
      expect(readBack.cardKey).toBeNull();
    }
    expect(await target.proposalCardCount()).toBe(0);
  });
});

describe.each(['memory', 'sqlite'] as const)('R13 (%s): the frozen base is re-checked at approval', backend => {
  it('holds the answer commit, revises the catalog, then the same call closes the members stale', async () => {
    const target = await world(backend);
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r13-a', 'src/a')], reason: 'R13 stale' }])
      .then(results => results.map(needsDecision));
    const ref = proposalRefOf(proposal!);
    const card = await target.cardByKey(proposal!.cardKey);
    const before = await target.readCatalog();
    expect(before.revision).toBe(2); // initial adoption c1, one world-setup add -> c2

    // ① answer commit lands; its answer is held; the public revision moves the base to c2.
    const hold = commitBarrier.holdAfter(byIdentityPrefix('session-message-decision-'), 'R13 answer');
    const answering = target.answer(card, 'approve', 's8c-r13-answer');
    await hold.reached;
    await target.revise([addModule(target, 's8c-r13-c2', 'src/c2')]);
    hold.release();
    const answered = await answering;
    expect(answered.state).toBe('applied');
    expect(target.lastApply()).toMatchObject({ status: 'source_stale' });

    // Members stale, no revision beyond the held call's own public revise, card closed as stale.
    const read = await target.read(ref);
    expect(read.proposal).toMatchObject({ state: 'stale' });
    expect((await target.readCatalog()).revision).toBe(3); // the public revise only; no approval revision
    const closed = await target.cardByKey(proposal!.cardKey);
    expect(closed).toMatchObject({ state: 'closed' });
    expect(closed.closedReason).toBe('source_resolved');
    expect(closed.readOnly).toBe(true);
    expect(closed.staleReason).not.toBeNull();

    // Replay of the same answer: original stale receipt, no revision.
    const replay = await target.answer(card, 'approve', 's8c-r13-answer');
    expect(replay.state).toBe('applied');
    expect(target.lastApply()).toMatchObject({ status: 'source_stale' });
    expect((await target.readCatalog()).revision).toBe(3); // replay writes no revision
    expect((await target.read(proposalRefOf(proposal!))).proposal).toMatchObject({ state: 'stale' });
  });

  it('closes the members stale when the catalog moves after the first window read', async () => {
    const target = await world(backend);
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r13-w', 'src/w')], reason: 'R13 second window' }])
      .then(results => results.map(needsDecision));
    const card = await target.cardByKey(proposal!.cardKey);
    const hold = commitBarrier.holdAfter(byIdentityPrefix('session-message-decision-'), 'R13 window');
    const answering = target.answer(card, 'approve', 's8c-r13-window');
    await hold.reached;
    // KLS-2b [2B-06]: the apply's window reads and its commit run in the project's write queue, so a revise can no
    // longer land between the first window read and the planner's re-read (it would wait on the queue the apply
    // holds); it lands while the answer is held, before the apply reads the window.
    await target.revise([addModule(target, 's8c-r13-w2', 'src/w2')]);
    hold.release();
    expect((await answering).state).toBe('applied');
    expect(target.lastApply()).toMatchObject({ status: 'source_stale', receipt: expect.anything() });
    expect((await target.read(proposalRefOf(proposal!))).proposal).toMatchObject({ state: 'stale' });
  });

  it('a second copy of the same application, sent while the first holds the write queue at its commit, answers the '
    + 'first copy (quick check 5)', async () => {
    const target = await world(backend);
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-qc5', 'src/qc5')], reason: 'QC5 two copies' }])
      .then(results => results.map(needsDecision));
    const card = await target.cardByKey(proposal!.cardKey);
    const holdAnswer = commitBarrier.holdAfter(byIdentityPrefix('session-message-decision-'), 'QC5 answer');
    const answering = target.answer(card, 'approve', 's8c-qc5-answer');
    await holdAnswer.reached;
    const saved = await target.readAnswer(card.source);
    if (saved.status !== 'ready' || saved.value.message === null) throw new Error('no saved answer');
    const batchRef = batchOf(await target.read(proposalRefOf(proposal!)));
    // KLS-2b [2B-06]: an application's reads, plan and commit run in the project's write queue, so the second copy
    // can no longer run inside the first. A is held before its commit (it holds the queue); B is sent then (A has no
    // receipt yet) and is answered after A, with A's result.
    const holdFirst = commitBarrier.hold(byIdentityPrefix('architecture-proposal-apply'), 'QC5 A prepared');
    const firstCall = target.apply(batchRef, saved.value.message.ref);
    await holdFirst.reached;
    const secondCall = target.apply(batchRef, saved.value.message.ref);
    holdFirst.release();
    const first = await firstCall;
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'applied' });
    expect(await secondCall).toEqual(first);
    // The answer's own application comes after both and replays the same result.
    holdAnswer.release();
    expect((await answering).state).toBe('applied');
    expect(target.lastApply()).toEqual(first);
    expect((await target.read(proposalRefOf(proposal!))).proposal).toMatchObject({ state: 'applied' });
  });

  it('a second copy of the same application, sent while the first holds the write queue at its stale close, answers '
    + 'that close and writes no file (quick check 8)', async () => {
    const target = await world(backend);
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-qc8', 'src/qc8')], reason: 'QC8 replayed close' }])
      .then(results => results.map(needsDecision));
    const card = await target.cardByKey(proposal!.cardKey);
    const holdAnswer = commitBarrier.holdAfter(byIdentityPrefix('session-message-decision-'), 'QC8 answer');
    const answering = target.answer(card, 'approve', 's8c-qc8-answer');
    await holdAnswer.reached;
    // KLS-2b [2B-06]: a revise waits on the write queue an application holds, so another command moves the base
    // first. A then finds no receipt, sees the base moved and closes the members stale under the original identity;
    // its close is held before its commit (it holds the queue). B is sent then (A has no receipt yet) and is answered
    // after A, with A's close.
    await target.revise([addModule(target, 's8c-qc8-other', 'src/qc8other')]);
    const saved = await target.readAnswer(card.source);
    if (saved.status !== 'ready' || saved.value.message === null) throw new Error('no saved answer');
    const batchRef = batchOf(await target.read(proposalRefOf(proposal!)));
    const holdFirst = commitBarrier.hold(byIdentityPrefix('architecture-proposal-apply'), 'QC8 A stale close');
    const firstCall = target.apply(batchRef, saved.value.message.ref);
    await holdFirst.reached;
    const secondCall = target.apply(batchRef, saved.value.message.ref);
    holdFirst.release();
    const first = await firstCall;
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'source_stale' });
    expect(await secondCall).toEqual(first);
    holdAnswer.release();
    await answering;
    expect(target.lastApply()).toEqual(first);
    expect((await target.read(proposalRefOf(proposal!))).proposal).toMatchObject({ state: 'stale' });
    const folder = join(target.staff.world.root, '.workbench/modules');
    const ids = existsSync(folder) ? readdirSync(folder)
      .map(name => (JSON.parse(readFileSync(join(folder, name), 'utf8')) as { id: string }).id) : [];
    expect(ids).toContain('s8c-qc8-other');
    expect(ids).not.toContain('s8c-qc8');
  });

  it('closes a rejected batch with no stale reason', async () => {
    const target = await world(backend);
    const [proposal] = await target.propose([{ baseCatalogPin: target.pin,
      ops: [addModule(target, 's8c-r13-reject', 'src/reject')], reason: 'R13 reject' }])
      .then(results => results.map(needsDecision));
    await target.answer(await target.cardByKey(proposal!.cardKey), 'reject', 's8c-r13-reject');
    expect((await target.cardByKey(proposal!.cardKey)).staleReason).toBeNull();
  });
});
