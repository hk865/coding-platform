/**
 * P1-14 BaselineActivation contracts — CandidateArchitectureBaseline /
 * ArchitectureChangeDecision / MigrationPlan / MigrationGateTask /
 * BaselineActivation + three frozen minimal interfaces
 * (HumanCollaboration.ArchitectureDecisionPort,
 * ArchitectureReconciler.BaselineEvolutionPort,
 * VerificationEngine.MigrationGatePort).
 *
 * Authority: ticket 14-baseline-activation.md Acceptance:
 *   - candidate materializes DETERMINISTICALLY from the proposal + its EXACT
 *     source baseline; materialization requires current active == proposal
 *     source, and candidate digest == proposal.expectedCandidateDigest, else
 *     no Decision may be requested and no migration may run;
 *   - the Decision (via the P1-11 authority path as EXISTENCE evidence, NOT a
 *     pre-authorization) records subject/outcome/actor/authority/authorized
 *     target/from ref/exact candidate ref; reject/defer/unauthorized or
 *     target mismatch -> NO activation;
 *   - MigrationGate must PASS on the candidate + current workspace revision;
 *     explicit diff, no implicit rebase; affected pinned plans listed;
 *   - activation = CAS on expected Project revision + exact ref chain
 *     (proposal source == candidate parent == decision from == migrationPlan
 *     from == current active); a move at ANY stage makes the whole chain
 *     STALE and requires re-proposal from the new active ref;
 *   - existing plans keep their pinned baseline (only explicit rebase /
 *     new PlanRevision recomputes); no old FAIL/Finding/Decision/Evidence
 *     rewrite; view explains who authorized / gate evidence / which plans
 *     are not yet rebased.
 */
