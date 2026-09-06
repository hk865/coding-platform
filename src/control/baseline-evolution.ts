/**
 * P1-14 Control entry: baseline-evolution orchestration engine (LANE A).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN). Fills the lane-A
 * implementation of the four P1-14 command handlers behind the frozen guard
 * chain recorded in the integrator rulings:
 *
 *   1. materializeCandidateBaseline: shape -> invalid; ledger.load(proposalRef)
 *      -> proposal_not_found; resolveProjectArchitectureBaseline(current active)
 *      != proposal.sourceBaselinePin -> source_stale; candidateContentDigest !=
 *      proposal.expectedCandidateDigest -> digest_mismatch; then deterministically
 *      materialize the candidate (content-addressed digest, parentSourcePin =
 *      proposal.sourceBaselinePin, candidateId = command.aggregateId — the
 *      aggregate identity IS the candidate id) and commit via
 *      buildP114CandidateFold; all pre-commit guard failures are ZERO write.
 *   2. recordArchitectureChangeDecision: shape -> invalid; ledger.load(subject
 *      .candidateRef) -> candidate_not_found; subject.candidateRef == loaded
 *      candidate ref AND authorizedTarget.candidateDigest == candidate.contentDigest
 *      AND authorizedTarget.fromPin == candidate.parentSourcePin (canonicalJson)
 *      — any inequality -> target_mismatch (zero write); commit
 *      buildP114DecisionFold.
 *   3. recordMigrationGate: shape -> invalid; ledger.load(candidateRef) ->
 *      candidate_not_found; ledger.load(Workspace ref) missing -> invalid (no
 *      workspace_not_found code); gate.workspaceRevision != workspace.revision ->
 *      workspace_revision_mismatch (zero write); commit buildP114GateFold.
 *   4. recordBaselineActivation: shape -> invalid; ledger.load(decisionRef) ->
 *      decision_not_found; ledger.load(gateRef) -> gate_not_found; decision
 *      .outcome != accept -> decision_not_accepted; authorizedTarget digest/from
 *      != activation to/from -> target_mismatch; gate.status != pass ->
 *      gate_not_pass; chain check (proposal source == activation.fromPin AND
 *      resolveProjectArchitectureBaseline current active == activation.fromPin)
 *      -> source_stale (zero write); commit buildP114ActivationFold.
 *
 * Receipt mapping: invalid_commit -> invalid; revision_conflict /
 * idempotency_conflict / unavailable pass through; committed fields per contract.
 *
 * NOTE (integrator ruling nuance): the "aggregateId 即 candidateId" ruling is
 * realised by assigning candidate.candidateId = command.aggregateId (the frozen
 * fold builder registers the aggregate under p114CandidateRef(projectId) whose
 * local candidateId IS the command aggregateId). The content-addressed
 * candidateIdFromDigest(digest) remains the on-record content address, but the
 * aggregate storage identity is the command's aggregateId as required by the
 * ruling — reported back as a gap for the P1-14 acceptance oracle.
 */
import type {
  ArchitectureChangeDecisionV1,
  CandidateArchitectureBaselineRef,
  CandidateArchitectureBaselineV1,
  MaterializeCandidateBaselineCommand,
  MaterializeCandidateBaselineReceipt,
  MigrationGateTaskV1,
  RecordArchitectureChangeDecisionCommand,
  RecordArchitectureChangeDecisionReceipt,
  RecordBaselineActivationCommand,
  RecordBaselineActivationReceipt,
  RecordMigrationGateCommand,
  RecordMigrationGateReceipt,
} from "../contracts/baseline-evolution.js";
import {
  architectureChangeDecisionRefFor,
  baselineActivationRefFor,
  candidateContentDigest,
  candidateRefFor,
  migrationGateRefFor,
} from "../contracts/baseline-evolution.js";
import type {
  ArchitectureCandidateProposalSnapshot,
  ArchitectureCandidateProposalRef,
} from "../contracts/architecture-inspection.js";
import {
  resolveProjectArchitectureBaseline,
  type ArchitectureBaselinePin,
} from "../contracts/governance.js";
import type { LedgerCommitReceipt, WorkspaceRef } from "../contracts/ledger.js";
import { canonicalJson, type JsonValue } from "../contracts/fingerprint.js";
import {
  buildP114ActivationFold,
  buildP114CandidateFold,
  buildP114DecisionFold,
  buildP114GateFold,
} from "../contracts/fixtures/baseline-evolution-fixtures.js";
import type { ControlEngineDeps } from "./control-engine.js";

