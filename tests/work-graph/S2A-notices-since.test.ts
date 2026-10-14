/**
 * Slice 2A QE3, Group N: QA-13, the archive wait disposal must keep the
 * message's creation commit position (`since`), so the disposed user
 * notification still sorts and filters by commit position in the notices.
 *
 * The dataset is the real S5 world: a real user notification with a wait, a
 * real yielded Run, a real archive request and the real `disposeArchiveWait`.
 * Assertions read only the public `queryDecisionQueue` and `markNoticesSeen`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { GOAL_B, T, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { committed, mailboxDependencies, pin, ready, workContext } from '../helpers/S5-queue-support.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { noticesHarness } from '../helpers/S2A-notices-support.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';

/** Ends the entered Run as `run_yielded` waiting for `messageRef` (S1 `end`). */
async function yieldRunForUser(f: S5DecisionFixture, claim: TaskClaim, messageRef: SessionMessage['ref']): Promise<void> {
  const reads = createRunStateReader({ records: f.records });
  const current = ready(await reads.readExecution(f.ctx, claim.runRef));
  const authorization = current.run.executionAuthorization;
  const history = current.run.executionHistory;
  if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
    || authorization.phase !== 'entered' || history === undefined || history === null) {
    throw new Error('the Run must be entered before it can yield');
  }
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const entry = createExecutionEntryService({ records: f.records, reads, roles, bodies: f.bodies,
    authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'result-only setup' }),
    now: f.now, eventId: f.newId, newId: f.newId });
  const position = history.observedThroughPosition + 1;
  const source = { ...history.kernel, position };
  committed(await entry.recordRunResult(f.ctx, { input: { claim,
    entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
    event: { schemaVersion: 1, eventId: f.newId(), runRef: claim.runRef, sequence: current.run.lastEventSeq + 1,
      occurredAt: T, eventType: 'run_yielded', payload: { kind: 'yielded', yield: {
        reason: 'reply_required', requestedBy: 'app', yieldedAt: T, pendingToolCallId: null } } },
    kernelSource: source, completedHistoryBoundary: { source, cursor: `s2a-yield-${claim.runRef.runId}` },
    history: { ...history, observedThroughPosition: position, endPosition: position },
    continuation: { schemaVersion: 1, kind: 'wait_reply', task: claim.task, sessionRef: claim.sessionRef, messageRef } },
    meta: { requestId: f.newId(), expected: [{ ref: claim.runRef, revision: current.run.revision }] } }));
}

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A archive wait disposal keeps since (%s)', kind => {
  it('QA-13 a disposed waiting notification keeps its commit position and is not hidden by an earlier seen position', async () => {
    const f = await openS5DecisionFixture(kind);
    opened.push(f);
    const mailbox = createSessionMailbox(mailboxDependencies(f));
    const send = async (text: string, wait: boolean) => {
      const result = await mailbox.sendUserMessage(workContext(f, f.claimRA), { input: { goalRef: GOAL_B, intent: 'notify',
        text, needsReply: wait, waitAfterSend: wait, options: [], objects: [] },
        meta: { requestId: f.newId(), expected: [] } });
      if (result.status !== 'committed') throw new Error(`user send failed: ${JSON.stringify(result)}`);
      return { message: result.value, cursor: result.cursor };
    };

    const first = await send('An earlier notification.', false);
    const waiting = await send('A notification that waits for its answer.', true);
    await yieldRunForUser(f, f.claimRA, waiting.message.ref);

    const sessionFacts = createSessionFactsService({ records: f.records });
    const lifecycle = createSessionLifecycleService({ records: f.records, lookups: f.records, sessionFacts });
    const sessionRef = f.claimRA.sessionRef;
    const registered = committed(await lifecycle.requestSessionArchive(f.ctx, { input: { sessionRef,
      reason: 'Archive the waiting line', tasks: [], wait: { kind: 'cancel', runRef: f.claimRA.runRef,
        messageRef: waiting.message.ref }, confirmUnknownStopped: false },
      meta: { requestId: f.newId(), expected: [await pin(f.records, plainSessionRefToAggregate(sessionRef))] } }));
    const request = registered.archiveRequest;
    if (request === undefined || request === null || request.wait === null) {
      throw new Error('the archive request must carry the waiting choice');
    }
    const step: ArchiveStepRefV1 = { sessionRef, archiveRequestId: request.requestId, requestReceipt: request.receipt,
      step: 'wait_cancel', subjectKey: canonicalJson(f.claimRA.runRef as unknown as JsonValue) };
    if (mailbox.disposeArchiveWait === undefined) throw new Error('the mailbox lacks the wait-disposal owner');
    committed(await mailbox.disposeArchiveWait(f.ctx, step));

    const firstKey = `member_notice:${sessionMessageRefKey(first.message.ref)}`;
    const waitingKey = `member_notice:${sessionMessageRefKey(waiting.message.ref)}`;
    const h = noticesHarness(f, []);
    const all = await h.page({ categories: ['member_notice'], limit: 50 });
    expect(all.notices.map(notice => notice.itemKey)).toEqual([firstKey, waitingKey]);
    const disposed = all.notices.find(notice => notice.itemKey === waitingKey);
    // The disposal rewrote the message; its position must still be the original
    // creation commit, never a legacy `occurredAt` position.
    expect(disposed?.position).toEqual({ kind: 'commit', cursor: waiting.cursor, itemKey: waitingKey });

    // Seeing only the earlier notice must not hide the disposed one. A legacy
    // position would sort before the earlier commit and disappear.
    const one = await h.page({ categories: ['member_notice'], limit: 1 });
    expect(one.notices.map(notice => notice.itemKey)).toEqual([firstKey]);
    await h.mark(one.displayToken, one.seenThrough);
    const after = await h.page({ categories: ['member_notice'], limit: 50 });
    expect(after.notices.map(notice => notice.itemKey)).toEqual([waitingKey]);
  }, 600_000);
});
