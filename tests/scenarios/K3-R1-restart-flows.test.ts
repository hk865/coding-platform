/**
 * K3 group 2 part 3, work item 3 (R1 business flows K3-01, K3-02, K3-03;
 * spec §5.2 lines 1408-1410; lead rulings 3 and 4).
 *
 * R1 = `HostScenario` with `restart({ crash: true })`, the real SQLite and lease
 * file, `workflow.advanceWork` through `h.advance`. Crash points are the existing
 * `lockLedgerAfter` seam (A8-3j): a composition root on the same files starts the
 * prepared Run and the test takes the ledger + Kernel write locks right after the
 * named commit, then the Host is restarted as a crash (HL-03).
 *
 * Ruling 3: advance only until the continuation is claimed and prepared (the
 * stop-before-`start` step). The continuation note lives in the prepared
 * manifest Artifact, opened through the public `materials/open` route
 * (9(b)); `executions/brief` cannot answer at prepare because
 * `inputBinding.continuationBriefDigest` is bound at start (RUN-02), and that
 * gap is reported. "Sent once" is read through `messages/outbox`. No check runs.
 *
 * Ruling 4 (K3-03): the item `undetermined` (`lookup_failed`) and the record
 * `needs_decision` with `undetermined` are asserted; K3 group 4 B1 adds the
 * card in the queue and the absence of a continuation (no new record case).
 *
 * Production gaps found while writing this (reported to the coordinator, fixed
 * in parallel; these tests are the RED spec):
 *  - `create-platform.ts` capture artifact put with `sourceRefs: []` fails the
 *    body codec, so RUN-25 blocks (`workspace_read_failed`) instead of applying;
 *  - `mailbox-service.ts` lookupToolCommit derives the sender from ctx instead
 *    of `input.origin`, so a committed send answers `not_committed`;
 *  - `runtime.ts` closeOpenTurn refuses a `takeover_unresolved` end, so the
 *    Kernel is not closed and the continuation goes to a new Session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { mailboxSeam, type MailboxSeam } from '../helpers/K3-mailbox-seam.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { lockLedgerAfter, openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';
import { outboxMessages, preparedBriefOf } from './support/brief.js';
// --- K3-02 seam: the switchable blocking `send_session_message` handler. ----
const mailboxSeams = vi.hoisted(() => ({ seam: undefined as unknown }));
vi.mock('../../src/core/agent-runtime/communication-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/communication-tools.js')>();
  return {
    ...actual,
    createSessionMailboxTools: (config: Parameters<typeof actual.createSessionMailboxTools>[0]) => {
      const handle = actual.createSessionMailboxTools(config);
      return {
        ...handle,
        create: (workspace: Parameters<typeof handle.create>[0]) => handle.create(workspace).map((definition) =>
          definition.name === 'send_session_message'
            ? { ...definition, handler: { ...definition.handler,
                execute: (call: never, options: never) =>
                  (mailboxSeams.seam as MailboxSeam).run(definition.handler, call, options) } }
            : definition),
      };
    },
  };
});
mailboxSeams.seam = mailboxSeam;

afterEach(async () => { await cleanupScenarios(); await cleanupRestart(); });

type Crashed = {
  recipient: { projectId: string; sessionId: string };
  prepared: ReturnType<typeof preparedOf>;
  oldRunRef: ReturnType<typeof preparedOf>['claim']['runRef'];
  oldSession: ReturnType<typeof preparedOf>['claim']['sessionRef'];
  report: Awaited<ReturnType<HostScenario['restart']>>;
};

/**
 * K3-01's crash point when `crashEvent` is `SessionMessageSent` (the message
 * committed, the Kernel result never recorded) and K3-02's when it is
 * `ModelRequestEvidenceRecorded` (before the message commit). The send is a
 * an explicit inquiry wait message so the Kernel yields; the caller drives on.
 */
