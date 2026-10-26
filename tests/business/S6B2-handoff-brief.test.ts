/**
 * Row 23 (memory): the four brief states, the readiness rule's two doors, the manifest ref, entered-only consumption
 * and the notice projection. Every prior state uses the real accept, the published handoff composite and public reads.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import { archiveContextOf } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import { createHandoffBriefPort } from '../../src/core/work-graph/sessions/session-handoff-brief.js';
import { createHandoffNoticeSource, noticePositionOf } from '../../src/core/work-graph/views/handoff-notices.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { createS6BLine, governS6B, understandingPointer } from '../helpers/S6B1-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { holdS6BUnderstandingRound, driveS6BHandoff, seedS6BTooLongSecretary } from '../helpers/S6B2-fixture.js';
import {
  s6b2Accept, s6b2Backend, s6b2FailCommit, s6b2Facts, s6b2Scene,
  type S6B2Backend, type S6B2Captured, type S6B2WorldValue,
} from '../helpers/S6B2-handoff-scene.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealInMemory(captured,
    await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>()));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealSqlite(captured,
    await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>()));

const scene = s6b2Scene();
afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });
afterAll(() => scene.closeAll());

// Imported after the mocks so the fixture's dynamic imports see them.
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';

function factsOf(world: S6B2WorldValue, records?: S6B2Backend['records']) {
  return s6b2Facts(world, captured, records);
}

/** The composite the composition root publishes; every composite row drives this one, never a second assembly. */
function published(world: S6B2WorldValue) {
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the Workflow publishes no handoff composite');
  return owner;
}

/** A real secretary source and an existing target; the handoff operation names the target as its successor. */
async function accepted(label: string) {
  const { world } = await scene.open('memory');
  const source = await world.createSecretary(`s6b-brief-${label}-source`);
  const target = await world.createSecretary(`s6b-brief-${label}-target`);
  // Real requests the source owns, so the successor's brief names them with their original text.
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  for (let index = 1; index <= (label === 'entered-brief' ? 2 : 1); index += 1) {
    const owned = await ws.submit({ label: `s6b-brief-${label}-owned-${index}`, goalId: null });
    expect(await ws.route('requests/route', { commandId: `s6b-brief-${label}-route-${index}`, round: owned.requestRoot,
      to: source.ref, reason: 'manual' })).toMatchObject({ status: 'routed' });
  }
  const acceptedHandoff = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
    commandId: `s6b-brief-${label}`, workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'manual',
    assignments: [{ target: { kind: 'existing', session: target.ref }, tasks: [] }] });
  if (acceptedHandoff.status !== 'committed') throw new Error(`accept failed: ${JSON.stringify(acceptedHandoff)}`);
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), acceptedHandoff.value.operation);
  if (read.status !== 'ready') throw new Error(`operation read failed: ${JSON.stringify(read)}`);
  return { world, ws, source, target, operationRef: acceptedHandoff.value.operation,
    operation: read.value as SessionOperationRecordOf<HandoffActionV1> };
}

/** The successor's round is the request the handoff handed it; prepare that round and read its frozen manifest. */
async function preparedOn(world: S6B2WorldValue, operation: OperationRef, target: S6ASession, label: string,
  index = 0) {
  const record = await operationRecord(world, operation);
  const round = record.action.progress.routing?.roots[index]?.requestRoot;
  if (round === undefined) throw new Error('the handoff routed no request to the successor');
  return preparedRound(world, round, target, label);
}

/** Claim one request round for the target, prepare it and read the frozen manifest of the prepared round. */
async function preparedRound(world: S6B2WorldValue, round: Parameters<typeof readQuery>[1], target: S6ASession,
  label: string) {
  await claimWithSecretaryProfile(world, round, target, `${label}-claim`);
  const run = (await readQuery(world.ag2b, round)).run.ref;
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE,
    { queryRunRef: run, requestId: `${label}-prepare` }))).body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`the round preparation failed: ${JSON.stringify(prepared)}`);
  const opened = (await world.post('materials/open', plain(S6A_SCOPE,
    { ref: prepared.value.bundleRef, usage: 'historical_explanation' }))).body as ReadResult<{ body: string }>;
  if (opened.status !== 'ready') throw new Error(`the frozen manifest read failed: ${JSON.stringify(opened)}`);
  return { prepared: prepared.value, manifest: JSON.parse(opened.value.body) as PreparedQueryManifestV1, run };
}

