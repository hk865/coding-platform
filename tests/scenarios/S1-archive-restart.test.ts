/**
 * Slice 1 (Session facts, corrections and archive) scenario rows IT19 and
 * IT21–IT25 (spec §4.1, §4.2, §5.4): the archive composite survives a Host
 * crash at each durable step and resumes from the stored request.
 *
 * One Work Run is driven to its safe point (`readCall` then a held second model
 * call, as tests/scenarios/A4-duplicate-receipts.test.ts holds it), so the line
 * has a real running execution and an unfinished Task. Each case then crashes
 * the Host at its own point (a failed next-step commit, or the answer of the
 * final step being lost) and continues the same archive request.
 *
 * The archive composite is a new owner entry that no old code produced, so it is
 * called on the composition root over the same SQLite files
 * (`HostScenario.direct()`); the Host itself still owns the crash and the
 * restart. Its owner is a `not implemented:` stub in part 1, so every case is
 * the expected RED there. Scripted model replies only; no real model is called.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type {
  ArchiveLineInput, ArchiveLineResultV1, ArchiveStepReceiptV1,
} from '../../src/business/workflow/session-archive.js';
import { AG2B_SCOPE, AG2B_WORK_TASK_ID, corePost, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { installS1ScenarioClock, ledgerCounts, loseResponse, ready } from '../helpers/S1-runtime-scenario-fixture.js';
import {
  assertInvariants, cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario,
} from './harness.js';
import { NO_REDRIVE, briefOf, readCall, selectedRun, stepOf, textReply, WORK_TARGET } from './support/common.js';
import { eventCount, failCommitOf } from './support/receipts.js';
import type { InvariantWorld } from '../state/invariants.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';

let restoreClock: (() => void) | undefined;
beforeEach(() => { restoreClock = installS1ScenarioClock(); });
afterEach(async () => { try { await cleanupScenarios(); } finally { restoreClock?.(); } });

/** The line under archive: its Host, Session, running Run and the Session pin the request names. */
type Interrupted = { host: HostScenario; sessionRef: SessionRef; sessionPin: SessionAggregateRef; runRef: RunRef; sessionRevision: number };

/**
 * One AG2b work Run held at its safe point (the second model call): the Run is
 * `running`, the Task unfinished, so archive must stop it before anything else.
 */
async function openInterrupted(flowId: string, repliesExtra = 0): Promise<Interrupted> {
  const replies = [readCall(flowId), textReply(`${flowId}: the interrupted Run answers`)];
  for (let index = 0; index < repliesExtra; index += 1) {
    replies.push(readCall(`${flowId}-after-${String(index)}`), textReply(`${flowId}: the successor Run answers`));
  }
  const host = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', script: { replies } });
  const held = host.holdReply(1);
  const toStart = await host.advance(host.select(flowId), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  const inFlight = host.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next));
  // Fail immediately if an existing guard prevents the real safe point. The
  // in-flight HTTP call remains outstanding when this Host is later abandoned.
  await Promise.race([held.reached, inFlight.then(value => {
    throw new Error(`the Work settled before reaching the held safe point: ${JSON.stringify(value)}`);
  })]);

  const runRef = await selectedRun(host);
  const record = await host.post<ReadResult<{ session: { ref: SessionRef } }>>('executions/read', plain(AG2B_SCOPE, runRef));
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  const sessionRef = { projectId: record.value.session.ref.projectId, sessionId: record.value.session.ref.sessionId };
  const card = await host.post<ReadResult<{ record: { ref: SessionAggregateRef; revision: number } }>>('sessions/read',
    plain(AG2B_SCOPE, sessionRef));
  if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
  return { host, sessionRef, sessionPin: card.value.record.ref, runRef, sessionRevision: card.value.record.revision };
}

/** The operator's one composite archive request for this line (`workflow/archiveLine` input). */
function archiveRequest(c: Interrupted, requestId: string): GraphWrite<ArchiveLineInput> {
  return { input: {
    sessionRef: c.sessionRef,
    reason: 'the operator archives the interrupted line',
    tasks: [{ target: WORK_TARGET, disposition: { kind: 'drop' } }],
    wait: null,
  }, meta: { requestId, expected: [{ ref: c.sessionPin, revision: c.sessionRevision }] } };
}

