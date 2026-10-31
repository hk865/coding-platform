import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { canonicalJson, canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1, S5RecordPort,
} from '../model/decision-contracts.js';
import type { SessionMessageRecord } from '../state/message-machine.js';
import { waitFactsOfRecord, waitStateOf } from '../state/message-machine.js';
import { decodeSessionMessageRecord, decodeNoticeOrigin, sessionMessageRefKey,
  S5_MESSAGE_BY_WORKSPACE_STATUS } from '../sessions/message-record-codecs.js';
import { decodeSessionRecord, plainSessionRefToAggregate,
  sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { messageSenderSessionOf } from '../communication/mailbox-service.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { GOAL_BY_CONTINUED_FROM_INDEX } from '../tasks/plan-readers.js';
import type { SessionFactsPort } from '../model/session-facts-contracts.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';
import { readWatermark } from './goal-conflicts.js';
import { atLeastCursorResult, storeFailureToRejection } from '../persistence/read-result-failures.js';
import { compareNoticePositions } from './notice-position.js';

/** The side of the wait the notice names. `waiting` = the line whose wait is stranded; `recipient` = the line it waits on. */
export type DisconnectSideV1 = 'waiting' | 'recipient';

export type DisconnectFactV1 = {
  /** `disconnect:<canonicalKey({sessionRef, at})>`: `at` is `archivedAt`, or the bound `unavailableSince` cursor. */
  operationKey: string;
  occurredAt: string;
  messageRef: SessionMessageRef;
  side: DisconnectSideV1;
  /** The Session that is gone (archived or retired). */
  party: SessionRef;
  /** The other communication side of the same wait; `null` for an undelivered message or a person recipient. */
  counterparty: SessionRef | null;
  successor: SessionRef | null;
  goalRef: GoalRef | null;
  /** The copy Goal pin of an unforwarded copied intervention (the pending item); `null` on a disconnect row. */
  copyGoal: { ref: GoalRef; revision: number } | null;
  /** D-54: a retired line's bound `unavailableSince`; an archived line's stranded-message `since`. */
  position: CommitCursor;
};

export type DisconnectNoticeSourceDependencies = {
  records: DecisionReadRecordsPort & Pick<S5RecordPort, 'eventAt'>;
  /** The one successor read (`findSessionSuccessors`, `session-facts.ts:545`); no second index read. */
  sessions: Pick<SessionFactsPort, 'findSessionSuccessors'>;
};

/** Page width of each of the two message lookups; 200 is the §4.1 lookup bound (`lookup-all.ts:27`). */
export const DISCONNECT_PAGE_LIMIT = 200;

export function disconnectOperationKeyOf(session: SessionRecord): string {
  const at = session.lifecycle === 'archived'
    ? (session.archivedAt ?? '')
    : (session.unavailableSince ?? '');
  return 'disconnect:' + canonicalJson({ sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId },
    at } as unknown as JsonValue);
}

export function disconnectItemKey(fact: Pick<DisconnectFactV1, 'operationKey' | 'messageRef' | 'side'>): string {
  return 'disconnect:' + canonicalJson({ operation: fact.operationKey, messageRef: fact.messageRef,
    side: fact.side } as unknown as JsonValue);
}

/**
 * The ONE disconnect-fact read: every unconsumed wait's two communication parties plus every undelivered message to a
 * gone line — and, for a copied intervention still unforwarded, the copy-pending item — each row present only when that
 * party's Session is archived or retired. One message window, one batched Session read per window, one successor
 * lookup per gone party. No write, no clock.
 */
