/**
 * The one per-Session handoff fence: its claim key, the fence read and the empty-slot guard.
 *
 * `secretaryHandoffClaimKey` is the only body of the prefix: the key is the prefix plus the canonical JSON
 * of the Session aggregate ref. The holder is `operationRefKey` of the handoff operation, but this read returns no
 * guards: the start commit's own claims carry the fence. `readHandoffFence` pages the unfinished operations by
 * `CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP` once and returns that Session's held handoff, or
 * `{held:false, operation:null}`. A failed read or a damaged operation is `unavailable`, never "not fenced".
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort, UniqueClaimChange } from '../../record-store/ports.js';
import { SECRETARY_HANDOFF_PREFIX } from '../model/request-contracts.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, plainSessionRefKey,
} from './session-record-codecs.js';

export type HandoffFenceV1 = { held: boolean; operation: OperationRef | null };

/** The one per-Session fence read; `{held:false, operation:null}` is the only not-held value. */
export interface HandoffFencePort {
  read(ctx: CoreCallContext, session: SessionRef):
    Promise<{ status: 'ready'; value: HandoffFenceV1 } | CoreRejection>;
}

/** The per-Session handoff claim key; the holder is the handoff operation key. */
export function secretaryHandoffClaimKey(session: SessionRef): string {
  return SECRETARY_HANDOFF_PREFIX + canonicalJson({
    aggregateType: 'Session', projectId: session.projectId, sessionId: session.sessionId,
  } as unknown as JsonValue);
}

/** The unfinished handoff of the Session whose fence is held; a damaged record or failed read is `unavailable`. */
export async function readHandoffFence(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort,
  ctx: CoreCallContext, session: SessionRef,
): Promise<{ status: 'ready'; value: HandoffFenceV1 } | CoreRejection> {
  const sessionKey = plainSessionRefKey(session);
  let fence: HandoffFenceV1 = { held: false, operation: null };
  const workspaceId = ctx.workspaceId ?? '';
  for (const phase of ['accepted', 'running'] as const) {
    let items: readonly EncodedRecord[];
    try {
      items = (await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [ctx.projectId, workspaceId, phase])).items;
    } catch (failure) {
      return ownerReadStoreFailureToRejection(failure as { code: string; reason: string });
    }
    for (const encoded of items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `an unfinished operation is damaged: ${decoded.reason}`);
      }
      const operation = decoded.value;
      if (operation.action.kind !== 'handoff') continue;
      if (operation.action.progress.fence?.state !== 'held') continue;
      if (!fence.held && plainSessionRefKey(operation.action.input.source) === sessionKey) {
        fence = { held: true, operation: operation.ref };
      }
    }
  }
  return { status: 'ready', value: fence };
}

/** The claim change a real start merges: it asserts the slot is still empty. */
export function handoffFenceGuard(session: SessionRef): UniqueClaimChange {
  return { claimKey: secretaryHandoffClaimKey(session), expectedOwner: null, nextOwner: null };
}
