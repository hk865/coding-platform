/**
 * Slice 2A QE3, Group N: QA-10(二) over-bound notice world.
 *
 * Builds, only through real public services:
 *   - `sessions` real Sessions by `SessionDirectoryPort.admitSessionCreation` +
 *     `recordSessionCreated` (the same owners the production composition uses);
 *   - a real Goal/Plan with two work Tasks through `openManyTaskWorld`;
 *   - two entered Runs (`reply-src` on the source Session, `reply-dst` on the
 *     responder Session) through the real claim/execution-entry owners;
 *   - `replies` real Session->Session inquiry messages and their real replies
 *     through the real mailbox (`sendMessage` / `respondMessage`);
 *   - the source Session marked unavailable through the real health owner;
 *   - `memberNotices` real user notifications through `sendUserMessage`.
 *
 * The unavailable source Session is the greatest canonical refKey of the created
 * Sessions, so the Session-by-workspace index orders it after every other one.
 */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { DecisionNoticeSourcePort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createUndeliveredReplyNoticeSource } from '../../src/core/work-graph/views/undelivered-reply-notices.js';
import { GOAL_B, T, type S5DecisionFixture } from './S5-decision-fixture.js';
import { openManyTaskWorld } from './S2A-notices-support.js';
import { committed, endRun, mailboxDependencies, pin, workContext } from './S5-queue-support.js';

export type OverboundNoticesWorld = {
  /** The one unavailable Session, ordered after every other created Session. */
  sourceSession: SessionRef;
  /** The real undelivered-reply source wired on the same store. */
  undelivered: DecisionNoticeSourcePort;
  expected: {
    sessions: number;
    memberNotices: number;
    undeliveredReplies: number;
    /** The literal `member_notice:` itemKey of the last created notification. */
    memberTailKey: string;
    /** The literal `undelivered_reply:` itemKey of the last created reply. */
    replyTailKey: string;
  };
};