import type { CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { ArchitectureBaselinePin } from "./governance.js";
import type { PlanRevisionRef } from "./plan.js";
import type { ArchitectureCandidateProposalV1 } from "./architecture-inspection.js";

export const BASELINE_EVOLUTION_MIGRATION_SUMMARY_MAX_BYTES = 4096;
export const BASELINE_EVOLUTION_MAX_AFFECTED_PLANS = 64;
export const BASELINE_EVOLUTION_MAX_GATE_EVIDENCE = 16;

// ------------------------------------------------------------------------ //
// CandidateArchitectureBaseline (deterministic materialization)             //
// ------------------------------------------------------------------------ //

export type CandidateArchitectureBaselineRef = { aggregateType: "CandidateArchitectureBaseline"; projectId: string; workspaceId: string; candidateId: string };

export type CandidateArchitectureBaselineV1 = {
  schemaVersion: 1;
  candidateId: string;
  projectId: string;
  workspaceId: string;
  proposalRef: { aggregateType: "ArchitectureCandidateProposal"; projectId: string; workspaceId: string; proposalId: string };
  parentSourcePin: ArchitectureBaselinePin;
  normalizedContent: ArchitectureCandidateProposalV1["normalizedContent"];
  /** MUST equal proposal.expectedCandidateDigest (content-addressed). */
  contentDigest: string;
  materializedAt: string;
};

export type CandidateArchitectureBaselineSnapshot = { ref: CandidateArchitectureBaselineRef; revision: 1; schemaVersion: 1; candidate: CandidateArchitectureBaselineV1; materializedAt: string };

export function candidateRefFor(projectId: string, workspaceId: string, candidateId: string): CandidateArchitectureBaselineRef {
  return { aggregateType: "CandidateArchitectureBaseline", projectId, workspaceId, candidateId };
}

/** Deterministic candidate digest over the normalized content (content-addressing). */
export function candidateContentDigest(normalizedContent: ArchitectureCandidateProposalV1["normalizedContent"]): string {
  return sha256Hex(canonicalJson(normalizedContent));
}

/** Deterministic candidate id derived from the content digest (content-addressed ref). */
export function candidateIdFromDigest(digest: string): string {
  return "candidate-" + digest.slice(0, 16);
}

// ------------------------------------------------------------------------ //
// ArchitectureChangeDecision (independent decision aggregate; P1-11 authority path is EXISTENCE evidence only) //
// ------------------------------------------------------------------------ //

export type ArchitectureChangeDecisionRef = { aggregateType: "ArchitectureChangeDecision"; projectId: string; workspaceId: string; decisionId: string };

export type ArchitectureChangeDecisionV1 = {
  schemaVersion: 1;
  decisionId: string;
  projectId: string;
  workspaceId: string;
  subject: { fromPin: ArchitectureBaselinePin; candidateRef: CandidateArchitectureBaselineRef };
  outcome: "accept" | "reject" | "defer";
  actor: import("./command-event.js").ActorRef;
  authority: { strategy: "user" | "delegated"; delegator: string | null; policyVersion: string };
  authorizedTarget: { fromPin: ArchitectureBaselinePin; candidateDigest: string };
  summary: string;
  decidedAt: string;
};

export function architectureChangeDecisionRefFor(projectId: string, workspaceId: string, decisionId: string): ArchitectureChangeDecisionRef {
  return { aggregateType: "ArchitectureChangeDecision", projectId, workspaceId, decisionId };
}

// ------------------------------------------------------------------------ //
// MigrationPlan / MigrationGateTask                                         //
// ------------------------------------------------------------------------ //

export type MigrationPlanV1 = {
  schemaVersion: 1;
  planId: string;
  projectId: string;
  workspaceId: string;
  decisionRef: ArchitectureChangeDecisionRef;
  candidateRef: CandidateArchitectureBaselineRef;
  fromPin: ArchitectureBaselinePin;
  candidatePin: ArchitectureBaselinePin;
  affectedPlanRefs: { planRef: PlanRevisionRef; pinnedBaselinePin: ArchitectureBaselinePin }[];
  migrationEvidenceRefs: import("./evidence.js").EvidenceRef[];
  materialsToRefresh: string[];
  /** Explicit: the gate never hides differences via an implicit rebase. */
  notImplicitRebase: true;
  createdAt: string;
};

export type MigrationGateTaskRef = { aggregateType: "MigrationGateTask"; projectId: string; workspaceId: string; gateId: string };

export type MigrationGateStatus = "pending" | "pass" | "fail" | "stale";

export type MigrationGateTaskV1 = {
  schemaVersion: 1;
  gateId: string;
  projectId: string;
  workspaceId: string;
  planRef: MigrationPlanV1["planId"];
  candidateRef: CandidateArchitectureBaselineRef;
  workspaceRevision: number;
  status: MigrationGateStatus;
  gateEvidenceRefs: import("./evidence.js").EvidenceRef[];
  createdAt: string;
  updatedAt: string;
};

export function migrationGateRefFor(projectId: string, workspaceId: string, gateId: string): MigrationGateTaskRef {
  return { aggregateType: "MigrationGateTask", projectId, workspaceId, gateId };
}

// ------------------------------------------------------------------------ //
// BaselineActivation record (the recorded orchestration artifact; the move itself reuses P1-02 activate) //
// ------------------------------------------------------------------------ //

export type BaselineActivationRef = { aggregateType: "BaselineActivation"; projectId: string; workspaceId: string; activationId: string };

export type BaselineActivationV1 = {
  schemaVersion: 1;
  activationId: string;
  projectId: string;
  workspaceId: string;
  proposalRef: { aggregateType: "ArchitectureCandidateProposal"; projectId: string; workspaceId: string; proposalId: string };
  decisionRef: ArchitectureChangeDecisionRef;
  gateRef: MigrationGateTaskRef;
  fromPin: ArchitectureBaselinePin;
  toPin: ArchitectureBaselinePin;
  activatedAt: string;
};

export function baselineActivationRefFor(projectId: string, workspaceId: string, activationId: string): BaselineActivationRef {
  return { aggregateType: "BaselineActivation", projectId, workspaceId, activationId };
}

// ------------------------------------------------------------------------ //
// Commands / receipts                                                        //
// ------------------------------------------------------------------------ //

export type MaterializeCandidateBaselineCommand = {
  commandId: string; commandType: "MaterializeCandidateBaseline"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { proposalRef: { aggregateType: "ArchitectureCandidateProposal"; projectId: string; workspaceId: string; proposalId: string } };
};

export type RecordArchitectureChangeDecisionCommand = {
  commandId: string; commandType: "RecordArchitectureChangeDecision"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { decision: ArchitectureChangeDecisionV1 };
};

export type RecordMigrationGateCommand = {
  commandId: string; commandType: "RecordMigrationGate"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { gate: MigrationGateTaskV1 };
};

export type RecordBaselineActivationCommand = {
  commandId: string; commandType: "RecordBaselineActivation"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { activation: BaselineActivationV1 };
};

export type MaterializeCandidateBaselineReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; candidateRef: CandidateArchitectureBaselineRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "proposal_not_found" | "source_stale" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };

export type RecordArchitectureChangeDecisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; decisionRef: ArchitectureChangeDecisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "candidate_not_found" | "target_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };

export type RecordMigrationGateReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; gateRef: MigrationGateTaskRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "candidate_not_found" | "workspace_revision_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };

export type RecordBaselineActivationReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; activationRef: BaselineActivationRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "decision_not_found" | "gate_not_found" | "decision_not_accepted" | "target_mismatch" | "gate_not_pass" | "source_stale" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };

// ------------------------------------------------------------------------ //
// Events                                                                    //
// ------------------------------------------------------------------------ //

export type CandidateBaselineMaterializedEvent = {
  eventId: string; eventType: "CandidateBaselineMaterialized"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "CandidateArchitectureBaseline"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { candidate: CandidateArchitectureBaselineV1; materializedAt: string };
};

export type ArchitectureChangeDecisionRecordedEvent = {
  eventId: string; eventType: "ArchitectureChangeDecisionRecorded"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "ArchitectureChangeDecision"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { decision: ArchitectureChangeDecisionV1; recordedAt: string };
};

export type MigrationGateRecordedEvent = {
  eventId: string; eventType: "MigrationGateRecorded"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "MigrationGateTask"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { gate: MigrationGateTaskV1; recordedAt: string };
};

export type BaselineActivationRecordedEvent = {
  eventId: string; eventType: "BaselineActivationRecorded"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "BaselineActivation"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { activation: BaselineActivationV1; recordedAt: string };
};

// ------------------------------------------------------------------------ //
// Fingerprints                                                               //
// ------------------------------------------------------------------------ //

export function materializeCandidateBaselineFingerprint(command: MaterializeCandidateBaselineCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { proposalRef: command.payload.proposalRef } })) as CommandFingerprint;
}
export function recordArchitectureChangeDecisionFingerprint(command: RecordArchitectureChangeDecisionCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decision: command.payload.decision } })) as CommandFingerprint;
}
export function recordMigrationGateFingerprint(command: RecordMigrationGateCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { gate: command.payload.gate } })) as CommandFingerprint;
}
export function recordBaselineActivationFingerprint(command: RecordBaselineActivationCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { activation: command.payload.activation } })) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// PURE chain consistency / stale checks                                     //
// ------------------------------------------------------------------------ //

/** Exact ref-chain equality: proposal source == candidate parent == decision from == migration from == current active. */
export function baselineEvolutionChainConsistent(inputs: { proposalSourcePin: ArchitectureBaselinePin; currentActivePin: ArchitectureBaselinePin; candidateParentPin: ArchitectureBaselinePin; decisionFromPin: ArchitectureBaselinePin; migrationFromPin: ArchitectureBaselinePin }): boolean {
  const a = canonicalJson(inputs.proposalSourcePin);
  return a === canonicalJson(inputs.currentActivePin) && a === canonicalJson(inputs.candidateParentPin) && a === canonicalJson(inputs.decisionFromPin) && a === canonicalJson(inputs.migrationFromPin);
}

