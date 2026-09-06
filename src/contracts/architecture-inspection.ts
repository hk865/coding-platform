/**
 * P1-12 Architecture inspection contracts — ArchitectureInspectionIntent /
 * CodeGraphSnapshot / ArchitectureDelta / ArchitectureFinding /
 * ArchitectureDecisionBrief / CandidateBaselineProposal (first consumer
 * freeze of WorkspaceReader.ReadPort, ArchitectureReconciler.InspectionPort,
 * VerificationEngine.CodeGraphPort).
 *
 * Authority:
 *   - dev_docs/planning/proposed/P1-foundation/tickets/12-codegraph-finding-decision-brief.md
 *     (7 verification groups, 10 Acceptance items incl. the 2026-09-06
 *     extension: report-source findings WITHOUT a raw delta are allowed; raw
 *     Delta must never be fabricated)
 *   - dev_docs/modules/data/workspace-reader.md + control/architecture-reconciler.md
 *     + control/verification-engine.md (extension records)
 *   - ARCHITECTURE.md global invariants #11/#12/#13 (baseline revision
 *     immutability; plan pins; candidate source-ref discipline)
 *
 * FROZEN semantics:
 *   - The ONLY baseline input of ArchitectureReconciler is the PlanRevision
 *     pin: it loads the digest/revision-matching immutable
 *     ArchitectureBaseline along THAT pin; Project active refs and built-in
 *     baselines are NEVER read (invariant #11/#12/#13).
 *   - ArchitectureDelta carries ONLY mechanical structure differences —
 *     no correct/incorrect verdict (explicit noVerdict: true).
 *   - ArchitectureFinding carries classification, risk, confidence, sources
 *     and recommendation; it may come from structure, performance,
 *     permission or runtime evidence; a REPORT-source finding with no raw
 *     delta is legal (deltaRef: null) — fabricating a raw delta is forbidden.
 *   - material/ambiguous findings produce a DecisionBrief binding the source
 *     baseline (options, risks, deferral consequence).
 *   - CandidateBaselineProposal derives DETERMINISTICALLY from the exact
 *     source baseline + selected delta/option + normalized content; it
 *     records source ref, proposal digest and the expected candidate digest
 *     for P1-14 materialization.
 *   - Determinism: the same snapshot/baseline input produces the same raw
 *     Delta (canonicalJson equality).
 *   - P1-12 NEVER creates RemediationTask / migration Gate / BaselineActivation
 *     side effects; Inspections/Finding/Brief/Candidate are facts for P1-13/14.
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { PlanRevisionRef } from "./plan.js";
import type { ArchitectureBaselinePin } from "./governance.js";
import type { ArtifactRef } from "./artifact.js";
import type { RunRef } from "./dispatch.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

export const INSPECTION_MAX_NODES = 512;
export const INSPECTION_MAX_EDGES = 1024;
export const INSPECTION_MAX_DELTA_CHANGES = 256;
export const INSPECTION_FINDING_SUMMARY_MAX_BYTES = 4096;
export const INSPECTION_MAX_OPTIONS = 8;
export const INSPECTION_MAX_REASONS = 8;
export const INSPECTION_MAX_AFFECTED_REFS = 32;
export const INSPECTION_MAX_SOURCES = 16;
/** Hard CodeGraph snapshot cap (canonical JSON bytes; full body in vault). */
export const INSPECTION_SNAPSHOT_MAX_BYTES = 256 * 1024;
export const INSPECTION_FINDING_MAX_BYTES = 16 * 1024;
export const INSPECTION_BRIEF_MAX_BYTES = 32 * 1024;
export const INSPECTION_PROPOSAL_MAX_BYTES = 32 * 1024;

// ------------------------------------------------------------------------ //
// Refs                                                                      //
// ------------------------------------------------------------------------ //

export type ArchitectureInspectionRef = {
  aggregateType: "ArchitectureInspection";
  projectId: string;
  workspaceId: string;
  inspectionId: string;
};

export type ArchitectureFindingRef = {
  aggregateType: "ArchitectureFinding";
  projectId: string;
  workspaceId: string;
  findingId: string;
};

export type ArchitectureDecisionBriefRef = {
  aggregateType: "ArchitectureDecisionBrief";
  projectId: string;
  workspaceId: string;
  briefId: string;
};

