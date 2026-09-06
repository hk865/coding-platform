/**
 * P1-15 contracts — InitialDesignProposal / InitialDesignDecision /
 * CoordinationPolicy / UnifiedStatusPresentation + three frozen minimal
 * interfaces (HumanCollaboration.InitialDesignPort,
 * HumanCollaboration.UnifiedStatusPort, ControlEngine.CoordinationPolicyPort).
 *
 * Authority: ticket 15-human-role-collaboration.md Acceptance:
 *   - the human sees the requirement ambiguity, >=2 substantively different
 *     options with impacts, and a decision bound to an EXACT proposal revision;
 *     reject/defer/old decisions never activate a policy or plan;
 *   - the initial baseline has NO source baseline (no fake migration); P1-02
 *     install/activation path reused; existing-baseline changes go P1-14;
 *   - an explicit BUDGETED coordination policy: in-scope rework/test can
 *     proceed autonomously; scope changes (requirements/acceptance/baseline)
 *     must escalate; hints/experience must not widen the policy;
 *   - coordinator rollover resumes from facts + Handoff; the unified status
 *     view references compatible revisions, explanatory staleness is marked,
 *     facts can display first; queries may bypass the staff;
 *   - G3 requires this traceable closed loop (P1-07 parallel/writer evidence
 *     alone is not sufficient).
 */
import type { CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { GoalRef } from "./ledger.js";
import type { PlanRevisionRef } from "./plan.js";

export const P15_MAX_OPTIONS = 16;
export const P15_OPTION_SUMMARY_MAX_BYTES = 2048;
export const P15_COORDINATION_BUDGET_MAX = 4;

// ------------------------------------------------------------------------ //
// Initial design proposal / decision                                        //
// ------------------------------------------------------------------------ //

export type InitialDesignOptionV1 = { optionId: string; summary: string; impactDelta: string };

export type InitialDesignProposalV1 = {
  schemaVersion: 1;
  designId: string;
  projectId: string;
  workspaceId: string;
  goalRef: GoalRef;
  planRef: PlanRevisionRef | null;
  requirement: { ambiguity: string; interpretations: string[] };
  options: InitialDesignOptionV1[];
  requestedBy: import("./command-event.js").ActorRef;
  submittedAt: string;
};

export type InitialDesignProposalRef = { aggregateType: "InitialDesignProposal"; projectId: string; workspaceId: string; designId: string };
export type InitialDesignProposalSnapshot = { ref: InitialDesignProposalRef; revision: 1; schemaVersion: 1; proposal: InitialDesignProposalV1; recordedAt: string };

export function initialDesignProposalRefFor(projectId: string, workspaceId: string, designId: string): InitialDesignProposalRef {
  return { aggregateType: "InitialDesignProposal", projectId, workspaceId, designId };
}

export type InitialDesignDecisionV1 = {
  schemaVersion: 1;
  decisionId: string;
  projectId: string;
  workspaceId: string;
  proposalRef: InitialDesignProposalRef;
  subject: { proposalRevision: number };
  outcome: "accept" | "reject" | "defer";
  actor: import("./command-event.js").ActorRef;
  authority: { strategy: "user" | "delegated"; delegator: string | null; policyVersion: string };
  authorizedTarget: { designId: string; optionId: string; proposalDigest: string };
  summary: string;
  decidedAt: string;
};

export type InitialDesignDecisionRef = { aggregateType: "InitialDesignDecision"; projectId: string; workspaceId: string; decisionId: string };
export type InitialDesignDecisionSnapshot = { ref: InitialDesignDecisionRef; revision: 1; schemaVersion: 1; decision: InitialDesignDecisionV1; recordedAt: string };

export function initialDesignDecisionRefFor(projectId: string, workspaceId: string, decisionId: string): InitialDesignDecisionRef {
  return { aggregateType: "InitialDesignDecision", projectId, workspaceId, decisionId };
}

export function initialDesignProposalDigest(proposal: InitialDesignProposalV1): string {
  return sha256Hex(canonicalJson({ schemaVersion: proposal.schemaVersion, projectId: proposal.projectId, workspaceId: proposal.workspaceId, designId: proposal.designId, requirement: proposal.requirement, options: proposal.options }));
}

// ------------------------------------------------------------------------ //
// Coordination policy (versioned, budgeted, immutable; NOT widenable)       //
// ------------------------------------------------------------------------ //

export type CoordinationPolicyContentV1 = {
  schemaVersion: 1;
  budget: { maxAutonomousReworks: number; maxClarifications: number };
  allowed: { inScopeRework: true; inScopeTesting: true };
  scope: { changesRequireHumanDecision: ["requirement", "acceptance", "baseline"] };
  upgrade: { path: "manual-decision"; note: string };
};

export type CoordinationPolicyRevisionRef = { aggregateType: "CoordinationPolicyRevision"; projectId: string; policyId: string; revision: number };
export type CoordinationPolicyPin = { ref: CoordinationPolicyRevisionRef; digest: string };
export type CoordinationPolicyRevisionSnapshot = {
  ref: CoordinationPolicyRevisionRef;
  revision: 1;
  schemaVersion: 1;
  policyId: string;
  contentRevision: number;
  content: CoordinationPolicyContentV1;
  contentDigest: string;
  installedAt: string;
};
export type ProjectCoordinationPolicyActiveRef = { aggregateType: "ProjectCoordinationPolicyActive"; projectId: string };
export type ProjectCoordinationPolicyActiveSnapshot = { ref: ProjectCoordinationPolicyActiveRef; projectId: string; activeRevision: CoordinationPolicyRevisionRef; revision: number };

export function coordinationPolicyContentDigest(content: CoordinationPolicyContentV1, policyId: string, revision: number): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, policyId, revision, content }));
}

