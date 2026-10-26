import { afterAll, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { adoptS6BPlan, seedS6BArchiveSource } from '../helpers/S6B1-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import {
  s6b2Accept, s6b2Scene, s6b2Workspace, type S6B2Captured, type S6B2WorldValue,
} from '../helpers/S6B2-handoff-scene.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { AG2B_CONSUMER_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { deferred, readQuery, type Deferred } from '../helpers/A2-restart-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { createQueryStageDriver } from '../../src/business/workflow/query-stage-driver.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { SecretaryProfileV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealInMemory(captured,
    await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>()));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6B2-handoff-scene.js')).sealSqlite(captured,
    await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>()));

/** A bounded poll of a public state through the shared bounded poll; the condition is a counted call or a public read, never a sleep. */
const awaitState = async (check: () => boolean | Promise<boolean>): Promise<void> => {
  await waitFor(async () => await check(), held => held, 'the S6B2 condition');
};

const scene = s6b2Scene();
afterAll(() => scene.closeAll());
/** A real subscribed commit that wakes the lifecycle queue; it starts no round and touches no Session. */
const wakeWithGoal = async (world: Parameters<typeof s6b2Accept>[0], goalId: string): Promise<void> => {
  const created = await world.platform.goals.createGoal(world.humanContext(), {
    input: { goalId, workspace: { ...S6A_SCOPE }, objective: goalId },
    meta: { requestId: goalId, expected: [] },
  });
  if (created.status !== 'committed') throw new Error(`S6B2: the wake goal was not created: ${JSON.stringify(created)}`);
};

describe('the per-queue commit subscription', () => {
  it('wakes the lifecycle queue on a PlanProposal commit and leaves the optionless request queue for Session', async () => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    const ws = await s6b2Workspace(opened.world);
    const counts = { lifecycle: 0, request: 0 };
    const readOps = opened.world.platform.listUnfinishedOperations;
    opened.world.platform.listUnfinishedOperations = (...args: Parameters<typeof readOps>) => {
      counts.lifecycle += 1;
      return readOps(...args);
    };
    const open = opened.world.platform.requestRounds.open;
    opened.world.platform.requestRounds.open = (...args: Parameters<typeof open>) => {
      counts.request += 1;
      return open(...args);
    };
    // A Session commit wakes both queues through the real loop, so the baseline is not a sleep.
    await opened.world.createSecretary('wake-base', { at: '2026-10-23T00:00:00.000Z' });
    await awaitState(() => counts.lifecycle > 0 && counts.request > 0);
    const base = { ...counts };
    await adoptS6BPlan(ws, opened.world.goals.first, { label: 'wake', taskIds: ['wake-1'], role: S6A_WORK_ROLE.templateId });
    await awaitState(() => counts.lifecycle > base.lifecycle);
    expect(counts.request).toBe(base.request);
    // A Goal commit and a note commit are subscribed by the lifecycle queue, each read from its real notice.
    const goalBefore = counts.lifecycle;
    const created = await opened.world.platform.goals.createGoal(opened.world.humanContext(), {
      input: { goalId: 'wake-goal', workspace: { ...S6A_SCOPE }, objective: 'the wake goal' },
      meta: { requestId: 'wake-goal', expected: [] },
    });
    expect(created.status).toBe('committed');
    await awaitState(() => counts.lifecycle > goalBefore);
    expect(counts.request).toBe(base.request);
    const noteBefore = counts.lifecycle;
    const written = await opened.world.platform.notes.writeNote(opened.world.humanContext(), {
      commandId: 'wake-note',
      note: understandingNote({ anchor: { kind: 'goal', goalId: opened.world.goals.first.goalId } }),
      expectedPointerRevision: null,
      goalId: opened.world.goals.first.goalId,
    });
    if (written.status === 'rejected') throw new Error(`S6B2: the note write was refused: ${JSON.stringify(written)}`);
    await awaitState(() => counts.lifecycle > noteBefore);
    expect(counts.request).toBe(base.request);
    await opened.world.createSecretary('wake-session', { at: '2026-10-24T00:00:00.000Z' });
    await awaitState(() => counts.request > base.request);
    expect(counts.lifecycle).toBeGreaterThan(base.lifecycle);
  });
});

