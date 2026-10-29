/**
 * Group R fix round, row KA-09 / findings D2 and D12 (spec §5.2 KA-09 line 429;
 * L9 lines 185-195; §9 M5): the continuation brief's fact window read through
 * the real KE3 Host/Workflow drive and the public `executions/brief` route.
 *
 * Cases the private reader-seam tests did not exercise publicly:
 *  - an entered but locator-less, attested Run whose own requeue ancestor exists:
 *    the Run must be its own facts source (`factsFrom` = the afterRun, `hops` 0),
 *    not the older ancestor;
 *  - D12: a never-entered, requeued Run between the attested Run and the Run being
 *    prepared: the facts source is the nearest entered ancestor, not the oldest;
 *  - a platform position record that lags the Kernel: a later accepted input is
 *    still listed because the window is read by Kernel identity, not the stale
 *    platform locator.
 *
 * No private assembly helper and no fabricated platform record: the platform
 * records are created by the real flow; the one Kernel fact appended at the
 * boundary (KE3's system boundary) is a genuine `run.input_accepted` record.
 */
import { afterEach, expect, it } from 'vitest';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain, startAG2bHost, type AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  moveKernelAside, post, publicDirectory, readExecution, restoreKernel, selectWork, submitControl, tempDir, workRow,
  writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import { injectAcceptedMessage, injectRunningToolCall } from '../helpers/K-boundary-facts-support.js';
import {
  cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario, type InvariantTarget,
} from './harness.js';
import { crashMidTurn } from './support/restart.js';
import {
  driveChecked, execution, lockLedgerAfter, openWorkRoot, operatorRequeue, preparedOf, readCall, redrivePolicy,
  requiredBriefOf, textReply,
} from './support/common.js';

afterEach(cleanupScenarios);

/**
 * K3 L21/L11: the attested record is `needs_decision`; the person resolves it
 * through the direct hold and "continue" routes before the automatic
 * continuation, so the gate lets the continuation through.
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

const NO_REDRIVE = { schemaVersion: 1 as const, autoReworkLimit: 3, resumeOnStartup: 'off' } as const;

/**
 * Host 1 pauses a Work Run at its safe point (no check needed; this sandbox has
 * no bwrap) and leaves a stale lock, so the next Host reconciles it RUN-24. The
 * Run's Turn stays open in Run 1's Session.
 */
async function openPausedInterrupted(flowId: string): Promise<{ h: HostScenario; runRef: RunRef }> {
  let live: HostScenario | undefined;
  let pauseSubmitted: WriteResult<SubmittedControl> | undefined;
  const h = await openHostScenario({
    automation: redrivePolicy(false),
    script: {
      replies: [readCall(`${flowId}-group1`), readCall(`${flowId}-group2`), textReply(`${flowId}: never reached`)],
      duringReply: async (index) => {
        if (live === undefined) return;
        const row = await workRow(live.host);
        if (row.execution === null) throw new Error('the work Task must have a Run while its Turn runs');
        if (index !== 1) return;
        const run = (await readExecution(live.host, row.execution)).run;
        pauseSubmitted = await live.post<WriteResult<SubmittedControl>>('controls/submit', graphWrite(AG2B_SCOPE,
          { runRef: row.execution, kind: 'pause', reason: `${flowId}: pause after the first tool group` },
          `${flowId}-pause`, [{ ref: row.execution, revision: run.revision }]));
      },
    },
  });
  live = h;
  const inv: InvariantTarget = { database: h.database };
  const driven = await driveChecked(h.host, inv, selectWork(flowId));
  expect(driven.last, 'the paused Turn waits at its safe point').toMatchObject({ state: 'waiting', next: null });
  if (pauseSubmitted?.status !== 'committed') throw new Error(`pause: ${JSON.stringify(pauseSubmitted)}`);
  const row = await workRow(h.host);
  if (row.execution === null) throw new Error('the work Task must select its Run');
  return { h, runRef: row.execution };
}

type AttestedEnteringRun = { h: HostScenario; inv: InvariantTarget; run1Ref: RunRef; run2Ref: RunRef; kernelSessionId: string };

/**
 * The shared D2/D12 setup: a paused-interrupted Run 1 is continued (TASK-27) and Run 2 is claimed;
 * Run 2's begin starts a Kernel Turn but crashes before the entered fact is booked, the Kernel store
 * is lost with the crash (Run 2 ends `outcome_unknown`, still without a locator), the Kernel returns
 * and a person attests the end. Run 2 has entered the Kernel, has no execution-history locator and
 * one requeue ancestor (Run 1). A genuine later Kernel fact is appended at the boundary.
 */