/** Real Session creation without the kernel-store file (the listing never reads it). */
async function createNoticeSession(f: S5DecisionFixture, requestKey: string): Promise<SessionRef> {
  const directory = createSessionDirectory({ records: f.records, lookups: f.records });
  const admitted = await directory.admitSessionCreation(f.ctx, { meta: { requestId: `qa10-admit-${requestKey}`, expected: [] },
    input: { workspace: f.base.scope,
      kernelStore: { adapterId: 's5-kernel', storeKey: 's5-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [] } });
  if (admitted.status !== 'committed') throw new Error(`QA-10 session admission failed: ${JSON.stringify(admitted)}`);
  const registered = await directory.recordSessionCreated(f.ctx, { meta: { requestId: `qa10-register-${requestKey}`, expected: [] },
    input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
      adapterId: 's5-kernel', kernelSessionId: `qa10-kernel-${requestKey}`, historyCursor: null, observedAt: T } });
  if (registered.status !== 'committed') throw new Error(`QA-10 session registration failed: ${JSON.stringify(registered)}`);
  return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
}

export type OverboundNoticesOptions = {
  sessions: number;
  replies: number;
  memberNotices: number;
  /**
   * The reply commit order. Absent (the default) keeps the `sc-base` order: each
   * message is sent and immediately replied to, one pair at a time. `message-key`
   * first collects every message and then replies in ascending SessionMessage
   * refKey order — the order the undelivered-reply read layer returns them — so
   * the reply read last is also the reply committed last (the tail).
   */
  replyOrder?: 'creation' | 'message-key';
  /** The page width of the undelivered source's inner directory and reply reads
   * (default 100, the production value). */
  readPageLimit?: number;
  /**
   * The literal `meta.requestId`s of the member notifications, in creation
   * order. Absent (the default) allocates `f.newId()` once per notice, the
   * `sc-base` order; passing them consumes no `f.newId()` for this loop.
   */
  memberNoticeRequestIds?: readonly string[];
};

export async function buildOverboundNoticesWorld(
  f: S5DecisionFixture,
  config: OverboundNoticesOptions,
): Promise<OverboundNoticesWorld> {
  const created: SessionRef[] = [];
  for (let index = 0; index < config.sessions; index += 1) {
    created.push(await createNoticeSession(f, `session-${String(index).padStart(5, '0')}`));
  }
  // The index orders by the full canonical refKey; the greatest is last.
  created.sort((left, right) => {
    const a = sessionAggregateRefKey(plainSessionRefToAggregate(left));
    const b = sessionAggregateRefKey(plainSessionRefToAggregate(right));
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const sourceSession = created[created.length - 1]!;
  const responderSession = await createNoticeSession(f, 'responder');

  // A real Goal/Plan with two work Tasks for the two entered Runs.
  const world = await openManyTaskWorld(f, ['reply-src'],
    { goalId: 'QA10', planId: 'PQA10', optionalTaskIds: ['reply-dst'] });
  const sourceClaim = await f.claimRun({ requestId: f.newId(), goalRef: world.goalRef, planRef: world.plan.ref,
    taskId: 'reply-src', sessionRef: sourceSession });
  await f.enterClaim(sourceClaim);
  const responderClaim = await f.claimRun({ requestId: f.newId(), goalRef: world.goalRef, planRef: world.plan.ref,
    taskId: 'reply-dst', sessionRef: responderSession });
  await f.enterClaim(responderClaim);

  const mailbox = createSessionMailbox(mailboxDependencies(f));
  let replyTailKey = '';
  if (config.replyOrder === 'message-key') {
    // The explicit message-key branch ONLY: collect every message, sort it by
    // the order the reply read returns, then reply in that order. The default
    // branch below keeps the `sc-base` one-send-one-reply sequence.
    const sentMessages: SessionMessage[] = [];
    for (let index = 0; index < config.replies; index += 1) {
      sentMessages.push(committed(await mailbox.sendMessage(workContext(f, sourceClaim), { input: {
        recipient: responderSession, text: `Undelivered reply ${index}`, intent: 'inquiry', needsReply: true, waitAfterSend: false },
        meta: { requestId: f.newId(), expected: [] } })));
    }
    const replyOrder = [...sentMessages].sort((left, right) => {
      const a = sessionMessageRefKey(left.ref);
      const b = sessionMessageRefKey(right.ref);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const sent of replyOrder) {
      const replied = committed(await mailbox.respondMessage(workContext(f, responderClaim), { input: {
        messageRef: sent.ref, text: `Reply answer ${sentMessages.indexOf(sent)}` },
        meta: { requestId: f.newId(), expected: [await pin(f.records, sent.ref)] } }));
      if (replied.response !== null) {
        replyTailKey = `undelivered_reply:${canonicalJson({ messageRef: sent.ref,
          responseRef: replied.response.bodyRef } as unknown as JsonValue)}`;
      }
    }
  } else {
    // Default (`sc-base`) path: send one message and reply to it immediately.
    for (let index = 0; index < config.replies; index += 1) {
      const sent = committed(await mailbox.sendMessage(workContext(f, sourceClaim), { input: {
        recipient: responderSession, text: `Undelivered reply ${index}`, intent: 'inquiry', needsReply: true, waitAfterSend: false },
        meta: { requestId: f.newId(), expected: [] } }));
      const replied = committed(await mailbox.respondMessage(workContext(f, responderClaim), { input: {
        messageRef: sent.ref, text: `Reply answer ${index}` },
        meta: { requestId: f.newId(), expected: [await pin(f.records, sent.ref)] } }));
      if (replied.response !== null) {
        replyTailKey = `undelivered_reply:${canonicalJson({ messageRef: sent.ref,
          responseRef: replied.response.bodyRef } as unknown as JsonValue)}`;
      }
    }
  }
  // The source Run ends and the Session is retired through the real owners.
  await endRun(f, sourceClaim, { eventType: 'run_crashed',
    payload: { kind: 'crashed', error: 'QA-10 reply line ended before the archive' } });
  const health = createSessionHealthService({ records: f.records,
    hostInstance: { hostInstanceId: 'qa10-host', lease: 'owned' }, now: f.now, eventId: f.newId });
  const observed = await health.recordSessionHealth(f.ctx, { sessionRef: sourceSession,
    probe: { verdict: 'missing', activeRunId: null } });
  if (observed.status !== 'observed' || observed.session.health !== 'unavailable') {
    throw new Error(`the QA-10 source Session did not become unavailable: ${JSON.stringify(observed)}`);
  }

  let memberTailKey = '';
  for (let index = 0; index < config.memberNotices; index += 1) {
    const requestId = config.memberNoticeRequestIds?.[index] ?? f.newId();
    const sent = committed(await mailbox.sendUserMessage(workContext(f, f.claimRA), { input: {
      goalRef: GOAL_B, intent: 'notify', text: `Member notification ${index}`,
      needsReply: false, waitAfterSend: false, options: [], objects: [] },
      meta: { requestId, expected: [] } }));
    memberTailKey = `member_notice:${sessionMessageRefKey(sent.ref)}`;
  }

  const undelivered = createUndeliveredReplyNoticeSource({ records: f.records,
    sessions: createSessionDirectory({ records: f.records, lookups: f.records }), messages: mailbox,
    ...(config.readPageLimit === undefined ? {} : { readPageLimit: config.readPageLimit }) });
  return { sourceSession, undelivered, expected: { sessions: created.length, memberNotices: config.memberNotices,
    undeliveredReplies: config.replies, memberTailKey, replyTailKey } };
}