export type InstallCoordinationPolicyCommand = {
  commandId: string; commandType: "InstallCoordinationPolicy"; schemaVersion: 1; identity: CommandIdentity; correlationId: string; submittedAt: string;
  payload: { policyId: string; content: CoordinationPolicyContentV1; contentDigest: string };
};
export type ActivateCoordinationPolicyCommand = {
  commandId: string; commandType: "ActivateCoordinationPolicy"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: number; correlationId: string; submittedAt: string;
  payload: { target: CoordinationPolicyPin };
};

export type InstallCoordinationPolicyReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; revisionRef: CoordinationPolicyRevisionRef; contentDigest: string; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };
export type ActivateCoordinationPolicyReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; activeRef: ProjectCoordinationPolicyActiveRef; activeRevision: CoordinationPolicyRevisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "not_found" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };

export type CoordinationPolicyInstalledEvent = {
  eventId: string; eventType: "CoordinationPolicyInstalled"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "CoordinationPolicyRevision"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { revision: CoordinationPolicyRevisionSnapshot };
};
export type CoordinationPolicyActivatedEvent = {
  eventId: string; eventType: "CoordinationPolicyActivated"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "ProjectCoordinationPolicyActive"; aggregateId: string; aggregateRevision: number; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { activeRef: ProjectCoordinationPolicyActiveRef; activeRevision: CoordinationPolicyRevisionRef };
};

// ------------------------------------------------------------------------ //
// Unified status presentation (view + facts-first with stale marks)         //
// ------------------------------------------------------------------------ //

export type UnifiedStatusViewQuery = { projectId: string; workspaceId: string };
export type UnifiedStatusViewResult =
  | {
      status: "ready";
      facts: { kind: "goal" | "plan" | "task" | "evidence" | "run" | "handoff" | "decision" | "proposal" | "baseline"; refKey: string; display: string; revision: unknown; stale: boolean; sourceCursor: CommitCursor }[];
      decisions: { decisionId: string; outcome: string; summary: string; stale: boolean }[];
      explanations: { fact: string; explanation: string; stale: boolean }[];
      freshness: CommitCursor | null;
    }
  | { status: "not_found" };

// ------------------------------------------------------------------------ //
// Frozen minimal interfaces                                                 //
// ------------------------------------------------------------------------ //

export interface InitialDesignPort {
  /** Submits ONE bounded initial-design proposal (ambiguity + >=2 options). */
  propose(proposal: InitialDesignProposalV1): Promise<Result<InitialDesignProposalSnapshot>>;
  /** Records ONE exact initial-design decision. */
  decide(command: import("./human-role-collaboration.js").RecordInitialDesignDecisionCommand): Promise<import("./human-role-collaboration.js").RecordInitialDesignDecisionReceipt>;
}

export interface UnifiedStatusPort {
  /** Facts-first unified presentation (read-only; stale marked, queries may bypass staff). */
  view(query: UnifiedStatusViewQuery): Promise<UnifiedStatusViewResult>;
}

export interface CoordinationPolicyPort {
  install(command: InstallCoordinationPolicyCommand): Promise<InstallCoordinationPolicyReceipt>;
  activate(command: ActivateCoordinationPolicyCommand): Promise<ActivateCoordinationPolicyReceipt>;
}

export type Result<T> = { status: "accepted"; snapshot: T } | { status: "rejected"; code: string; message: string };

// ------------------------------------------------------------------------ //
// Commands for design decision (Control records)                            //
// ------------------------------------------------------------------------ //

export type RecordInitialDesignProposalCommand = {
  commandId: string; commandType: "RecordInitialDesignProposal"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { proposal: InitialDesignProposalV1 };
};
export type RecordInitialDesignDecisionCommand = {
  commandId: string; commandType: "RecordInitialDesignDecision"; schemaVersion: 1; identity: CommandIdentity; aggregateId: string; expectedRevision: 0; correlationId: string; submittedAt: string;
  payload: { decision: InitialDesignDecisionV1 };
};

export type RecordInitialDesignProposalReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; proposalRef: InitialDesignProposalRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };
export type RecordInitialDesignDecisionReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; decisionRef: InitialDesignDecisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "proposal_not_found" | "target_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[] };

export function recordInitialDesignProposalFingerprint(command: RecordInitialDesignProposalCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { proposal: command.payload.proposal } })) as CommandFingerprint;
}
export function recordInitialDesignDecisionFingerprint(command: RecordInitialDesignDecisionCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { decision: command.payload.decision } })) as CommandFingerprint;
}
export function installCoordinationPolicyFingerprint(command: InstallCoordinationPolicyCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, payload: { policyId: command.payload.policyId, contentDigest: command.payload.contentDigest } })) as CommandFingerprint;
}
export function activateCoordinationPolicyFingerprint(command: ActivateCoordinationPolicyCommand): CommandFingerprint {
  return sha256Hex(canonicalJson({ schemaVersion: command.schemaVersion, commandType: command.commandType, projectId: command.identity.projectId, expectedRevision: command.expectedRevision, target: command.payload.target })) as CommandFingerprint;
}

export type InitialDesignProposalRecordedEvent = {
  eventId: string; eventType: "InitialDesignProposalRecorded"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "InitialDesignProposal"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { proposal: InitialDesignProposalV1; recordedAt: string };
};
export type InitialDesignDecisionRecordedEvent = {
  eventId: string; eventType: "InitialDesignDecisionRecorded"; schemaVersion: 1; projectId: string; workspaceId: string; aggregateType: "InitialDesignDecision"; aggregateId: string; aggregateRevision: 1; causationId: string; correlationId: string; idempotencyKey: string; actor: import("./command-event.js").ActorRef; occurredAt: string;
  payload: { decision: InitialDesignDecisionV1; recordedAt: string };
};
