/**
 * P1-12 Control entry: ArchitectureInspectionEngineImpl — durable recording
 * of inspections / findings / decision briefs / candidate proposals
 * (ControlEngine versioned additions, immutability CAS@0 each).
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane B fills the
 * implementations). Frozen semantics (IMPLEMENTATION-HANDOFF "P1-12 契约与
 * 存储语义" items 1-7): shape validation -> invalid; pinned baseline resolved
 * from the intent/plan (ledger.load) -> not_found; pin digest mismatch ->
 * baseline_mismatch (zero write); PROPOSAL digest recompute mismatch ->
 * digest_mismatch (zero write); ONE atomic commit per command with FULL
 * ledger idempotency. NO remediation/gate/activation side effects.
 */
import type {
  RecordArchitectureDecisionBriefCommand,
  RecordArchitectureDecisionBriefReceipt,
  RecordArchitectureFindingCommand,
  RecordArchitectureFindingReceipt,
  RecordArchitectureInspectionCommand,
  RecordArchitectureInspectionReceipt,
  RecordCandidateBaselineProposalCommand,
  RecordCandidateBaselineProposalReceipt,
} from "../../contracts/architecture-inspection.js";
import {
  architectureCandidateProposalRefFor,
  architectureDecisionBriefRefFor,
  architectureFindingRefFor,
  architectureInspectionRefFor,
  candidateProposalDigest,
} from "../../contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin, ArchitectureBaselineRevisionSnapshot } from "../../contracts/governance.js";
import type { LedgerCommitReceipt } from "../../contracts/ledger.js";
import { validateRecordArchitectureDecisionBriefCommand, validateRecordArchitectureFindingCommand, validateRecordArchitectureInspectionCommand, validateRecordCandidateBaselineProposalCommand } from '../../contracts/validation/architecture.js';
import { buildArchitectureBriefRecordLedgerCommit, buildArchitectureFindingRecordLedgerCommit, buildArchitectureInspectionRecordLedgerCommit, buildArchitectureProposalRecordLedgerCommit } from "./records/architecture.js";
import type { ControlEngineDeps } from "./control-engine.js";

export class ArchitectureInspectionEngineImpl {
  private readonly deps: ControlEngineDeps;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
  }

  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt> {
    return recordArchitectureInspectionImpl(this.deps, command);
  }

  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt> {
    return recordArchitectureFindingImpl(this.deps, command);
  }

  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt> {
    return recordArchitectureDecisionBriefImpl(this.deps, command);
  }

  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt> {
    return recordCandidateBaselineProposalImpl(this.deps, command);
  }
}

