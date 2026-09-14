/**
 * Control entry: ArchitectureEvolutionPolicy install/activate (third governance
 * kind).
 *
 * Admission semantics follow governance-install.ts / governance-activate.ts:
 *
 *   install (schema -> digest -> fold the exact install commit -> ledger.commit -> map):
 *     - schema / structural issues (shared validateInstallArchitectureEvolutionPolicyRevisionCommand)
 *       -> "invalid" (ZERO write); digest mismatch -> "digest_mismatch";
 *     - install NEVER auto-activates; no built-in allowlist; a missing / invalid
 *       fixture is rejected as "invalid", never defaulted;
 *     - immutability (idempotent replay, CAS at revision 0) is decided by
 *       StateLedger.commit and mapped back here.
 *
 *   activate (schema -> exact installed-target resolution -> per-kind active CAS):
 *     - only an INSTALLED exact target ref (identity/revision/digest triple) is
 *       admissible: ledger.load(target.ref) not_found -> "not_found"; the ref is
 *       found but the stored contentDigest != target.digest -> "digest_mismatch"
 *       (both ZERO write);
 *     - CAS: Project@command.expectedRevision + per-kind active aggregate@k
 *       (first activation k=0 -> 1) -> fold -> ledger.commit -> map; a stale
 *       Project revision / active-aggregate movement => revision_conflict,
 *       never moves the active ref.
 *
 * The shared activate validator (validatePin) accepts
 * kind="evolution" (aggregateType=ArchitectureEvolutionPolicyRevision), so the
 * control consumes it directly and additionally asserts the exact third-kind
 * aggregateType before proceeding.
 *
 * Dependencies: shared contracts (architecture-evolution-policy.js,
 * ledger.js), the shared validators (validation/governance.js), StateLedger.load/commit via
 * ControlEngineDeps. The deterministic folds are built inline replicating the
 * fixture-fold builders; the behavior tests assert fold-equality.
 */
import type {
  ArchitectureEvolutionPolicyActivateReceipt,
  ArchitectureEvolutionPolicyActivatedEvent,
  ArchitectureEvolutionPolicyInstallReceipt,
  ArchitectureEvolutionPolicyInstalledEvent,
  ArchitectureEvolutionPolicyPin,
  ArchitectureEvolutionPolicyRevisionRef,
  ArchitectureEvolutionPolicyRevisionSnapshot,
  ActivateProjectArchitectureEvolutionPolicyCommand,
  InstallArchitectureEvolutionPolicyRevisionCommand,
  ProjectArchitectureEvolutionPolicyActiveRef,
  ProjectArchitectureEvolutionPolicyActiveSnapshot,
} from "../../contracts/architecture-evolution-policy.js";
import {
  architectureEvolutionPolicyActivateFingerprint,
  architectureEvolutionPolicyContentDigest,
  architectureEvolutionPolicyInstallFingerprint,
} from "../../contracts/architecture-evolution-policy.js";
import { validateActivateProjectArchitectureEvolutionPolicyCommand, validateInstallArchitectureEvolutionPolicyRevisionCommand } from '../../contracts/validation/governance.js';
import type {
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  LedgerCommitReceipt,
  ProjectRef,
  SnapshotResult,
} from "../../contracts/ledger.js";
import type { ControlEngineDeps } from "./control-engine.js";

function isEvolutionPolicySnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ArchitectureEvolutionPolicyRevisionSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "ArchitectureEvolutionPolicyRevision";
}

function targetMatchesEvolutionPolicySnapshot(
  snapshot: ArchitectureEvolutionPolicyRevisionSnapshot,
  target: ArchitectureEvolutionPolicyPin,
): boolean {
  return (
    snapshot.ref.projectId === target.ref.projectId &&
    snapshot.policyId === target.ref.policyId &&
    snapshot.contentRevision === target.ref.revision &&
    snapshot.contentDigest === target.digest
  );
}

// ------------------------------------------------------------------------ //
// Deterministic folds (replicate the shared fixture-fold builders exactly)   //
// ------------------------------------------------------------------------ //

