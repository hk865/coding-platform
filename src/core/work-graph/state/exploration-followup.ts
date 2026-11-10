/**
 * The exploration follow-up operation (`exploration_followup`): one `role_line` arm with one phase, a fixed
 * set of requested blocks, and the batch refs it freezes. It reuses the region line/round/batch/card owners;
 * these constructors only move its own payload.
 */
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureProposalBatchRef } from '../../../contracts/architecture-proposal.js';
import type {
  ColdStartExplorationQueryRefV1, ExplorationDepthV1, RoleLineActionV1,
} from './role-line-action.js';

export type ExplorationFollowUpActionV1 = RoleLineActionV1 & {
  action: 'exploration_followup';
  phase: 'regions';
  lastCompleted: null;
  followUp: {
    kind: 'repropose' | 'deepen';
    moduleRefs: ModuleRef[];
    reason: string | null;
    sourceBatchRef: ArchitectureProposalBatchRef | null;
  };
  explorations: ColdStartExplorationQueryRefV1[];
  plannedRounds: number;
  pendingRegions: [];
  batchRefs: ArchitectureProposalBatchRef[];
  route: 'split';
  baseCatalogPin: ArchitectureCatalogPinV1;
};

/** One follow-up operation per public cause: `repropose:<batchId>` or `deepen:<requestId>`. */
export function explorationFollowUpOperationRef(projectId: string, key: string): OperationRef {
  return { aggregateType: 'CoreOperation', projectId, operationId: `exploration_followup:${key}` };
}

export function newExplorationFollowUpAction(input: {
  depth: ExplorationDepthV1;
  kind: 'repropose' | 'deepen';
  moduleRefs: ModuleRef[];
  reason: string | null;
  sourceBatchRef: ArchitectureProposalBatchRef | null;
  baseCatalogPin: ArchitectureCatalogPinV1;
}): ExplorationFollowUpActionV1 {
  return { kind: 'role_line', action: 'exploration_followup', phase: 'regions', lastCompleted: null,
    goalRef: null, steps: [], result: null,
    followUp: { kind: input.kind, moduleRefs: input.moduleRefs.map((ref) => ({ ...ref })),
      reason: input.reason, sourceBatchRef: input.sourceBatchRef === null ? null : { ...input.sourceBatchRef } },
    explorations: [], plannedRounds: input.moduleRefs.length, pendingRegions: [],
    batchRefs: [], route: 'split', baseCatalogPin: structuredClone(input.baseCatalogPin),
    depth: input.depth };
}

/** The frozen batches this operation saved; the recovery reads only these refs. */
export function saveBatchRefs(action: ExplorationFollowUpActionV1,
  batchRefs: readonly ArchitectureProposalBatchRef[]): ExplorationFollowUpActionV1 {
  return { ...action, batchRefs: batchRefs.map((ref) => ({ ...ref })) };
}

/** The terminal action mark; the record's `completed` rides the same commit. */
export function completeFollowup(action: ExplorationFollowUpActionV1): ExplorationFollowUpActionV1 {
  return { ...action, result: { status: 'done', reason: null } };
}