async function recordArchitectureInspectionImpl(
  deps: ControlEngineDeps,
  command: RecordArchitectureInspectionCommand,
): Promise<RecordArchitectureInspectionReceipt> {
  // Guard 1: schema / shape validation (zero write).
  const issues = validateRecordArchitectureInspectionCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const inspection = command.payload.inspection;
  const baselinePin = inspection.intent.baselinePin;

  // Guard 2: the pinned baseline must exist (ledger.load is the ONLY fact
  // surface for intent/workspace existence — missing -> not_found, zero write).
  const baseline = await resolveBaseline(deps, baselinePin);
  if (baseline.status !== "found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  // Guard 3: the loaded baseline content digest must match the pin digest
  // (digest/revision mismatch is fail-closed — zero write, never a pseudo delta).
  if (baseline.snapshot.contentDigest !== baselinePin.digest) {
    return { status: "rejected", commandId: command.commandId, code: "baseline_mismatch" };
  }

  // Guard 4: deterministic fold -> ONE atomic commit (CAS@0 + full idempotency).
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildArchitectureInspectionRecordLedgerCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  return mapInspectionReceipt(receipt, command);
}

async function recordArchitectureFindingImpl(
  deps: ControlEngineDeps,
  command: RecordArchitectureFindingCommand,
): Promise<RecordArchitectureFindingReceipt> {
  const issues = validateRecordArchitectureFindingCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const finding = command.payload.finding;
  const baselinePin = finding.baselinePin;

  const baseline = await resolveBaseline(deps, baselinePin);
  if (baseline.status !== "found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  if (baseline.snapshot.contentDigest !== baselinePin.digest) {
    return { status: "rejected", commandId: command.commandId, code: "baseline_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildArchitectureFindingRecordLedgerCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  return mapFindingReceipt(receipt, command);
}

async function recordArchitectureDecisionBriefImpl(
  deps: ControlEngineDeps,
  command: RecordArchitectureDecisionBriefCommand,
): Promise<RecordArchitectureDecisionBriefReceipt> {
  const issues = validateRecordArchitectureDecisionBriefCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const brief = command.payload.brief;
  const baselinePin = brief.baselinePin;

  const baseline = await resolveBaseline(deps, baselinePin);
  if (baseline.status !== "found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  if (baseline.snapshot.contentDigest !== baselinePin.digest) {
    return { status: "rejected", commandId: command.commandId, code: "baseline_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildArchitectureBriefRecordLedgerCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  return mapBriefReceipt(receipt, command);
}

async function recordCandidateBaselineProposalImpl(
  deps: ControlEngineDeps,
  command: RecordCandidateBaselineProposalCommand,
): Promise<RecordCandidateBaselineProposalReceipt> {
  const issues = validateRecordCandidateBaselineProposalCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const proposal = command.payload.proposal;
  const baselinePin = proposal.sourceBaselinePin;

  const baseline = await resolveBaseline(deps, baselinePin);
  if (baseline.status !== "found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  if (baseline.snapshot.contentDigest !== baselinePin.digest) {
    return { status: "rejected", commandId: command.commandId, code: "baseline_mismatch" };
  }

  // Guard: the proposal digest is deterministic — a stored digest that differs
  // from the recompute is a content tamper (zero write; never materialize).
  if (candidateProposalDigest(proposal) !== proposal.proposalDigest) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const batch = buildArchitectureProposalRecordLedgerCommit(command, { eventId, occurredAt });
  const receipt = await deps.ledger.commit(batch);
  return mapProposalReceipt(receipt, command);
}

/** Load the pinned baseline revision (the ONLY admissible baseline input).
 *  Returns not_found on a missing ref (never a pseudo baseline). */
async function resolveBaseline(
  deps: ControlEngineDeps,
  pin: ArchitectureBaselinePin,
): Promise<{ status: "found"; snapshot: ArchitectureBaselineRevisionSnapshot } | { status: "not_found" }> {
  const result = await deps.ledger.load(pin.ref);
  if (result.status === "not_found" || result.snapshot.ref.aggregateType !== "ArchitectureBaselineRevision") {
    return { status: "not_found" };
  }
  return { status: "found", snapshot: result.snapshot as ArchitectureBaselineRevisionSnapshot };
}

// ------------------------------------------------------------------------ //
// Receipt mapping (isomorphic with handoff.ts mapReceipt)                  //
// ------------------------------------------------------------------------ //

function mapInspectionReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordArchitectureInspectionCommand,
): RecordArchitectureInspectionReceipt {
  if (receipt.status === "committed") {
    const inspection = command.payload.inspection;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      inspectionRef: architectureInspectionRefFor(inspection.intent.projectId, inspection.intent.workspaceId, inspection.intent.inspectionId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapRejected(receipt, command.commandId);
}

function mapFindingReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordArchitectureFindingCommand,
): RecordArchitectureFindingReceipt {
  if (receipt.status === "committed") {
    const finding = command.payload.finding;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      findingRef: architectureFindingRefFor(finding.projectId, finding.workspaceId, finding.findingId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapRejected(receipt, command.commandId);
}

function mapBriefReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordArchitectureDecisionBriefCommand,
): RecordArchitectureDecisionBriefReceipt {
  if (receipt.status === "committed") {
    const brief = command.payload.brief;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      briefRef: architectureDecisionBriefRefFor(brief.projectId, brief.workspaceId, brief.briefId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapRejected(receipt, command.commandId);
}

function mapProposalReceipt(
  receipt: LedgerCommitReceipt,
  command: RecordCandidateBaselineProposalCommand,
): RecordCandidateBaselineProposalReceipt {
  if (receipt.status === "committed") {
    const proposal = command.payload.proposal;
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      proposalRef: architectureCandidateProposalRefFor(proposal.projectId, proposal.workspaceId, proposal.proposalId),
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  return mapRejected(receipt, command.commandId);
}

type LedgerRejectionCode =
  | "invalid"
  | "revision_conflict"
  | "idempotency_conflict"
  | "unavailable";

function mapRejected(
  receipt: Extract<LedgerCommitReceipt, { status: "rejected" }>,
  commandId: string,
): { status: "rejected"; commandId: string; code: LedgerRejectionCode } {
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId, code: "invalid" };
    case "idempotency_conflict":
      return { status: "rejected", commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId, code: "unavailable" };
    case "not_empty":
      // Not reachable for these commits (non-empty expected versions) — treat as
      // a malformed command rather than inventing a rejection code.
      return { status: "rejected", commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId, code: "revision_conflict" };
  }
}