function buildP113InstallCommit(
  command: InstallArchitectureEvolutionPolicyRevisionCommand,
  deps: ControlEngineDeps,
): GovernanceInstallLedgerCommitV1 {
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const fixture = command.payload.fixture;
  const ref: ArchitectureEvolutionPolicyRevisionRef = {
    aggregateType: "ArchitectureEvolutionPolicyRevision",
    projectId: command.identity.projectId,
    policyId: fixture.identity.fixtureId,
    revision: fixture.revision,
  };
  const snapshot: ArchitectureEvolutionPolicyRevisionSnapshot = {
    ref,
    revision: 1,
    schemaVersion: 1,
    policyId: fixture.identity.fixtureId,
    contentRevision: fixture.revision,
    content: fixture.content,
    contentDigest: command.payload.contentDigest,
    installedAt: occurredAt,
  };
  const event: ArchitectureEvolutionPolicyInstalledEvent = {
    eventId,
    eventType: "ArchitectureEvolutionPolicyInstalled",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: "",
    aggregateType: "ArchitectureEvolutionPolicyRevision",
    aggregateId: fixture.identity.fixtureId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: { revision: snapshot },
  };
  return {
    commitKind: "governance-install",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: architectureEvolutionPolicyInstallFingerprint(command),
    expectedVersions: [{ ref, revision: 0 }],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

function buildP113ActivateCommit(
  command: ActivateProjectArchitectureEvolutionPolicyCommand,
  deps: ControlEngineDeps,
  activeAggregateRevision: number,
): GovernanceActivateLedgerCommitV1 {
  const eventId = deps.eventId();
  const occurredAt = deps.now();
  const snapshot: ProjectArchitectureEvolutionPolicyActiveSnapshot = {
    ref: { aggregateType: "ProjectArchitectureEvolutionPolicyActive", projectId: command.identity.projectId },
    projectId: command.identity.projectId,
    activeRevision: command.payload.target.ref,
    revision: activeAggregateRevision,
  };
  const projectRef: ProjectRef = { aggregateType: "Project", projectId: command.identity.projectId };
  const event: ArchitectureEvolutionPolicyActivatedEvent = {
    eventId,
    eventType: "ArchitectureEvolutionPolicyActivated",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: "",
    aggregateType: "ProjectArchitectureEvolutionPolicyActive",
    aggregateId: command.identity.projectId,
    aggregateRevision: activeAggregateRevision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: { activeRef: snapshot.ref, activeRevision: snapshot.activeRevision },
  };
  return {
    commitKind: "governance-activate",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: architectureEvolutionPolicyActivateFingerprint(command),
    expectedVersions: [
      { ref: projectRef, revision: command.expectedRevision },
      { ref: snapshot.ref, revision: activeAggregateRevision - 1 },
    ],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// Mapping: ledger receipt -> architecture evolution receipts                //
// ------------------------------------------------------------------------ //

function mapInstallReceipt(
  receipt: LedgerCommitReceipt,
  command: InstallArchitectureEvolutionPolicyRevisionCommand,
  revisionRef: ArchitectureEvolutionPolicyRevisionRef,
): ArchitectureEvolutionPolicyInstallReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      revisionRef,
      contentDigest: command.payload.contentDigest,
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
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

function mapActivateReceipt(
  receipt: LedgerCommitReceipt,
  command: ActivateProjectArchitectureEvolutionPolicyCommand,
  activeRef: ProjectArchitectureEvolutionPolicyActiveRef,
): ArchitectureEvolutionPolicyActivateReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId: command.commandId,
      replayed: receipt.replayed,
      activeRef,
      activeRevision: command.payload.target.ref,
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
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
  }
}

// ------------------------------------------------------------------------ //
// Control entry                                                              //
// ------------------------------------------------------------------------ //

export class ArchitectureEvolutionPolicyEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}

  async install(command: InstallArchitectureEvolutionPolicyRevisionCommand): Promise<ArchitectureEvolutionPolicyInstallReceipt> {
    // 1) schema: shared validator -> structural issues are invalid (ZERO write).
    const issues = validateInstallArchitectureEvolutionPolicyRevisionCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // 2) digest: pure content mismatch -> digest_mismatch (structural issues won).
    if (architectureEvolutionPolicyContentDigest(command.payload.fixture) !== command.payload.contentDigest) {
      return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
    }

    // 3) deterministic fold (exactly the shared fixture-fold builder).
    const batch = buildP113InstallCommit(command, this.deps);
    const revisionRef = batch.snapshots[0]!.ref as ArchitectureEvolutionPolicyRevisionRef;

    // 4) atomic commit (idempotency / immutability CAS decided by the ledger).
    const receipt = await this.deps.ledger.commit(batch);
    return mapInstallReceipt(receipt, command, revisionRef);
  }

  async activate(command: ActivateProjectArchitectureEvolutionPolicyCommand): Promise<ArchitectureEvolutionPolicyActivateReceipt> {
    // 1) schema: shared validator -> structural issues are invalid (ZERO write).
    //    Additionally assert the exact third-kind aggregateType.
    const issues = validateActivateProjectArchitectureEvolutionPolicyCommand(command);
    if (issues.length > 0 || (command.payload.target.ref as { aggregateType?: string }).aggregateType !== "ArchitectureEvolutionPolicyRevision") {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // 2) exact installed-target resolution (pre-CAS, ZERO write). A dangling ref ->
    //    not_found; the ref is found but the digest does not match -> digest_mismatch.
    const target = command.payload.target;
    const loaded = await this.deps.ledger.load(target.ref);
    if (loaded.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    if (!isEvolutionPolicySnapshot(loaded) || !targetMatchesEvolutionPolicySnapshot(loaded.snapshot, target)) {
      return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
    }

    // 3) per-kind active aggregate revision (absent -> 0; present -> snapshot.revision).
    const activeRef: ProjectArchitectureEvolutionPolicyActiveRef = {
      aggregateType: "ProjectArchitectureEvolutionPolicyActive",
      projectId: command.identity.projectId,
    };
    const active = await this.deps.ledger.load(activeRef);
    const activeExpected = active.status === "found" ? active.snapshot.revision : 0;
    const newActiveRevision = activeExpected + 1;

    // 4) deterministic fold (project CAS deps use command.expectedRevision).
    const batch = buildP113ActivateCommit(command, this.deps, newActiveRevision);

    // 5) atomic commit (Project CAS + active-aggregate CAS; idempotency by ledger).
    const receipt = await this.deps.ledger.commit(batch);
    return mapActivateReceipt(receipt, command, activeRef);
  }
}
