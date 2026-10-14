/**
 * Slice K part A, group W: the KE4 fallback rows (spec §5.2 rows KA-13 and
 * KA-16; L6, L8, L10, §9 M1/M2).
 *
 * KA-13: a fallback continuation Session was created but its E15 transfer had
 * not committed when the Host restarted; the next start replays the same
 * `create_session{requeue}` exactly once and recovers the handover, never
 * closing or resurrecting the predecessor.
 *
 * KA-16: a retired Query line with an open Kernel Turn is never closed by
 * maintenance (L10); the same Query helpers as tests/scenarios/A8-host-restart-lease.test.ts
 * build it. Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import {
  AG2B_SCOPE, claimBusyQuery, createAG2bSession, plain, seedAG2bWorkGraph, startAG2bHost, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  deferred, post, publicDirectory, readExecution, selectWork, tempDir, workRow, writeAutomationSettings, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, type InvariantTarget } from './harness.js';
import { driveChecked, operatorRequeue, pausedRunOnClosedHostChecked, textReply } from './support/common.js';

afterEach(cleanupScenarios);

const kernelClosure = vi.hoisted(() => ({ supported: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => (kernelClosure.supported ? actual['closeOpenTurn'] : undefined) });
});
afterEach(() => { kernelClosure.supported = true; });

function receiptKinds(driven: Awaited<ReturnType<typeof driveChecked>>): string[] {
  return driven.steps.flatMap(step => step.receipt === null ? [] : [step.receipt.kind]);
}

it('KA-13 (KE4, L6/L8): a fallback new Session whose E15 transfer had not committed survives a Host restart; with closure now AVAILABLE the next start still replays it and recovers the handover without ever closing the predecessor', async () => {
  // M2: the Kernel cannot close on the first Host, so the Workflow takes the new-Session fallback.
  kernelClosure.supported = false;
  const root = await tempDir('kw-ka13-ws-');
  const database = await tempDir('kw-ka13-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-13 fallback successor')] });
  let successor = '';
  try {
    const continued = await operatorRequeue(second, runRef, 'kw-ka13-continue', '继续');
    expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    const firstDrive = await driveChecked(second, inv, selectWork('kw-ka13-a', true), { stopBefore: 'transfer_responsibility' });
    expect(firstDrive.next?.kind === 'perform' ? firstDrive.next.operation.kind : null, 'the drive stops before the E15 transfer').toBe('transfer_responsibility');
    const kinds = receiptKinds(firstDrive);
    expect(kinds).toContain('close_open_turn');
    expect(firstDrive.steps.find(step => step.receipt?.kind === 'close_open_turn')?.receipt)
      .toMatchObject({ result: { status: 'unsupported' } });
    expect(kinds).toContain('create_session');
    const created = firstDrive.steps.find(step => step.receipt?.kind === 'create_session')?.receipt?.result as
      { value?: { ref?: { sessionId?: string } } } | undefined;
    successor = created?.value?.ref?.sessionId ?? '';
    expect(successor).not.toBe('');
  } finally {
    await second.host.close();
  }
  // The review's KA-13 gap: closure becomes available again before the restart. The
  // recorded successor still protects the predecessor, so the Workflow replays the
  // fallback instead of producing a close step.
  kernelClosure.supported = true;
  const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-13 recovered handover')] });
  try {
    const driven = await driveChecked(third, inv, selectWork('kw-ka13-b', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the recovered continuation').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds, 'the fallback Session is replayed, never created twice').not.toContain('create_session');
    expect(kinds, 'the successor protects the predecessor even though closure is available').not.toContain('close_open_turn');
    expect(kinds).toContain('transfer_responsibility');
    expect(kinds).toContain('claim_task');
    const row = await workRow(third);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(third, row.execution)).session.ref.sessionId).toBe(successor);
    // The predecessor stays the original retired Session, never the fallback and never reopened.
    const predecessor = await readExecution(third, runRef);
    expect(predecessor.session.ref.sessionId).toBe(oldSession.ref.sessionId);
    expect(predecessor.session.ref.sessionId).not.toBe(successor);
  } finally {
    await third.host.close();
  }
}, 240_000);

it('KA-10 (KE3, L7): the successor exclusion holds with closure enabled — a retired kernel_turn_open line that already has a fallback continuation is left unclosed by maintenance and archives as handoff_complete, never through the new insertion', async () => {
  // The fallback successor is built while closure is unavailable; closure then becomes
  // available before the restart, but the recorded successor already protects the line.
  kernelClosure.supported = false;
  const root = await tempDir('kw-ka10s-ws-');
  const database = await tempDir('kw-ka10s-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  const { runRef, oldSession } = await pausedRunOnClosedHostChecked(root, database, publicDir, inv, 'run');
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  const second = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-10 successor exclusion')] });
  try {
    const continued = await operatorRequeue(second, runRef, 'kw-ka10s-continue', '继续');
    expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    const firstDrive = await driveChecked(second, inv, selectWork('kw-ka10s-a', true), { stopBefore: 'transfer_responsibility' });
    expect(firstDrive.next?.kind === 'perform' ? firstDrive.next.operation.kind : null, 'the drive stops before the E15 transfer').toBe('transfer_responsibility');
    expect(receiptKinds(firstDrive)).toContain('create_session');
  } finally {
    await second.host.close();
  }
  kernelClosure.supported = true;
  const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('KA-10 successor exclusion recovered')] });
  try {
    // Start-up maintenance ran with closure available: the recorded successor still
    // protects the line, so it stays retired (health unavailable), never closed.
    expect((await readExecution(third, runRef)).session).toMatchObject({ lifecycle: 'active',
      health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    const driven = await driveChecked(third, inv, selectWork('kw-ka10s-b', true), { stopBefore: 'start' });
    expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops at the recovered continuation').toBe('start');
    const kinds = receiptKinds(driven);
    expect(kinds, 'the successor already exists, so no closure is attempted').not.toContain('close_open_turn');
    expect(kinds).toContain('transfer_responsibility');
    // HM01: once the handover is complete the line archives as handoff_complete, not by a closure.
    expect((await readExecution(third, runRef)).session).toMatchObject({ lifecycle: 'archived' });
    const row = await workRow(third);
    if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
    expect((await readExecution(third, row.execution)).session.ref.sessionId).not.toBe(oldSession.ref.sessionId);
  } finally {
    await third.host.close();
  }
}, 240_000);

it('KA-16 (KE3, L10): a retired Query line with an open Kernel Turn is not closed by maintenance; it stays active and retired', async () => {
  const root = await tempDir('kw-ka16-ws-');
  const database = await tempDir('kw-ka16-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  let startedSession: Awaited<ReturnType<typeof createAG2bSession>> | undefined;
  try {
    await seedAG2bWorkGraph(first);
    const claimedSession = await createAG2bSession(first, 'kw-ka16-claimed');
    startedSession = await createAG2bSession(first, 'kw-ka16-started');
    await claimBusyQuery(first, claimedSession, 'claimed');
    const started = await claimBusyQuery(first, startedSession, 'started');
    inFlight = startBusyQuery(first, started, 'started').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
  } catch (error) {
    hold.reject(new Error('KA-16 setup failed'));
    await inFlight;
    await first.host.close();
    throw error;
  }
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (startedSession === undefined) throw new Error('the Query Session must exist');
    const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
      plain(AG2B_SCOPE, startedSession.sessionRef));
    expect(card.status).toBe('ready');
    // L10: the Query line is left kernel_turn_open, never closed by the maintenance insertion.
    expect(card.value.record).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'unavailable',
      healthConclusion: 'kernel_turn_open' });
    expect(second.queryScripted.calls()).toBe(0);
  } finally {
    await second.host.close();
    hold.reject(new Error('KA-16 cleanup'));
    await inFlight;
    await first.host.close().catch(() => undefined);
  }
}, 240_000);
