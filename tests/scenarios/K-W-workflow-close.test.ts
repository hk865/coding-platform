/**
 * Slice K part A, group W: the Workflow `close_open_turn` step (KE3/KE4; spec
 * §5.2 rows KA-07, KA-08, KA-09 flow half, KA-11(a)(b)(c), KA-12, KA-15;
 * L4, L6, L7, L9, §9 M1/M2).
 *
 * Every case starts from one paused-interrupted Work Run whose Kernel Turn is
 * still open (`kernel_turn_open`) and drives the real Host/Workflow. The Kernel
 * store is the injected system boundary: the `closeOpenTurn` switch of M2 is the
 * same `vi.mock` pattern as tests/scenarios/A8-host-restart-paused.test.ts. The
 * same seam injects the KA-15 concurrent revision change and the KA-11(a)/(b)
 * "close committed, next probe not ready" window. Scripted model replies only;
 * no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import type { ControlIntentSnapshotV1, SubmittedControl } from '../../src/contracts/control-intent.js';
import { continuationBriefMarker } from '../../src/contracts/continuation-brief.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  AG2B_SCOPE, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  answer, moveKernelAside, post, publicDirectory, readExecution, restoreKernel, selectWork, tempDir, workRow,
  writeAutomationSettings, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import { startKLegacyReaderHost } from '../helpers/K-legacy-reader-support.js';
import { cleanupScenarios, type InvariantTarget } from './harness.js';
import {
  driveChecked, operatorRequeue, pausedRunOnClosedHostChecked, readCall, requiredBriefOf, textReply,
} from './support/common.js';

afterEach(cleanupScenarios);

// Slice K (L4 step 5, L8, M2): switching the Kernel's `closeOpenTurn` off makes
// the Runtime answer `unsupported`; the Workflow then takes the fallback. The
// same seam (the Kernel store boundary) injects:
// - KA-15: one concurrent append (a legal `run.resumed` event) lands between the
//   Runtime's probe read and the Kernel close's own append, so the close collides
//   with a moved revision and must answer the retryable `conflict`;
// - KA-11(a)/(b): the Kernel store's very next read after the committed close
//   fails once, so the health probe is not ready and is not written;
// - KA-12: the Kernel answers `mismatch` once (another Run at the head), a
//   definite failure that must take the new-Session fallback.
const kernelClosure = vi.hoisted(() => ({ supported: true, concurrentAppend: false, mismatchOnce: false,
  afterClose: null as null | (() => Promise<void>) }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual['closeOpenTurn'];
  const parseEvent = (actual['agentEventSchema'] as { parse: (input: unknown) => { meta: { eventId: string } } }).parse;
  // KA-15: append one valid Kernel event that only moves the revision and keeps the
  // Turn open, exactly what a competing caller's append does. `run.resumed` is the
  // non-terminal event a paused Turn accepts.
  const appendConcurrentRevision = async (store: KernelStoreBoundary, sessionId: string, expectedRevision: number): Promise<void> => {
    const records: KernelBoundaryRecord[] = [];
    let position = 0;
    for (;;) {
      const page = await store.read(sessionId, position, 256, { signal: new AbortController().signal });
      records.push(...page.records);
      const last = page.records.at(-1);
      if (page.nextPosition === null || last === undefined) break;
      position = last.position;
    }
    const lastEvent = [...records].reverse().find(record => record.recordType === 'agent.event');
    if (lastEvent === undefined) throw new Error('KA-15 needs an open Kernel Turn to perturb');
    const previous = lastEvent.payload.event;
    const at = '2026-10-14T00:20:00.000Z';
    const event = parseEvent({ type: 'run.resumed',
      meta: { schemaVersion: 1, eventId: 'kw-ka15-concurrent-resume', runId: previous.meta.runId,
        turnId: previous.meta.turnId, sequence: previous.meta.sequence + 1, occurredAt: at,
        elapsedMs: previous.meta.elapsedMs },
      payload: { resumedBy: 'app' } });
    await store.append(sessionId, expectedRevision, [{ recordId: `agent-event:${event.meta.eventId}`,
      recordType: 'agent.event', schemaVersion: 1, recordedAt: at, payload: { event } }],
    { signal: new AbortController().signal });
  };
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => {
      if (!kernelClosure.supported || real === undefined) return undefined;
      if (!kernelClosure.concurrentAppend && !kernelClosure.mismatchOnce && kernelClosure.afterClose === null) return real;
      const call = real as (store: KernelStoreBoundary, input: { sessionId: string; expectedRevision: number }) => Promise<unknown>;
      return async (store: KernelStoreBoundary, input: { sessionId: string; expectedRevision: number }) => {
        if (kernelClosure.mismatchOnce) {
          // KA-12: another Run owns the Kernel head; this is the Kernel's `mismatch`.
          kernelClosure.mismatchOnce = false;
          return { status: 'mismatch', activeRunId: 'kw-ka12-other-run' };
        }
        const after = kernelClosure.afterClose;
        kernelClosure.afterClose = null;
        let spy: { mockRestore(): void } | undefined;
        if (kernelClosure.concurrentAppend) {
          kernelClosure.concurrentAppend = false;
          const originalAppend = store.append.bind(store);
          let injected = false;
          spy = vi.spyOn(store, 'append').mockImplementation(async (...args: unknown[]) => {
            if (!injected) {
              injected = true;
              await appendConcurrentRevision(store, input.sessionId, input.expectedRevision);
            }
            return originalAppend(...args as Parameters<KernelStoreBoundary['append']>);
          });
        }
        try {
          const result = await call(store, input);
          if (after !== null) await after();
          return result;
        } finally {
          spy?.mockRestore();
        }
      };
    } });
});
afterEach(() => { kernelClosure.supported = true; kernelClosure.concurrentAppend = false; kernelClosure.mismatchOnce = false; kernelClosure.afterClose = null; });

/** The narrow public Kernel store surface the boundary seam above reads and appends through. */
type KernelBoundaryRecord = { recordType: string; position: number; payload: { event: { meta: { runId: string; turnId: string;
  sequence: number; elapsedMs: number } } } };
