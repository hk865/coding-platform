/**
 * The handoff "please be aware" projector: one `DecisionNoticeSourcePort` for category `handoff`, one item per
 * handoff operation that reached its notice write. It is a pure read projection: no new record and no new event.
 *
 * The item's position is the original notice write's commit. The projection rebuilds that write's exact R2 identity
 * from the operation's own saved facts — the saved Host principal (never the reader's), the record's workspace, the
 * deterministic `{kind:'notice', basis: noticeItemKey}` input and `progress.advanceGeneration` — then reads the
 * committed receipt and the original event. A missing or damaged receipt is `unavailable`, never an item without a
 * position.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1,
} from '../model/decision-contracts.js';
import type { HandoffActionV1 } from '../model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../model/session-contracts.js';
import { lookupCommittedReceipt } from '../persistence/receipt-lookup.js';
import { readCommittedEvent } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord,
} from '../sessions/session-record-codecs.js';
import { advanceWriteKeys, handoffRecordedEvent, savedHostPrincipal } from '../sessions/session-handoff-service.js';
import { compareNoticePositions } from './notice-position.js';
import { readWatermark } from './goal-conflicts.js';

export type HandoffNoticeReadInputV1 = { workspace: WorkspaceScope; goalRef?: GoalRef; after?: NoticePositionV1;
  page: { limit: number; cursor?: string } };

export type NoticePositionReadV1 =
  | { status: 'ready'; value: { position: NoticePositionV1; occurredAt: string } | null }
  | CoreRejection;

export type HandoffNoticeSourceDependencies = {
  records: Pick<GoalRecordTransactionPort, 'lookupCommit' | 'eventAt' | 'readMany'> & Pick<RecordLookupPort, 'lookup'>;
};

/**
 * The original notice write's position and time, rebuilt from the operation's saved facts. No new field and no new
 * command: the write is the existing `<op>:notice:-:after:<g>` stage write.
 */
export async function noticePositionOf(
  records: Pick<GoalRecordTransactionPort, 'lookupCommit' | 'eventAt'>,
  _ctx: CoreCallContext,
  operation: SessionOperationRecordOf<HandoffActionV1>,
): Promise<NoticePositionReadV1> {
  const action = operation.action;
  const key = action.progress.noticeItemKey;
  if (key === null) return { status: 'ready', value: null };
  // The saved Host principal of the record, never the reader's: a different caller must find the same write.
  const saved = savedHostPrincipal(action.input.actor);
  if (saved === null) return rejected('invalid', 'the operation has no saved Host actor');
  const built = advanceWriteKeys({
    principal: principalIdentity(saved),
    scope: { projectId: operation.ref.projectId, workspaceId: operation.workspaceId },
    kind: 'handoff.advance',
    operation: operation.ref,
    stage: 'notice',
    item: '-',
    phase: 'after',
    generation: action.progress.advanceGeneration,
    fingerprintInput: { kind: 'notice', basis: key },
  });
  const found = await lookupCommittedReceipt(records, built.keys.identityKey, built.keys.fingerprint);
  if (found.status === 'missing') {
    return rejected('unavailable', 'the notice write has no committed receipt');
  }
  if (found.status === 'conflict') return rejected('idempotency_conflict', found.reason);
  if (found.status === 'invalid') return rejected('invalid', found.reason);
  if (found.status === 'unavailable') return rejected('unavailable', found.reason);
  // The one committed-event read proves the cursor, the receipt's last event id, the type and the decode.
  const read = await readCommittedEvent(records, found.receipt, handoffRecordedEvent);
  if (read.status !== 'ready') return rejected('unavailable', read.reason);
  const recorded = read.value;
  if (recorded.projectId !== operation.ref.projectId || recorded.workspaceId !== operation.workspaceId) {
    return rejected('unavailable', 'the notice event belongs to another scope');
  }
  if (recorded.operationRef.operationId !== operation.ref.operationId) {
    return rejected('unavailable', 'the notice event records another operation');
  }
  if (recorded.action.kind !== 'handoff' || recorded.action.progress.noticeItemKey !== key) {
    return rejected('unavailable', 'the notice event records another notice key');
  }
  const position: NoticePositionV1 = { kind: 'commit', cursor: found.receipt.cursor, itemKey: key };
  return { status: 'ready', value: { position, occurredAt: recorded.occurredAt } };
}

const NOTICE_PHASES = ['accepted', 'running', 'completed', 'failed', 'unknown'] as const;

function summaryOf(operation: SessionOperationRecordOf<HandoffActionV1>, occurredAt: string): string {
  const action = operation.action;
  const successor = action.progress.assignments
    .map(assignment => assignment.successor?.sessionId ?? '')
    .filter(id => id !== '')
    .join(', ');
  const reason = action.input.trigger === 'too_long' ? '秘书上下文过长' : '手工交接';
  const line = action.input.source.sessionId;
  return `交接 · ${reason} · 继任 ${successor === '' ? '未定' : successor} · 旧线 ${line} · ${occurredAt}`;
}

/** The page: every operation with a notice write, in commit order, one item each. */
async function readHandoffNoticePage(
  records: HandoffNoticeSourceDependencies['records'],
  ctx: CoreCallContext,
  input: HandoffNoticeReadInputV1,
): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
  const watermarkRead = await readWatermark(records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  if (input.goalRef !== undefined) return { status: 'ready', value: { availability: 'available', items: [], nextCursor: null, sourceCursor: watermarkRead.value } };
  const items: NoticeItemV1[] = [];
  for (const phase of NOTICE_PHASES) {
    let batch;
    try {
      batch = await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [input.workspace.projectId, input.workspace.workspaceId, phase]);
    } catch (error) {
      return rejected('unavailable', `the handoff operations could not be read: ${messageOf(error)}`);
    }
    for (const encoded of batch.items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `a handoff operation is damaged: ${decoded.reason}`);
      }
      const operation = decoded.value;
      if (operation.action.kind !== 'handoff') continue;
      if (operation.action.progress.noticeItemKey === null) continue;
      const read = await noticePositionOf(records, ctx, operation as SessionOperationRecordOf<HandoffActionV1>);
      if (read.status !== 'ready' || read.value === null) {
        return read.status === 'ready' ? rejected('unavailable', 'the notice position is missing') : read;
      }
      items.push({
        itemKey: operation.action.progress.noticeItemKey,
        category: 'handoff',
        subject: { kind: 'project', projectRef: { projectId: input.workspace.projectId } },
        position: read.value.position,
        summary: summaryOf(operation as SessionOperationRecordOf<HandoffActionV1>, read.value.occurredAt),
        objects: [],
        rework: null,
      });
    }
  }
  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  });
  const after = input.after;
  const remaining = after === undefined ? items : items.filter(item => compareNoticePositions(item.position, after) > 0);
  const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const limit = Number.isSafeInteger(input.page.limit) && input.page.limit > 0 ? input.page.limit : 50;
  const end = Math.min(remaining.length, start + limit);
  return { status: 'ready', value: { availability: 'available', items: remaining.slice(start, end),
    nextCursor: end < remaining.length ? String(end) : null, sourceCursor: watermarkRead.value } };
}

/** Builds the `handoff` notice source; one item per operation, read only. */
export function createHandoffNoticeSource(deps: HandoffNoticeSourceDependencies): DecisionNoticeSourcePort {
  return {
    category: 'handoff',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      return readHandoffNoticePage(deps.records, ctx, input as HandoffNoticeReadInputV1);
    },
  };
}
