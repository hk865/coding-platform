/**
 * Slice K part A, group W: the single Session-maintenance insertion point (KE3;
 * spec §5.2 rows KA-10 and KA-14; L7, decision 45/51, §9 M1/M3).
 *
 * The maintenance close is driven through the real Host start (the start-up
 * maintenance step) and through `workflow/advance`; the Kernel store is the
 * system boundary. No database is read for verification: the Session/Run
 * projections come from the public `executions/read` route.
 *
 * KA-10's RUN-23 clean-close half (a clean queued-cancel line whose start-up
 * maintenance closes the Turn and SES-13 returns it available) is pinned by the
 * frozen tests/scenarios/A8-host-restart.test.ts W-12; the RUN-19 half and the
 * RUN-24/attested halves are re-pinned here.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { agentEventSchema, SqliteStores } from '../../vendor/coding-agent/dist/public-api.js';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { AG2B_SCOPE, graphWrite, plain, startAG2bHost, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import {
  moveKernelAside, post, publicDirectory, readExecution, restoreKernel, selectWork, tempDir, workRow, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import { assertInvariantsAt, cleanupScenarios, type InvariantTarget } from './harness.js';
import { crashMidTurn } from './support/restart.js';
import { driveChecked, pausedRunOnClosedHostChecked, requiredBriefOf, textReply, WORK_TARGET } from './support/common.js';

/**
 * K3 L21/L11: the attested record is `needs_decision`; a person resolves it with
 * the direct hold and "continue" routes before the automatic continuation. The
 * KA-14 crash has no pause pointer, so `release-hold` only releases (no human
 * requeue) and the ordinary automatic rework continues.
 */
async function resolveAttestedReview(host: AG2bHost, runRef: RunRef, label: string): Promise<void> {
  const read = await post<ReadResult<UnknownCallReviewV1>>(host, 'unknown-call-reviews/read',
    plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready') throw new Error(`the attested review record must read: ${JSON.stringify(read)}`);
  const review = read.value;
  expect(review).toMatchObject({ status: 'needs_decision', decisionReasons: ['inventory_incomplete'] });
  const held = await post<WriteResult<UnknownCallReviewV1>>(host, 'unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: review.ref, text: null }, `${label}-hold`, [{ ref: review.ref, revision: review.revision }]));
  if (held.status !== 'committed') throw new Error(`the review hold must commit: ${JSON.stringify(held)}`);
  const released = await post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(host,
    'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: review.ref }, `${label}-release`,
      [{ ref: review.ref, revision: held.value.revision }]));
  if (released.status !== 'committed') throw new Error(`the review release must commit: ${JSON.stringify(released)}`);
  expect(released.value).toMatchObject({ hold: { status: 'committed', value: { disposition: { hold: 'released' } } },
    requeue: null });
}

afterEach(cleanupScenarios);

/**
 * D15 (KA-10 archive request): boundary instrumentation for the zero-closure
 * assertion. The mock wraps the real Kernel `closeOpenTurn` in a counter so the
 * tests that DO close a Turn keep working, while the archive-request test can
 * prove that the Host's start-up never invoked it (spec §9 M2 pattern; the same
 * `vi.hoisted` + `vi.mock` seam as tests/scenarios/K-W-fallback.test.ts:27–33).
 */
const kernelClosureCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual['closeOpenTurn'];
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => {
      if (typeof real !== 'function') return real;
      return (...args: unknown[]) => {
        kernelClosureCalls.count += 1;
        return (real as (...callArgs: unknown[]) => unknown)(...args);
      };
    } });
});
afterEach(() => { kernelClosureCalls.count = 0; });

const NO_REDRIVE = { schemaVersion: 1 as const, autoReworkLimit: 3, resumeOnStartup: 'off' } as const;

/**
 * KA-14: the crashed Host left a model request in flight; append a real
 * started-but-unfinished tool call to the restored Kernel Turn at the store
 * boundary, so the platform closure has to mark it `outcome_unknown` instead of
 * inventing a result. The events are valid Kernel events with the crashed
 * request's identity; no assertion reads them back.
 */
type BoundaryEvent = { type: string; meta: { runId: string; turnId: string; sequence: number; elapsedMs: number };
  payload: { requestId?: string } };
type BoundaryRecord = { recordType: string; position: number; payload: { event: BoundaryEvent } };
/** The narrow public Kernel store surface the boundary injection above uses (drafts stay untyped). */
type BoundaryStore = {
  read(sessionId: string, afterPosition: number, limit: number, options: { signal: AbortSignal }):
    Promise<{ records: readonly BoundaryRecord[]; nextPosition: number | null }>;
  get(sessionId: string, options: { signal: AbortSignal }): Promise<{ revision: number }>;
  append(sessionId: string, expectedRevision: number, drafts: readonly unknown[], options: { signal: AbortSignal }): Promise<unknown>;
  close(): Promise<void>;
};