/** Drive the published composite through the real archive child; a refusal is the live result, never relaxed. */
async function driveArchive(world: S6B2WorldValue, operation: OperationRef) {
  return (await driveS6BHandoff(world, { operation })).progress;
}

/** The successor's brief state, read through the one facts view the composition injects. */
async function briefStateOf(world: S6B2WorldValue, session: S6ASession | SessionRef) {
  const result = await factsOf(world).readBriefState(world.humanContext(),
    { session: 'aggregateRef' in session ? session.ref : session });
  if (result.status !== 'ready') throw new Error(`the brief state failed: ${JSON.stringify(result)}`);
  return result.value;
}

/** The handoff operation as the platform now records it (the notice position needs the recorded key). */
async function operationRecord(world: S6B2WorldValue, operation: OperationRef) {
  const read = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  if (read.status !== 'ready' || read.value.action.kind !== 'handoff') {
    throw new Error(`the handoff operation is not readable: ${JSON.stringify(read)}`);
  }
  return read.value as SessionOperationRecordOf<HandoffActionV1>;
}

describe('row 23: the brief states', () => {
  it('answers none for a Session no handoff names as its successor', async () => {
    const { world, source } = await accepted('none');
    const result = await factsOf(world).readBriefState(world.humanContext(), { session: source.ref });
    expect(result).toEqual({ status: 'ready', value: { state: 'none' } });
  });
  it('answers waiting while the operation is unfinished; an existing successor is never none', async () => {
    const { world, target, operationRef } = await accepted('waiting');
    const result = await factsOf(world).readBriefState(world.humanContext(), { session: target.ref });
    expect(result).toEqual({ status: 'ready', value: { state: 'waiting', operation: operationRef } });
  });
  it('answers none when the only handoff naming the Session has a non-secretary source', async () => {
    const { world } = await scene.open('memory');
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await createS6BLine(ws, { label: 's6b-brief-work-source', role: S6A_WORK_ROLE });
    const target = await createS6BLine(ws, { label: 's6b-brief-work-target', role: S6A_WORK_ROLE });
    await s6b2Accept(world, { commandId: 's6b-brief-work', source: source.ref, target: target.ref });
    const result = await factsOf(world).readBriefState(world.humanContext(), { session: target.ref });
    expect(result).toEqual({ status: 'ready', value: { state: 'none' } });
  });
  it('answers unavailable on a failed read, never none', async () => {
    const { world, target } = await accepted('unavailable');
    // A2: the real operation index throws once at its named boundary; the read answers unavailable, never none.
    const real = s6b2Backend(captured).records;
    let failed = false;
    const broken = { ...real, lookup: async (input: Parameters<typeof real.lookup>[0]) => {
      if (!failed) { failed = true; throw new Error('the operation index is down'); }
      return await real.lookup(input);
    } };
    const result = await factsOf(world, broken).readBriefState(world.humanContext(), { session: target.ref });
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

});

describe('rejects: the brief read and the entered consumption', () => {
  const run = { aggregateType: 'QueryRun' as const, projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
    queryJobId: 's6b-brief-job', runId: 's6b-brief-run' };
  it('rejects a non-ready operation and leaves its revision unchanged', async () => {
    const { world, operationRef } = await accepted('consume');
    const refused = await createHandoffBriefPort({ operations: world.platform.sessions }).consume(
      world.humanContext(), { operation: operationRef, queryRun: run, at: world.clock.now() });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await world.platform.sessions.getSessionOperation(world.humanContext(), operationRef))
      .toMatchObject({ status: 'ready', value: { revision: 1 } });
  });
  it('rejects an operation that does not exist and writes nothing', async () => {
    const { world } = await accepted('unknown');
    const operation = { aggregateType: 'CoreOperation' as const, projectId: S6A_SCOPE.projectId, operationId: 'no-such-operation' };
    const refused = await createHandoffBriefPort({ operations: world.platform.sessions }).consume(
      world.humanContext(), { operation, queryRun: run, at: world.clock.now() });
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await world.platform.sessions.getSessionOperation(world.humanContext(), operation))
      .toMatchObject({ status: 'not_found' });
  });
});