type KernelStoreBoundary = {
  read(sessionId: string, afterPosition: number, limit: number, options: { signal: AbortSignal }):
    Promise<{ records: KernelBoundaryRecord[]; nextPosition: number | null }>;
  append(sessionId: string, expectedRevision: number, drafts: readonly unknown[], options: { signal: AbortSignal }):
    Promise<{ revision: number; positions: number[] }>;
};

/**
 * KA-11(a)/(b): the Kernel store's *very next* read fails once, exactly the
 * "the append committed, then the following probe read is not ready" window of
 * L6/L7. Every later read is the real one, so the retry (or the start-up
 * reconcile) recovers without any test-side restoration.
 */
function failNextKernelReadOnce(): void {
  const original = SqliteStores.prototype.get;
  let fired = false;
  const spy = vi.spyOn(SqliteStores.prototype, 'get').mockImplementation(async function (this: SqliteStores, ...args) {
    if (!fired) {
      fired = true;
      spy.mockRestore();
      throw new Error('KA-11: the next Kernel store read fails once');
    }
    return original.apply(this, args as Parameters<SqliteStores['get']>);
  });
}

type Paused = { root: string; database: string; publicDir: string; inv: InvariantTarget; runRef: RunRef; s1: SessionRef };

/** The paused-interrupted Work Run in S1 on a stale-locked Host, ready for the next start. */
async function pausedInterrupted(prefix: string): Promise<Paused> {
  const root = await tempDir(`${prefix}-ws-`);
  const database = await tempDir(`${prefix}-db-`);
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  const s1: SessionRef = { projectId: oldSession.ref.projectId, sessionId: oldSession.ref.sessionId };
  return { root, database, publicDir, inv, runRef, s1 };
}

/**
 * The same line, but the interrupted Turn ACCEPTED one message at its second
 * model boundary (KA-08 second clause): two read groups run, the message is
 * supplied before the second one, and the person's pause lands at the safe point
 * after it. On the continuation it must not be re-delivered as new input; it
 * appears only in the continuation brief.
 */
