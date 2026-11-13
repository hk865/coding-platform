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
import type { QueryRunRef } from './query-job.js';
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
  /** M6: the exact exploration round that wrote this proposal; absent on old records. */
  queryRunRef?: QueryRunRef | null;
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
  /**
   * 121-109: the project's structural auto-approval applied the proposal's batch in the same call. Only the new pin
   * comes back, never the revision: a tool output is capped at 64 KiB.
   */
  | { status: 'applied'; proposalRef: ArchitectureProposalRef; catalogPin: ArchitectureCatalogPinV1 }
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

/**
 * 121-106 item 5, 121-109: a project's structural auto-approval, one switch for structural proposals (and the
 * understanding notes that wait only because they are structural), one for structural repairs. `auto` lets the
 * platform approve them itself and leave a notice; `ask` keeps the card. Each is decided at the moment the proposal
 * freezes or the note is written or staged, never later.
 */
export type StructuralApprovalModeV1 = 'auto' | 'ask';
export type StructuralApprovalV1 = { proposals: StructuralApprovalModeV1; repairs: StructuralApprovalModeV1 };
/** 121-109: the factory default is automatic approval. */
export const DEFAULT_STRUCTURAL_APPROVAL: Readonly<StructuralApprovalV1> = Object.freeze({ proposals: 'auto', repairs: 'auto' });

/** The one shape check of the setting (the settings route and the settings file): exactly the two switches. */
export function structuralApprovalOf(value: unknown): StructuralApprovalV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries = value as Record<string, unknown>;
  if (Object.keys(entries).length !== 2) return null;
  const proposals = entries['proposals'];
  const repairs = entries['repairs'];
  if ((proposals !== 'auto' && proposals !== 'ask') || (repairs !== 'auto' && repairs !== 'ask')) return null;
  return { proposals, repairs };
}