/** `workflow.archiveLine` on the composition root over the scenario's own SQLite files (a new owner entry). */
async function archiveLine(c: Interrupted, requestId: string): Promise<ReadResult<ArchiveLineResultV1>> {
  const platform = await c.host.direct();
  const result = await platform.workflow.archiveLine(hostCtx(c.host.stepActor()), archiveRequest(c, requestId));
  await assertInvariants(c.host, `${requestId}: archiveLine`);
  return result;
}

/** `workflow.continueArchiveLine`: resume the durable request after the crash. */
async function resume(c: Interrupted, requestId: string): Promise<ReadResult<ArchiveLineResultV1>> {
  const platform = await c.host.direct();
  const result = await platform.workflow.continueArchiveLine(hostCtx(c.host.stepActor()),
    { sessionRef: c.sessionRef, archiveRequestId: requestId });
  await assertInvariants(c.host, `${requestId}: continueArchiveLine`);
  return result;
}

/** The committed step receipt `step` of a ready archive result (fails the row with its own message). */
function stepReceiptOf(result: ArchiveLineResultV1, step: ArchiveStepReceiptV1['step']): ArchiveStepReceiptV1 {
  const receipt = result.receipts.find((candidate) => candidate.step === step);
  if (receipt === undefined) throw new Error(`the archive result must carry its ${step} receipt: ${JSON.stringify(result)}`);
  return receipt;
}

/** The stable identity of a step receipt (`replayed` is deliberately excluded: a replay keeps the identity). */
function identityOf(receipt: ArchiveStepReceiptV1): Omit<ArchiveStepReceiptV1, 'replayed'> {
  return { step: receipt.step, subjectKey: receipt.subjectKey, cursor: receipt.cursor };
}

/** The invariant world after `label`, the same reader every §11.11 scenario check uses. */
async function worldOf(c: Interrupted, label: string): Promise<InvariantWorld> {
  await assertInvariants(c.host, label);
  if (c.host.lastWorld === undefined) throw new Error(`the invariants must have read a world after ${label}`);
  return c.host.lastWorld;
}

/** The common final state: archived, request cleared, one anchor and one requeue. */
async function expectArchived(c: Interrupted, requestId: string): Promise<ArchiveLineResultV1> {
  const result = await resume(c, requestId);
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`the archive continuation must be ready: ${JSON.stringify(result)}`);
  expect(result.value).toMatchObject({ state: 'archived', message: '已归档', pendingOn: null, rejection: null,
    session: { lifecycle: 'archived', archiveRequest: null } });
  // D10: a plain continuation after finalization reports CURRENT state only.
  const before = { files: c.host.counts(), ledger: ledgerCounts(c.host.database) };
  const current = ready(await resume(c, requestId));
  expect(current).toEqual({ ...result.value, receipts: [] });
  expect({ files: c.host.counts(), ledger: ledgerCounts(c.host.database) }).toEqual(before);
  await assertInvariants(c.host, `the archive of ${requestId} finished`, stepOf(c.host, 'other', 'archive finished'));
  // Replaying the ORIGINAL GraphWrite is the only way to obtain write receipts.
  const replay = ready(await archiveLine(c, requestId));
  expect(replay.session).toEqual(current.session);
  // IT19 can already be stopped by takeover before its first cancel commits.
  // Such a natural stopped fact needs no invented cancel receipt (spec 2.3).
  expect(replay.receipts.filter(receipt => receipt.step !== 'stop').map(receipt => receipt.step))
    .toEqual(['anchor', 'responsibility', 'requeue', 'archive']);
  expect(replay.receipts.filter(receipt => receipt.step === 'stop').length).toBeLessThanOrEqual(1);
  for (const receipt of replay.receipts) expect(receipt.replayed).toBe(true);
  const second = ready(await archiveLine(c, requestId));
  expect(second).toEqual(replay);
  expect({ files: c.host.counts(), ledger: ledgerCounts(c.host.database) }).toEqual(before);
  return replay;
}