/** LANE-A implementation of the four frozen P1-14 command handlers. */
export class BaselineEvolutionEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}

  materializeCandidate(command: MaterializeCandidateBaselineCommand): Promise<MaterializeCandidateBaselineReceipt> {
    return materializeCandidateImpl(this.deps, command);
  }

  recordDecision(command: RecordArchitectureChangeDecisionCommand): Promise<RecordArchitectureChangeDecisionReceipt> {
    return recordDecisionImpl(this.deps, command);
  }

  recordGate(command: RecordMigrationGateCommand): Promise<RecordMigrationGateReceipt> {
    return recordGateImpl(this.deps, command);
  }

  recordActivation(command: RecordBaselineActivationCommand): Promise<RecordBaselineActivationReceipt> {
    return recordActivationImpl(this.deps, command);
  }
}

// ------------------------------------------------------------------------ //
// Handlers                                                                   //
// ------------------------------------------------------------------------ //

async function materializeCandidateImpl(
  deps: ControlEngineDeps,
  command: MaterializeCandidateBaselineCommand,
): Promise<MaterializeCandidateBaselineReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateMaterializeShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const proposalRef: ArchitectureCandidateProposalRef = {
    aggregateType: "ArchitectureCandidateProposal",
    projectId: command.identity.projectId,
    workspaceId: command.payload.proposalRef.workspaceId,
    proposalId: command.payload.proposalRef.proposalId,
  };

  // Guard 2: proposal must exist (zero write).
  const proposalResult = await deps.ledger.load(proposalRef);
  if (proposalResult.status !== "found" || proposalResult.snapshot.ref.aggregateType !== "ArchitectureCandidateProposal") {
    return { status: "rejected", commandId: command.commandId, code: "proposal_not_found" };
  }
  const proposal = (proposalResult.snapshot as ArchitectureCandidateProposalSnapshot).proposal;

  // Guard 3: current Project active baseline must equal the proposal source
  // (exact ref chain — a move at any stage makes the chain STALE; zero write).
  const active = await resolveProjectArchitectureBaseline(deps.ledger, command.identity.projectId);
  if (active.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "source_stale", issues: ["project has no active architecture baseline"] };
  }
  if (canonicalJsonEqual(active.pin, proposal.sourceBaselinePin) === false) {
    return { status: "rejected", commandId: command.commandId, code: "source_stale" };
  }

  // Guard 4: content digest must match the proposal's expected candidate digest.
  const digest = candidateContentDigest(proposal.normalizedContent);
  if (digest !== proposal.expectedCandidateDigest) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  // Deterministic materialization (aggregate identity == command.aggregateId,
  // per the ruling; the on-record content address is the digest).
  const materializedAt = deps.now();
  const candidate: CandidateArchitectureBaselineV1 = {
    schemaVersion: 1,
    candidateId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId: command.payload.proposalRef.workspaceId,
    proposalRef: { ...proposalRef },
    parentSourcePin: { ...proposal.sourceBaselinePin },
    normalizedContent: proposal.normalizedContent,
    contentDigest: digest,
    materializedAt,
  };

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildP114CandidateFold(command, { eventId, occurredAt, candidate });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      candidateRef: candidateRefFor(candidate.projectId, candidate.workspaceId, candidate.candidateId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapMaterializeRejected(receipt, command.commandId);
}

