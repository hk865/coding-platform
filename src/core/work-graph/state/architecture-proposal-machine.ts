/**
 * ArchitectureProposal state machine.
 *
 * A proposal is written once in `pending`; the only later changes are the state
 * (`pending → applied | rejected | stale`) and the `batchRef` set once when the
 * proposal enters a frozen batch. The content — base pin, ops, moves, reason,
 * proposer and operation ref — is immutable, so every transition copies the
 * record and touches only `revision`, `state` and `batchRef`. A batch has no state
 * of its own: the card reads its members' states.
 *
 * Pure: the owner reads the record and the facts, calls these functions and writes
 * the result in its own commit; no storage, clock or id lives here.
 */
import type {
  ArchitectureProposalBatchRef, ArchitectureProposalV1,
} from '../../../contracts/architecture-proposal.js';
import { accept, reject, type Transition } from './transition.js';

/** The closed state set; `pending` is the only non-terminal value. */
export const ARCHITECTURE_PROPOSAL_STATES = ['pending', 'applied', 'rejected', 'stale'] as const;
export type ArchitectureProposalStateV1 = (typeof ARCHITECTURE_PROPOSAL_STATES)[number];

/** The store record: the immutable content plus the mutable state and the store revision. */
export type ArchitectureProposalRecordV1 = ArchitectureProposalV1 & { revision: number };

/** One legal change after the write: enter a batch, or reach a terminal state. */
export type ArchitectureProposalEventV1 =
  | { kind: 'enter_batch'; batchRef: ArchitectureProposalBatchRef }
  | { kind: 'apply' }
  | { kind: 'reject' }
  | { kind: 'stale' };

/** The initial `pending@1` record; `batchRef` is null until a batch freezes it. */
export function newArchitectureProposalRecord(
  proposal: Omit<ArchitectureProposalV1, 'state' | 'batchRef'>,
): ArchitectureProposalRecordV1 {
  return { ...proposal, revision: 1, batchRef: null, state: 'pending' };
}

/**
 * `pending` enters a batch once, or reaches exactly one terminal state. Any other
 * request is refused: no transition leaves a terminal state, a second batch, or
 * changes the content.
 */
export function transitionArchitectureProposal(
  current: ArchitectureProposalRecordV1,
  event: ArchitectureProposalEventV1,
): Transition<ArchitectureProposalRecordV1, ArchitectureProposalEventV1, never> {
  if (current.state !== 'pending') {
    return reject('illegal', 'invalid', `an ${current.state} architecture proposal has no further transition`);
  }
  if (event.kind === 'enter_batch') {
    if (current.batchRef !== null) {
      return reject('illegal', 'invalid', 'an architecture proposal enters one batch only');
    }
    return accept({ ...current, revision: current.revision + 1, batchRef: event.batchRef });
  }
  const state = event.kind === 'apply' ? 'applied' : event.kind === 'reject' ? 'rejected' : 'stale';
  return accept({ ...current, revision: current.revision + 1, state });
}