async function sourceRunRefs(c: Interrupted): Promise<RunRef[]> {
  const world = await worldOf(c, 'read the source Session execution history');
  return world.outboxes.filter(box => box.claim.sessionRef.sessionId === c.sessionRef.sessionId)
    .map(box => box.claim.runRef);
}

async function sourceLink(c: Interrupted) {
  const card = ready(await c.host.post<ReadResult<SessionCard>>('sessions/read', plain(AG2B_SCOPE, c.sessionRef)));
  const links = card.links.filter(link => link.ref.relation === 'responsible'
    && canonicalJson(link.ref.target as JsonValue) === canonicalJson(WORK_TARGET as JsonValue));
  expect(links).toHaveLength(1);
  return links[0]!;
}

it('IT19 (request committed): the Host crashes right after the archive request commits; the next Host resumes the original request, archives the line, runs nothing new on the old Session and carries the anchor into the successor brief', async () => {
  const c = await openInterrupted('it19', 1);
  const requestId = 'it19-archive';
  // The stop commit is the step after the request: failing it leaves the durable
  // request as the crash point's only committed fact.
  const stopFault = failCommitOf(c.host.database, 'ControlIntentSubmitted');
  let first: ReadResult<ArchiveLineResultV1> | undefined;
  try {
    first = await archiveLine(c, requestId);
  } finally {
    stopFault.drop();
  }
  if (first === undefined) throw new Error('the archive request must be readable');
  expect(first).toMatchObject({ status: 'ready' });
  if (first.status !== 'ready') throw new Error(`the archive request must answer ready: ${JSON.stringify(first)}`);
  const requestReceipt = first.value.session.archiveRequest?.receipt ?? null;
  expect(requestReceipt, 'the committed request keeps the receipt it handed the caller').not.toBeNull();
  const accepted = ready(await (await c.host.direct()).sessions.readSessionArchiveRequestReceipt(
    hostCtx(c.host.stepActor()), archiveRequest(c, requestId)));
  expect(accepted.session).toEqual(first.value.session);
  await c.host.restart({ crash: true });
  const done = await expectArchived(c, requestId);
  const countsBeforeRead = { files: c.host.counts(), ledger: ledgerCounts(c.host.database) };
  expect(ready(await (await c.host.direct()).sessions.readSessionArchiveRequestReceipt(
    hostCtx(c.host.stepActor()), archiveRequest(c, requestId)))).toEqual(accepted);
  expect({ files: c.host.counts(), ledger: ledgerCounts(c.host.database) }).toEqual(countsBeforeRead);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
  const world = await worldOf(c, 'the archive of IT19 finished');
  expect(world.anchors ?? []).toHaveLength(1);
  expect(world.anchors?.[0]?.archiveRequestReceipt, 'the anchor keeps the originally handed request receipt').toEqual(requestReceipt);
  // The old Session gets no new Run; the successor Run's brief carries the anchor.
  const next = await c.host.advance(c.host.select('it19-after', AG2B_WORK_TASK_ID));
  expect(next.state).toBe('completed');
  const successor = await selectedRun(c.host);
  expect(successor.runId).not.toBe(c.runRef.runId);
  const bound = await briefOf(c.host.host, successor);
  expect(bound?.brief.anomalies?.anchors).toHaveLength(1);
  expect(bound?.brief.anomalies?.anchors.map(anchor => anchor.ref)).toEqual([world.anchors![0]!.ref]);
  const after = await worldOf(c, 'IT19 successor entered');
  const successorClaim = after.outboxes.find(box => box.claim.runRef.runId === successor.runId)?.claim;
  expect(successorClaim).toBeDefined();
  expect(successorClaim!.sessionRef.sessionId).not.toBe(c.sessionRef.sessionId);
  expect(await sourceRunRefs(c)).toEqual([c.runRef]);
  expect(done.session.ref).toEqual({ aggregateType: 'Session', ...c.sessionRef });
}, 120_000);

