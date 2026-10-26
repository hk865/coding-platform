import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRecordTransactionPort, RecordCommitIdentityPort, StoreCommitReceipt } from '../../record-store/ports.js';

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

export type ReceiptByIdentityLookup =
  | { status: 'found'; receipt: CommittedReceipt; fingerprint: string }
  | { status: 'missing' }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string };

/**
 * The identity-only replay read: one committed identity row and the fingerprint
 * it was committed with. `not_found` is `missing`; a damaged row is `corrupt`
 * and therefore `unavailable`; a throw is `unavailable`. The current input's
 * fingerprint never enters this read.
 */
export async function lookupCommittedReceiptByIdentity(
  port: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>, identityKey: string,
): Promise<ReceiptByIdentityLookup> {
  let found: Awaited<ReturnType<RecordCommitIdentityPort['readCommitByIdentity']>>;
  try {
    found = await port.readCommitByIdentity(identityKey);
  } catch (error) {
    return { status: 'unavailable', reason: `the identity read failed: ${messageOf(error)}` };
  }
  if (found.status === 'ready') {
    return { status: 'found', receipt: found.value.receipt, fingerprint: found.value.fingerprint };
  }
  switch (found.code) {
    case 'not_found': return { status: 'missing' };
    case 'invalid': return { status: 'invalid', reason: found.reason };
    default: return { status: 'unavailable', reason: `${found.code}: ${found.reason}` };
  }
}