export type ArchitectureCandidateProposalRef = {
  aggregateType: "ArchitectureCandidateProposal";
  projectId: string;
  workspaceId: string;
  proposalId: string;
};

export function architectureInspectionRefFor(projectId: string, workspaceId: string, inspectionId: string): ArchitectureInspectionRef {
  return { aggregateType: "ArchitectureInspection", projectId, workspaceId, inspectionId };
}
export function architectureFindingRefFor(projectId: string, workspaceId: string, findingId: string): ArchitectureFindingRef {
  return { aggregateType: "ArchitectureFinding", projectId, workspaceId, findingId };
}
export function architectureDecisionBriefRefFor(projectId: string, workspaceId: string, briefId: string): ArchitectureDecisionBriefRef {
  return { aggregateType: "ArchitectureDecisionBrief", projectId, workspaceId, briefId };
}
export function architectureCandidateProposalRefFor(projectId: string, workspaceId: string, proposalId: string): ArchitectureCandidateProposalRef {
  return { aggregateType: "ArchitectureCandidateProposal", projectId, workspaceId, proposalId };
}
export function architectureDeltaRef(delta: ArchitectureDeltaV1): ArtifactRef {
  return delta.bodyRef;
}

// ------------------------------------------------------------------------ //
// ReadModel view (display only)                                             //
// ------------------------------------------------------------------------ //

export type ArchitectureInspectionViewQuery = {
  projectId: string;
  workspaceId: string;
  /** Optional plan filter (default: all plans of the workspace). */
  planId?: string;
};

export type ArchitectureInspectionViewResult =
  | {
      status: "ready";
      inspections: {
        inspection: ArchitectureInspectionSnapshot;
        findings: ArchitectureFindingSnapshot[];
        briefs: ArchitectureDecisionBriefSnapshot[];
        proposals: ArchitectureCandidateProposalSnapshot[];
      }[];
      sourceCursor: CommitCursor;
    }
  | { status: "not_ready"; observedCursor: CommitCursor | null }
  | { status: "not_found"; projectId: string; workspaceId: string };

// ------------------------------------------------------------------------ //
// CodeGraph value types                                                     //
// ------------------------------------------------------------------------ //

export type CodeGraphNode = {
  nodeId: string;
  kind: "module" | "interface" | "type" | "function" | "file";
  name: string;
  path: string;
  /** Canonical structural key of the node (deterministic identity in diffs). */
  structuralKey: string;
  /** Digest of the node's normalized content (change detection). */
  contentDigest: string;
};

export type CodeGraphEdge = {
  edgeId: string;
  fromNode: string;
  toNode: string;
  kind: "module_dependency" | "interface_uses" | "type_references" | "calls";
  structuralKey: string;
};

export type CodeGraphIndexCapabilities = {
  hasCodeGraph: boolean;
  /** Text/source search fallback available (coverage-limited). */
  degradesToText: boolean;
  /** stale when the workspace revision changed since the snapshot was produced. */
  graphRevision: string | null;
};

/** A version-bound code graph snapshot of ONE workspace revision. */
export type CodeGraphSnapshotV1 = {
  schemaVersion: 1;
  snapshotId: string;
  projectId: string;
  workspaceId: string;
  /** The workspace revision the graph was produced from (canonical). */
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  /** The ONLY admissible baseline input: the plan pin (invariant #12). */
  baselinePin: ArchitectureBaselinePin;
  gitRef: { commitHash: string; treeDigest: string } | null;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  indexCapabilities: CodeGraphIndexCapabilities;
  bodyRef: ArtifactRef;
  generatedAt: string;
};

export type CodeGraphSnapshot = CodeGraphSnapshotV1;

// ------------------------------------------------------------------------ //
// ArchitectureDelta (mechanical only)                                       //
// ------------------------------------------------------------------------ //

export type DeltaChangeKind = "added" | "removed" | "modified" | "moved";
export type DeltaChangeLevel = "node" | "edge";

export type ArchitectureDeltaChange = {
  changeId: string;
  level: DeltaChangeLevel;
  kind: DeltaChangeKind;
  structuralKey: string;
  /** Before/after digests of the changed item (null when absent). */
  beforeDigest: string | null;
  afterDigest: string | null;
  /** Human label (mechanical, no verdict). */
  label: string;
};