it('IT21 (stop committed): the stop is queued while the Run is still running; the Host crashes and the next Host resumes the request, archives the line, keeps the original stop intent and starts no new Run on the old Session', async () => {
  const c = await openInterrupted('it21');
  const requestId = 'it21-archive';
  const first = await archiveLine(c, requestId);
  expect(first).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中 · 停止中' } });
  if (first.status !== 'ready') throw new Error(`the archive line must answer ready: ${JSON.stringify(first)}`);
  const stopReceipt = identityOf(stepReceiptOf(first.value, 'stop'));
  const atStop = await worldOf(c, 'the stop of IT21 is committed');
  const stops = atStop.intents.filter((intent) => intent.kind === 'cancel');
  expect(stops).toHaveLength(1);
  const stopIntentId = stops[0]!.ref.intentId;
  await c.host.restart({ crash: true });
  const done = await expectArchived(c, requestId);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
  const world = await worldOf(c, 'the archive of IT21 finished');
  // The original stop intent is reused: the same id, its original receipt cursor, no second intent.
  expect(identityOf(stepReceiptOf(done, 'stop'))).toEqual(stopReceipt);
  expect(world.intents.filter((intent) => intent.kind === 'cancel').map((intent) => intent.ref.intentId)).toEqual([stopIntentId]);
  expect(world.anchors ?? []).toHaveLength(1);
  expect(await sourceRunRefs(c)).toEqual([c.runRef]);
}, 120_000);

it('IT22 (anchor committed): the Host crashes right after the anchor commits; the anchor keeps its original body and cursor, the next Host archives the line and still writes exactly one anchor and one requeue', async () => {
  const c = await openInterrupted('it22');
  const requestId = 'it22-archive';
  const pending = await archiveLine(c, requestId);
  expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending' } });
  if (pending.status !== 'ready') throw new Error(`the archive request must answer ready: ${JSON.stringify(pending)}`);
  // The step after the anchor is the responsibility write: failing it leaves the
  // anchor as the crash point. The fault is armed before the restart, so the
  // start-up maintenance that resumes the durable request meets it as well.
  const fault = failCommitOf(c.host.database, 'SessionResponsibilityChanged');
  let partial: ReadResult<ArchiveLineResultV1> | undefined;
  try {
    await c.host.restart({ crash: true });
    partial = await resume(c, requestId);
  } finally {
    fault.drop();
  }
  if (partial === undefined) throw new Error('the partial archive must be readable');
  expect(partial).toMatchObject({ status: 'ready', value: { state: 'partial', message: '处置已完成，归档没成功' } });
  if (partial.status !== 'ready') throw new Error(`the partial archive must answer ready: ${JSON.stringify(partial)}`);
  const anchorReceipt = identityOf(stepReceiptOf(partial.value, 'anchor'));
  const atAnchor = await worldOf(c, 'the anchor of IT22 is committed');
  expect(atAnchor.anchors ?? []).toHaveLength(1);
  const anchor = atAnchor.anchors![0]!;
  expect(eventCount(c.host, 'SessionAnomalyRecorded')).toBe(1);
  await c.host.restart({ crash: true });
  const done = await expectArchived(c, requestId);
  const finalWorld = await worldOf(c, 'the archive of IT22 finished');
  expect(finalWorld.anchors ?? []).toHaveLength(1);
  expect(finalWorld.anchors?.[0], 'the anchor keeps its original body').toEqual(anchor);
  expect(identityOf(stepReceiptOf(done, 'anchor')), 'the anchor keeps its original cursor').toEqual(anchorReceipt);
  expect(eventCount(c.host, 'SessionAnomalyRecorded')).toBe(1);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
}, 120_000);