/** A work item is STALE when the exact source ref it derives from no longer equals the current active ref. */
export function isSourceStale(sourcePin: ArchitectureBaselinePin, currentActivePin: ArchitectureBaselinePin): boolean {
  return canonicalJson(sourcePin) !== canonicalJson(currentActivePin);
}

/** Migration plan from/to pins must be exact; gate must NOT claim implicit rebase. */
export function migrationPlanConsistent(plan: MigrationPlanV1, gate: MigrationGateTaskV1): boolean {
  return plan.candidateRef.candidateId === gate.candidateRef.candidateId && plan.notImplicitRebase === true;
}

// ------------------------------------------------------------------------ //
// Read view (ReadModelIndex.baselineChangeView)                             //
// ------------------------------------------------------------------------ //

export type BaselineChangeViewQuery = { projectId: string; workspaceId: string };
export type BaselineChangeViewResult =
  | {
      status: "ready";
      defaultPin: ArchitectureBaselinePin;
      candidate: (CandidateArchitectureBaselineSnapshot & { stale: boolean }) | null;
      decision: (ArchitectureChangeDecisionV1 & { ref: ArchitectureChangeDecisionRef; stale: boolean }) | null;
      gate: (MigrationGateTaskV1 & { ref: MigrationGateTaskRef; stale: boolean }) | null;
      activation: (BaselineActivationV1 & { ref: BaselineActivationRef }) | null;
      notRebasedPlans: { planRef: PlanRevisionRef; pinnedBaselinePin: ArchitectureBaselinePin }[];
      freshness: CommitCursor | null;
    }
  | { status: "not_found" };

// ------------------------------------------------------------------------ //
// Frozen minimal interfaces (first consumers only consume these versions)   //
// ------------------------------------------------------------------------ //

export interface ArchitectureDecisionPort {
  /** Record ONE immutable architecture-change decision; only Control activates later. */
  decide(command: RecordArchitectureChangeDecisionCommand): Promise<RecordArchitectureChangeDecisionReceipt>;
  /** Record ONE migration gate result. */
  recordGate(command: RecordMigrationGateCommand): Promise<RecordMigrationGateReceipt>;
  /** Record ONE baseline activation (CAS guarded; the ref move itself reuses P1-02 activate). */
  recordActivation(command: RecordBaselineActivationCommand): Promise<RecordBaselineActivationReceipt>;
}

export interface BaselineEvolutionPort {
  /** Deterministic candidate materialization from the proposal + exact source. */
  materialize(proposalRef: { aggregateType: "ArchitectureCandidateProposal"; projectId: string; workspaceId: string; proposalId: string }): Promise<RecordMaterializeResult>;
}

export type RecordMaterializeResult =
  | { status: "materialized"; candidate: CandidateArchitectureBaselineV1 }
  | { status: "needs_material"; gaps: string[] }
  | { status: "rejected"; code: "proposal_not_found" | "source_stale" | "digest_mismatch" | "invalid_request"; message: string };

// --- P1-14 LANE-B zone -------------------------------------------------- //
// Minimal field extension to the FROZEN MigrationGatePort: planRef is now a
// REQUIRED input. The gate record associates the change view with the existing
// plan; a missing/empty planRef yields { status: "fail", reasons:["plan_ref_missing"] }.
// Only this interface changes in lane B; every other contract stays frozen.
export interface MigrationGatePort {
  /** Run (or re-run) the migration gate against candidate + current workspace revision. */
  run(input: { candidateRef: CandidateArchitectureBaselineRef; workspaceRevision: number; planRef: string }): Promise<{ status: "pass"; gate: MigrationGateTaskV1 } | { status: "fail"; gate: MigrationGateTaskV1; reasons: string[] } | { status: "stale"; message: string } | { status: "unsupported"; message: string }>;
}