export async function readDisconnectFacts(
  deps: DisconnectNoticeSourceDependencies, ctx: CoreCallContext, scope: WorkspaceScope,
): Promise<ReadResult<DisconnectFactV1[]>> {
  if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the disconnect fact read was cancelled' };
  const watermark = await readWatermark(deps.records);
  if (watermark.status !== 'ready') return watermark;
  const facts = new Map<string, DisconnectFactV1>();
  const sessions = new Map<string, SessionRecord>();
  for (const status of ['pending', 'read', 'responded'] as const) {
    let batch;
    try {
      batch = await lookupAll(deps.records, S5_MESSAGE_BY_WORKSPACE_STATUS,
        [scope.projectId, scope.workspaceId, status], { pageLimit: DISCONNECT_PAGE_LIMIT });
    } catch (error) { return storeFailureToRejection(error as { code: string; reason: string }); }
    for (const record of batch.items) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable',
        reason: `a disconnect candidate is damaged: ${decoded.reason}` };
      const message = decoded.value;
      const origin = decodeNoticeOrigin(record);
      if (origin.status !== 'decoded' || origin.value.since === undefined) {
        return { status: 'rejected', code: 'unavailable',
          reason: `a disconnect candidate has no commit position: ${record.refKey}` };
      }
      const archivePosition = origin.value.since;
      const recipient: SessionRef | null = 'kind' in message.recipient ? null : message.recipient as SessionRef;
      const parties: { side: DisconnectSideV1; ref: SessionRef }[] = [];
      if (message.intent === 'inquiry' && message.release === 'released' && message.waitAfterSend === true) {
        const state = waitStateOf(message, waitFactsOfRecord(message));
        if (state.state === 'open' || state.state === 'answered' || state.state === 'expired') {
          const waiting = messageSenderSessionOf(message);
          if (waiting !== null) parties.push({ side: 'waiting', ref: waiting });
          if (recipient !== null) parties.push({ side: 'recipient', ref: recipient });
        }
      }
      // A Host system `notify` asks for nothing: its non-delivery is information, not a new disconnect fact.
      if (recipient !== null && (message.acceptedInputs ?? []).every(i => i.part !== 'message')
        && !(message.intent === 'notify' && message.sender.kind === 'host' && message.sender.actor.kind === 'system')) {
        parties.push({ side: 'recipient', ref: recipient });   // an undelivered message to a gone line
      }
      let copyGoalPin: { ref: GoalRef; revision: number } | null | undefined;
      for (const party of parties) {
        const key = canonicalKey(party.ref);
        let session = sessions.get(key);
        if (session === undefined) {
          const refKey = sessionAggregateRefKey(plainSessionRefToAggregate(party.ref));
          const read = await deps.records.readMany([refKey]);
          if (read.status !== 'ready') return storeFailureToRejection(read);
          const found = read.value.records.find(r => r.refKey === refKey);
          if (found === undefined) continue;                    // a gone message whose line no longer reads is skipped
          const record = decodeSessionRecord(found);
          if (record.status !== 'decoded') return { status: 'rejected', code: 'unavailable',
            reason: `the disconnect party is damaged: ${record.reason}` };
          session = record.value; sessions.set(key, session);
        }
        if (session.lifecycle !== 'archived' && session.health !== 'unavailable') continue;
        const archived = session.lifecycle === 'archived';
        // D-54 narrowed: a retired line's notice position is its bound entry cursor; an archived line keeps
        // the stranded message's `since` because no existing read gives the archive's commit position.
        const position = archived ? archivePosition : (session.unavailableSince ?? null);
        if (position === null) continue;   // an old record without the bound cursor: no row, never a guessed position
        // Row 05: the occurrence time is the event header `occurredAt` at that same cursor
        // (`src/core/record-store/ports.ts:102`); the cursor is identity/position, not a timestamp.
        let occurredAt = session.archivedAt ?? '';
        if (!archived) {
          const located = await deps.records.eventAt(position);
          if (located.status !== 'ready') return storeFailureToRejection(located);
          occurredAt = located.value.event.occurredAt;
        }
        if (copyGoalPin === undefined) {
          const read = await copyGoalPinOf(deps, scope, message);
          if (read.status !== 'ready') return read;
          copyGoalPin = read.value;
        }
        const successors = await deps.sessions.findSessionSuccessors(ctx, { sessionRef: party.ref, page: { limit: 100 } });
        if (successors.status !== 'ready') return successors;   // the fact read fails; never a null successor
        const successor = successors.value.items.find(s => s.provenance.kind === 'handoff')?.ref ?? null;
        const fact: DisconnectFactV1 = {
          operationKey: disconnectOperationKeyOf(session),
          occurredAt,
          messageRef: message.ref, side: party.side, party: party.ref,
          counterparty: parties.find(p => p.side !== party.side)?.ref ?? null,
          successor, goalRef: message.goalRef, position, copyGoal: copyGoalPin,
        };
        facts.set(disconnectItemKey(fact), fact);
      }
    }
  }
  return { status: 'ready', value: [...facts.values()].sort((l, r) => {
    const by = compareNoticePositions({ kind: 'commit', cursor: l.position, itemKey: disconnectItemKey(l) },
      { kind: 'commit', cursor: r.position, itemKey: disconnectItemKey(r) });
    return by !== 0 ? by : (disconnectItemKey(l) < disconnectItemKey(r) ? -1 : 1);
  }) };
}