async function crashSendFlow(h: HostScenario, label: string, crashEvent: string,
  options: { armLookupFailure?: boolean } = {}): Promise<Crashed> {
  const recipient = (await createAG2bSession(h.host, `${label}-recipient`, AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  const toStart = await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  const lock = lockLedgerAfter(h.database, crashEvent, { kernelStore: true });
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: `${label}-send`, name: 'send_session_message',
    args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: `${label} question`, intent: 'inquiry', needsReply: true, waitAfterSend: true } }] }]);
  const root = await openWorkRoot(h, model, lock.observer);
  try {
    await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` });
  } finally { lock.release(); await root.close(); }
  expect(lock.locked(), `${label}: the locks were taken at ${crashEvent}`).toBe(true);
  expect(model.calls(), `${label}: one model reply, the send`).toBe(1);
  if (options.armLookupFailure === true) h.failNextLookupCommitOnce();
  const report = await h.restart({ crash: true });
  return { recipient, prepared, oldRunRef: prepared.claim.runRef, oldSession: prepared.claim.sessionRef, report };
}

/**
 * K3-02's crash point: the Kernel records `tool.started` for the send, then the
 * blocking mailbox stand-in stops BOTH the message commit and the Kernel result.
 * The restart therefore sees an unresolved call whose platform lookup answers
 * `not_committed`. See tests/helpers/K3-mailbox-seam.ts.
 */
async function crashSendBeforeMessage(h: HostScenario, label: string): Promise<Crashed> {
  const recipient = (await createAG2bSession(h.host, `${label}-recipient`, AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  const toStart = await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  mailboxSeam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: `${label}-send`, name: 'send_session_message',
    args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: `${label} question`, intent: 'inquiry', needsReply: true, waitAfterSend: true } }] }]);
  const root = await openWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let report: Awaited<ReturnType<HostScenario['restart']>>;
  try {
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` });
    await mailboxSeam.waitForCall();
    report = await h.restart({ crash: true });
  } finally {
    mailboxSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }
  expect(mailboxSeam.calls.map(call => call.callId), `${label}: the stand-in held the send`).toEqual([`${label}-send`]);
  return { recipient, prepared, oldRunRef: prepared.claim.runRef, oldSession: prepared.claim.sessionRef, report };
}

function reviewOf(h: HostScenario, runRef: Crashed['oldRunRef']): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}
/** The continuation note: the brief carried by the prepared manifest of the claimed continuation Run. */
async function noteOf(h: HostScenario, prepared: Crashed['prepared']): Promise<string> {
  const brief = await preparedBriefOf(h, prepared.envelope.bundleRef);
  return renderContinuationBriefZh(brief, continuationBriefDigest(brief));
}

