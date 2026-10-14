/**
 * Wiring package 1, group W19 (spec §5.2 rows SC01-SC02; §0 L7-L9, L15, §5.1).
 *
 * SC01 (E15, ordinary continuation handover; K slice KA-07 and L8): a human
 * pause + Host restart leaves T paused-interrupted and P with `kernel_turn_open`;
 * the human's continue re-queues T. With the Kernel closure available, advancing
 * to the end closes P's dangling Kernel Turn (`close_open_turn`) and claims T in
 * P again in a new Run: no new Session, no transfer, no archive, no anomaly
 * anchor. With the closure unsupported (K L8), the `close_open_turn` step answers
 * `unsupported` and advancing to the end must build the new Session, transfer P's
 * responsibility for T and then archive P as `handoff_complete` by maintenance,
 * with no anomaly anchor and no `archive_predecessor` step.
 *
 * SC02 (I-3, extension rows): the operator archives the running line (drop) ->
 * anchor A; the next Session's prepare must advertise `extensions.anomalies`
 * `available`, carry A as one reminder row and in the continuation brief's
 * anomaly section, not print "异常锚点投影尚未接入", and after the anchor is
 * picked up a fresh Goal read must report an empty anomalies row list.
 *
 * The fixture performs every step through the real production entry points and
 * already calls `assertInvariants` after every step (`checkStep` inside `drive`,
 * plus its own explicit calls). These cases never build state by hand and never
 * call a real model.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { sessionAnomalyRefKey } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import {
  cleanupWP1Scenarios, openArchivedLineScenario, openPausedInterruptedScenario,
} from '../helpers/WP1-scenario-fixture.js';
import { ready } from '../helpers/S1-runtime-scenario-fixture.js';
import { execution } from './support/common.js';

afterEach(cleanupWP1Scenarios);

// K slice: the fallback copy switches the Kernel's `closeOpenTurn` off, so the
// Runtime's closure answers `unsupported` (K L4 step 5) and the Workflow takes
// today's new-Session path (K L8).
const kernelClosure = vi.hoisted(() => ({ supported: true }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true,
    get: () => (kernelClosure.supported ? actual['closeOpenTurn'] : undefined) });
});
afterEach(() => { kernelClosure.supported = true; });

it('SC01 (closing supported; KA-07) human pause + Host restart, continue: the Workflow closes P\'s dangling Kernel Turn and T continues in P in a new Run with no new Session, transfer or archive; T completes satisfied, no anchor', async () => {
  const f = await openPausedInterruptedScenario();
  await f.clickContinue();
  const trace = await f.advanceToEnd();

  // K L7 (KA2, KA3): the human's TaskRequeue authorizes closing the paused line
  // (L4 item 2; maintenance never closes it), so the received steps contain
  // close_open_turn, then claim_task in P, and no create_session, transfer or
  // archive (KA-07).
  const lineKinds = trace.performedKinds
    .filter(kind => ['close_open_turn', 'create_session', 'transfer_responsibility', 'claim_task', 'archive_predecessor'].includes(kind));
  expect(lineKinds).toEqual(['close_open_turn', 'claim_task']);
  expect(trace.receipts.find(receipt => receipt.kind === 'close_open_turn'))
    .toMatchObject({ result: { status: 'closed', health: 'available' } });

  // T completes normally and the Goal-level drive reaches completion.
  expect(trace.state).toBe('completed');
  const task = await f.readTask();
  expect(task.effectivePhase).toBe('satisfied');

  // KA-07: the same Session, a new Run.
  if (task.execution === null) throw new Error('SC01: T must select a Run');
  expect(task.execution.runId).not.toBe(f.runRef.runId);
  expect((await execution(f.harness, task.execution)).session.ref.sessionId).toBe(f.P.sessionId);

  // P is available again (SES-13) and is not archived.
  expect((await f.readSession()).record).toMatchObject({ lifecycle: 'active', health: 'available' });

  // The whole scenario wrote no anomaly anchor (L14; read through the public anomalies route) and T carries no
  // archive label.
  expect(await f.readAnomalies()).toEqual([]);
  expect(ready(await f.readArchiveState()).label).toBeNull();
});

it('SC01 (closing unsupported) human pause + Host restart, continue: the continuation handover creates, transfers and then archives P, T completes satisfied, no anchor', async () => {
  // K L8: from the first start on (the builder restarts the Host inside) the Kernel has no `closeOpenTurn`.
  kernelClosure.supported = false;
  const f = await openPausedInterruptedScenario();
  await f.clickContinue();
  const trace = await f.advanceToEnd();

  // K L7: the close_open_turn step comes first and answers `unsupported` (a
  // definite failure), so today's continuation handover follows (K L8).
  // The received steps contain create_session, transfer_responsibility, claim_task
  // in this order and no archive_predecessor (L12: P retires, so maintenance
  // archives it in its own page rather than in a combined handover step).
  const handoverKinds = trace.performedKinds
    .filter(kind => ['close_open_turn', 'create_session', 'transfer_responsibility', 'claim_task', 'archive_predecessor'].includes(kind));
  expect(handoverKinds).toEqual(['close_open_turn', 'create_session', 'transfer_responsibility', 'claim_task']);
  expect(trace.receipts.find(receipt => receipt.kind === 'close_open_turn'))
    .toMatchObject({ result: { status: 'unsupported' } });
  expect(trace.performedKinds).not.toContain('archive_predecessor');

  // T completes normally and the Goal-level drive reaches completion.
  expect(trace.state).toBe('completed');
  expect((await f.readTask()).effectivePhase).toBe('satisfied');

  // P is archived by maintenance with the handover-complete mode.
  expect((await f.readSession()).record.lifecycle).toBe('archived');
  const archiveRequests = f.readArchiveRequests();
  expect(archiveRequests.map(request => request.mode)).toEqual(['handoff_complete']);

  // P's responsibility link to T is closed exactly at the transfer receipt cursor.
  const transfer = trace.receipts.find(receipt => receipt.kind === 'transfer_responsibility');
  if (transfer === undefined || transfer.kind !== 'transfer_responsibility') {
    throw new Error('SC01: no transfer_responsibility receipt was produced');
  }
  if (transfer.result.status !== 'committed') {
    throw new Error(`SC01: transfer_responsibility was not committed: ${JSON.stringify(transfer.result)}`);
  }
  const pCard = await f.readSession();
  const tLink = pCard.links.find(link => link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' && link.ref.target.ref.taskId === f.T.taskId);
  if (tLink === undefined) throw new Error('SC01: P no longer has a responsibility link to T');
  expect(tLink.until).toEqual(transfer.result.cursor);

  // The whole scenario wrote no anomaly anchor (L14) and T carries no archive label.
  expect(await f.readAnchors()).toEqual([]);
  expect(ready(await f.readArchiveState()).label).toBeNull();
});

it('SC02 operator archive-line(drop) -> anchor A: the prepared binding exposes the anomaly row and the brief lists A; after pickup the Goal read has no rows', async () => {
  const f = await openArchivedLineScenario();
  // Given sanity: archiving the running line produces the archive_interrupted anchor.
  expect(f.A.cause).toBe('archive_interrupted');

  const prepared = await f.advanceUntilPrepared();

  // The prepared manifest's binding advertises the live anomaly projection (I-3).
  expect(prepared.binding.extensions.anomalies).toBe('available');

  // The reminders section carries A's one deterministic index row (L9/§4.2).
  const expectedRow = {
    key: `anomaly:${sessionAnomalyRefKey(f.A.ref)}`,
    node: { kind: 'task', ref: f.A.task, planRef: f.A.planRef },
    text: `中断，待核对：任务 ${f.A.task.taskId} 的执行 ${f.A.runRef.runId} 被归档中断，改动没撤销也没核对`,
    sources: [{ kind: 'record', ref: f.A.ref, revision: 1, digest: null }],
  };
  const remindersSection = prepared.binding.sections.find((section) => section.name === 'reminders');
  if (remindersSection?.startByte == null || remindersSection.endByte == null) {
    throw new Error('SC02 needs a real reminders section interval');
  }
  const remindersBytes = Buffer.from(prepared.input, 'utf8')
    .subarray(remindersSection.startByte, remindersSection.endByte).toString('utf8');
  expect(remindersBytes).toContain(canonicalJson(expectedRow as unknown as JsonValue));

  // The continuation brief's anomaly section also lists the same anchor A.
  const briefAnchors = prepared.manifest.continuationBrief?.anomalies?.anchors ?? [];
  expect(briefAnchors.map(anchor => anchor.ref)).toEqual([f.A.ref]);

  // With the real projection available the old "not_implemented" reminder is gone.
  expect(prepared.input).not.toContain('异常锚点投影尚未接入');

  // The Run enters and completes; the picked-up anchor leaves no pending rows.
  const drive = await f.enterAndComplete();
  expect(drive.state).toBe('completed');
  expect((await f.readTask()).effectivePhase).toBe('satisfied');
  const facts = ready(await f.readGoalContextFacts());
  expect(facts.extensions.anomalies.availability).toBe('available');
  expect(facts.extensions.anomalies.rows).toEqual([]);
});