export function createDisconnectNoticeSource(deps: DisconnectNoticeSourceDependencies): DecisionNoticeSourcePort {
  return {
    category: 'disconnect',
    async readPage(ctx, input) {
      if (ctx.principal.kind !== 'host') {
        return { status: 'rejected', code: 'forbidden', reason: 'the disconnect notice source requires a Host call context' };
      }
      if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the disconnect notice read was cancelled' };
      const watermark = await readWatermark(deps.records);
      if (watermark.status !== 'ready') return watermark;
      const notReady = atLeastCursorResult<DecisionSourcePageV1<NoticeItemV1>>(watermark.value, input.page.atLeastCursor);
      if (notReady !== null) return notReady;
      const all = await readDisconnectFacts(deps, ctx, input.workspace);
      if (all.status !== 'ready') return all;
      const items: NoticeItemV1[] = all.value
        .filter(f => input.goalRef === undefined ? true
          : f.goalRef !== null && f.goalRef.projectId === input.goalRef.projectId && f.goalRef.goalId === input.goalRef.goalId)
        .map(f => ({
          itemKey: disconnectItemKey(f), category: 'disconnect' as const,
          subject: f.goalRef === null
            ? { kind: 'project' as const, projectRef: { projectId: input.workspace.projectId } as ProjectScope }
            : { kind: 'goal' as const, goalRef: f.goalRef },
          position: { kind: 'commit' as const, cursor: f.position, itemKey: disconnectItemKey(f) },
          summary: `断开通知 · Session ${f.party.sessionId} · ${f.occurredAt} · ${f.successor?.sessionId ?? '没人接，等你定'}`,
          objects: f.copyGoal === null ? []
            : [{ kind: 'aggregate' as const, pin: { ref: f.copyGoal.ref, revision: f.copyGoal.revision }, label: 'copy Goal' }],
          rework: null,
        }));
      const after = input.after;
      const remaining = after === undefined ? items : items.filter(i => compareNoticePositions(i.position, after) > 0);
      const cursor = input.page.cursor;
      const offset = cursor === undefined ? 0 : Number(cursor);
      const end = Math.min(remaining.length, offset + input.page.limit);
      return { status: 'ready', value: { availability: 'available', items: remaining.slice(offset, end),
        nextCursor: end < remaining.length ? String(end) : null, sourceCursor: watermark.value } };
    },
  };
}

/** The copy Goal whose `copiedInterventions` still carries this unforwarded intervention; `null` when it is not one. */
async function copyGoalPinOf(deps: DisconnectNoticeSourceDependencies, scope: WorkspaceScope,
  message: SessionMessageRecord): Promise<ReadResult<{ ref: GoalRef; revision: number } | null>> {
  const goalRef = message.goalRef;
  if (message.transferredTo !== null || goalRef === null) return { status: 'ready', value: null };
  const messageKey = sessionMessageRefKey(message.ref);
  let copies;
  try {
    copies = await lookupAll(deps.records, GOAL_BY_CONTINUED_FROM_INDEX, [scope.projectId, goalRef.goalId]);
  } catch (error) { return storeFailureToRejection(error as { code: string; reason: string }); }
  for (const record of copies.items) {
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable',
      reason: `a copy Goal of the intervention is damaged: ${decoded.reason}` };
    if (decoded.value.copiedInterventions.some(ref => sessionMessageRefKey(ref) === messageKey)) {
      return { status: 'ready', value: { ref: decoded.value.ref, revision: decoded.value.revision } };
    }
  }
  return { status: 'ready', value: null };
}
