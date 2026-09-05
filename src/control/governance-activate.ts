/**
 * P1-02 Control entry: governance activation (typed Project active refs).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN). Lane A fills the
 * implementation; semantics recorded in IMPLEMENTATION-HANDOFF.md
 * "P1-02 契约与存储语义" and the ticket Acceptance:
 *   schema -> resolve installed target (identity/revision/digest triple) ->
 *   "not_found"/"digest_mismatch" zero-write -> load per-kind active aggregate
 *   -> fold activation commit with CAS: Project@expected (command
 *   expectedRevision) + active aggregate @(current or 0) -> map receipt.
 *   - activation only accepts an INSTALLED exact target ref; dangling /
 *     digest mismatch / concurrent movement (revision_conflict) never moves
 *     the active ref;
 *   - CompletionPolicy and ArchitectureBaseline actives are independent.
 *
 * Guard style mirrors control-engine.ts: the engine performs pre-CAS guards
 * that need a distinct rejection code (validation -> invalid, dangling target ->
 * not_found, identity/digest mismatch -> digest_mismatch); the Project CAS and
 * the per-kind aggregate CAS plus idempotency are decided by StateLedger.commit
 * and mapped back here.
 */
import type {
  ArchitectureBaselineActivatedEvent,
  ArchitectureBaselineRevisionRef,
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyActivatedEvent,
  CompletionPolicyRevisionRef,
  CompletionPolicyRevisionSnapshot,
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  ActivateProjectArchitectureBaselineCommand,
  ActivateProjectCompletionPolicyCommand,
  ProjectArchitectureBaselineActiveRef,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveRef,
  ProjectCompletionPolicyActiveSnapshot,
} from "../contracts/governance.js";
import { governanceActivateFingerprint } from "../contracts/governance.js";
import type { GovernanceActivateLedgerCommitV1, LedgerCommitReceipt, ProjectRef, SnapshotResult } from "../contracts/ledger.js";
import {
  validateActivateProjectArchitectureBaselineCommand,
  validateActivateProjectCompletionPolicyCommand,
} from "../contracts/validation.js";
import type { ControlEngineDeps } from "./control-engine.js";

export function activateGovernance(
  deps: ControlEngineDeps,
  command: GovernanceActivateCommand,
): Promise<GovernanceActivateReceipt> {
  if (command.commandType === "ActivateProjectCompletionPolicy") {
    return activateCompletionPolicy(deps, command);
  }
  return activateArchitectureBaseline(deps, command);
}

// ------------------------------------------------------------------------ //
// CompletionPolicy activation                                                //
// ------------------------------------------------------------------------ //

