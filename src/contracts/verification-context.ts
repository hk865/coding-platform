import type { RunOutputMaterialPort } from './run-output-materials.js';
import type { ArtifactOpenResult, ArtifactRef } from './artifact.js';
import type { RunRef, RunSnapshot } from './dispatch.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from './plan.js';
import type { CompletionPolicyContentV1, CompletionPolicyResolution, ArchitectureBaselineResolution, ArchitectureBaselineContentV1, CompletionPolicyPin } from './governance.js';
import type { PatchRecordSnapshot } from './patch.js';
import type { WorkspaceWriteLeaseSnapshot } from './workspace-lease.js';
import type { VerificationScope } from './verification-import.js';
import type { VerificationRequestV1, VerificationResultV1, VerificationIssue, ChangeScopeV1, RiskV1 } from './verification.js';
import type { CandidateArchitectureBaselineRef, CandidateArchitectureBaselineV1 } from './baseline-evolution.js';
import type { ArchitectureBaselinePin } from './governance.js';
export type VerificationMaterialResult = Exclude<VerificationResultV1, {
  status: 'ready';
}> | {
  status: 'ready';
  planSnapshot: PlanRevisionSnapshot;
  workspaceRevision: number;
  policyContent: CompletionPolicyContentV1;
};
type VerificationRunMaterial = {
  run: RunSnapshot;
  plan: PlanRevisionSnapshot;
  workspaceRevision: number;
  root: string;
};
/** Public runtime facts only; Context does not inspect a concrete runtime record. */
export interface VerificationRuntimeFacts {
  all(): Array<{
    spec: VerificationScope;
    status: string;
  }>;
}
export interface VerificationContextPort extends RunOutputMaterialPort {
  resolveVerification(request: VerificationRequestV1): Promise<VerificationMaterialResult>;
  run(scope: VerificationScope): Promise<VerificationRunMaterial>;
  policy(plan: PlanRevisionSnapshot): Promise<CompletionPolicyResolution>;
  baseline(plan: PlanRevisionSnapshot): Promise<ArchitectureBaselineResolution>;
  taskReductionRevision(scope: {
    projectId: string;
    goalId: string;
    taskId: string;
  }): Promise<number>;
  goalPhaseRevision(scope: {
    projectId: string;
    goalId: string;
  }): Promise<number>;
  writeLease(projectId: string, leaseId: string): Promise<WorkspaceWriteLeaseSnapshot | null>;
  patchRecord(projectId: string, patchId: string): Promise<PatchRecordSnapshot | null>;
  openReport(ref: ArtifactRef, owner: RunRef): Promise<ArtifactOpenResult>;
  workspaceDigest(scope: VerificationScope): Promise<string>;
  resolveRound(scope: VerificationRoundScope, expected?: VerificationRoundMaterialIdentity): Promise<VerificationRoundMaterialResult>;
  resolveRework?(scope: VerificationRoundScope): Promise<VerificationReworkMaterialResult>;
}

export type VerificationReworkMaterialResult = Exclude<VerificationRoundMaterialResult, { status: 'ready' }> | { status: 'not_rework' } | {
  status: 'ready';
  material: VerificationRoundMaterial;
  proposalId: string;
  issues: import('./rework/issues.js').ReworkIssueV1[];
};

export type VerificationRoundScope = VerificationScope & { taskId: string };
/** The comparison is explicit. Neither variant proves the Run's before-state. */
export type VerificationRoundSourceProof =
  | { kind: 'git-head-worktree'; baseCommit: string; changedFiles: string[]; comparison: 'current-head-to-worktree'; runBaselineKnown: false }
  | { kind: 'current-workspace-only'; runBaselineKnown: false };

export type VerificationRoundSourceResult =
  | { status: 'ready'; sourceDigest: string; sourceProof: VerificationRoundSourceProof; changeScope: ChangeScopeV1; gaps: string[] }
  | { status: 'incomplete'; code: 'source_unavailable'; missing: string[] }
  | { status: 'rejected'; code: 'source_changed'; issues: VerificationIssue[] };

/** WorkspaceReader only observes files/Git metadata; no checks or state writes. */
export interface VerificationRoundSourcePort {
  capture(root: string): Promise<VerificationRoundSourceResult>;
}

/** Frozen canonical and filesystem identities, rechecked before every use. */
export type VerificationRoundMaterialIdentity = {
  schemaVersion: 1;
  scope: VerificationRoundScope;
  runRef: RunRef;
  runRevision: number;
  runDigest: string;
  planRef: PlanRevisionRef;
  planRevision: number;
  planDigest: string;
  taskDigest: string;
  goalRevision: number;
  goalDigest: string;
  workspaceRevision: number;
  /** Digest of the canonical Workspace record, distinct from sourceDigest. */
  workspaceDigest: string;
  workspaceRoot: string;
  policyPin: CompletionPolicyPin;
  baselinePin: ArchitectureBaselinePin;
  sourceDigest: string;
  sourceProofDigest: string;
};

export type VerificationRoundMaterial = VerificationRunMaterial & {
  task: RuntimeTask;
  policyContent: CompletionPolicyContentV1;
  baselineContent: ArchitectureBaselineContentV1;
  sourceDigest: string;
  sourceProof: VerificationRoundSourceProof;
  changeScope: ChangeScopeV1;
  /** No trusted Run-before-state exists yet; never manufacture a fast path. */
  semanticChange: 'semantic';
  risks: RiskV1[];
  gaps: string[];
  identity: VerificationRoundMaterialIdentity;
};

export type VerificationRoundMaterialResult =
  | { status: 'ready'; material: VerificationRoundMaterial }
  | { status: 'incomplete'; code: 'material_unavailable' | 'source_unavailable'; missing: string[] }
  | { status: 'rejected'; code: 'invalid_scope' | 'not_found' | 'scope_mismatch' | 'run_unsettled' | 'dangling_ref' | 'stale_material' | 'source_changed'; issues: VerificationIssue[] };
/** Source materials for the deterministic migration gate, separate from command execution. */
export interface VerificationMigrationContextPort {
  migrationCandidate(ref: CandidateArchitectureBaselineRef): Promise<CandidateArchitectureBaselineV1 | null>;
  migrationBasis(candidate: CandidateArchitectureBaselineV1): Promise<{
    activeSourcePin: ArchitectureBaselinePin | null;
    workspaceRevision: number | null;
  }>;
}