async function openAttestedEnteringRun(flowId: string): Promise<AttestedEnteringRun> {
  const { h, runRef: run1Ref } = await openPausedInterrupted(flowId);
  const inv: InvariantTarget = { database: h.database };
  // 1. The crashed Host comes back; the person continues the paused Run (TASK-27), which closes the
  //    dangling Turn and prepares Run 2 in Run 1's Session with completed history.
  await h.restart({ crash: true });
  const continued = await operatorRequeue(h.host, run1Ref, `${flowId}-continue`, '继续');
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') {
    throw new Error(`continue: ${JSON.stringify(continued)}`);
  }
  const toStart = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  expect(toStart.state).toBe('stopped');
  const run2Ref = (await h.taskRow()).execution;
  if (run2Ref === null || toStart.next === null) throw new Error('Run 2 must be claimed and prepared');
  const run2 = await execution(h, run2Ref);
  expect(run2.run).toMatchObject({ status: 'starting', requeueRef: h.lastWorld?.requeues.at(-1)?.ref });
  // 2. The A8-2d crash point: start Run 2 through a composition root; the ledger lock lands right after the
  //    begin, so the Kernel Turn starts but the entered fact is never booked.
  const prepared = preparedOf(toStart.next);
  const lock = lockLedgerAfter(h.database, 'ExecutionEntryBegun');
  const model = createScriptedModel([]);
  const root = await openWorkRoot(h, model, lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${flowId}-start` });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the lock was taken right after the begin').toBe(true);
  expect(started).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(model.calls(), 'the Turn stopped before its first model call').toBe(0);
  const entering = await execution(h, run2Ref);
  expect(entering.run).toMatchObject({ status: 'starting', startedAt: null,
    executionAuthorization: { phase: 'entering', generation: 1 } });
  expect(entering.run.executionHistory, 'no entered fact').toBeUndefined();
  const binding = entering.run.executionAuthorization;
  if (binding === undefined || !('schemaVersion' in binding) || binding.kernel === null) {
    throw new Error('the begin must fix the Kernel identity');
  }
  const kernelSessionId = entering.session.kernel.kernelSessionId;
  // 3. The Kernel store is lost with the crash: Run 2 ends outcome_unknown, still without a position record.
  const aside = await moveKernelAside(h.database);
  await h.restart({ crash: true });
  const unknown = await execution(h, run2Ref);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(unknown.run.executionHistory, 'still no position record').toBeUndefined();
  expect(unknown.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: run2Ref.runId } },
    health: 'unavailable', healthConclusion: 'missing' });
  // 4. The Kernel returns; the person attests the end; a later fact is appended at the Kernel boundary.
  await restoreKernel(h.database, aside);
  const attested = await h.post<WriteResult<unknown>>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'checked by hand: nothing more was written' }, `${flowId}-resolve`,
    [{ ref: run2Ref, revision: unknown.run.revision }]));
  expect(attested).toMatchObject({ status: 'committed' });
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'human_attested' } } });
  expect(ended.run.executionHistory, 'the attested Run still has no position record').toBeUndefined();
  expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  await injectAcceptedMessage(h.database, kernelSessionId,
    { messageId: `${flowId}-late-message`, projectId: AG2B_SCOPE.projectId, workspaceId: AG2B_SCOPE.workspaceId,
      text: 'a fact recorded after the platform Run stopped observing' });
  return { h, inv, run1Ref, run2Ref, kernelSessionId };
}

it('KA-09 (KE3, L9/D2): an entered, locator-less, attested requeue continuation is its own facts source and lists the later accepted input', async () => {
  const { h, inv, run2Ref } = await openAttestedEnteringRun('kr-attested');
  try {
    // 5. The next start's maintenance closes the dangling Turn; the interrupted verdict auto-requeues.
    await writeAutomationSettings(h.database, NO_REDRIVE);
    await h.restart({});
    await resolveAttestedReview(h.host, run2Ref, 'kr-attested');
    const continuation = await driveChecked(h.host, inv, selectWork('kr-attested-continue', true), { stopBefore: 'open_checks' });
    expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
    const row = await workRow(h.host);
    if (row.execution === null || row.execution.runId === run2Ref.runId) {
      throw new Error('the automatically requeued continuation Run 3 must be selected');
    }
    const { brief } = await requiredBriefOf(h.host, row.execution);
    expect(brief.session.continuity).toBe('same_session_without_previous_turn');
    expect(brief.previous.runRef.runId, 'the afterRun is the attested Run 2').toBe(run2Ref.runId);
    // D2: Run 2 is its own facts source although it has no execution-history locator and has a requeue ancestor.
    expect(brief.factsFrom.runRef.runId, 'the attested Run proves entry through its Kernel Turn').toBe(run2Ref.runId);
    expect(brief.factsFrom.hops, 'no hop back to Run 1').toBe(0);
    expect(brief.stoppedAt.turnStatus, 'the closed Turn is reported interrupted (M5)').toBe('interrupted');
    expect(brief.stoppedAt.lastAssistant).toBeNull();
    expect(brief.acceptedInputs.messages.map((entry) => entry.messageRef.messageId))
      .toContain('kr-attested-late-message');
    expect(brief.acceptedInputs.messages.map((entry) => entry.excerpt.text))
      .toContain('a fact recorded after the platform Run stopped observing');
  } finally {
    await h.dispose();
  }
}, 300_000);

it('KA-09 (KE3, L9/D12): a never-entered, requeued Run between the attested Run and the prepared Run leaves the attested Run as the nearest facts source', async () => {
  const { h, inv, run2Ref } = await openAttestedEnteringRun('kr-attested-d12');
  try {
    await writeAutomationSettings(h.database, NO_REDRIVE);
    await h.restart({});
    await resolveAttestedReview(h.host, run2Ref, 'kr-attested-d12');
    // The maintenance closes the dangling Turn; the interrupted verdict requeues and claims Run 3. Stop
    // before it starts: Run 3 is claimed but never enters the Kernel.
    const toRun3 = await driveChecked(h.host, inv, selectWork('kr-attested-d12-r3', true), { stopBefore: 'start' });
    expect(toRun3.next?.kind === 'perform' ? toRun3.next.operation.kind : null, 'the drive stops before Run 3 starts').toBe('start');
    const run3Row = await workRow(h.host);
    if (run3Row.execution === null || run3Row.execution.runId === run2Ref.runId) {
      throw new Error('Run 3 must be claimed and prepared after the attested Run 2');
    }
    const run3Ref = run3Row.execution;
    // A person stops Run 3 while it is still claimed: it ends without ever entering the Kernel.
    await submitControl(h.host, run3Ref, 'cancel', 'KA-09 D12: stop the prepared Run before it starts', 'kr-attested-d12-r3-cancel');
    const stopped = await execution(h, run3Ref);
    expect(stopped.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
    expect(stopped.run.executionHistory, 'Run 3 never entered the Kernel').toBeUndefined();
    // The person requeues the stopped Run; Run 4 prepares in the same Session.
    const requeued = await operatorRequeue(h.host, run3Ref, 'kr-attested-d12-r3-requeue', 'continue after the stopped prepared Run');
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`requeue: ${JSON.stringify(requeued)}`);
    }
    const toRun4 = await driveChecked(h.host, inv, selectWork('kr-attested-d12-r4', true), { stopBefore: 'open_checks' });
    expect(toRun4.next?.kind === 'perform' ? toRun4.next.operation.kind : null, 'the drive stops after Run 4').toBe('open_checks');
    const run4Row = await workRow(h.host);
    if (run4Row.execution === null || run4Row.execution.runId === run3Ref.runId) {
      throw new Error('Run 4 must be claimed and prepared after the requeued Run 3');
    }
    const { brief } = await requiredBriefOf(h.host, run4Row.execution);
    expect(brief.session.continuity).toBe('same_session_without_previous_turn');
    expect(brief.previous.runRef.runId, 'the afterRun is the never-entered Run 3').toBe(run3Ref.runId);
    // D12: the nearest entered ancestor is the attested Run 2, one hop back past Run 3, not the older Run 1.
    expect(brief.factsFrom.runRef.runId, 'the attested Run 2 is the nearest entered ancestor').toBe(run2Ref.runId);
    expect(brief.factsFrom.hops, 'one hop back, past the never-entered Run 3').toBe(1);
  } finally {
    await h.dispose();
  }
}, 300_000);

/**
 * The operator archives a Session through the public `sessions/link` + `sessions/archive`
 * routes, exactly as `tests/scenarios/support/brief.ts:archiveSession` does for a `HostScenario`.
 * A moved case's own `AG2bHost` has no harness scenario, so this small local copy drives the
 * same routes; it is setup only, and no assertion reads a store back.
 */
async function archiveSessionOn(host: AG2bHost, sessionRef: SessionRef, label: string): Promise<void> {
  type Card = { record: { ref: SessionRef & { aggregateType: string }; revision: number };
    links: Array<{ ref: { target: unknown; relation: string }; revision: number; until: string | null }> };
  const read = async (): Promise<Card> => {
    const card = await post<ReadResult<Card>>(host, 'sessions/read', plain(AG2B_SCOPE, sessionRef));
    if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
    return card.value;
  };
  for (const [index, link] of (await read()).links.filter(candidate => candidate.until === null).entries()) {
    const card = await read();
    const unlinked = await post<WriteResult<unknown>>(host, 'sessions/link', graphWrite(AG2B_SCOPE,
      { sessionRef, target: link.ref.target, relation: link.ref.relation, active: false }, `${label}-unlink-${String(index)}`,
      [{ ref: card.record.ref, revision: card.record.revision }, { ref: link.ref, revision: link.revision }]));
    if (unlinked.status !== 'committed') throw new Error(`unlink: ${JSON.stringify(unlinked)}`);
  }
  const card = await read();
  const archived = await post<WriteResult<{ lifecycle: string }>>(host, 'sessions/archive', graphWrite(AG2B_SCOPE,
    { sessionRef, reason: 'retire the Session before the continuation' }, `${label}-archive`,
    [{ ref: card.record.ref, revision: card.record.revision }]));
  if (archived.status !== 'committed') throw new Error(`archive: ${JSON.stringify(archived)}`);
}

it('KA-09 (KE3, L9/D11): a cross-Session continuation of an interrupted Run reads the recorded platform window, not a Kernel fact appended after it', async () => {
  const root = await tempDir('kr-d11-ws-');
  const database = await tempDir('kr-d11-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  // Host 1 runs into a held second model request and crashes; the Run has entered and recorded a position.
  const crashed = await crashMidTurn(root, database, publicDir, {}, 'kr-d11', inv);
  try {
    const aside = await moveKernelAside(database);
    const second = await startAG2bHost(publicDir, { root, database });
    let kernelSessionId = '';
    let observedThrough: number | null = null;
    let sessionRef: SessionRef | undefined;
    try {
      const unknown = await readExecution(second, crashed.runRef);
      expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
      const locator = unknown.run.executionHistory as { kernel?: { kernelSessionId?: string };
        observedThroughPosition?: number } | undefined;
      kernelSessionId = locator?.kernel?.kernelSessionId ?? '';
      observedThrough = locator?.observedThroughPosition ?? null;
      sessionRef = { projectId: unknown.session.ref.projectId, sessionId: unknown.session.ref.sessionId };
      expect(kernelSessionId, 'the crashed Run entered a mapped Kernel Session and recorded a position').not.toBe('');
      expect(observedThrough, 'the platform Run recorded a position').toEqual(expect.any(Number));
      const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: crashed.runRef, reason: 'checked by hand: nothing more was written' }, 'kr-d11-attest',
        [{ ref: crashed.runRef, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
    } finally {
      await second.host.close();
    }
    await restoreKernel(database, aside);
    // A genuine Kernel fact the platform Run never observed: appended after its recorded window.
    await injectRunningToolCall(database, kernelSessionId,
      { callId: 'kr-d11-late-read', messageId: 'kr-d11-late-message', path: 'src/later-fact.ts' });
    await writeAutomationSettings(database, NO_REDRIVE);
    const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('kr-d11 continuation')] });
    try {
      // The start-up maintenance closes the attested dangling Turn.
      const closed = await readExecution(third, crashed.runRef);
      expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
      if (sessionRef === undefined) throw new Error('the original Session must be known');
      // Retire the original Session: the continuation must be claimed in another one (cross-Session).
      await archiveSessionOn(third, sessionRef, 'kr-d11');
      await resolveAttestedReview(third, crashed.runRef, 'kr-d11');
      // A fresh invariant target re-reads the world after the restart.
      const driveInv: InvariantTarget = { database };
      const continuation = await driveChecked(third, driveInv, selectWork('kr-d11-continue', true), { stopBefore: 'open_checks' });
      expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
      const row = await workRow(third);
      if (row.execution === null || row.execution.runId === crashed.runRef.runId) {
        throw new Error('the continuation Run must be selected in another Session');
      }
      const { brief } = await requiredBriefOf(third, row.execution);
      // D11: cross-Session, so the ordinary platform window decides the facts.
      expect(brief.session.continuity).not.toBe('same_session_without_previous_turn');
      expect(brief.session.sessionRef.sessionId).not.toBe(sessionRef.sessionId);
      expect(brief.previous.runRef.runId).toBe(crashed.runRef.runId);
      expect(brief.factsFrom.runRef.runId).toBe(crashed.runRef.runId);
      // The boundary is the platform's recorded window, and the later Kernel fact is not in the brief.
      expect(brief.stoppedAt.lastPosition, 'the recorded platform position is the boundary').toBe(observedThrough);
      expect([...brief.toolCalls.confirmed, ...brief.toolCalls.unknown].map((call) => call.callId))
        .not.toContain('kr-d11-late-read');
    } finally {
      await third.host.close();
    }
  } finally {
    await crashed.release();
  }
}, 300_000);

it('KA-09 (KE3, L9): a platform position record that lags the Kernel still lists the later tool fact read by Kernel identity', async () => {
  const root = await tempDir('kr-lag-ws-');
  const database = await tempDir('kr-lag-db-');
  const publicDir = await publicDirectory();
  const inv: InvariantTarget = { database };
  // Host 1 runs into a held second model request and crashes; the Run has entered and recorded a position.
  const crashed = await crashMidTurn(root, database, publicDir, {}, 'kr-lag', inv);
  try {
    const aside = await moveKernelAside(database);
    const second = await startAG2bHost(publicDir, { root, database });
    let kernelSessionId = '';
    let observedThrough: number | null = null;
    try {
      const unknown = await readExecution(second, crashed.runRef);
      expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
      const locator = unknown.run.executionHistory as { kernel?: { kernelSessionId?: string };
        observedThroughPosition?: number } | undefined;
      kernelSessionId = locator?.kernel?.kernelSessionId ?? '';
      observedThrough = locator?.observedThroughPosition ?? null;
      expect(kernelSessionId, 'the crashed Run entered a mapped Kernel Session and recorded a position').not.toBe('');
      expect(observedThrough, 'the platform Run recorded a position').toEqual(expect.any(Number));
      const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: crashed.runRef, reason: 'checked by hand: nothing more was written' }, 'kr-lag-attest',
        [{ ref: crashed.runRef, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
    } finally {
      await second.host.close();
    }
    await restoreKernel(database, aside);
    // The platform locator stopped at the pre-crash request boundary; this tool fact is later.
    await injectRunningToolCall(database, kernelSessionId,
      { callId: 'kr-lag-late-read', messageId: 'kr-lag-late-message', path: 'src/later-fact.ts' });
    await writeAutomationSettings(database, NO_REDRIVE);
    const third = await startAG2bHost(publicDir, { root, database, replies: [textReply('kr-lag continuation')] });
    try {
      // The start-up maintenance closes the attested dangling Turn.
      const closed = await readExecution(third, crashed.runRef);
      expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
      // A fresh invariant target re-reads the world after the restart (the crashed Host's cached world predates the attestation).
      const driveInv: InvariantTarget = { database };
      await resolveAttestedReview(third, crashed.runRef, 'kr-lag');
      const continuation = await driveChecked(third, driveInv, selectWork('kr-lag-continue', true), { stopBefore: 'open_checks' });
      expect(continuation.next?.kind === 'perform' ? continuation.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
      const row = await workRow(third);
      if (row.execution === null || row.execution.runId === crashed.runRef.runId) {
        throw new Error('the continuation Run must be selected in the original Session');
      }
      const { brief } = await requiredBriefOf(third, row.execution);
      expect(brief.session.continuity).toBe('same_session_without_previous_turn');
      expect(brief.previous.runRef.runId).toBe(crashed.runRef.runId);
      expect(brief.factsFrom.runRef.runId).toBe(crashed.runRef.runId);
      expect(brief.stoppedAt.turnStatus).toBe('interrupted');
      // The platform position record lags the Kernel: the close is beyond it, and the later tool
      // fact is still listed.
      expect(observedThrough).not.toBeNull();
      expect(brief.stoppedAt.lastPosition, 'the Kernel close is beyond the recorded platform position')
        .toBeGreaterThan(observedThrough!);
      expect([...brief.toolCalls.confirmed, ...brief.toolCalls.unknown].map((call) => call.callId))
        .toContain('kr-lag-late-read');
    } finally {
      await third.host.close();
    }
  } finally {
    await crashed.release();
  }
}, 300_000);