export type ArchitectureDeltaV1 = {
  schemaVersion: 1;
  deltaId: string;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  baselinePin: ArchitectureBaselinePin;
  /** Mechanical structure differences ONLY. */
  changes: ArchitectureDeltaChange[];
  /** Explicit guarantee: a raw Delta carries NO correct/incorrect verdict. */
  noVerdict: true;
  /** Vault ref of the snapshot the delta was computed from. */
  sourceSnapshotRef: ArtifactRef | null;
  bodyRef: ArtifactRef;
  generatedAt: string;
};

/** Deterministic mechanical diff: same inputs -> identical Delta JSON. PURE. */
export function computeArchitectureDelta(before: CodeGraphSnapshotV1, after: CodeGraphSnapshotV1): ArchitectureDeltaV1 {
  const changes: ArchitectureDeltaChange[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.structuralKey, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.structuralKey, n]));
  for (const key of [...beforeNodes.keys()].sort()) {
    const b = beforeNodes.get(key)!;
    const a = afterNodes.get(key);
    if (a === undefined) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "removed", structuralKey: key, beforeDigest: b.contentDigest, afterDigest: null, label: "node removed: " + b.name });
    } else if (a.contentDigest !== b.contentDigest) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "modified", structuralKey: key, beforeDigest: b.contentDigest, afterDigest: a.contentDigest, label: "node modified: " + a.name });
    }
  }
  for (const key of [...afterNodes.keys()].sort()) {
    const a = afterNodes.get(key)!;
    if (!beforeNodes.has(key)) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "added", structuralKey: key, beforeDigest: null, afterDigest: a.contentDigest, label: "node added: " + a.name });
    }
  }
  const beforeEdges = new Map(before.edges.map((e) => [e.structuralKey, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.structuralKey, e]));
  for (const key of [...beforeEdges.keys()].sort()) {
    if (!afterEdges.has(key)) {
      changes.push({ changeId: "edge:" + key, level: "edge", kind: "removed", structuralKey: key, beforeDigest: sha256Hex(canonicalJson(beforeEdges.get(key)!)), afterDigest: null, label: "edge removed: " + key });
    }
  }
  for (const key of [...afterEdges.keys()].sort()) {
    if (!beforeEdges.has(key)) {
      changes.push({ changeId: "edge:" + key, level: "edge", kind: "added", structuralKey: key, beforeDigest: null, afterDigest: sha256Hex(canonicalJson(afterEdges.get(key)!)), label: "edge added: " + key });
    }
  }
  return {
    schemaVersion: 1,
    deltaId: "delta-" + sha256Hex(canonicalJson({ before: before.snapshotId, after: after.snapshotId, changes })).slice(0, 16),
    projectId: before.projectId,
    workspaceId: before.workspaceId,
    workspaceRevision: after.workspaceRevision,
    planRef: { ...before.planRef },
    baselinePin: { ...before.baselinePin },
    changes,
    noVerdict: true,
    sourceSnapshotRef: after.bodyRef,
    bodyRef: after.bodyRef,
    generatedAt: after.generatedAt,
  };
}

// ------------------------------------------------------------------------ //
// Finding / DecisionBrief / CandidateProposal                               //
// ------------------------------------------------------------------------ //

export type ArchitectureFindingSource =
  | "workspace_delta"
  | "interface_report"
  | "performance"
  | "permission"
  | "runtime_evidence";

export type ArchitectureFindingCategory =
  | "structure"
  | "interface"
  | "dependency"
  | "performance"
  | "permission"
  | "runtime"
  | "governance";

export type ArchitectureFindingRisk = "high" | "medium" | "low";
export type ArchitectureFindingConfidence = "high" | "medium" | "low";

export type ArchitectureFindingV1 = {
  schemaVersion: 1;
  findingId: string;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  baselinePin: ArchitectureBaselinePin;
  source: ArchitectureFindingSource;
  /** null = reported conflict WITHOUT any raw delta (never fabricate). */
  deltaRef: ArtifactRef | null;
  category: ArchitectureFindingCategory;
  risk: ArchitectureFindingRisk;
  confidence: ArchitectureFindingConfidence;
  title: string;
  summary: string;
  sources: { kind: string; refKey: string; version: string | null; label: string | null }[];
  recommendation: string | null;
  affectedRefs: { moduleRefs: string[]; interfaceRefs: string[]; pathRefs: string[] };
  /** material / ambiguous findings must carry a DecisionBrief. */
  material: boolean;
  ambiguous: boolean;
  generatedAt: string;
};

