/**
 * Structural proposal contracts: the proposal and batch that the
 * exploration line writes, the person's approval freezes and applies, and the plain
 * read beside them. They are pure data: no store, no clock, no id minting and no
 * decision routing. The WorkGraph proposal owner, its records and its state machine
 * consume these shapes.
 *
 * `ApplyBatchResult` names the applied catalog revision as a type parameter because
 * the applied revision (`ArchitectureRevision`) belongs to the WorkGraph catalog
 * layer; the shared contracts layer cannot depend on it.
 */
import type { ArchitectureCatalogPinV1 } from './architecture-catalog.js';
import type { OperationRef } from './core/operations.js';
import type { SessionRef } from './core/identity.js';
import type { CoreRejection } from './core/results.js';
import type { DecisionApplicationReceiptV1 } from './core/session-message.js';
import type { CatalogRepairOpV1, ResponsibilityMoveV1 } from './note.js';

export type ArchitectureProposalRef = {
  projectId: string; proposalId: string; aggregateType: 'ArchitectureProposal';
};
export type ArchitectureProposalBatchRef = {
  projectId: string; batchId: string; aggregateType: 'ArchitectureProposalBatch';
};

export type ArchitectureProposalV1 = {
  ref: ArchitectureProposalRef;
  batchRef: ArchitectureProposalBatchRef | null;   // set once when the proposal enters a batch, never changed
  baseCatalogPin: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
  reason: string;
  proposer: SessionRef;
  operationRef: OperationRef | null;
  state: 'pending' | 'applied' | 'rejected' | 'stale';
};

export type ArchitectureProposalBatchV1 = {
  ref: ArchitectureProposalBatchRef;
  members: ArchitectureProposalRef[];
  baseCatalogPin: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
  digest: string;
};

export type ProposeArchitectureRevisionInputV1 = {
  baseCatalogPin: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
  reason: string;
  operationRef?: OperationRef;
};

export type ProposalResult =
  | { status: 'needs_decision'; proposalRef: ArchitectureProposalRef; cardKey: string }
  | { status: 'pending_batch'; proposalRef: ArchitectureProposalRef }
  | { status: 'invalid'; reason: string }
  | CoreRejection;   // unavailable/idempotency_conflict/... through the existing rejection, no new string

export type ApplyBatchResult<Revision = unknown> =
  | { status: 'applied'; receipt: DecisionApplicationReceiptV1; revision: Revision }
  | { status: 'rejected'; receipt: DecisionApplicationReceiptV1 }
  | { status: 'source_stale'; receipt: DecisionApplicationReceiptV1 }
  | { status: 'invalid'; reason: string }
  | CoreRejection;   // revision_conflict/unavailable/... through the existing rejection

export type ProposalRead = {
  proposal: ArchitectureProposalV1;
  batchRef: ArchitectureProposalBatchRef | null;
  cardKey: string | null;
};