async function activateCompletionPolicy(
  deps: ControlEngineDeps,
  command: ActivateProjectCompletionPolicyCommand,
): Promise<GovernanceActivateReceipt> {
  const issues = validateActivateProjectCompletionPolicyCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  // 2) exact target resolution (pre-CAS, zero-write). Only an INSTALLED revision
  //    whose identity/revision/digest triple matches is admissible.
  const target = command.payload.target;
  const loaded = await deps.ledger.load(target.ref);
  if (loaded.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  if (!isCompletionPolicySnapshot(loaded) || !targetMatchesPolicySnapshot(loaded.snapshot, target)) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  // 3) per-kind active aggregate revision (absent -> 0; present -> snapshot.revision).
  const activeRef: ProjectCompletionPolicyActiveRef = {
    aggregateType: "ProjectCompletionPolicyActive",
    projectId: command.identity.projectId,
  };
  const active = await deps.ledger.load(activeRef);
  const activeExpected = active.status === "found" ? active.snapshot.revision : 0;
  const newActiveRevision = activeExpected + 1;

  // 4) deterministic fold (exactly the shared fixture-fold builder).
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const event: CompletionPolicyActivatedEvent = {
    eventId,
    eventType: "CompletionPolicyActivated",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    aggregateType: "ProjectCompletionPolicyActive",
    aggregateId: command.identity.projectId,
    aggregateRevision: newActiveRevision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: { target },
  };
  const snapshot: ProjectCompletionPolicyActiveSnapshot = {
    ref: activeRef,
    projectId: command.identity.projectId,
    activeRevision: target.ref,
    revision: newActiveRevision,
  };
  const projectRef: ProjectRef = {
    aggregateType: "Project",
    projectId: command.identity.projectId,
  };
  const batch: GovernanceActivateLedgerCommitV1 = {
    commitKind: "governance-activate",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: governanceActivateFingerprint(command),
    expectedVersions: [
      { ref: projectRef, revision: command.expectedRevision },
      { ref: activeRef, revision: activeExpected },
    ],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };

  // 5) atomic commit (Project CAS + active-aggregate CAS; idempotency by ledger).
  const receipt = await deps.ledger.commit(batch);
  return mapActivateReceipt(receipt, command, snapshot.activeRevision, activeRef);
}

// ------------------------------------------------------------------------ //
// ArchitectureBaseline activation                                            //
// ------------------------------------------------------------------------ //

async function activateArchitectureBaseline(
  deps: ControlEngineDeps,
  command: ActivateProjectArchitectureBaselineCommand,
): Promise<GovernanceActivateReceipt> {
  const issues = validateActivateProjectArchitectureBaselineCommand(command);
  if (issues.length > 0) {
    return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }

  const target = command.payload.target;
  const loaded = await deps.ledger.load(target.ref);
  if (loaded.status === "not_found") {
    return { status: "rejected", commandId: command.commandId, code: "not_found" };
  }
  if (!isArchitectureBaselineSnapshot(loaded) || !targetMatchesBaselineSnapshot(loaded.snapshot, target)) {
    return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
  }

  const activeRef: ProjectArchitectureBaselineActiveRef = {
    aggregateType: "ProjectArchitectureBaselineActive",
    projectId: command.identity.projectId,
  };
  const active = await deps.ledger.load(activeRef);
  const activeExpected = active.status === "found" ? active.snapshot.revision : 0;
  const newActiveRevision = activeExpected + 1;

  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const event: ArchitectureBaselineActivatedEvent = {
    eventId,
    eventType: "ArchitectureBaselineActivated",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    aggregateType: "ProjectArchitectureBaselineActive",
    aggregateId: command.identity.projectId,
    aggregateRevision: newActiveRevision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: { target },
  };
  const snapshot: ProjectArchitectureBaselineActiveSnapshot = {
    ref: activeRef,
    projectId: command.identity.projectId,
    activeRevision: target.ref,
    revision: newActiveRevision,
  };
  const projectRef: ProjectRef = {
    aggregateType: "Project",
    projectId: command.identity.projectId,
  };
  const batch: GovernanceActivateLedgerCommitV1 = {
    commitKind: "governance-activate",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: governanceActivateFingerprint(command),
    expectedVersions: [
      { ref: projectRef, revision: command.expectedRevision },
      { ref: activeRef, revision: activeExpected },
    ],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };

  const receipt = await deps.ledger.commit(batch);
  return mapActivateReceipt(receipt, command, snapshot.activeRevision, activeRef);
}

// ------------------------------------------------------------------------ //
// Mapping: ledger receipt -> governance activate receipt                       //
// ------------------------------------------------------------------------ //

function mapActivateReceipt(
  receipt: LedgerCommitReceipt,
  command: GovernanceActivateCommand,
  activeRevision: CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef,
  activeRef: ProjectCompletionPolicyActiveRef | ProjectArchitectureBaselineActiveRef,
): GovernanceActivateReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      activeRef,
      activeRevision,
      eventIds: receipt.eventIds,
      commitCursor: receipt.commitCursor,
    };
  }
  switch (receipt.code) {
    case "invalid_commit":
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    case "revision_conflict":
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
    case "idempotency_conflict":
      return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
    case "unavailable":
      return { status: "rejected", commandId: command.commandId, code: "unavailable" };
    case "not_empty":
      // Not reachable for a governance-activate commit (expectedVersions
      // non-empty); treat as a malformed commit rather than inventing a code.
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}


function isCompletionPolicySnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: CompletionPolicyRevisionSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "CompletionPolicyRevision";
}

function isArchitectureBaselineSnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ArchitectureBaselineRevisionSnapshot } {
  return (
    result.status === "found" && result.snapshot.ref.aggregateType === "ArchitectureBaselineRevision"
  );
}

function targetMatchesPolicySnapshot(
  snapshot: CompletionPolicyRevisionSnapshot,
  target: { ref: { projectId: string; policyId: string; revision: number }; digest: string },
): boolean {
  return (
    snapshot.ref.projectId === target.ref.projectId &&
    snapshot.policyId === target.ref.policyId &&
    snapshot.contentRevision === target.ref.revision &&
    snapshot.contentDigest === target.digest
  );
}

function targetMatchesBaselineSnapshot(
  snapshot: ArchitectureBaselineRevisionSnapshot,
  target: { ref: { projectId: string; baselineId: string; revision: number }; digest: string },
): boolean {
  return (
    snapshot.ref.projectId === target.ref.projectId &&
    snapshot.baselineId === target.ref.baselineId &&
    snapshot.contentRevision === target.ref.revision &&
    snapshot.contentDigest === target.digest
  );
}