async function recordDecisionImpl(
  deps: ControlEngineDeps,
  command: RecordArchitectureChangeDecisionCommand,
): Promise<RecordArchitectureChangeDecisionReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateDecisionShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const decision = command.payload.decision;

  // Guard 2: the candidate the decision binds must exist (zero write).
  const candidateResult = await deps.ledger.load(decision.subject.candidateRef);
  if (candidateResult.status !== "found" || candidateResult.snapshot.ref.aggregateType !== "CandidateArchitectureBaseline") {
    return { status: "rejected", commandId: command.commandId, code: "candidate_not_found" };
  }
  const candidate = (candidateResult.snapshot as { candidate: CandidateArchitectureBaselineV1 }).candidate;

  // Guard 3: exact target matching — subject ref == loaded candidate ref AND
  // authorizedTarget digest == candidate digest AND fromPin == parentSourcePin.
  const loadedRef = candidateResult.snapshot.ref as CandidateArchitectureBaselineRef;
  const refMatch = canonicalJsonEqual(decision.subject.candidateRef, loadedRef);
  const digestMatch = decision.authorizedTarget.candidateDigest === candidate.contentDigest;
  const fromMatch = canonicalJsonEqual(decision.authorizedTarget.fromPin, candidate.parentSourcePin);
  if (!refMatch || !digestMatch || !fromMatch) {
    return { status: "rejected", commandId: command.commandId, code: "target_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildP114DecisionFold(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      decisionRef: architectureChangeDecisionRefFor(decision.projectId, decision.workspaceId, decision.decisionId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapDecisionRejected(receipt, command.commandId);
}

async function recordGateImpl(
  deps: ControlEngineDeps,
  command: RecordMigrationGateCommand,
): Promise<RecordMigrationGateReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateGateShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const gate = command.payload.gate;

  // Guard 2: the candidate the gate binds must exist (zero write).
  const candidateResult = await deps.ledger.load(gate.candidateRef);
  if (candidateResult.status !== "found" || candidateResult.snapshot.ref.aggregateType !== "CandidateArchitectureBaseline") {
    return { status: "rejected", commandId: command.commandId, code: "candidate_not_found" };
  }

  // Guard 3: the workspace must exist (missing -> invalid; there is no
  // workspace_not_found receipt code). Zero write.
  const workspaceRef: WorkspaceRef = { aggregateType: "Workspace", projectId: gate.projectId, workspaceId: gate.workspaceId };
  const workspaceResult = await deps.ledger.load(workspaceRef);
  if (workspaceResult.status !== "found" || workspaceResult.snapshot.ref.aggregateType !== "Workspace") {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["workspace not found"] };
  }
  const workspaceRevision = workspaceResult.snapshot.revision;

  // Guard 4: the gate binds the CURRENT workspace revision (a revision
  // mismatch means the gate evidence is stale — zero write).
  if (gate.workspaceRevision !== workspaceRevision) {
    return { status: "rejected", commandId: command.commandId, code: "workspace_revision_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildP114GateFold(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      gateRef: migrationGateRefFor(gate.projectId, gate.workspaceId, gate.gateId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapGateRejected(receipt, command.commandId);
}

async function recordActivationImpl(
  deps: ControlEngineDeps,
  command: RecordBaselineActivationCommand,
): Promise<RecordBaselineActivationReceipt> {
  // Guard 1: shape (zero write).
  const shapeIssues = validateActivationShape(command);
  if (shapeIssues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid", issues: shapeIssues };
  }

  const activation = command.payload.activation;

  // Guard 2 / 3: decision + gate must exist (zero write).
  const decisionResult = await deps.ledger.load(activation.decisionRef);
  if (decisionResult.status !== "found" || decisionResult.snapshot.ref.aggregateType !== "ArchitectureChangeDecision") {
    return { status: "rejected", commandId: command.commandId, code: "decision_not_found" };
  }
  const decision = (decisionResult.snapshot as { decision: ArchitectureChangeDecisionV1 }).decision;

  const gateResult = await deps.ledger.load(activation.gateRef);
  if (gateResult.status !== "found" || gateResult.snapshot.ref.aggregateType !== "MigrationGateTask") {
    return { status: "rejected", commandId: command.commandId, code: "gate_not_found" };
  }
  const gate = (gateResult.snapshot as { gate: MigrationGateTaskV1 }).gate;

  // Guard 4: only an ACCEPTED decision authorises an activation (zero write).
  if (decision.outcome !== "accept") {
    return { status: "rejected", commandId: command.commandId, code: "decision_not_accepted" };
  }

  // Guard 5: exact target matching against the authorised candidate (zero write).
  const toDigestMatch = decision.authorizedTarget.candidateDigest === activation.toPin.digest;
  const fromMatch = canonicalJsonEqual(decision.authorizedTarget.fromPin, activation.fromPin);
  if (!toDigestMatch || !fromMatch) {
    return { status: "rejected", commandId: command.commandId, code: "target_mismatch" };
  }

  // Guard 6: the migration gate must have PASSED on the exact candidate (zero write).
  if (gate.status !== "pass") {
    return { status: "rejected", commandId: command.commandId, code: "gate_not_pass" };
  }

  // Guard 7: full chain consistency — proposal source == activation.fromPin
  // AND Project active baseline == activation.fromPin (zero write). A move at
  // any stage makes the whole chain STALE.
  const proposalResult = await deps.ledger.load(activation.proposalRef);
  const proposalFound = proposalResult.status === "found" && proposalResult.snapshot.ref.aggregateType === "ArchitectureCandidateProposal";
  if (!proposalFound) {
    return { status: "rejected", commandId: command.commandId, code: "source_stale" };
  }
  const proposal = (proposalResult.snapshot as ArchitectureCandidateProposalSnapshot).proposal;
  const proposalSourceMatch = canonicalJsonEqual(proposal.sourceBaselinePin, activation.fromPin);
  const active = await resolveProjectArchitectureBaseline(deps.ledger, command.identity.projectId);
  const activeMatch = active.status === "found" && canonicalJsonEqual(active.pin, activation.fromPin);
  if (!proposalSourceMatch || !activeMatch) {
    return { status: "rejected", commandId: command.commandId, code: "source_stale" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildP114ActivationFold(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      activationRef: baselineActivationRefFor(activation.projectId, activation.workspaceId, activation.activationId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapActivationRejected(receipt, command.commandId);
}

// ------------------------------------------------------------------------ //
// Receipt mapping                                                            //
// ------------------------------------------------------------------------ //

type LedgerRejected = Extract<LedgerCommitReceipt, { status: "rejected" }>;

function mapCommittedRejection(
  receipt: LedgerRejected,
  commandId: string,
): { status: "rejected"; commandId: string; code: "invalid" | "revision_conflict" | "idempotency_conflict" | "unavailable" } {
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId, code: "unavailable" };
    case "not_empty":
      // Not reachable for these commits (all carry a non-empty expectedVersions);
      // treat as a malformed commit rather than inventing a code.
      return { status: "rejected", commandId, code: "invalid" };
  }
}

function mapMaterializeRejected(receipt: LedgerRejected, commandId: string): MaterializeCandidateBaselineReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapDecisionRejected(receipt: LedgerRejected, commandId: string): RecordArchitectureChangeDecisionReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapGateRejected(receipt: LedgerRejected, commandId: string): RecordMigrationGateReceipt {
  return mapCommittedRejection(receipt, commandId);
}
function mapActivationRejected(receipt: LedgerRejected, commandId: string): RecordBaselineActivationReceipt {
  return mapCommittedRejection(receipt, commandId);
}

// ------------------------------------------------------------------------ //
// Shape validators (P1-14 commands have no contract validators yet; these are
// the lane-A inline guards — all zero write on failure)                    //
// ------------------------------------------------------------------------ //

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNumber(v: unknown): v is number {
  return typeof v === "number";
}
function isBasePin(v: unknown): v is ArchitectureBaselinePin {
  if (!isRecord(v)) return false;
  const ref = v["ref"];
  if (!isRecord(ref)) return false;
  return (
    ref["aggregateType"] === "ArchitectureBaselineRevision" &&
    isString(ref["projectId"]) &&
    isString(ref["baselineId"]) &&
    isNumber(ref["revision"]) &&
    isString(v["digest"])
  );
}
function isCandidateRef(v: unknown): v is CandidateArchitectureBaselineRef {
  if (!isRecord(v)) return false;
  return (
    v["aggregateType"] === "CandidateArchitectureBaseline" &&
    isString(v["projectId"]) &&
    isString(v["workspaceId"]) &&
    isString(v["candidateId"])
  );
}

function validateMaterializeShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "MaterializeCandidateBaseline") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  if (!isString(command["aggregateId"])) issues.push("aggregateId");
  if (command["expectedRevision"] !== 0) issues.push("expectedRevision");
  if (!isRecord(command["identity"])) {
    issues.push("identity");
  } else if (!isString(command["identity"]["projectId"]) || !isRecord(command["identity"]["actor"]) || !isString(command["identity"]["idempotencyKey"])) {
    issues.push("identity");
  }
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const ref = payload["proposalRef"];
  if (!isRecord(ref)) {
    issues.push("payload.proposalRef");
  } else if (
    ref["aggregateType"] !== "ArchitectureCandidateProposal" ||
    !isString(ref["projectId"]) ||
    !isString(ref["workspaceId"]) ||
    !isString(ref["proposalId"])
  ) {
    issues.push("payload.proposalRef");
  }
  return issues;
}

function validateDecisionShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "RecordArchitectureChangeDecision") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const d = payload["decision"];
  if (!isRecord(d)) {
    issues.push("payload.decision");
    return issues;
  }
  if (d["schemaVersion"] !== 1) issues.push("decision.schemaVersion");
  if (!isString(d["decisionId"]) || !isString(d["projectId"]) || !isString(d["workspaceId"])) issues.push("decision.identity");
  if (!isRecord(d["subject"]) || !isBasePin(d["subject"]["fromPin"]) || !isCandidateRef(d["subject"]["candidateRef"])) issues.push("decision.subject");
  if (!isString(d["outcome"]) || !["accept", "reject", "defer"].includes(d["outcome"])) issues.push("decision.outcome");
  if (!isRecord(d["actor"]) || !isString(d["actor"]["kind"]) || !isString(d["actor"]["id"])) issues.push("decision.actor");
  if (!isRecord(d["authority"])) {
    issues.push("decision.authority");
  } else if (d["authority"]["strategy"] !== "user" && d["authority"]["strategy"] !== "delegated") {
    issues.push("decision.authority.strategy");
  } else if (d["authority"]["strategy"] === "user" && d["authority"]["delegator"] !== null) {
    issues.push("decision.authority.delegator");
  } else if (d["authority"]["strategy"] === "delegated" && !isString(d["authority"]["delegator"])) {
    issues.push("decision.authority.delegator");
  } else if (!isString(d["authority"]["policyVersion"]) || d["authority"]["policyVersion"].length === 0) {
    issues.push("decision.authority.policyVersion");
  }
  if (!isRecord(d["authorizedTarget"]) || !isBasePin(d["authorizedTarget"]["fromPin"]) || !isString(d["authorizedTarget"]["candidateDigest"])) {
    issues.push("decision.authorizedTarget");
  }
  if (!isString(d["summary"])) issues.push("decision.summary");
  if (!isString(d["decidedAt"])) issues.push("decision.decidedAt");
  return issues;
}

function validateGateShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "RecordMigrationGate") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const g = payload["gate"];
  if (!isRecord(g)) {
    issues.push("payload.gate");
    return issues;
  }
  if (g["schemaVersion"] !== 1) issues.push("gate.schemaVersion");
  if (!isString(g["gateId"]) || !isString(g["projectId"]) || !isString(g["workspaceId"])) issues.push("gate.identity");
  if (!isString(g["planRef"]) || g["planRef"].length === 0) issues.push("gate.planRef");
  if (!isCandidateRef(g["candidateRef"])) issues.push("gate.candidateRef");
  if (!isNumber(g["workspaceRevision"])) issues.push("gate.workspaceRevision");
  if (!isString(g["status"]) || !["pass", "fail", "pending", "stale"].includes(g["status"])) issues.push("gate.status");
  if (!Array.isArray(g["gateEvidenceRefs"])) issues.push("gate.gateEvidenceRefs");
  if (!isString(g["createdAt"]) || !isString(g["updatedAt"])) issues.push("gate.timestamps");
  return issues;
}

function validateActivationShape(command: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(command)) return ["command not an object"];
  if (command["commandType"] !== "RecordBaselineActivation") issues.push("commandType");
  if (command["schemaVersion"] !== 1) issues.push("schemaVersion");
  if (!isString(command["commandId"])) issues.push("commandId");
  const payload = command["payload"];
  if (!isRecord(payload)) {
    issues.push("payload");
    return issues;
  }
  const a = payload["activation"];
  if (!isRecord(a)) {
    issues.push("payload.activation");
    return issues;
  }
  if (a["schemaVersion"] !== 1) issues.push("activation.schemaVersion");
  if (!isString(a["activationId"]) || !isString(a["projectId"]) || !isString(a["workspaceId"])) issues.push("activation.identity");
  if (!isBasePin(a["fromPin"])) issues.push("activation.fromPin");
  if (!isBasePin(a["toPin"])) issues.push("activation.toPin");
  if (!isRecord(a["proposalRef"])) issues.push("activation.proposalRef");
  if (!isRecord(a["decisionRef"])) issues.push("activation.decisionRef");
  if (!isRecord(a["gateRef"])) issues.push("activation.gateRef");
  if (!isString(a["activatedAt"])) issues.push("activation.activatedAt");
  return issues;
}

// ------------------------------------------------------------------------ //
// Canonical JSON comparison                                                  //
// ------------------------------------------------------------------------ //

/** Canonical JSON equality (JCS) used for all exact pin/ref chain comparisons. */
function canonicalJsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue);
}