it('IT23 (responsibility committed): the Host crashes right after the responsibility write; the closed link keeps its original cursor and is not reopened, and the line still ends archived with one anchor and one requeue', async () => {
  const c = await openInterrupted('it23');
  const originalLink = structuredClone(await sourceLink(c));
  expect(originalLink.until).toBeNull();
  const requestId = 'it23-archive';
  const pending = await archiveLine(c, requestId);
  expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending' } });
  if (pending.status !== 'ready') throw new Error(`the archive request must answer ready: ${JSON.stringify(pending)}`);
  // The step after the responsibility write is the requeue: failing it leaves the
  // responsibility (the closed link) as the crash point, armed before the restart.
  const fault = failCommitOf(c.host.database, 'TaskRequeued');
  let partial: ReadResult<ArchiveLineResultV1> | undefined;
  try {
    await c.host.restart({ crash: true });
    partial = await resume(c, requestId);
  } finally {
    fault.drop();
  }
  if (partial === undefined) throw new Error('the partial archive must be readable');
  expect(partial).toMatchObject({ status: 'ready', value: { state: 'partial' } });
  if (partial.status !== 'ready') throw new Error(`the partial archive must answer ready: ${JSON.stringify(partial)}`);
  const linkClose = identityOf(stepReceiptOf(partial.value, 'responsibility'));
  const closedLink = structuredClone(await sourceLink(c));
  expect(closedLink.until).toEqual(linkClose.cursor);
  expect(closedLink.since).toEqual(originalLink.since);
  expect(closedLink.revision).toBe(originalLink.revision + 1);
  const atClose = await worldOf(c, 'the responsibility of IT23 is committed');
  expect(atClose.anchors ?? []).toHaveLength(1);
  await c.host.restart({ crash: true });
  const done = await expectArchived(c, requestId);
  const finalWorld = await worldOf(c, 'the archive of IT23 finished');
  expect(identityOf(stepReceiptOf(done, 'responsibility')), 'the closed link keeps its original cursor').toEqual(linkClose);
  expect(await sourceLink(c), 'same since, until and revision; never reopened').toEqual(closedLink);
  expect(eventCount(c.host, 'SessionAnomalyRecorded')).toBe(1);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
  expect(finalWorld.anchors ?? []).toHaveLength(1);
}, 120_000);

it('IT24 (requeue committed): the Host crashes right after the requeue; the original TaskRequeued value and cursor are reused, no extra Attempt, Run or model call is made, and the line still ends archived', async () => {
  const c = await openInterrupted('it24');
  const requestId = 'it24-archive';
  const pending = await archiveLine(c, requestId);
  expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending' } });
  if (pending.status !== 'ready') throw new Error(`the archive request must answer ready: ${JSON.stringify(pending)}`);
  // The step after the requeue is the final archive: failing it leaves the
  // requeue as the crash point, armed before the restart.
  const fault = failCommitOf(c.host.database, 'SessionArchived');
  let partial: ReadResult<ArchiveLineResultV1> | undefined;
  try {
    await c.host.restart({ crash: true });
    partial = await resume(c, requestId);
  } finally {
    fault.drop();
  }
  if (partial === undefined) throw new Error('the partial archive must be readable');
  expect(partial).toMatchObject({ status: 'ready', value: { state: 'partial' } });
  if (partial.status !== 'ready') throw new Error(`the partial archive must answer ready: ${JSON.stringify(partial)}`);
  const requeueReceipt = identityOf(stepReceiptOf(partial.value, 'requeue'));
  const atRequeue = await worldOf(c, 'the requeue of IT24 is committed');
  expect(atRequeue.requeues).toHaveLength(1);
  const requeue = atRequeue.requeues[0]!;
  const attempts = atRequeue.attempts.length;
  const runs = atRequeue.runs.length;
  const modelCalls = c.host.counts().modelCalls;
  await c.host.restart({ crash: true });
  const done = await expectArchived(c, requestId);
  const finalWorld = await worldOf(c, 'the archive of IT24 finished');
  expect(finalWorld.requeues, 'the original TaskRequeue value is reused').toEqual([requeue]);
  expect(identityOf(stepReceiptOf(done, 'requeue')), 'the requeue keeps its original cursor').toEqual(requeueReceipt);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
  expect(finalWorld.attempts, 'no extra Attempt').toHaveLength(attempts);
  expect(finalWorld.runs, 'no extra Run').toHaveLength(runs);
  expect(c.host.counts().modelCalls, 'no extra model call').toBe(modelCalls);
}, 120_000);