describe('the Host lifecycle wiring', () => {
  // HR4: one operation's wait or transient failure never stops the next in the same traversal.
  /** A real entered writer on `session`: its model request is held at the gate until the test releases it. */
  const startWriter = async (world: S6B2WorldValue, session: S6ASession) => {
    const refs = await world.occupy(session);
    const { run } = await readQuery(world.ag2b, refs.queryJobRef);
    const prepared = valueOf<PreparedQueryExecution>((await world.post('queries/prepare', plain(S6A_SCOPE, {
      queryRunRef: run.ref, requestId: `s6b2-prepare-${session.label}`,
    }))).body, 'ready', 'the writer preparation');
    const gate = await world.gates.modelRequest(session);
    const started = world.post('queries/start', plain(S6A_SCOPE, { prepared,
      consumerId: AG2B_CONSUMER_ID, requestId: `s6b2-start-${session.label}` })).then(answer => answer.body);
    started.catch(() => undefined);
    await gate.reached;
    return { gate, started, refs };
  };
  it.each([
    { case: 'a real business wait on the first operation', mutate: 'stop-at-first-wait' },
    { case: 'a thrown continue on the first operation', mutate: 'hold-on-failed-item' },
  ])('HR4: $case still continues the second operation', async ({ mutate }) => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    const seedA = await opened.world.createSecretary('hr4-a', { at: '2026-10-26T00:00:00.000Z' });
    const seedB = await opened.world.createSecretary('hr4-b', { at: '2026-10-26T00:00:01.000Z' });
    const owner = opened.world.platform.workflow.sessionHandoff!;
    const realList = opened.world.platform.listUnfinishedOperations;
    /** The A3 barrier: the first traversal reads and keeps the real list, then is held until the release returns it. */
    const entered = deferred<void>();
    const releaseGate = deferred<void>();
    let reads = 0;
    opened.world.platform.listUnfinishedOperations = async (...args: Parameters<typeof realList>) => {
      reads += 1;
      const listed = await realList(...args);
      if (reads === 1) { entered.resolve(); await releaseGate.promise; }
      return listed;
    };
    const read = async (operation: OperationRef) => {
      const record = await opened.world.platform.sessions.getSessionOperation(opened.world.systemContext(), operation);
      if (record.status !== 'ready') throw new Error(`S6B2: the operation is not readable: ${JSON.stringify(record)}`);
      return record.value;
    };
    const writers: Awaited<ReturnType<typeof startWriter>>[] = [];
    let realContinue: typeof owner.continueHandoff | null = null;
    try {
      // The held traversal kept its list before any operation exists; every commit below leaves the pair dirty, so
      // the released pass does nothing and the pass the dirty mark starts next is the measured one.
      await wakeWithGoal(opened.world, 'hr4-wake');
      await entered.promise;
      const opA = await s6b2Accept(opened.world, { commandId: 'hr4-a', source: seedA.ref });
      const opB = await s6b2Accept(opened.world, { commandId: 'hr4-b', source: seedB.ref });
      const listed = await realList(opened.world.systemContext());
      if (listed.status !== 'ready') throw new Error(`S6B2: the operation list is not readable: ${JSON.stringify(listed)}`);
      const ordered = listed.value.filter(entry => entry.operation.operationId === opA.operationId
        || entry.operation.operationId === opB.operationId);
      if (ordered.length !== 2) throw new Error(`S6B2: expected both handoffs, got ${JSON.stringify(listed.value)}`);
      const seedOf: Record<string, S6ASession> = { [opA.operationId]: seedA, [opB.operationId]: seedB };
      // Both sources get a real entered writer; one continue takes each handoff's own fence and parks it at
      // `wait_writer` (running), so the read order after this point is the measured traversal's order.
      const firstEntry = ordered[0]!;
      const secondEntry = ordered[1]!;
      const firstWriter = await startWriter(opened.world, seedOf[firstEntry.operation.operationId]!);
      const secondWriter = await startWriter(opened.world, seedOf[secondEntry.operation.operationId]!);
      writers.push(firstWriter, secondWriter);
      for (const entry of [firstEntry, secondEntry]) {
        await owner.continueHandoff(opened.world.humanContext(), { operation: entry.operation });
      }
      const afterDrive = await realList(opened.world.systemContext());
      if (afterDrive.status !== 'ready') throw new Error(`S6B2: the operation list is not readable: ${JSON.stringify(afterDrive)}`);
      const measuredOrder = afterDrive.value.filter(entry => entry.operation.operationId === opA.operationId
        || entry.operation.operationId === opB.operationId);
      expect(measuredOrder.map(entry => entry.operation.operationId))
        .toEqual([firstEntry.operation.operationId, secondEntry.operation.operationId]);
      const firstBefore = await read(firstEntry.operation);
      const secondBefore = await read(secondEntry.operation);
      realContinue = owner.continueHandoff;
      if (mutate === 'stop-at-first-wait') {
        // The clean source's writer stops; its handoff can go on. The first source's writer stays entered.
        secondWriter.gate.release();
        await secondWriter.started.catch(() => undefined);
        const calls: { operationId: string; reads: number }[] = [];
        owner.continueHandoff = async (ctx, input) => {
          calls.push({ operationId: input.operation.operationId, reads });
          return await realContinue!(ctx, input);
        };
        releaseGate.resolve();
        await awaitState(async () => {
          const firstCall = calls.find(call => call.operationId === firstEntry.operation.operationId);
          const secondCall = calls.find(call => call.operationId === secondEntry.operation.operationId);
          return firstCall !== undefined && secondCall !== undefined && firstCall.reads === secondCall.reads
            && (await read(secondEntry.operation)).revision > secondBefore.revision;
        });
        expect((await read(firstEntry.operation)).revision).toBe(firstBefore.revision);
      } else {
        // Let the first source's writer stop behind the A3 barrier, so the back-off's rerun can finish its handoff.
        firstWriter.gate.release();
        await firstWriter.started.catch(() => undefined);
        await awaitState(async () => (await opened.world.readSession(seedOf[firstEntry.operation.operationId]!)).record.occupancy === null);
        let throwReads: number | null = null;
        let secondReads: number | null = null;
        owner.continueHandoff = async (ctx, input) => {
          if (input.operation.operationId === firstEntry.operation.operationId && throwReads === null) {
            throwReads = reads;
            throw new Error('S6B2: the first operation failed once');
          }
          if (input.operation.operationId === secondEntry.operation.operationId) secondReads = reads;
          return await realContinue!(ctx, input);
        };
        releaseGate.resolve();
        // The dirty mark's pass fails the first operation; nothing commits after it, so only the back-off retries it.
        await awaitState(() => throwReads !== null);
        await awaitState(() => secondReads !== null);
        expect(secondReads).toBe(throwReads);
        await awaitState(async () => (await read(firstEntry.operation)).phase === 'completed');
        // The second operation is still waiting on its writer: the retry came from the back-off, not from its commit.
        expect((await read(secondEntry.operation)).phase).not.toBe('completed');
      }
    } finally {
      opened.world.platform.listUnfinishedOperations = realList;
      if (realContinue !== null) owner.continueHandoff = realContinue;
      releaseGate.resolve();
      for (const writer of writers) { writer.gate.release(); await writer.started.catch(() => undefined); }
      await opened.world.close();
    }
  });

  // HR7: the round-end trigger is retried after the back-off and starts at most one handoff.
  const hostRound = async (
    world: Parameters<typeof s6b2Accept>[0], secretary: S6ASession,
    commandId: string, inputTokens: number,
  ) => {
    const body = JSON.stringify({ schemaVersion: 1, body: commandId, ideas: [], goalCardDrafts: [] });
    await world.scripted.script(secretary, [{ kind: 'text', text: body, usage: usageOf(inputTokens) }]);
    const submitted = await world.submit({ commandId, goalId: null, text: commandId, continues: null, recipient: secretary });
    if (submitted.status !== 'queued') throw new Error(`S6B2: the round was not queued: ${JSON.stringify(submitted)}`);
    await world.waitForRequest(submitted.requestRoot, view => view.rounds[0]?.status === 'ended',
      `the round ${commandId} ends on the Host`);
    return submitted;
  };
  const startedIds = (answers: readonly { status: string; value?: unknown }[]): string[] => answers
    .filter(answer => answer.status === 'ready')
    .map(answer => (answer.value as { operation: OperationRef }).operation.operationId);
  it.each([
    { case: 'a failed basis read', fail: 'basis' as const },
    { case: 'a failed start response', fail: 'start' as const },
  ])('HR7: retries the round-end trigger after $case and starts one handoff', async ({ fail }) => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    const owner = opened.world.platform.workflow.sessionHandoff!;
    const realBasis = opened.world.platform.readSecretaryHandoffBasis;
    const realStart = owner.startHandoff;
    const answers: { status: string; value?: unknown }[] = [];
    let basisFailed = false;
    let startFailed = false;
    const short = await opened.world.createSecretary('hr7-short', { at: '2026-10-26T00:00:00.000Z' });
    const long = await opened.world.createSecretary('hr7-long', { at: '2026-10-26T00:00:01.000Z' });
    // The short line must not start anything: the negative case stays beside the retry.
    opened.world.platform.readSecretaryHandoffBasis = async (ctx, session) => {
      if (fail === 'basis' && !basisFailed && session.sessionId === long.ref.sessionId) {
        basisFailed = true;
        throw new Error('S6B2: the basis read failed once');
      }
      return await realBasis(ctx, session);
    };
    owner.startHandoff = async (ctx, input) => {
      const result = await realStart(ctx, input);
      answers.push(result.status === 'ready' ? { status: 'ready', value: result.value } : { status: result.status });
      if (fail === 'start' && !startFailed) {
        startFailed = true;
        throw new Error('S6B2: the start response was lost once');
      }
      return result;
    };
    try {
      await hostRound(opened.world, short, 'hr7-short-round', 499_999);
      expect(answers).toEqual([]);
      await hostRound(opened.world, long, 'hr7-long-round', 500_000);
      await awaitState(() => startedIds(answers).length > 0);
      if (fail === 'basis') {
        // The failed read threw before the real read: the retry starts the one operation.
        expect(basisFailed).toBe(true);
        expect(startedIds(answers)).toHaveLength(1);
      } else {
        // The real start was committed but its response was lost once; the retry names the same operation.
        expect(startFailed).toBe(true);
        await awaitState(() => startedIds(answers).length >= 2);
        const ids = startedIds(answers);
        expect(ids[0]).toBe(ids[1]);
      }
      const operation = (answers.find(answer => answer.status === 'ready')!.value as { operation: OperationRef }).operation;
      await awaitState(async () => {
        const record = await opened.world.platform.sessions.getSessionOperation(opened.world.systemContext(), operation);
        return record.status === 'ready' && record.value.phase === 'completed';
      });
    } finally {
      opened.world.platform.readSecretaryHandoffBasis = realBasis;
      owner.startHandoff = realStart;
      await opened.world.close();
    }
  });


  // N1: a pending round-end source's already waiting handoff makes phase 1's start a zero-write continue; that
  // must not count as progress, or a transient failure in the same traversal hides the back-off.
  it('N1: a zero-write start of an already waiting handoff does not hide a transient failure', async () => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    const source = await opened.world.createSecretary('n1-source', { at: '2026-10-26T00:00:00.000Z' });
    const other = await opened.world.createSecretary('n1-other', { at: '2026-10-26T00:00:01.000Z' });
    const owner = opened.world.platform.workflow.sessionHandoff!;
    const realList = opened.world.platform.listUnfinishedOperations;
    const realBasis = opened.world.platform.readSecretaryHandoffBasis;
    const realStart = owner.startHandoff;
    const realContinue = owner.continueHandoff;
    const basisHeld = deferred<void>();
    const releaseBasis = deferred<void>();
    let basisHeldOnce = false;
    opened.world.platform.readSecretaryHandoffBasis = async (ctx, session) => {
      if (!basisHeldOnce && session.sessionId === source.ref.sessionId) {
        basisHeldOnce = true;
        basisHeld.resolve();
        await releaseBasis.promise;
      }
      return await realBasis(ctx, session);
    };
    let startFailed = false;
    owner.startHandoff = async (ctx, input) => {
      const result = await realStart(ctx, input);
      if (!startFailed && input.source.sessionId === source.ref.sessionId) {
        startFailed = true;
        throw new Error('S6B2: the start failed once after the real start');
      }
      return result;
    };
    let listCalls = 0;
    let otherOperation: OperationRef | null = null;
    let threw = false;
    owner.continueHandoff = async (ctx, input) => {
      if (otherOperation !== null && input.operation.operationId === otherOperation.operationId
        && listCalls >= 3 && !threw) {
        threw = true;
        throw new Error('S6B2: the other operation failed once');
      }
      return await realContinue(ctx, input);
    };
    opened.world.platform.listUnfinishedOperations = async (...args: Parameters<typeof realList>) => {
      listCalls += 1;
      // The first traversal (the other operation's accept) and the round-end traversal both throw before the real
      // read; the back-off's rerun is the first read that sees the waiting handoff and the other operation together.
      if (listCalls <= 2) throw new Error('S6B2: the operation index is unavailable');
      return await realList(...args);
    };
    let writer: Awaited<ReturnType<typeof startWriter>> | null = null;
    try {
      const otherOperationRef = await s6b2Accept(opened.world, { commandId: 'n1-other', source: other.ref });
      otherOperation = otherOperationRef;
      await awaitState(() => listCalls >= 1);
      // A real Host round records the source; its basis read is held while a real writer enters the source.
      await hostRound(opened.world, source, 'n1-round', 500_000);
      await basisHeld.promise;
      writer = await startWriter(opened.world, source);
      releaseBasis.resolve();
      // The first traversal's start throws after the real start and its operation read throws, so it backs off with
      // the source still pending and its handoff parked at `wait_writer`.
      await awaitState(() => startFailed && listCalls >= 2);
      // The back-off's traversal counts no phase-1 progress; the other operation fails once there and the next
      // back-off finishes it. No commit is made after that failure.
      await awaitState(async () => {
        const record = await opened.world.platform.sessions.getSessionOperation(
          opened.world.systemContext(), otherOperationRef);
        return record.status === 'ready' && record.value.phase === 'completed';
      });
      expect(threw).toBe(true);
    } finally {
      opened.world.platform.listUnfinishedOperations = realList;
      opened.world.platform.readSecretaryHandoffBasis = realBasis;
      owner.startHandoff = realStart;
      owner.continueHandoff = realContinue;
      releaseBasis.resolve();
      writer?.gate.release();
      await writer?.started.catch(() => undefined);
      await opened.world.close();
    }
  });

  it('continues a handoff and a manual archive in one lifecycle pass, each by its own entry', async () => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    const ws = await s6b2Workspace(opened.world);
    const seeded = await seedS6BArchiveSource(ws, 'kinds-archive');
    const source = await opened.world.createSecretary('kinds-handoff', { at: '2026-10-24T00:00:00.000Z' });
    const target = await opened.world.createSecretary('kinds-target', { at: '2026-10-24T00:00:01.000Z' });
    const handoff = await s6b2Accept(opened.world, { commandId: 'kinds-handoff', source: source.ref, target: target.ref });
    const accepted = await opened.world.platform.sessionArchive.acceptArchive(opened.world.humanContext(), {
      commandId: 'kinds-archive', source: seeded.source,
      choices: seeded.requests.map(request => ({ requestRoot: request.requestRoot, to: seeded.other })),
    });
    if (accepted.status !== 'committed') throw new Error(`S6B2: the archive accept failed: ${JSON.stringify(accepted)}`);
    const archive = accepted.value.operation;
    const read = async (operation: typeof handoff) => {
      const record = await opened.world.platform.sessions.getSessionOperation(opened.world.systemContext(), operation);
      if (record.status !== 'ready') throw new Error(`S6B2: the operation is not readable: ${JSON.stringify(record)}`);
      return record.value;
    };
    const archiveBefore = (await read(archive)).revision;
    // Each arm's own entry: the handoff only through `continueHandoff`, the manual archive only through
    // `manualArchive`, and each operation only through its own arm.
    const continued: string[] = [];
    const archived: string[] = [];
    const owner = opened.world.platform.workflow.sessionHandoff!;
    const ownContinue = owner.continueHandoff; const ownArchive = owner.manualArchive;
    owner.continueHandoff = async (ctx, input) => { continued.push(input.operation.operationId); return await ownContinue(ctx, input); };
    owner.manualArchive = async (ctx, input) => { archived.push(input.operation.operationId); return await ownArchive(ctx, input); };
    await wakeWithGoal(opened.world, 'kinds-wake');
    await awaitState(async () => (await read(handoff)).phase === 'completed');
    await awaitState(async () => (await read(archive)).revision > archiveBefore);
    expect(continued).toContain(handoff.operationId);
    expect(continued).not.toContain(archive.operationId);
    expect(archived).toContain(archive.operationId);
    expect(archived).not.toContain(handoff.operationId);
  });

  it('stores a stable successor refusal once and still calls the child on a later subscribed commit', async () => {
    // The cap counts the lines this admission does not replace: the non-source secretary already fills it, so the real
    // successor-capacity child refuses through the published composite (no fault wrapper); the first line is the source.
    const opened = await scene.open('memory', { secretaryOpenCap: 1, requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    const first = await opened.world.createSecretary('hr9-first', { at: '2026-10-26T00:00:00.000Z' });
    const second = await opened.world.createSecretary('hr9-second', { at: '2026-10-26T00:00:01.000Z' });

    const owner = opened.world.platform.workflow.sessionHandoff!;
    const realContinue = owner.continueHandoff;
    let waiter: Deferred<Awaited<ReturnType<typeof realContinue>>> | null = null;
    // A3 over the published entry: count, record the real answer, and hold an excess call so a mutant that keeps
    // writing the same refusal cannot spin the worker forever. The cap is lifted once the stable state is read.
    let calls = 0; let gateAt: number | null = 5; let held = false;
    let gate = deferred<void>();
    const releaseGate = (): void => {
      const release = gate;
      held = false;
      gate = deferred<void>();
      release.resolve();
    };
    owner.continueHandoff = async (ctx, input) => {
      const result = await realContinue(ctx, input);
      if (waiter !== null) { const pending = waiter; waiter = null; pending.resolve(result); }
      calls += 1;
      if (gateAt !== null && calls > gateAt) {
        held = true;
        // The loop's own abort (Host close) releases a held call, so a mutant's extra writes cannot hang cleanup.
        const stopped = new Promise<void>(resolve => {
          if (ctx.signal.aborted) { resolve(); return; }
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        await Promise.race([gate.promise, stopped]);
      }
      return result;
    };
    try {
      const handoff = await s6b2Accept(opened.world, { commandId: 'hr9-handoff', source: first.ref });
      const readHandoff = async (): Promise<SessionOperationRecordOf<HandoffActionV1>> => {
        const record = await opened.world.platform.sessions.getSessionOperation(opened.world.systemContext(), handoff);
        if (record.status !== 'ready' || record.value.action.kind !== 'handoff') {
          throw new Error(`S6B2: the handoff operation is not readable: ${JSON.stringify(record)}`);
        }
        return record.value as SessionOperationRecordOf<HandoffActionV1>;
      };
      await awaitState(async () => (await readHandoff()).action.progress.lastRefusal !== null);
      const refused = await readHandoff();
      const stable = refused.action.progress.lastRefusal;
      if (stable === null) throw new Error('S6B2: the successor refusal was not recorded');
      expect(stable).toMatchObject({ stage: 'successor', code: 'busy' });
      const revision = refused.revision;

      // A real subscribed commit (the Plan proposal) wakes the lifecycle queue again over the same facts. The
      // child is called and answers its own refusal, but the identical mark is not written a second time.
      const next = deferred<Awaited<ReturnType<typeof realContinue>>>();
      waiter = next;
      if (held) releaseGate();
      else await wakeWithGoal(opened.world, 'hr9-wake');
      const answered = await next.promise;
      expect(answered).toMatchObject({ status: 'rejected', code: 'busy' });
      const afterWake = await readHandoff();
      expect(afterWake.revision).toBe(revision);
      expect(afterWake.action.progress.lastRefusal).toMatchObject({
        stage: stable.stage, code: stable.code, reason: stable.reason,
      });
      gateAt = null;

      // Free the counted line through the public manual archive; its Session commit is the genuine subscription
      // the lifecycle queue acts on, and the child now creates the successor.
      await opened.world.archive(second);
      await awaitState(async () => (await readHandoff()).phase === 'completed');
      const done = await readHandoff();
      expect(done.phase).toBe('completed');
      expect(done.action.progress.assignments.map(entry => entry.successor).filter(successor => successor !== null))
        .toHaveLength(1);
    } finally {
      const closing = opened.world.close();
      await closing;
    }
  });

  // HR10: Host close waits for a running traversal and starts no later one.
  it('HR10: close waits for the running traversal and starts no further one', async () => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    const realList = opened.world.platform.listUnfinishedOperations;
    const realPlatformClose = opened.world.platform.close;
    // The Host closes the loop and the lifecycle queue before the platform; reaching the platform while the
    // traversal is still held would be the close that skips running lifecycle work.
    let passCompleted = false;
    opened.world.platform.close = async () => {
      if (!passCompleted) throw new Error('S6B2: Host close reached the platform with the lifecycle traversal running');
      return await realPlatformClose();
    };
    const entered = deferred<void>();
    const held = deferred<void>();
    const aborted = deferred<void>();
    let reads = 0;
    let laterRead = false;
    opened.world.platform.listUnfinishedOperations = async (...args: Parameters<typeof realList>) => {
      reads += 1;
      if (reads > 1) laterRead = true;
      if (reads === 1) {
        const signal = args[0].signal;
        if (signal.aborted) aborted.resolve();
        else signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        entered.resolve();
        await held.promise;
      }
      const result = await realList(...args);
      passCompleted = true;
      return result;
    };
    let hostClosed = false;
    let worldClosed = false;
    try {
      await opened.world.createSecretary('hr10-first', { at: '2026-10-26T00:00:00.000Z' });
      await entered.promise;
      // A real owner commit while the traversal runs marks the pair dirty; close must not run it.
      await wakeWithGoal(opened.world, 'hr10-goal');
      const closing = opened.world.host.close().then(() => { hostClosed = true; });
      // Close aborts the signal every pass receives; the held traversal then finishes before close resolves.
      await aborted.promise;
      expect(hostClosed).toBe(false);
      held.resolve();
      await closing;
      expect(hostClosed).toBe(true);
      // The dirty wake marked while the pass ran must not start a second traversal.
      expect(laterRead).toBe(false);
      await opened.world.close();
      worldClosed = true;
    } finally {
      if (!worldClosed) opened.world.platform.listUnfinishedOperations = realList;
      held.resolve();
      if (!worldClosed) await opened.world.close().catch(() => undefined);
    }
  });

  it('keeps a failed operation read pending and re-reads it after the existing back-off', async () => {
    const opened = await scene.open('memory', { requestDriver: 'on' });
    await s6b2Workspace(opened.world);
    let reads = 0;
    const real = opened.world.platform.listUnfinishedOperations;
    // A2: the first two reads throw before the real read; the counted calls are the only state the row keeps.
    opened.world.platform.listUnfinishedOperations = async (...args: Parameters<typeof real>) => {
      reads += 1;
      if (reads <= 2) throw new Error('S6B2: the operation index is unavailable');
      return await real(...args);
    };
    // The create commits two notices; a third read can only be the loop's own back-off retry, never a new commit.
    await opened.world.createSecretary('fail-wake', { at: '2026-10-24T00:00:00.000Z' });
    await awaitState(() => reads >= 3);
  });
});

describe('the stage driver on a fenced Session', () => {
  it('answers blocked on a change for a held fence and claims nothing, and abandons an attempt claimed earlier', async () => {
    const opened = await scene.open('memory');
    const ws = await s6b2Workspace(opened.world);
    const seeded = await seedS6BArchiveSource(ws, 'fence');
    const sourceRef = { projectId: seeded.source.projectId, sessionId: seeded.source.sessionId };
    const card = await opened.world.readSession(seeded.source);
    const source: S6ASession = { label: 'fence', ref: sourceRef, aggregateRef: card.record.ref,
      role: card.record.role, createdAt: card.record.createdAt };
    const targetRef = { projectId: seeded.other.projectId, sessionId: seeded.other.sessionId };
    const writer = seeded.requests[0];
    const pending = seeded.requests[1];
    // The writer's claim occupies the source, so the handoff's fence take stops at `wait_writer` and the fence stays held.
    valueOf(await claimWithSecretaryProfile(opened.world, writer.round, source, 's6b2-fence-claim'),
      'committed', 'the writer claim');
    const before = (await readQuery(opened.world.ag2b, writer.round)).run;
    const operation = await s6b2Accept(opened.world, { commandId: 's6b2-fence-handoff', source: sourceRef,
      target: targetRef, trigger: 'manual' });
    const owner = opened.world.platform.workflow.sessionHandoff;
    let held = false;
    for (let step = 0; step < 8 && !held; step += 1) {
      await owner.continueHandoff(opened.world.humanContext(), { operation });
      const record = await opened.world.platform.sessions.getSessionOperation(opened.world.humanContext(), operation);
      held = record.status === 'ready' && record.value.action.kind === 'handoff'
        && record.value.action.progress.fence?.state === 'held';
    }
    expect(held).toBe(true);
    const profile = await opened.world.platform.secretaryProfiles.forSession({
      workspace: { ...S6A_SCOPE }, sessionRole: card.record.role }) as SecretaryProfileV1 | null;
    const driver = createQueryStageDriver({
      queries: opened.world.platform.queries, runtime: opened.world.platform.runtime,
      facts: opened.world.platform.requestFacts, fence: opened.world.platform.readHandoffFence,
      consumerId: AG2B_CONSUMER_ID,
    });
    // A claimed attempt is saved work: it goes on to prepare/start, and the held fence makes the entry abandon it. The
    // round keeps a new pending attempt and the claim's occupancy is released.
    expect(await driver.advance(opened.world.systemContext(),
      { queryJobRef: writer.round, expectedRunRef: before.ref, profile })).toEqual({ status: 'progressed' });
    const after = await readQuery(opened.world.ag2b, writer.round);
    expect(after.run.ref).not.toEqual(before.ref);
    expect(after.run.run.status).toBe('pending');
    expect(after.run.run.executionState).toBeUndefined();
    expect(await opened.world.platform.runtime.countQueryActivity!(opened.world.systemContext(),
      { queryRunRef: before.ref })).toEqual({ status: 'ready', value: { kind: 'not_entered' } });
    // The released occupancy admits a plain Query on the source; the held fence settles it `not_entered`.
    const plainQuery = await opened.world.occupy(source);
    const plainPrepared = valueOf<PreparedQueryExecution>((await opened.world.post('queries/prepare', plain(S6A_SCOPE, {
      queryRunRef: plainQuery.queryRunRef, requestId: 's6b2-fence-plain-prepare',
    }))).body, 'ready', 'the plain preparation');
    await opened.world.post('queries/start', plain(S6A_SCOPE, { prepared: plainPrepared,
      consumerId: AG2B_CONSUMER_ID, requestId: 's6b2-fence-plain-start' }));
    expect((await readQuery(opened.world.ag2b, plainQuery.queryJobRef)).run.run)
      .toMatchObject({ status: 'closed', outcome: 'not_entered' });
    // The other round is still unclaimed: its new claim at the same held fence is blocked and claims nothing.
    const pendingRun = (await readQuery(opened.world.ag2b, pending.round)).run;
    const blocked = await driver.advance(opened.world.systemContext(),
      { queryJobRef: pending.round, expectedRunRef: pendingRun.ref, profile });
    expect(blocked).toMatchObject({ status: 'blocked', retry: 'on_change' });
    expect(blocked.status === 'blocked' ? blocked.reason : '').toContain('held by handoff operation');
    expect((await readQuery(opened.world.ag2b, pending.round)).run.run.executionState).toBeUndefined();
  });
});

function valueOf<T>(body: unknown, status: 'ready' | 'committed' | 'completed' | 'queued', what: string): T {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  if (record['status'] !== status) throw new Error(`S6B2: ${what} is not ${status}: ${JSON.stringify(body)}`);
  return record['value'] as T;
}