export type ArchitectureDecisionBriefOption = {
  optionId: string;
  summary: string;
  affectedRefs: { moduleRefs: string[]; interfaceRefs: string[] };
  risk: ArchitectureFindingRisk;
  /** Consequence of deferring this option. */
  deferralImpact: string | null;
};

export type ArchitectureDecisionBriefV1 = {
  schemaVersion: 1;
  briefId: string;
  projectId: string;
  workspaceId: string;
  planRef: PlanRevisionRef;
  baselinePin: ArchitectureBaselinePin;
  findingRefs: ArchitectureFindingRef[];
  originalReasons: string[];
  impact: {
    affectedModules: string[];
    affectedInterfaces: string[];
    affectedPlans: string[];
  };
  options: ArchitectureDecisionBriefOption[];
  risk: ArchitectureFindingRisk;
  deferralConsequence: string;
  bodyRef: ArtifactRef;
  generatedAt: string;
};

export type ArchitectureCandidateProposalV1 = {
  schemaVersion: 1;
  proposalId: string;
  projectId: string;
  workspaceId: string;
  planRef: PlanRevisionRef;
  /** EXACT source baseline the proposal derives from (invariant #13). */
  sourceBaselinePin: ArchitectureBaselinePin;
  selectedDeltaRef: ArtifactRef;
  selectedOptionId: string;
  /** Normalized content of the candidate baseline (content-addressed). */
  normalizedContent: { description: string; constraints: { name: string; scope: string }[] };
  /** Deterministic proposal digest = sha256(canonicalJson(payload)). */
  proposalDigest: string;
  /** Expected candidate baseline digest once materialized by P1-14. */
  expectedCandidateDigest: string;
  bodyRef: ArtifactRef;
  generatedAt: string;
};

export function candidateProposalPayload(p: ArchitectureCandidateProposalV1): string {
  return canonicalJson({
    schemaVersion: 1,
    projectId: p.projectId,
    workspaceId: p.workspaceId,
    planRef: p.planRef,
    sourceBaselinePin: p.sourceBaselinePin,
    selectedDeltaRef: p.selectedDeltaRef,
    selectedOptionId: p.selectedOptionId,
    normalizedContent: p.normalizedContent,
  });
}

export function candidateProposalDigest(p: ArchitectureCandidateProposalV1): string {
  return sha256Hex(candidateProposalPayload(p));
}

// ------------------------------------------------------------------------ //
// Inspection intent / record                                                //
// ------------------------------------------------------------------------ //

export type InspectionSource = "mechanic" | "report";

export type ArchitectureInspectionIntentV1 = {
  schemaVersion: 1;
  inspectionId: string;
  projectId: string;
  workspaceId: string;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
  /** The plan pin is the ONLY admissible baseline input. */
  baselinePin: ArchitectureBaselinePin;
  source: InspectionSource;
  requestedByRunRef: RunRef | null;
  /** report-source: a described conflict WITHOUT delta (structure check still runs). */
  reportInput: {
    description: string;
    category: ArchitectureFindingCategory;
    risk: ArchitectureFindingRisk;
    affectedRefs: { moduleRefs: string[]; interfaceRefs: string[]; pathRefs: string[] };
  } | null;
  budget: { maxTokens: number; deadline: string | null };
};

export type ArchitectureInspectionSnapshot = {
  ref: ArchitectureInspectionRef;
  revision: 1;
  schemaVersion: 1;
  intent: ArchitectureInspectionIntentV1;
  /** null for a report-source inspection that never produced a graph diff. */
  snapshotRef: ArtifactRef | null;
  deltaRef: ArtifactRef | null;
  findingRefs: ArchitectureFindingRef[];
  briefRef: ArchitectureDecisionBriefRef | null;
  proposalRef: ArchitectureCandidateProposalRef | null;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// Commands / receipts                                                       //
// ------------------------------------------------------------------------ //

export type RecordArchitectureInspectionCommand = {
  commandId: string;
  commandType: "RecordArchitectureInspection";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { inspection: ArchitectureInspectionSnapshot };
};

export type RecordArchitectureInspectionRejectionCode =
  | "invalid"
  | "not_found"
  | "baseline_mismatch"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordArchitectureInspectionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; inspectionRef: ArchitectureInspectionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordArchitectureInspectionRejectionCode; issues?: string[] };