async function injectRunningToolCall(database: string, kernelSessionId: string, callId: string, messageId: string): Promise<void> {
  const signal = new AbortController().signal;
  const store = await SqliteStores.open(join(database, 'kernel.sqlite')) as unknown as BoundaryStore;
  try {
    const records: BoundaryRecord[] = [];
    let position = 0;
    for (;;) {
      const page = await store.read(kernelSessionId, position, 256, { signal });
      records.push(...page.records);
      const last = page.records.at(-1);
      if (page.nextPosition === null || last === undefined) break;
      position = last.position;
    }
    const lastEvent = [...records].reverse().find(record => record.recordType === 'agent.event');
    if (lastEvent === undefined) throw new Error('KA-14 needs the crashed Turn to append the unfinished call to');
    const previous = lastEvent.payload.event;
    const requestId = previous.payload.requestId;
    if (requestId === undefined) throw new Error('KA-14 needs the in-flight model request to complete the assistant step');
    const at = '2026-10-14T00:40:00.000Z';
    const of = (type: 'assistant.message_completed' | 'tool.started', sequence: number, payload: unknown): BoundaryEvent =>
      agentEventSchema.parse({
        type, meta: { schemaVersion: 1, eventId: `kw-ka14b-${type}`, runId: previous.meta.runId, turnId: previous.meta.turnId,
          sequence, occurredAt: at, elapsedMs: previous.meta.elapsedMs },
        payload }) as BoundaryEvent;
    const call = { schemaVersion: 1, callId, name: 'read', arguments: { path: 'src/module.ts' } };
    const message = of('assistant.message_completed', previous.meta.sequence + 1,
      { requestId, message: { schemaVersion: 1, messageId, role: 'assistant', content: '' }, toolCalls: [call] });
    const started = of('tool.started', previous.meta.sequence + 2, { call });
    const header = await store.get(kernelSessionId, { signal });
    await store.append(kernelSessionId, header.revision, [
      { recordId: `agent-event:kw-ka14b-assistant`, recordType: 'agent.event', schemaVersion: 1, recordedAt: at, payload: { event: message } },
      { recordId: `agent-event:kw-ka14b-started`, recordType: 'agent.event', schemaVersion: 1, recordedAt: at, payload: { event: started } },
    ], { signal });
  } finally {
    await store.close();
  }
}

