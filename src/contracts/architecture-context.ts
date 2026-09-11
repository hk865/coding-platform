import type { ArchitectureInspectionIntentV1, ArchitectureCandidateProposalSnapshot } from './architecture-inspection.js';
import type { InspectResultV1 } from './architecture-reconciler.js';
import type { ArchitectureBaselineRevisionSnapshot } from './governance.js';
import type { ArchitectureSourceSnapshotV1 } from './architecture-source.js';

/** Validated, immutable inputs for one inspection; no state transition authority. */
export type ArchitectureInspectionMaterials = {
  baseline: ArchitectureBaselineRevisionSnapshot;
  readerRevision: number;
  priorRecordedAt: string | null;
  sources: { baseline: ArchitectureSourceSnapshotV1; current: ArchitectureSourceSnapshotV1 } | null;
};

export type ArchitectureContextResult =
  | { status: 'ready'; materials: ArchitectureInspectionMaterials }
  | Extract<InspectResultV1, { status: 'fail_closed' }>;

export interface ArchitectureContextPort {
  /** Resolves the exact plan pin, scoped reader, prior identity and source pair.
   * Report-only inspections never fabricate a source pair. Current-source
   * refusal is explicit; callers must not substitute an empty graph. */
  assemble(intent: ArchitectureInspectionIntentV1): Promise<ArchitectureContextResult>;
}

export type BaselineProposalRef = ArchitectureCandidateProposalSnapshot['ref'];
export interface BaselineEvolutionContextPort {
  assemble(proposalRef: BaselineProposalRef): Promise<
    | { status: 'ready'; proposal: ArchitectureCandidateProposalSnapshot['proposal'] }
    | { status: 'rejected'; code: 'proposal_not_found' | 'source_stale'; message: string }
  >;
}