export type RecordArchitectureFindingCommand = {
  commandId: string;
  commandType: "RecordArchitectureFinding";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { finding: ArchitectureFindingV1 };
};

export type RecordArchitectureFindingRejectionCode =
  | "invalid"
  | "not_found"
  | "baseline_mismatch"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordArchitectureFindingReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; findingRef: ArchitectureFindingRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordArchitectureFindingRejectionCode; issues?: string[] };

export type RecordArchitectureDecisionBriefCommand = {
  commandId: string;
  commandType: "RecordArchitectureDecisionBrief";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { brief: ArchitectureDecisionBriefV1 };
};

export type RecordArchitectureDecisionBriefRejectionCode =
  | "invalid"
  | "not_found"
  | "baseline_mismatch"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordArchitectureDecisionBriefReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; briefRef: ArchitectureDecisionBriefRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordArchitectureDecisionBriefRejectionCode; issues?: string[] };

export type RecordCandidateBaselineProposalCommand = {
  commandId: string;
  commandType: "RecordCandidateBaselineProposal";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: { proposal: ArchitectureCandidateProposalV1 };
};

export type RecordCandidateBaselineProposalRejectionCode =
  | "invalid"
  | "not_found"
  | "baseline_mismatch"
  | "digest_mismatch"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

export type RecordCandidateBaselineProposalReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; proposalRef: ArchitectureCandidateProposalRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: RecordCandidateBaselineProposalRejectionCode; issues?: string[] };

export type ArchitectureInspectionOutcome =
  | { status: "recorded"; inspectionRef: ArchitectureInspectionRef; findingCount: number }
  | { status: "fail_closed"; code: "baseline_unresolved" | "baseline_digest_mismatch" | "plan_pin_missing" | "workspace_unavailable"; diagnostics: string[] };

// ------------------------------------------------------------------------ //
// Domain events (P1-12 v1)                                                  //
// ------------------------------------------------------------------------ //

export type ArchitectureInspectionRecordedEvent = {
  eventId: string;
  eventType: "ArchitectureInspectionRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ArchitectureInspection";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { inspection: ArchitectureInspectionSnapshot };
};

export type ArchitectureFindingRecordedEvent = {
  eventId: string;
  eventType: "ArchitectureFindingRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ArchitectureFinding";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { finding: ArchitectureFindingV1; recordedAt: string };
};

export type ArchitectureDecisionBriefRecordedEvent = {
  eventId: string;
  eventType: "ArchitectureDecisionBriefRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ArchitectureDecisionBrief";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { brief: ArchitectureDecisionBriefV1; recordedAt: string };
};

export type ArchitectureCandidateProposalRecordedEvent = {
  eventId: string;
  eventType: "ArchitectureCandidateProposalRecorded";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ArchitectureCandidateProposal";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { proposal: ArchitectureCandidateProposalV1; recordedAt: string };
};

export type ArchitectureFindingSnapshot = {
  ref: ArchitectureFindingRef;
  revision: 1;
  schemaVersion: 1;
  finding: ArchitectureFindingV1;
  recordedAt: string;
};

export type ArchitectureDecisionBriefSnapshot = {
  ref: ArchitectureDecisionBriefRef;
  revision: 1;
  schemaVersion: 1;
  brief: ArchitectureDecisionBriefV1;
  recordedAt: string;
};

export type ArchitectureCandidateProposalSnapshot = {
  ref: ArchitectureCandidateProposalRef;
  revision: 1;
  schemaVersion: 1;
  proposal: ArchitectureCandidateProposalV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// Fingerprints                                                              //
// ------------------------------------------------------------------------ //

export function recordArchitectureInspectionFingerprint(command: RecordArchitectureInspectionCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { inspection: command.payload.inspection } })) as CommandFingerprint;
}
export function recordArchitectureFindingFingerprint(command: RecordArchitectureFindingCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { finding: command.payload.finding } })) as CommandFingerprint;
}
export function recordArchitectureDecisionBriefFingerprint(command: RecordArchitectureDecisionBriefCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { brief: command.payload.brief } })) as CommandFingerprint;
}
export function recordCandidateBaselineProposalFingerprint(command: RecordCandidateBaselineProposalCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { proposal: command.payload.proposal } })) as CommandFingerprint;
}
