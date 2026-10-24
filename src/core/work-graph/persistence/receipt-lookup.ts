import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRecordTransactionPort, StoreCommitReceipt } from '../../record-store/ports.js';

export type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;

export type ReceiptLookup =
  | { status: 'found'; receipt: CommittedReceipt }
  | { status: 'missing' }
  | { status: 'conflict'; reason: string }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string };

/**
 * The ONE committed-receipt storage lookup: the exact identity/fingerprint
 * `lookupCommit` with every failure classified, and a thrown lookup caught as
 * `unavailable`. Each owner keeps its own error wording and projection.
 */
export async function lookupCommittedReceipt(
  records: Pick<GoalRecordTransactionPort, 'lookupCommit'>,
  identityKey: string,
  fingerprint: string,
): Promise<ReceiptLookup> {
  let found: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
  try {
    found = await records.lookupCommit({ identityKey, fingerprint });
  } catch (error) {
    return { status: 'unavailable', reason: `the idempotency lookup failed: ${messageOf(error)}` };
  }
  if (found.status === 'ready') return { status: 'found', receipt: found.value };
  switch (found.code) {
    case 'not_found':
      return { status: 'missing' };
    case 'idempotency_conflict':
      return { status: 'conflict', reason: found.reason };
    case 'invalid':
      return { status: 'invalid', reason: found.reason };
    default:
      return { status: 'unavailable', reason: `${found.code}: ${found.reason}` };
  }
}