describe('row 23: the brief chain', () => {
  it('presents the predecessor\'s stored version beside a moved current pointer', async () => {
    const { world } = await scene.open('memory', undefined, { secretaryBudget: { contextWindowTokens: 625_000 },
      secretaryTools: ['read', 'record_note'] });
    const seeded = await seedS6BTooLongSecretary(world, { windowTokens: 625_000, inputTokens: 500_000,
      label: 'written-version' });
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    // One goal request opens the source's coverage; the understanding round writes the goal's note.
    await ws.submit({ label: 'written-version-goal', goalId: world.goals.first.goalId, recipient: seeded.secretary.ref });
    const held = await holdS6BUnderstandingRound(world, { secretary: seeded.secretary, goals: [world.goals.first] });
    // A second queued request over the goal keeps the recheck's coverage naming it (the brief's goals come from there).
    await ws.submit({ label: 'written-version-goal-2', goalId: world.goals.first.goalId, recipient: seeded.secretary.ref });
    const archived = await driveArchive(world, held.operation);
    expect(archived).toMatchObject({ stage: 'finished' });
    if (archived === null || archived.successor === null) {
      throw new Error('the handoff has no successor');
    }
    const successorRef = archived.successor;
    const card = await world.readSession(successorRef);
    const successor: S6ASession = { label: 'written-version-target', ref: successorRef,
      aggregateRef: card.record.ref, role: structuredClone(card.record.role), createdAt: card.record.createdAt };
    // The person moves the goal's current understanding; the pointer now names a different note version.
    const pointer = await understandingPointer(world, { kind: 'goal', goalId: world.goals.first.goalId });
    expect((await ws.route('notes/write', { commandId: 's6b2-brief-written-version', goalId: world.goals.first.goalId,
      expectedPointerRevision: pointer.revision,
      note: understandingNote({ anchor: { kind: 'goal', goalId: world.goals.first.goalId }, topic: 's6b2-brief',
        conclusion: 'the person moved the goal understanding', structural: false,
        replaces: pointer.noteId === null ? [] : [pointer.noteId] }) }) as { write: { status: string } })
      .write.status).not.toBe('rejected');
    const current = await understandingPointer(world, { kind: 'goal', goalId: world.goals.first.goalId });
    const brief = await briefStateOf(world, successor);
    expect(brief).toMatchObject({ state: 'ready' });
    if (brief.state !== 'ready') return;
    const goal = brief.brief.goals[0]!;
    // The stored version is the one the predecessor really wrote; the current pointer really moved to a new note.
    expect(goal.written).toMatchObject({ noteId: held.pointers[0]!.pointer.noteId,
      version: held.pointers[0]!.version, text: held.pointers[0]!.note.conclusion });
    expect(goal.current).toMatchObject({ noteId: current.noteId });
    expect(goal.current?.noteId).not.toBe(goal.written?.noteId);
    // The prepared round freezes that stored version beside the live one, never a rebuilt text.
    const { manifest } = await preparedOn(world, held.operation, successor, 'written-version');
    expect(manifest.input).toContain(`written understanding: ${goal.written!.noteId}@${goal.written!.version}:`);
    expect(manifest.input).toContain(`current understanding: ${current.noteId}@`);
  });
  it('answers waiting for a partial registration receipt and ready only after the final archive', async () => {
    const { world, source, target, operationRef } = await accepted('partial-registration');
    const fault = s6b2FailCommit(s6b2Backend(captured).records, { prefix: 's1-archive-step:' });
    try {
      const archived = await published(world).advance(world.humanContext(), { operation: operationRef });
      // The real partial: the one drive stops at the archive stage with the owner's own incomplete mark.
      expect(archived).toMatchObject({ status: 'ready', value: { stage: 'archive',
        lastRefusal: 'the archive child is still partial' } });
      // The registration is the child's, the source still active and the brief not ready.
      const saved = (await operationRecord(world, operationRef)).action.progress.archiveRequest?.savedInput;
      expect(saved).not.toBeNull();
      expect(await world.platform.sessions.readSessionArchiveRequestReceipt(
        archiveContextOf(world.humanContext()), saved!)).toMatchObject({ status: 'ready' });
      expect((await world.readSession(source.ref)).record.lifecycle).toBe('active');
      expect(await briefStateOf(world, target)).toMatchObject({ state: 'waiting', operation: operationRef });
      // The successor's preparation answers the retryable incomplete and prepares no round.
      const waiting = await s6aCardsWorkspace(world, S6A_SCOPE).submit({ label: 'partial-registration-wait',
        goalId: null, recipient: target.ref });
      await claimWithSecretaryProfile(world, waiting.round, target, 'partial-registration-claim');
      const waitingRun = (await readQuery(world.ag2b, waiting.round)).run.ref;
      expect((await world.post('queries/prepare', plain(S6A_SCOPE,
        { queryRunRef: waitingRun, requestId: 'partial-registration-prepare' }))).body)
        .toMatchObject({ status: 'rejected', code: 'incomplete' });
      // The published owner's next drive resumes the same saved GraphWrite and completes; only then is it ready.
      expect(await driveArchive(world, operationRef)).toMatchObject({ stage: 'finished', phase: 'completed' });
      expect(await briefStateOf(world, target)).toMatchObject({ state: 'ready', operation: operationRef });
    } finally {
      fault.restore();
    }
  });
  it('consumes a ready brief when the entered run confirms it', async () => {
    const { world, target, operationRef } = await accepted('consumed-brief');
    expect(await driveArchive(world, operationRef)).toMatchObject({ stage: 'finished' });
    const ready = await briefStateOf(world, target);
    expect(ready).toMatchObject({ state: 'ready', operation: operationRef });
    if (ready.state !== 'ready') return;
    // The brief's body is the source's real request text, read at brief time.
    expect(ready.brief.requests[0]?.text).toContain('s6b-brief-consumed-brief-owned-1');
    const { prepared, manifest, run } = await preparedOn(world, operationRef, target, 'consumed-brief-enter');
    expect(manifest.request?.briefRef).toEqual(operationRef);
    expect(manifest.input).toContain('s6b-brief-consumed-brief-owned');
    await world.scripted.script(target, [{ kind: 'text', text: '{"schemaVersion":1,"body":"brief answer","ideas":[],"goalCardDrafts":[]}' }]);
    expect((await world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: 'consumed-brief-enter-start' }))).body).toMatchObject({ status: 'ready' });
    // The entered confirmation is the consumer, and it names the run that entered.
    expect(await briefStateOf(world, target)).toMatchObject({ state: 'consumed', operation: operationRef, by: run });
  });
  it('consumes only at entered and retries when not entered', async () => {
    const { world, target, operationRef } = await accepted('entered-brief');
    expect(await driveArchive(world, operationRef)).toMatchObject({ stage: 'finished' });
    const dropped = await preparedOn(world, operationRef, target, 'entered-brief-drop');
    expect(dropped.manifest.request?.briefRef).toEqual(operationRef);
    // The prepared round never enters: its request is dropped and the run closes not_entered.
    const round = (await operationRecord(world, operationRef)).action.progress.routing?.roots[0]?.requestRoot;
    if (round === undefined) throw new Error('the handoff routed no request to the successor');
    expect(await world.drop({ commandId: 'entered-brief-drop', round })).toMatchObject({ status: 'routed' });
    expect((await readQuery(world.ag2b, round)).run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    // Nothing consumed: the successor's next request still gets the brief and consumes it on entry.
    expect(await briefStateOf(world, target)).toMatchObject({ state: 'ready' });
    const retry = await preparedOn(world, operationRef, target, 'entered-brief-retry', 1);
    expect(retry.manifest.request?.briefRef).toEqual(operationRef);
    await world.scripted.script(target, [{ kind: 'text', text: '{"schemaVersion":1,"body":"brief answer","ideas":[],"goalCardDrafts":[]}' }]);
    expect((await world.post('queries/start', plain(S6A_SCOPE, { prepared: retry.prepared,
      consumerId: AG2B_CONSUMER_ID, requestId: 'entered-brief-start' }))).body).toMatchObject({ status: 'ready' });
    expect(await briefStateOf(world, target)).toMatchObject({ state: 'consumed', by: retry.run });
  });
});