async function pausedInterruptedWithAcceptedMessage(prefix: string): Promise<Paused & { acceptedText: string }> {
  const root = await tempDir(`${prefix}-ws-`);
  const database = await tempDir(`${prefix}-db-`);
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const acceptedText = `${prefix}: a message the interrupted Turn already accepted`;
  let first: AG2bHost | undefined;
  let pauseSubmitted: WriteResult<SubmittedControl> | undefined;
  first = await startAG2bHost(publicDir, { root, database,
    replies: [readCall(`${prefix}-group1`), readCall(`${prefix}-group2`), textReply(`${prefix}: never reached`)],
    beforeReply: async (_request, index) => {
      if (first === undefined) return;
      const row = await workRow(first);
      if (row.execution === null) throw new Error('the work Task must have a Run while its Turn runs');
      if (index === 0) {
        const session = (await readExecution(first, row.execution)).session;
        const sent = await post<WriteResult<SessionMessage>>(first, 'messages/send', graphWrite(AG2B_SCOPE,
          { recipient: { projectId: session.ref.projectId, sessionId: session.ref.sessionId }, text: acceptedText },
          `${prefix}-accepted`, []));
        expect(sent, 'the accepted message commits while the Turn is open').toMatchObject({ status: 'committed' });
      } else if (index === 1) {
        const run = (await readExecution(first, row.execution)).run;
        pauseSubmitted = await post<WriteResult<SubmittedControl>>(first, 'controls/submit', graphWrite(AG2B_SCOPE,
          { runRef: row.execution, kind: 'pause', reason: `${prefix}: pause after the accepted message` },
          `${prefix}-pause`, [{ ref: row.execution, revision: run.revision }]));
      }
    } });
  let runRef: RunRef;
  let s1: SessionRef;
  try {
    await seedAG2bWorkGraph(first);
    const driven = await driveChecked(first, inv, selectWork(`${prefix}-1`));
    expect(driven.last, 'the paused Turn waits at its safe point').toMatchObject({ state: 'waiting', next: null });
    expect(first.scripted.calls(), 'the message was accepted at the second model boundary before the pause').toBe(2);
    if (pauseSubmitted?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pauseSubmitted)}`);
    const row = await workRow(first);
    if (row.execution === null) throw new Error('the work Task must select its Run');
    runRef = row.execution;
    const paused = await readExecution(first, runRef);
    s1 = { projectId: paused.session.ref.projectId, sessionId: paused.session.ref.sessionId };
    expect(paused.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: runRef.runId } });
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  return { root, database, publicDir, inv, runRef, s1, acceptedText };
}

/** The person's `继续` (TASK-27) for the paused Run; must commit. */
async function continueRun(host: AG2bHost, runRef: RunRef, requestId: string): Promise<Extract<TaskRequeueOutcomeV1, { kind: 'requeued' }>['requeue']> {
  const continued = await operatorRequeue(host, runRef, requestId, '继续');
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') {
    throw new Error(`continue: ${JSON.stringify(continued)}`);
  }
  return continued.value.requeue;
}

function receiptKinds(driven: Awaited<ReturnType<typeof driveChecked>>): string[] {
  return driven.steps.flatMap(step => step.receipt === null ? [] : [step.receipt.kind]);
}

/** The Runtime result of the drive's `close_open_turn` receipt, if the step ran. */
function closeResult(driven: Awaited<ReturnType<typeof driveChecked>>): unknown {
  return driven.steps.flatMap(step => step.receipt?.kind === 'close_open_turn' ? [step.receipt.result] : [])[0];
}

it('KA-09 flow half / KA-11 (c) (KE3, L6/L7): the closure is idempotent — on the next advancement after a restart the Session is available, so no close step is produced, no new Session is created, and the requeue is claimed in place', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka11');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-11 continued')] });
  let third: AG2bHost | undefined;
  try {
    await continueRun(second, runRef, 'kw-ka11-continue');
    const firstDrive = await driveChecked(second, inv, selectWork('kw-ka11-a', true), { stopBefore: 'claim_task' });
    expect(firstDrive.next?.kind === 'perform' ? firstDrive.next.operation.kind : null, 'the drive stops before the claim commits').toBe('claim_task');
    expect(closeResult(firstDrive))
      .toMatchObject({ status: 'closed', health: 'available' });
    expect((await readExecution(second, runRef)).session).toMatchObject({ health: 'available', healthConclusion: null });
    await second.host.close();
    await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
    third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-11 after the restart')] });
    const driven = await driveChecked(third, inv, selectWork('kw-ka11-b', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the restart re-claim').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds).not.toContain('close_open_turn');
    expect(kinds).not.toContain('create_session');
    expect(kinds).toContain('claim_task');
    const row = await workRow(third);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(third, row.execution)).session.ref.sessionId).toBe(s1.sessionId);
  } finally {
    if (third !== undefined) await third.host.close();
    else await second.host.close();
  }
}, 180_000);

it('KA-11 (a) (KE3, L6/L7): after the close append commits exactly the next Kernel store read fails once; the advancement waits, the line is not archived, and the next advancement completes the recovery in the original Session', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka11a');
  kernelClosure.afterClose = async () => { failNextKernelReadOnce(); };
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-11a continued')] });
  try {
    await continueRun(second, runRef, 'kw-ka11a-continue');
    const firstDrive = await driveChecked(second, inv, selectWork('kw-ka11a-1', true), { stopBefore: 'start' });
    expect(closeResult(firstDrive), 'the append committed but the health probe was not ready')
      .toMatchObject({ status: 'closed', health: 'unavailable' });
    expect(firstDrive.last, 'a not-ready probe is retryable: this advancement waits').toMatchObject({ state: 'waiting', next: null });
    expect(receiptKinds(firstDrive)).not.toContain('create_session');
    const held = await readExecution(second, runRef);
    expect(held.session).toMatchObject({ lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    const recovered = await driveChecked(second, inv, selectWork('kw-ka11a-2', true), { stopBefore: 'start' });
    expect(recovered.next?.kind === 'perform' ? recovered.next.operation.kind : null, 'the drive stops at the recovered continuation').toBe('start');
    expect(closeResult(recovered), 'the retry hits the Kernel already_closed and restores the health')
      .toMatchObject({ status: 'already_closed', health: 'available' });
    expect(receiptKinds(recovered)).not.toContain('create_session');
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(second, row.execution)).session.ref.sessionId).toBe(s1.sessionId);
  } finally {
    await second.host.close();
  }
}, 240_000);

it('KA-11 (b) (KE3, L6/L7): the same one-shot read failure, then a Host restart (no test-side repair); the start-up reconcile SES-13 makes the Session available and the requeue is claimed in place', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka11b');
  kernelClosure.afterClose = async () => { failNextKernelReadOnce(); };
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-11b first host')] });
  try {
    await continueRun(second, runRef, 'kw-ka11b-continue');
    const firstDrive = await driveChecked(second, inv, selectWork('kw-ka11b-1', true), { stopBefore: 'start' });
    expect(closeResult(firstDrive), 'the append committed but the health probe was not ready')
      .toMatchObject({ status: 'closed', health: 'unavailable' });
    expect(firstDrive.last, 'the not-ready probe waits here too').toMatchObject({ state: 'waiting', next: null });
  } finally {
    await second.host.close();
  }
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-11b after the restart')] });
  try {
    expect((await readExecution(third, runRef)).session, 'the start-up reconcile step 1 runs SES-13')
      .toMatchObject({ lifecycle: 'active', health: 'available', healthConclusion: null });
    const recovered = await driveChecked(third, inv, selectWork('kw-ka11b-2', true), { stopBefore: 'start' });
    expect(recovered.next?.kind === 'perform' ? recovered.next.operation.kind : null, 'the drive stops at the recovered continuation').toBe('start');
    expect(receiptKinds(recovered)).not.toContain('close_open_turn');
    expect(receiptKinds(recovered)).not.toContain('create_session');
    const row = await workRow(third);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(third, row.execution)).session.ref.sessionId).toBe(s1.sessionId);
  } finally {
    await third.host.close();
  }
}, 240_000);

it('KA-15 (KE3, L7): a real concurrent append at the Kernel store boundary moves the revision, so the close answers conflict; the advancement waits without a fallback or archive, and a later advancement closes and claims in the original Session', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka15');
  // The competing caller's append lands between the close's own reads and its append.
  kernelClosure.concurrentAppend = true;
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-15 continued in the same Session')] });
  try {
    await continueRun(second, runRef, 'kw-ka15-continue');
    const conflicted = await driveChecked(second, inv, selectWork('kw-ka15-a', true), { stopBefore: 'start' });
    expect(closeResult(conflicted), 'the concurrent append moved the Kernel Session revision under the close')
      .toMatchObject({ status: 'conflict' });
    expect(conflicted.last, 'a retryable close waits on this advancement').toMatchObject({ state: 'waiting', next: null });
    expect(receiptKinds(conflicted), 'a conflict is retryable, never the new-Session fallback').not.toContain('create_session');
    expect((await readExecution(second, runRef)).session, 'the line is left active and unavailable')
      .toMatchObject({ lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    const recovered = await driveChecked(second, inv, selectWork('kw-ka15-b', true), { stopBefore: 'start' });
    expect(recovered.next?.kind === 'perform' ? recovered.next.operation.kind : null, 'the drive stops at the recovered continuation').toBe('start');
    expect(closeResult(recovered), 'the retry closes the Turn and restores the health')
      .toMatchObject({ status: 'closed', health: 'available' });
    expect(receiptKinds(recovered)).not.toContain('create_session');
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(second, row.execution)).session.ref.sessionId).toBe(s1.sessionId);
  } finally {
    await second.host.close();
  }
}, 240_000);

it('KA-12 (KE4, L8, M2): when the Kernel cannot close the Turn the Runtime answers unsupported (a definite failure), so the Workflow falls back to a new Session and never uses the retired one', async () => {
  // M2: the Kernel cannot close; the Runtime answers `unsupported`, a definite failure.
  kernelClosure.supported = false;
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka12');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-12 continued in a new Session')] });
  try {
    await continueRun(second, runRef, 'kw-ka12-continue');
    const driven = await driveChecked(second, inv, selectWork('kw-ka12', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the fallback successor start').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds).toContain('close_open_turn');
    expect(closeResult(driven))
      .toMatchObject({ status: 'unsupported' });
    expect(kinds).toContain('create_session');
    expect(kinds, 'the definite failure hands over to the fallback successor').toContain('transfer_responsibility');
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    const next = await readExecution(second, row.execution);
    expect(next.session.ref.sessionId).not.toBe(s1.sessionId);
  } finally {
    await second.host.close();
  }
}, 180_000);

it('KA-12 (KE4, L8): an unreadable Kernel store is a definite failure; the Workflow falls back to a new Session, hands the responsibility over, and the original history honestly refuses the read while the store is gone', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka12u');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-12 unreadable continued in a new Session')] });
  let aside = '';
  try {
    await continueRun(second, runRef, 'kw-ka12u-continue');
    // The reconcile already proved the Session `kernel_turn_open`; the store then
    // disappears, so the close's own storage step answers `unreadable`.
    aside = await moveKernelAside(database);
    const driven = await driveChecked(second, inv, selectWork('kw-ka12u', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the fallback successor start').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds).toContain('close_open_turn');
    expect(closeResult(driven), 'the mapped Kernel store file is missing').toMatchObject({ status: 'unreadable' });
    expect(kinds).toContain('create_session');
    expect(kinds).toContain('transfer_responsibility');
    // LD-4: the public history read of the retired predecessor is honest, not empty.
    const history = await answer(second, 'sessions/history', plain(AG2B_SCOPE,
      { sessionRef: s1, afterCursor: null, throughCursor: null, limit: 10 }));
    expect(history['status'], 'the unreadable Kernel history is refused, never fabricated').toBe('rejected');
    expect(history['value'], 'a refused history read carries no records').toBeUndefined();
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(second, row.execution)).session.ref.sessionId).not.toBe(s1.sessionId);
    const archived = await post<{ status: string; value: { record: { lifecycle: string } } }>(
      second, 'sessions/read', plain(AG2B_SCOPE, s1));
    expect(archived.status).toBe('ready');
    expect(archived.value.record, 'the unreadable-store fallback still archives the predecessor Session')
      .toMatchObject({ lifecycle: 'archived' });
  } finally {
    if (aside !== '') await restoreKernel(database, aside);
    await second.host.close();
  }
}, 180_000);

it('KA-12 (KE4, L8): another Run at the Kernel head is a definite failure; the Workflow falls back to a new Session and hands over, while the readable store keeps the predecessor history available', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka12m');
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-12 mismatch continued in a new Session')] });
  try {
    await continueRun(second, runRef, 'kw-ka12m-continue');
    // The Kernel head names another Run: the boundary answers `mismatch`.
    kernelClosure.mismatchOnce = true;
    const driven = await driveChecked(second, inv, selectWork('kw-ka12m', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the fallback successor start').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds).toContain('close_open_turn');
    expect(closeResult(driven), 'the Kernel head names another Run').toMatchObject({ status: 'mismatch' });
    expect(kinds).toContain('create_session');
    expect(kinds).toContain('transfer_responsibility');
    // The store is still readable: the retired predecessor's original records stay readable.
    const history = await answer(second, 'sessions/history', plain(AG2B_SCOPE,
      { sessionRef: s1, afterCursor: null, throughCursor: null, limit: 10 }));
    expect(history, 'a readable store keeps the original history readable').toMatchObject({ status: 'ready' });
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(second, row.execution)).session.ref.sessionId).not.toBe(s1.sessionId);
    const archived = await post<{ status: string; value: { record: { lifecycle: string } } }>(
      second, 'sessions/read', plain(AG2B_SCOPE, s1));
    expect(archived.status).toBe('ready');
    expect(archived.value.record, 'the Kernel-head mismatch fallback still archives the predecessor Session')
      .toMatchObject({ lifecycle: 'archived' });
  } finally {
    await second.host.close();
  }
}, 180_000);

it('KA-12 (KE4, L8): the mapped Kernel adapter is no longer registered by this Host (entries alone, no legacy locator); the Session stays kernel_turn_open, the Runtime answers unsupported, and the Workflow falls back to a new Session while the original history is honestly refused', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka12a');
  // One honest reconcile boot with the predecessor adapter registered proves the
  // open Turn and settles the Session at `unavailable/kernel_turn_open`, releasing
  // the paused Run's occupancy. (Without it the Session is still `available` with
  // the occupancy held; an unresolved `host_config` probe proves nothing, and the
  // start-up reconcile only *keeps* a `kernel_turn_open` conclusion, never creates
  // one from a mapping it cannot resolve.)
  const predecessor = await startAG2bHost(publicDir, { root, database, replies: [] });
  try {
    expect((await readExecution(predecessor, runRef)).session)
      .toMatchObject({ health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  } finally {
    await predecessor.host.close();
  }
  // On this restart the predecessor's adapter (`ag2b-kernel`) is not registered at
  // all — `entries` alone, no `legacyEntries` — so `byAdapterId` is null. The
  // start-up probe answers `host_config` (inconclusive) and keeps
  // `kernel_turn_open`; the close's own storage step then finds no location for
  // the mapped adapter and answers `unsupported` (L4 step 5's "another adapter").
  const second = await startKLegacyReaderHost(publicDir, { root, database,
    predecessorRegistration: 'absent',
    replies: [textReply('KA-12 absent adapter continued in a new Session')] });
  try {
    expect((await readExecution(second, runRef)).session, 'an inconclusive host_config probe keeps the open-Turn conclusion')
      .toMatchObject({ lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    await continueRun(second, runRef, 'kw-ka12a-continue');
    const driven = await driveChecked(second, inv, selectWork('kw-ka12a', true), { stopBefore: 'start' });
    // D7: the predecessor's Kernel adapter is unregistered, so its Turn identity
    // is unreadable; the fallback successor's preparation waits instead of
    // starting on a degraded brief.
    expect(driven.last, 'the unreadable predecessor identity keeps the fallback preparation waiting')
      .toMatchObject({ state: 'waiting', next: null });
    const kinds = receiptKinds(driven);
    expect(kinds).toContain('close_open_turn');
    expect(closeResult(driven), 'the mapped Kernel adapter is not registered by this Host')
      .toMatchObject({ status: 'unsupported' });
    expect(kinds).toContain('create_session');
    expect(kinds, 'the definite failure hands over to the fallback successor').toContain('transfer_responsibility');
    // L8: with no registered adapter there is no readable store, so the original
    // history is honestly refused, never fabricated.
    const history = await answer(second, 'sessions/history', plain(AG2B_SCOPE,
      { sessionRef: s1, afterCursor: null, throughCursor: null, limit: 10 }));
    expect(history, 'an unregistered Kernel adapter is an honest refusal')
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(history['value'], 'a refused history read carries no records').toBeUndefined();
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(second, row.execution)).session.ref.sessionId).not.toBe(s1.sessionId);
    const archived = await post<{ status: string; value: { record: { lifecycle: string } } }>(
      second, 'sessions/read', plain(AG2B_SCOPE, s1));
    expect(archived.status).toBe('ready');
    expect(archived.value.record, 'the unregistered-adapter fallback still archives the predecessor Session')
      .toMatchObject({ lifecycle: 'archived' });
  } finally {
    await second.host.close();
  }
}, 180_000);

const KA08_TEXT = 'KA-08: the person\'s message sent while the Turn was open reaches the new Run';

it('KA-08 (KE3, L9): a message sent to the original Session while its Turn is still open reaches the new Run in the same Session as new input at its first safe point', async () => {
  const { root, database, publicDir, inv, runRef, s1 } = await pausedInterrupted('kw-ka08');
  const second = await startAG2bHost(publicDir, { root, database, checkCommand: 'node -e "process.exit(0)"',
    replies: [textReply('KA-08 continuation answered')] });
  try {
    const message = await post<WriteResult<SessionMessage>>(second, 'messages/send',
      graphWrite(AG2B_SCOPE, { recipient: s1, text: KA08_TEXT }, 'kw-ka08-message', []));
    expect(message).toMatchObject({ status: 'committed' });
    await continueRun(second, runRef, 'kw-ka08-continue');
    const driven = await driveChecked(second, inv, selectWork('kw-ka08', true), { stopBefore: 'open_checks' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
    const request = second.scripted.requests.at(-1);
    expect(JSON.stringify(request?.messages ?? []), 'the message is delivered as new input to the continuation Run')
      .toContain(KA08_TEXT);
  } finally {
    await second.host.close();
  }
}, 180_000);

it('KA-08 (KE3, L9 second clause): a message the interrupted Turn already accepted is not re-delivered to the new Run; only the new message plus the continuation brief reach it', async () => {
  const { root, database, publicDir, inv, runRef, s1, acceptedText } = await pausedInterruptedWithAcceptedMessage('kw-ka08b');
  const newText = 'KA-08: the message that arrives while the Turn is open';
  const second = await startAG2bHost(publicDir, { root, database, checkCommand: 'node -e "process.exit(0)"',
    replies: [textReply('KA-08 second clause answered')] });
  try {
    const message = await post<WriteResult<SessionMessage>>(second, 'messages/send',
      graphWrite(AG2B_SCOPE, { recipient: s1, text: newText }, 'kw-ka08b-message', []));
    expect(message).toMatchObject({ status: 'committed' });
    await continueRun(second, runRef, 'kw-ka08b-continue');
    const driven = await driveChecked(second, inv, selectWork('kw-ka08b', true), { stopBefore: 'open_checks' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
    const row = await workRow(second);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    const bound = await requiredBriefOf(second, row.execution);
    expect(bound.brief.acceptedInputs.messages.map(entry => entry.excerpt.text),
      'the brief lists the message the interrupted Turn accepted').toContain(acceptedText);
    const marker = continuationBriefMarker(bound.digest);
    const bodyText = (second.scripted.requests.at(-1)?.messages ?? [])
      .flatMap(message => message.role === 'user' && !message.content.includes(marker) ? [message.content] : []).join('\n');
    expect(bodyText, 'the new message is delivered as new input').toContain(newText);
    expect(bodyText, 'the already-accepted message is not re-delivered as new input').not.toContain(acceptedText);
  } finally {
    await second.host.close();
  }
}, 240_000);