describe('K3 R1 restart flows', () => {
  it('K3-01 (W-26, L2/L4/L24/L25; decision 52): a committed send without a Kernel result is auto-closed, resolved done, and the same Session claims the continuation', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashSendFlow(h, 'k3-01', 'SessionMessageSent');
    const { oldRunRef, oldSession, report } = crashed;

    // The Host's report line: W-26, takeover_unresolved, autoCleanup applied.
    expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(oldRunRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });

    // The Run: crashed, takeover_unresolved, hl03_stale_lock with the old instance id and pid.
    const read = await reviewOf(h, oldRunRef);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const review = read.value;
    expect(review).toMatchObject({
      status: 'resolved',
      origin: { kind: 'takeover_unresolved', hostInstanceId: report.hostInstanceId,
        proof: { kind: 'hl03_stale_lock', previousInstanceId: 'a2-crashed-host', previousPid: expect.any(Number) } },
      items: [{ alias: 1, callId: 'k3-01-send', toolName: 'send_session_message', kind: 'platform' }],
    });
    // The message committed, so the platform lookup is `done`, evidenced by the receipt cursor.
    expect(review.items[0]?.observed).toMatchObject({ verdict: 'done', by: 'platform', evidence: { kind: 'receipt' } });
    const evidence = review.items[0]?.observed;
    // 9(b′): the platform receipt carries the cursor and eventIds the verdict is based on.
    if (evidence?.verdict === 'done') {
      expect(evidence.evidence).toMatchObject({ kind: 'receipt', cursor: expect.any(String),
        eventIds: expect.arrayContaining([expect.any(String)]) });
    }
    expect(review.decisionReasons).toEqual([]);

    // Start-up maintenance already closed the crashed Turn: the original
    // Session is available again and still points at the original Run.
    const maintained = await readExecution(h.host, oldRunRef);
    expect(maintained.session.health).toBe('available');
    expect(maintained.session.lastExecutionRef?.runId).toBe(oldRunRef.runId);

    // Advance: the ORIGINAL Session claims the continuation.
    const toContinue = await h.advance(h.select('k3-01', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toContinue.next);
    expect(prepared.claim.sessionRef, 'the original Session claims the continuation').toEqual(oldSession);
    expect(prepared.claim.runRef.runId).not.toBe(oldRunRef.runId);

    // 9(b): "sent once" through the public outbox, not the ledger table.
    expect(await outboxMessages(h, oldSession), 'the message is not re-sent').toHaveLength(1);

    // The continuation note renders the review section with verdict 已做 and the fixed sentence.
    // The prepared manifest's brief also names the afterRun (the crashed Run), read publicly.
    const brief = await preparedBriefOf(h, prepared.envelope.bundleRef);
    expect(brief.requeueRef, 'the continuation requeues after the crashed Run').toMatchObject({ afterRunId: oldRunRef.runId });
    const note = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(note).toContain('### 结果未知的调用：核对和处置');
    expect(note).toContain('已做');
    expect(note).toContain('- 不在变动清单里，不证明没做。');

    // The "请知悉" notice: one 自动恢复 entry, not counted.
    const notices = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue', plain(AG2B_SCOPE,
      { workspace: AG2B_SCOPE, sections: ['notices'], categories: ['automatic_rework'], page: { limit: 20 } }));
    expect(notices.status).toBe('ready');
    if (notices.status === 'ready') {
      const auto = notices.value.notices.filter(notice => notice.summary.includes('自动恢复'));
      expect(auto).toHaveLength(1);
      expect(auto[0]?.summary).toContain('不计次');
    }
  }, 180_000);

  it('K3-02 (L4): the crash lands before the message commit, so the item is not_done and the note says 没做', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashSendBeforeMessage(h, 'k3-02');
    const { oldRunRef, oldSession, report } = crashed;

    // No message ever committed: the public outbox of the crashed Run's Session is empty.
    expect(await outboxMessages(h, oldSession), 'no message was sent').toHaveLength(0);

    expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(oldRunRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });

    const read = await reviewOf(h, oldRunRef);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const review = read.value;
    expect(review).toMatchObject({
      status: 'resolved',
      items: [{ alias: 1, callId: 'k3-02-send', toolName: 'send_session_message', kind: 'platform',
        observed: { verdict: 'not_done', by: 'platform', evidence: { kind: 'not_committed' } } }],
    });

    const toContinue = await h.advance(h.select('k3-02', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toContinue.next);
    const note = await noteOf(h, prepared);
    expect(note).toContain('没做');
    expect(note).toContain('- 不在变动清单里，不证明没做。');
  }, 180_000);

  it('K3-03 (ruling 4, L4/L17): the one lookupCommit failure leaves the item undetermined (lookup_failed) and the record needs_decision', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashSendFlow(h, 'k3-03', 'SessionMessageSent', { armLookupFailure: true });
    const { oldRunRef, report } = crashed;

    // RUN-25 still applies (the plan lookup failure is recorded, not blocking).
    expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(oldRunRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });

    const read = await reviewOf(h, oldRunRef);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    const review = read.value;
    expect(review).toMatchObject({
      status: 'needs_decision',
      items: [{ alias: 1, callId: 'k3-03-send', toolName: 'send_session_message', kind: 'platform',
        observed: { verdict: 'undetermined', by: 'platform', evidence: { kind: 'lookup_failed' } } }],
    });
    expect(review.decisionReasons).toContain('undetermined');

    // K3-03 card part (L17/L18): the record's card is waiting. The one item is
    // a platform `send_session_message`, so D7/L18 gives the card THREE options
    // (no `safer_method`: there is no proposable command), and its source is
    // advertised available.
    const queueRead = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
      plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
    expect(queueRead.status).toBe('ready');
    if (queueRead.status !== 'ready') return;
    const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: review.ref, revision: review.revision });
    const card = queueRead.value.waitingAnswer.find(entry => entry.source.key === key);
    expect(card, 'the needs_decision review record has its card').toBeDefined();
    expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      source: { kind: 'unknown_call_review', goalRef: { goalId: AG2B_GOAL_REF.goalId } },
      options: [{ id: 'rerun_as_is' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
    expect(queueRead.value.capabilities)
      .toContainEqual({ source: 'unknown_call_review', availability: 'available' });

    // No continuation: the open record gates every claim/requeue (L11), so
    // advancing this Task settles `waiting` without preparing another Run.
    const gate = await h.advance(h.select('k3-03-no-continuation', AG2B_WORK_TASK_ID), { maxSteps: 16 });
    expect(gate.state).toBe('waiting');
    expect(gate.receipts.map(receipt => receipt.kind)).not.toContain('prepare');
    expect(gate.receipts.map(receipt => receipt.kind)).not.toContain('start');
  }, 180_000);
});
