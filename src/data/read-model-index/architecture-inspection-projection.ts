import type { ArchitectureInspectionSnapshot } from '../../contracts/architecture-inspection.js';
import type { ArchitectureBaselinePin } from '../../contracts/governance.js';
import type { PlanRevisionRef } from '../../contracts/plan.js';

/** Display-only row for a brief/proposal recorded without an inspection row. */
export function buildSyntheticArchitectureInspection(
  projectId: string,
  workspaceId: string,
  labelId: string,
  baselinePin: ArchitectureBaselinePin,
  planRef: PlanRevisionRef,
  recordedAt: string,
  label: string,
): ArchitectureInspectionSnapshot {
  const inspectionId = `synthetic-${label}-${labelId}`;
  return {
    ref: { aggregateType: 'ArchitectureInspection', projectId, workspaceId, inspectionId },
    revision: 1,
    schemaVersion: 1,
    intent: {
      schemaVersion: 1,
      inspectionId,
      projectId,
      workspaceId,
      workspaceRevision: 0,
      planRef,
      baselinePin,
      source: 'report',
      requestedByRunRef: null,
      reportInput: null,
      budget: { maxTokens: 0, deadline: null },
    },
    snapshotRef: null,
    deltaRef: null,
    findingRefs: [],
    briefRef: null,
    proposalRef: null,
    recordedAt,
  };
}