describe('row 23: the notice projection has a position or nothing', () => {
  it('keeps an operation before its notice write out of the page and reads a null position', async () => {
    const { world, operation } = await accepted('notice');
    const page = await createHandoffNoticeSource({ records: s6b2Backend(captured).records }).readPage(world.humanContext(), {
      workspace: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId }, page: { limit: 50 } });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    expect(page.value.availability).toBe('available');
    expect(page.value.items).toEqual([]);
    expect(page.value.nextCursor).toBeNull();
    expect(page.value.sourceCursor).toMatch(/^c\d+$/);
    const position = await noticePositionOf(s6b2Backend(captured).records, world.humanContext(), operation);
    expect(position).toEqual({ status: 'ready', value: null });
  });
  it('projects a committed notice write\'s position and time and filters by Goal under the same watermark', async () => {
    const { world, operationRef } = await accepted('notice');
    // A3: the published composite's advance port answers the real notice after-write; its cursor is the projection's.
    const port = world.platform.sessionHandoff, advanceHandoff = port.advanceHandoff;
    const writes: Awaited<ReturnType<typeof advanceHandoff>>[] = [];
    port.advanceHandoff = async (...args) => { const result = await advanceHandoff(...args); writes.push(result); return result; };
    const at = '2026-10-25T11:00:00.000Z';
    world.clock.set(at);
    try { expect(await driveArchive(world, operationRef)).toMatchObject({ stage: 'finished' }); }
    finally { port.advanceHandoff = advanceHandoff; }
    const notice = writes.find(result => result.status === 'committed' && result.value.stage === 'notice'
      && result.value.write.phase === 'after');
    if (notice === undefined || notice.status !== 'committed') throw new Error('S6B2: the drive wrote no notice after-write');
    world.clock.set('2026-10-25T11:30:00.000Z');
    const page = await createHandoffNoticeSource({ records: s6b2Backend(captured).records })
      .readPage(world.humanContext(), { workspace: { projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId }, page: { limit: 50 } });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    expect(page.value.items).toHaveLength(1);
    const item = page.value.items[0]!;
    expect(item.position).toEqual({ kind: 'commit', cursor: notice.cursor, itemKey: `handoff:${operationRef.operationId}` });
    expect(item.summary).toContain(at);
    // The handoff notice's subject is the project: the Goal-filtered read answers no item under the same watermark.
    const filtered = await createHandoffNoticeSource({ records: s6b2Backend(captured).records })
      .readPage(world.humanContext(), { workspace: { projectId: S6A_SCOPE.projectId,
        workspaceId: S6A_SCOPE.workspaceId }, goalRef: world.goals.first, page: { limit: 50 } });
    expect(filtered).toMatchObject({ status: 'ready',
      value: { items: [], sourceCursor: page.value.sourceCursor } });
  });
});