it('KA-10 (KE3, L7/KA1): the start-up maintenance closes a RUN-19 clean interruption\'s dangling Kernel Turn, returns the Session available, and does not archive it', async () => {
  const root = await tempDir('kw-ka10-run19-ws-');
  const database = await tempDir('kw-ka10-run19-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const crashed = await crashMidTurn(root, database, publicDir, {}, 'kw-ka10-run19', inv);
  await writeAutomationSettings(database, NO_REDRIVE);
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-10 Run-19 continued')] });
  try {
    await assertInvariantsAt(inv, 'KA-10 RUN-19 reconciled');
    const ended = await readExecution(second, crashed.runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'interrupted_clean', pausedIntentRef: null } } });
    // The start-up maintenance closed the dangling Turn and SES-13 returned S1 available; the line is active, not archived.
    expect(ended.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

it('KA-10 (KE3, L7): a human-paused RUN-24 line is not closed by maintenance (the pause fence is not the platform\'s to cross); its Session stays kernel_turn_open with zero writes', async () => {
  const root = await tempDir('kw-ka10-run24-ws-');
  const database = await tempDir('kw-ka10-run24-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  await writeAutomationSettings(database, NO_REDRIVE);
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-10 Run-24 must not continue automatically')] });
  try {
    await assertInvariantsAt(inv, 'KA-10 RUN-24 reconciled');
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ reconciliation: { observation: { kind: 'interrupted_clean' } } });
    expect(ended.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'unavailable',
      healthConclusion: 'kernel_turn_open' });
    // The maintenance page ran (through one select_work) and still did not close it.
    const advanced = await driveChecked(second, inv, selectWork('kw-ka10-run24-advance', true), { stopBefore: 'requeue_task' });
    expect(advanced.last, 'the paused RUN-24 line leaves the advance settled, with no requeue and no closure')
      .toMatchObject({ state: 'waiting', next: null });
    const after = await readExecution(second, runRef);
    expect({ run: after.run.revision, session: after.session.revision },
      'the paused RUN-24 line is left with zero writes').toEqual({ run: ended.run.revision, session: ended.session.revision });
    expect(after.session).toMatchObject({ lifecycle: 'active', health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  } finally {
    await second.host.close();
  }
}, 180_000);

it('KA-10 (KE3, L7): a RUN-19 line whose operator archive request was committed before the crash is archived by the next maintenance, never closed first (the archive request is continued before the closure insertion)', async () => {
  const root = await tempDir('kw-ka10arc-ws-');
  const database = await tempDir('kw-ka10arc-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const requestId = 'kw-ka10arc-request';
  // The archive request is committed while the line still runs; the crash then leaves
  // the line retired with a dangling Kernel Turn and a durable archive request.
  const crashed = await crashMidTurn(root, database, publicDir, {
    whileBlocked: async (host, runRef) => {
      const card = await readExecution(host, runRef);
      const s1: SessionRef = { projectId: card.session.ref.projectId, sessionId: card.session.ref.sessionId };
      const request: GraphWrite<ArchiveLineInput> = {
        input: { sessionRef: s1, reason: 'KA-10: the operator archives the line before the crash',
          tasks: [{ target: WORK_TARGET, disposition: { kind: 'drop' } }], wait: null },
        meta: { requestId, expected: [{ ref: card.session.ref, revision: card.session.revision }] },
      };
      const started = await post<ReadResult<ArchiveLineResultV1>>(host, 'sessions/archive-line', { scope: AG2B_SCOPE, request });
      expect(started.status).toBe('ready');
      if (started.status !== 'ready') throw new Error('the archive-line request must answer ready');
      expect(started.value.state, 'the running line cannot archive yet: the durable request stays pending').toBe('pending');
      expect(started.value.session.archiveRequest?.requestId, 'the request keeps its identity').toBe(requestId);
    },
  }, 'kw-ka10arc', inv);
  try {
    await writeAutomationSettings(database, NO_REDRIVE);
    kernelClosureCalls.count = 0;
    const second = await startAG2bHost(publicDir, { root, database });
    try {
      // The start-up maintenance continued the archive request FIRST; the closure
      // insertion is never reached for a line with a pending archive request.
      const predecessor = await readExecution(second, crashed.runRef);
      expect(predecessor.session, 'the archive request archives the line without closing its Turn')
        .toMatchObject({ lifecycle: 'archived' });
      // (a) The predecessor Run read through the public `executions/read` route
      // still shows no Kernel closure: it keeps a null end position and its
      // retired (archive-request) outcome, never an interrupted closure.
      expect(predecessor.run.status, 'the archive request retires the Run, it is not re-run').toBe('ended');
      expect(predecessor.run.executionHistory?.endPosition,
        'the archive path recorded no Kernel closure end').toBeNull();
      // (a) The Session read through the public `sessions/read` route is archived.
      const sessionRef: SessionRef = { projectId: predecessor.session.ref.projectId, sessionId: predecessor.session.ref.sessionId };
      const sessionCard = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(
        second, 'sessions/read', plain(AG2B_SCOPE, sessionRef));
      expect(sessionCard.status).toBe('ready');
      expect(sessionCard.value.record, 'the archived Session, read through the public route')
        .toMatchObject({ lifecycle: 'archived' });
      // (b) Boundary instrumentation: the Host's start-up never invoked the Kernel
      // closure switch for the archive-request line.
      expect(kernelClosureCalls.count, 'the archive insertion never calls closeOpenTurn').toBe(0);
    } finally {
      await second.host.close();
    }
  } finally {
    await crashed.release();
  }
}, 240_000);

it('KA-14 (KE3, L7, decision 45/51): an outcome_unknown holder keeps the Session with zero maintenance writes; once a person attests the end the next maintenance closes the Turn and returns the Session available', async () => {
  const root = await tempDir('kw-ka14-ws-');
  const database = await tempDir('kw-ka14-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  // The Kernel store is lost with the crashed Host: the probe is `missing` and the Run ends outcome_unknown (RUN-20).
  const aside = await moveKernelAside(database);
  const second = await startAG2bHost(publicDir, { root, database });
  let unknownRevision = 0;
  try {
    const unknown = await readExecution(second, runRef);
    unknownRevision = unknown.run.revision;
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    expect(unknown.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: runRef.runId } },
      health: 'unavailable', healthConclusion: 'missing' });
    // decision 45: the maintenance page (one select_work) writes nothing at all while the outcome is unknown.
    await driveChecked(second, inv, selectWork('kw-ka14-unknown', true));
    const held = await readExecution(second, runRef);
    expect(held.run.revision).toBe(unknownRevision);
    expect(held.session).toMatchObject({ revision: unknown.session.revision, occupancy: { kind: 'execution' },
      healthConclusion: 'missing' });
    // RUN-22: the person attests the end; the Session is retired kernel_turn_open (SES-07, LA-1).
    const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'checked by hand: nothing more was written' }, 'kw-ka14-attest',
      [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed' });
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'human_attested' } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  } finally {
    await second.host.close();
  }
  // The Kernel is readable again: the next Host's start-up maintenance closes the attested dangling Turn (decision 51).
  await restoreKernel(database, aside);
  await writeAutomationSettings(database, NO_REDRIVE);
  const third = await startAG2bHost(publicDir, { root, database });
  try {
    const closed = await readExecution(third, runRef);
    expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
  } finally {
    await third.host.close();
  }
  // This line still carries the person's pause fence, so its verdict stays
  // `stopped/task_paused` (AV-4): the automatic second phase below needs a
  // host-interrupted unknown outcome with no pause pointer.
}, 240_000);