it('IT25 (final committed, response lost): the final archive commits but its answer never reaches the caller; after the restart the same request replays the original archived Session and receipt, clears the request and adds no stop, anchor or requeue', async () => {
  const c = await openInterrupted('it25');
  const requestId = 'it25-archive';
  const pending = await archiveLine(c, requestId);
  expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending' } });
  if (pending.status !== 'ready') throw new Error(`the archive request must answer ready: ${JSON.stringify(pending)}`);
  const stopReceipt = identityOf(stepReceiptOf(pending.value, 'stop'));
  // Stop startup immediately BEFORE final, then lose the HTTP response of the
  // real final commit. Merely ignoring a successful startup is not response loss.
  const fault = failCommitOf(c.host.database, 'SessionArchived');
  try {
    await c.host.restart({ crash: true });
    const partial = ready(await resume(c, requestId));
    expect(partial.state).toBe('partial');
  } finally { fault.drop(); }
  const lost: { value?: ReadResult<ArchiveLineResultV1> } = {};
  await expect(loseResponse<ReadResult<ArchiveLineResultV1>>(
    () => corePost(c.host.host.base, 'sessions/archive-line', c.host.host.token,
      { scope: AG2B_SCOPE, request: archiveRequest(c, requestId) }),
    value => { lost.value = structuredClone(value); },
  )).rejects.toThrow('S1 injected transport loss after the durable response');
  if (lost.value === undefined) throw new Error('the final HTTP response never reached the transport fault');
  const original = ready(lost.value);
  expect(original).toMatchObject({ state: 'archived', session: { lifecycle: 'archived', archiveRequest: null } });
  const originalFinal = identityOf(stepReceiptOf(original, 'archive'));
  const beforeRestart = await worldOf(c, 'IT25 final durable, response lost');
  expect(beforeRestart.sessions.find(session => session.ref.sessionId === c.sessionRef.sessionId)).toEqual(original.session);
  await c.host.restart({ crash: true });
  const beforeReplay = { files: c.host.counts(), ledger: ledgerCounts(c.host.database) };
  const replayed = await archiveLine(c, requestId);
  expect(replayed).toMatchObject({ status: 'ready', value: { state: 'archived', message: '已归档', pendingOn: null, rejection: null,
    session: { lifecycle: 'archived', archiveRequest: null } } });
  if (replayed.status !== 'ready') throw new Error(`the archive replay must be ready: ${JSON.stringify(replayed)}`);
  const world = await worldOf(c, 'the archive reply of IT25 replayed');
  expect(replayed.value.session.ref).toEqual({ aggregateType: 'Session', ...c.sessionRef });
  expect(replayed.value.session).toEqual(original.session);
  expect(replayed.value).toEqual({ ...original,
    receipts: original.receipts.map(receipt => ({ ...receipt, replayed: true })) });
  expect(stepReceiptOf(replayed.value, 'archive').replayed).toBe(true);
  expect(identityOf(stepReceiptOf(replayed.value, 'archive'))).toEqual(originalFinal);
  expect(identityOf(stepReceiptOf(replayed.value, 'stop')), 'the original stop receipt is unchanged').toEqual(stopReceipt);
  expect(world.intents).toEqual(beforeRestart.intents);
  expect(world.anchors).toEqual(beforeRestart.anchors);
  expect(world.requeues).toEqual(beforeRestart.requeues);
  expect(ready(await resume(c, requestId))).toEqual({ ...replayed.value, receipts: [] });
  expect({ files: c.host.counts(), ledger: ledgerCounts(c.host.database) }).toEqual(beforeReplay);
  expect(eventCount(c.host, 'SessionAnomalyRecorded')).toBe(1);
  expect(eventCount(c.host, 'TaskRequeued')).toBe(1);
  expect(world.anchors ?? []).toHaveLength(1);
}, 120_000);