describe('OP-F1: a successor\'s later round enters after its first round consumed the brief', () => {
  it.each(['memory', 'sqlite'] as const)('%s: the second round carries no briefRef and starts', async (backend) => {
    const { world } = await scene.open(backend);
    const label = `s6b-f1-${backend}`;
    const source = await world.createSecretary(`${label}-source`);
    // The person's handoff through the real route runs the published Workflow to its end.
    const handoff = (await world.post('secretaries/handoff', { scope: S6A_SCOPE,
      input: { commandId: label, session: source.ref } })).body as ReadResult<{ operation: OperationRef; stage: string }>;
    expect(handoff).toMatchObject({ status: 'ready', value: { stage: 'finished' } });
    if (handoff.status !== 'ready') return;
    const record = (await world.listSessions()).map((card) => card.record).find((candidate) =>
      candidate.provenance.kind === 'handoff' && candidate.provenance.from.sessionId === source.ref.sessionId);
    if (record === undefined) throw new Error('the handoff made no successor');
    const successor: S6ASession = { label: `${label}-successor`, aggregateRef: record.ref,
      ref: { projectId: record.ref.projectId, sessionId: record.ref.sessionId },
      role: structuredClone(record.role), createdAt: record.createdAt };
    // One request to the successor: claimed, prepared, answered by the scripted model and started.
    const round = async (step: string) => {
      const request = await s6aCardsWorkspace(world, S6A_SCOPE).submit({ label: `${label}-${step}`, goalId: null,
        recipient: successor.ref });
      const { prepared, manifest } = await preparedRound(world, request.round, successor, `${label}-${step}`);
      await world.scripted.script(successor, [{ kind: 'text',
        text: '{"schemaVersion":1,"body":"successor answer","ideas":[],"goalCardDrafts":[]}' }]);
      const started = (await world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: `${label}-${step}-start` }))).body;
      return { manifest, started, requests: await world.scripted.requests(successor) };
    };
    // The first round carries the brief and consumes it at entry.
    const first = await round('first');
    expect(first.manifest.request?.briefRef).toEqual(handoff.value.operation);
    expect(first.started).toMatchObject({ status: 'ready' });
    expect(await factsOf(world).readBriefState(world.humanContext(), { session: successor.ref }))
      .toMatchObject({ status: 'ready', value: { state: 'consumed' } });
    // A later round gets no brief, so its entry consumes nothing and the model is called.
    const second = await round('second');
    expect(second.manifest.request?.briefRef).toBeNull();
    expect(second.started).toMatchObject({ status: 'ready' });
    expect(second.requests).toHaveLength(2);
    // The second request carries the first round in its history; only its own new task text must have no brief.
    expect(JSON.stringify(first.requests.at(-1)?.messages.at(-1))).toContain('You are continuing this line');
    expect(JSON.stringify(second.requests.at(-1)?.messages.at(-1))).not.toContain('You are continuing this line');
  });
});