it('KA-14 (KE3, L7, decision 45/51 second phase): an attested host-interrupted unknown outcome is closed by maintenance, the Task is automatically requeued, the continuation is claimed in the original Session, and its brief lists the interrupted steps', async () => {
  const root = await tempDir('kw-ka14b-ws-');
  const database = await tempDir('kw-ka14b-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  // Host 1 is interrupted mid-Turn with NO pause pointer (RUN-19); the Kernel store is lost, so the Run ends
  // outcome_unknown (RUN-20) and only an operator attestation can settle it (RUN-22).
  const crashed = await crashMidTurn(root, database, publicDir, {}, 'kw-ka14b', inv);
  try {
    const aside = await moveKernelAside(database);
    const second = await startAG2bHost(publicDir, { root, database });
    let originalSessionId = '';
    let kernelSessionId = '';
    try {
      const unknown = await readExecution(second, crashed.runRef);
      expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
      originalSessionId = unknown.session.ref.sessionId;
      kernelSessionId = (unknown.run.executionHistory as { kernel?: { kernelSessionId?: string } } | undefined)
        ?.kernel?.kernelSessionId ?? '';
      expect(kernelSessionId, 'the crashed Run entered a mapped Kernel Session').not.toBe('');
      const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: crashed.runRef, reason: 'checked by hand: nothing more was written' }, 'kw-ka14b-attest',
        [{ ref: crashed.runRef, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
    } finally {
      await second.host.close();
    }
    await restoreKernel(database, aside);
    // The crashed Turn had a tool running when the Host went down: the closure must
    // report it as an unknown outcome, never a fabricated result (L1, rule 1).
    await injectRunningToolCall(database, kernelSessionId, 'kw-ka14b-unknown-read', 'kw-ka14b-unknown-message');
    await writeAutomationSettings(database, NO_REDRIVE);
    const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-14b continuation answered')] });
    try {
      const closed = await readExecution(third, crashed.runRef);
      expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
      // decision 51 second phase: the attested interrupted Task's verdict is an automatic
      // requeue; the continuation is claimed in the ORIGINAL Session and its brief lists
      // the interrupted Turn's step facts. A fresh target re-reads the world after the
      // restart (the crashed host's cached world predates the attestation).
      await resolveAttestedReview(third, crashed.runRef, 'kw-ka14b');
      const driveInv: InvariantTarget = { database };
      const continuation = await driveChecked(third, driveInv, selectWork('kw-ka14b-continue', true), { stopBefore: 'open_checks' });
      expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
      const row = await workRow(third);
      if (row.execution === null || row.execution.runId === crashed.runRef.runId) {
        throw new Error('the automatically requeued continuation Run must be selected');
      }
      expect((await readExecution(third, row.execution)).session.ref.sessionId, 'the continuation runs in the original Session')
        .toBe(originalSessionId);
      const bound = await requiredBriefOf(third, row.execution);
      expect(bound.brief.session.continuity).toBe('same_session_without_previous_turn');
      expect(bound.brief.previous).toMatchObject({ runRef: crashed.runRef, origin: 'human_attested' });
      expect(bound.brief.stoppedAt.turnStatus, 'the closed Turn is reported interrupted').toBe('interrupted');
      expect(bound.brief.toolCalls.confirmed.map(call => call.callId),
        'the brief lists the interrupted Turn\'s step facts').toContain('a2-crash-read');
      expect(bound.brief.toolCalls.unknown.map(call => [call.callId, call.result]),
        'the started-but-unfinished call reaches the brief as an unknown outcome, with no invented result')
        .toContainEqual(['kw-ka14b-unknown-read', 'outcome_unknown']);
    } finally {
      await third.host.close();
    }
  } finally {
    await crashed.release();
  }
}, 240_000);
