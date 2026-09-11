/**
 * P1-07 Control entry: workspace lease engine (acquireReadLease /
 * acquireWriteLease / releaseLease) + read-only-capability enforcement.
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane A fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" items 1/2/3/4. Every acquisition resolves the WorkspaceCapabilityPort
 * FIRST (unsupported -> capability_unsupported, NEVER a silent degrade); a
 * reader run can never obtain a write lease; write scopes must be ⊆
 * declaredWriteScope (scope_not_declared) and ⊆ the capability cap.
 */
import type { LedgerCommitReceipt } from "../../contracts/ledger.js";
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
  WorkspaceReadLeaseIndexSnapshot,
  WorkspaceWriteLeaseIndexSnapshot,
  WorkspaceReadLeaseSnapshot,
  WorkspaceWriteLeaseSnapshot,
} from "../../contracts/workspace-lease.js";
import { evaluateLeaseAdmissibility } from "./policies/workspace-lease.js";
import { scopeOverlap, scopeCoveredByWriteScope, workspaceReadLeaseRefFor, workspaceWriteLeaseRefFor, workspaceReadLeaseIndexRefFor, workspaceWriteLeaseIndexRefFor } from "../../contracts/workspace-lease.js";
import type {
  AcquireReadLeaseRejectionCode,
  AcquireWriteLeaseRejectionCode,
  ReleaseLeaseRejectionCode,
} from "../../contracts/workspace-lease.js";
import { validateAcquireWorkspaceReadLeaseCommand, validateAcquireWorkspaceWriteLeaseCommand, validateReleaseWorkspaceLeaseCommand } from '../../contracts/validation/workspace.js';
import { evaluateWorkspaceOperation } from "./policies/workspace-operation.js";
import type { WorkspaceOperationVerdict, WorkspaceCapabilitiesV1 } from "../../contracts/workspace-capability.js";
import type { TaskEnvelopeV1 } from "../../contracts/task-envelope.js";
import { canonicalJson } from "../../contracts/fingerprint.js";
import { buildWorkspaceReadLeaseAcquireLedgerCommit, buildWorkspaceWriteLeaseAcquireLedgerCommit, buildWorkspaceReadLeaseReleaseLedgerCommit, buildWorkspaceWriteLeaseReleaseLedgerCommit, type BuildP107WriteAcquireCommitDeps } from "./records/workspace.js";
import type { ConflictScopeV1 } from "../../contracts/workspace-lease.js";
import type { ControlEngineDeps } from "./control-engine.js";

type LedgerRejectedCode = Extract<LedgerCommitReceipt, { status: "rejected" }>["code"];

/** Rejection codes common to every lease command receipt. */
type SharedRejectionCode = "invalid" | "idempotency_conflict" | "revision_conflict" | "unavailable";

function mapCommitRejection(code: LedgerRejectedCode): SharedRejectionCode {
  switch (code) {
    case "invalid_commit":
      return "invalid";
    case "not_empty":
      return "invalid";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "revision_conflict":
      return "revision_conflict";
    case "unavailable":
      return "unavailable";
  }
}

export interface WorkspaceLeaseEngine {
  acquireReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  acquireWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  releaseLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
}

export class WorkspaceLeaseEngineImpl implements WorkspaceLeaseEngine {
  constructor(private readonly deps: ControlEngineDeps) {}

  // --------------------------------------------------------------------- //
  // acquireReadLease — shared / overlapping / re-entrant                   //
  // --------------------------------------------------------------------- //

  async acquireReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt> {
    const commandId = command.commandId;
    const issues = validateAcquireWorkspaceReadLeaseCommand(command);
    if (issues.length > 0) return this.rejectRead(commandId, "invalid");

    const projectId = command.identity.projectId;
    const { payload } = command;

    // 1) holder Run must exist; a run that never started declares no capability.
    const run = await this.deps.ledger.load(payload.holder.runRef);
    if (run.status === "not_found") return this.rejectRead(commandId, "run_not_found");
    const envelope = (run.snapshot as { envelope: TaskEnvelopeV1 | null }).envelope;
    if (envelope === null) return this.rejectRead(commandId, "capability_unsupported");

    // 2) Workspace must exist (no silent degrade to a missing workspace).
    const wsRef = { aggregateType: "Workspace" as const, projectId, workspaceId: payload.workspaceId };
    const workspace = await this.deps.ledger.load(wsRef);
    if (workspace.status === "not_found" || workspace.snapshot.ref.aggregateType !== "Workspace") {
      return this.rejectRead(commandId, "workspace_not_found");
    }

    // 3) Capability resolution — capability_unsupported is a HARD rejection.
    const verdict = await this.resolveReadCapability(envelope, payload.scope);
    if (!verdict.allowed) {
      if (verdict.code === "capability_readonly") return this.rejectRead(commandId, "capability_readonly");
      if (verdict.code === "workspace_mismatch") return this.rejectRead(commandId, "workspace_mismatch");
      return this.rejectRead(commandId, "capability_unsupported");
    }

    // 4) Read lease index (absent -> a fresh index at rev 0).
    const readIndexRef = workspaceReadLeaseIndexRefFor(projectId, payload.workspaceId);
    const indexSnapshot = await this.loadReadLeaseIndex(readIndexRef);

    // 5) Read-write conflict: an ADMISSIBLE overlapping write lease stops a read.
    const writeIndexLoad = await this.deps.ledger.load(workspaceWriteLeaseIndexRefFor(projectId, payload.workspaceId));
    if (writeIndexLoad.status === "found") {
      const writeIndex = writeIndexLoad.snapshot as WorkspaceWriteLeaseIndexSnapshot;
      if (writeIndex.activeLeaseId !== null) {
        const writeLeaseLoad = await this.deps.ledger.load(workspaceWriteLeaseRefFor(projectId, writeIndex.activeLeaseId));
        if (writeLeaseLoad.status === "found") {
          const writeLeaseSnapshot = writeLeaseLoad.snapshot as WorkspaceWriteLeaseSnapshot;
          const admissibility = evaluateLeaseAdmissibility(writeLeaseSnapshot.lease, this.deps.now());
          if (admissibility.admissible && scopeOverlap(writeLeaseSnapshot.lease.scope, payload.scope)) {
            return this.rejectRead(commandId, "read_lease_conflict");
          }
        }
      }
    }

    // 6) Fold + atomic commit.
    const batch = buildWorkspaceReadLeaseAcquireLedgerCommit(command, {
      eventId: this.deps.eventId(),
      occurredAt: this.deps.now(),
      indexSnapshot,
      writeIndexRevision: writeIndexLoad.status === "found" ? writeIndexLoad.snapshot.revision : 0,
    });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId,
        replayed: receipt.replayed,
        leaseRef: workspaceReadLeaseRefFor(projectId, command.aggregateId),
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    return this.rejectRead(commandId, mapCommitRejection(receipt.code));
  }

  // --------------------------------------------------------------------- //
  // acquireWriteLease — exclusive via the index CAS (invariant #7)         //
  // --------------------------------------------------------------------- //

  async acquireWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt> {
    const commandId = command.commandId;
    const issues = validateAcquireWorkspaceWriteLeaseCommand(command);
    if (issues.length > 0) return this.rejectWrite(commandId, "invalid");

    const projectId = command.identity.projectId;
    const { payload } = command;

    // An existing lease makes this an immutable-create replay/conflict probe.
    // Let the ledger compare the durable identity + fingerprint before current
    // capability/conflict guards. Lease@0 cannot succeed here, so this probe
    // cannot append events or replace a lease when the command is not a replay.
    const existingLease = await this.deps.ledger.load(workspaceWriteLeaseRefFor(projectId, command.aggregateId));
    if (existingLease.status === "found") {
      const index = await this.deps.ledger.load(workspaceWriteLeaseIndexRefFor(projectId, payload.workspaceId));
      if (index.status === "not_found") return this.rejectWrite(commandId, "revision_conflict");
      const readers = await this.deps.ledger.load(workspaceReadLeaseIndexRefFor(projectId, payload.workspaceId));
      return this.commitWriteAcquisition(command, {
        indexSnapshot: index.snapshot as WorkspaceWriteLeaseIndexSnapshot,
        readIndexRevision: readers.status === "found" ? readers.snapshot.revision : 0,
      });
    }

    // 1) holder Run must exist; a run that never started declares no capability.
    const run = await this.deps.ledger.load(payload.holder.runRef);
    if (run.status === "not_found") return this.rejectWrite(commandId, "run_not_found");
    const envelope = (run.snapshot as { envelope: TaskEnvelopeV1 | null }).envelope;
    if (envelope === null) return this.rejectWrite(commandId, "capability_unsupported");

    // 2) Workspace must exist.
    const wsRef = { aggregateType: "Workspace" as const, projectId, workspaceId: payload.workspaceId };
    const workspace = await this.deps.ledger.load(wsRef);
    if (workspace.status === "not_found" || workspace.snapshot.ref.aggregateType !== "Workspace") {
      return this.rejectWrite(commandId, "workspace_not_found");
    }

    // 3) Capability resolution — write requires an explicit workspaceWrite.
    const verdict = await this.resolveWriteCapability(envelope, payload.scope);
    if (!verdict.allowed) {
      if (verdict.code === "capability_readonly") return this.rejectWrite(commandId, "capability_readonly");
      if (verdict.code === "workspace_mismatch") return this.rejectWrite(commandId, "workspace_mismatch");
      if (verdict.code === "scope_exceeds_capability") return this.rejectWrite(commandId, "scope_exceeds_capability");
      return this.rejectWrite(commandId, "capability_unsupported");
    }

    // 4) 越权即拒：the write scope must be ⊆ the binding's declared writeScope.
    if (!scopeCoveredByWriteScope(payload.scope, payload.declaredWriteScope)) {
      return this.rejectWrite(commandId, "scope_not_declared");
    }

    // 5) WorkspaceWriteLeaseIndex (absent -> rev 0, no active writer).
    const writeIndexRef = workspaceWriteLeaseIndexRefFor(projectId, payload.workspaceId);
    const writeIndexLoad = await this.deps.ledger.load(writeIndexRef);
    let indexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
    if (writeIndexLoad.status === "not_found") {
      indexSnapshot = {
        ref: writeIndexRef,
        revision: 0,
        schemaVersion: 1,
        activeLeaseId: null,
        activeScope: null,
        holderRunRef: null,
      };
    } else {
      indexSnapshot = writeIndexLoad.snapshot as WorkspaceWriteLeaseIndexSnapshot;
    }

    let vacatedSnapshot: WorkspaceWriteLeaseSnapshot | undefined = undefined;
    if (indexSnapshot.activeLeaseId !== null) {
      const activeLeaseLoad = await this.deps.ledger.load(
        workspaceWriteLeaseRefFor(projectId, indexSnapshot.activeLeaseId),
      );
      if (activeLeaseLoad.status === "found") {
        const activeLeaseSnapshot = activeLeaseLoad.snapshot as WorkspaceWriteLeaseSnapshot;
        // A concurrent duplicate may have committed while capability resolution
        // was pending. The existing target still makes Lease@0 a zero-write
        // replay/conflict probe, regardless of the opposing index version.
        if (activeLeaseSnapshot.ref.leaseId === command.aggregateId) {
          return this.commitWriteAcquisition(command, { indexSnapshot });
        }
        const admissibility = evaluateLeaseAdmissibility(activeLeaseSnapshot.lease, this.deps.now());
        if (admissibility.admissible) return this.rejectWrite(commandId, "write_lease_conflict");
        if (admissibility.reason === "released") return this.rejectWrite(commandId, "write_lease_conflict");
        // expired -> the active lease is vacated atomically in the same commit.
        vacatedSnapshot = activeLeaseSnapshot;
      }
    }

    // 6) Read-lease conflict: an ADMISSIBLE overlapping read lease blocks a write.
    const readIndexLoad = await this.deps.ledger.load(workspaceReadLeaseIndexRefFor(projectId, payload.workspaceId));
    if (readIndexLoad.status === "found") {
      const readIndex = readIndexLoad.snapshot as WorkspaceReadLeaseIndexSnapshot;
      for (const entry of readIndex.activeReadLeases) {
        const readLeaseLoad = await this.deps.ledger.load(workspaceReadLeaseRefFor(projectId, entry.leaseId));
        if (readLeaseLoad.status === "found") {
          const readLeaseSnapshot = readLeaseLoad.snapshot as WorkspaceReadLeaseSnapshot;
          const admissibility = evaluateLeaseAdmissibility(readLeaseSnapshot.lease, this.deps.now());
          if (admissibility.admissible && scopeOverlap(readLeaseSnapshot.lease.scope, payload.scope)) {
            return this.rejectWrite(commandId, "read_lease_conflict");
          }
        }
      }
    }

    // 7) Fold + atomic commit (+ optional expiry-vacate).
    return this.commitWriteAcquisition(command, {
      indexSnapshot,
      readIndexRevision: readIndexLoad.status === "found" ? readIndexLoad.snapshot.revision : 0,
      ...(vacatedSnapshot !== undefined ? { vacatedSnapshot } : {}),
    });
  }

  // --------------------------------------------------------------------- //
  // releaseLease — explicit holder release (no cancel/preempt/force)       //
  // --------------------------------------------------------------------- //

  async releaseLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt> {
    const commandId = command.commandId;
    const issues = validateReleaseWorkspaceLeaseCommand(command);
    if (issues.length > 0) return this.rejectRelease(commandId, "invalid");

    const projectId = command.identity.projectId;
    const { payload } = command;

    // 1) Load the lease by kind; a mismatched aggregate type is a kind mismatch.
    const expectedType = payload.kind === "read" ? "WorkspaceReadLease" : "WorkspaceWriteLease";
    const leaseRef =
      payload.kind === "read"
        ? workspaceReadLeaseRefFor(projectId, payload.leaseId)
        : workspaceWriteLeaseRefFor(projectId, payload.leaseId);
    const leaseLoad = await this.deps.ledger.load(leaseRef);
    if (leaseLoad.status === "not_found") return this.rejectRelease(commandId, "lease_not_found");
    if (leaseLoad.snapshot.ref.aggregateType !== expectedType) return this.rejectRelease(commandId, "kind_mismatch");

    // 2) Only the holder may release (frozen releasedBy === "holder").
    const lease =
      payload.kind === "read"
        ? (leaseLoad.snapshot as WorkspaceReadLeaseSnapshot).lease
        : (leaseLoad.snapshot as WorkspaceWriteLeaseSnapshot).lease;
    if (canonicalJson(lease.holder.runRef) !== canonicalJson(payload.holderRunRef)) {
      return this.rejectRelease(commandId, "not_holder");
    }

    // 3) Already released / already expired (zero write, no state change).
    if (lease.status === "released") return this.rejectRelease(commandId, "already_released");
    const admissibility = evaluateLeaseAdmissibility(lease, this.deps.now());
    if (!admissibility.admissible && admissibility.reason === "expired") {
      return this.rejectRelease(commandId, "already_expired");
    }

    // 4) The corresponding index must exist (an active lease always has one).
    let indexSnapshot: WorkspaceReadLeaseIndexSnapshot | undefined;
    let writeIndexSnapshot: WorkspaceWriteLeaseIndexSnapshot | undefined;
    if (payload.kind === "read") {
      const readIndexLoad = await this.deps.ledger.load(workspaceReadLeaseIndexRefFor(projectId, payload.workspaceId));
      if (readIndexLoad.status === "not_found") return this.rejectRelease(commandId, "lease_not_found");
      indexSnapshot = readIndexLoad.snapshot as WorkspaceReadLeaseIndexSnapshot;
    } else {
      const writeIndexLoad = await this.deps.ledger.load(workspaceWriteLeaseIndexRefFor(projectId, payload.workspaceId));
      if (writeIndexLoad.status === "not_found") return this.rejectRelease(commandId, "lease_not_found");
      writeIndexSnapshot = writeIndexLoad.snapshot as WorkspaceWriteLeaseIndexSnapshot;
    }

    // 5) Fold + atomic commit.
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const activeSnapshot = leaseLoad.snapshot;
    let receipt: LedgerCommitReceipt;
    if (payload.kind === "read") {
      receipt = await this.deps.ledger.commit(
        buildWorkspaceReadLeaseReleaseLedgerCommit(command, activeSnapshot as WorkspaceReadLeaseSnapshot, {
          eventId,
          occurredAt,
          indexSnapshot: indexSnapshot!,
        }),
      );
    } else {
      receipt = await this.deps.ledger.commit(
        buildWorkspaceWriteLeaseReleaseLedgerCommit(command, activeSnapshot as WorkspaceWriteLeaseSnapshot, {
          eventId,
          occurredAt,
          indexSnapshot: writeIndexSnapshot!,
        }),
      );
    }
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId,
        replayed: receipt.replayed,
        leaseRef:
          payload.kind === "read"
            ? workspaceReadLeaseRefFor(projectId, payload.leaseId)
            : workspaceWriteLeaseRefFor(projectId, payload.leaseId),
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    return this.rejectRelease(commandId, mapCommitRejection(receipt.code));
  }

  // --------------------------------------------------------------------- //
  // helpers                                                                //
  // --------------------------------------------------------------------- //

  private async commitWriteAcquisition(
    command: AcquireWorkspaceWriteLeaseCommand,
    deps: Omit<BuildP107WriteAcquireCommitDeps, "eventId" | "occurredAt">,
  ): Promise<AcquireWriteLeaseReceipt> {
    const batch = buildWorkspaceWriteLeaseAcquireLedgerCommit(command, {
      ...deps, eventId: this.deps.eventId(), occurredAt: this.deps.now(),
    });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        leaseRef: workspaceWriteLeaseRefFor(command.identity.projectId, command.aggregateId),
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }
    return this.rejectWrite(command.commandId, mapCommitRejection(receipt.code));
  }

  private async loadReadLeaseIndex(ref: {
    aggregateType: "WorkspaceReadLeaseIndex";
    projectId: string;
    workspaceId: string;
  }): Promise<WorkspaceReadLeaseIndexSnapshot> {
    const load = await this.deps.ledger.load(ref);
    if (load.status === "not_found") {
      return { ref, revision: 0, schemaVersion: 1, activeReadLeases: [] };
    }
    return load.snapshot as WorkspaceReadLeaseIndexSnapshot;
  }

  private async resolveReadCapability(
    envelope: TaskEnvelopeV1,
    scope: ConflictScopeV1,
  ): Promise<WorkspaceOperationVerdict> {
    const capabilities = await this.resolveCapabilities(envelope, scope);
    return evaluateWorkspaceOperation(capabilities, { kind: "read", scope });
  }

  private async resolveWriteCapability(
    envelope: TaskEnvelopeV1,
    scope: ConflictScopeV1,
  ): Promise<WorkspaceOperationVerdict> {
    const capabilities = await this.resolveCapabilities(envelope, scope);
    return evaluateWorkspaceOperation(capabilities, { kind: "write", scope });
  }

  /** Resolve capabilities; an absent port or a rejected/unsupported result is a hard null (unsupported). */
  private async resolveCapabilities(
    envelope: TaskEnvelopeV1,
    _scope: ConflictScopeV1,
  ): Promise<WorkspaceCapabilitiesV1 | null> {
    const port = this.deps.workspaceCapability;
    if (port === undefined) return null;
    const result = await port.capabilitiesFor(envelope);
    if (result.status === "unsupported") return null;
    if (result.status === "rejected") return null;
    return result.capabilities;
  }

  private rejectRead(commandId: string, code: AcquireReadLeaseRejectionCode): AcquireReadLeaseReceipt {
    return { status: "rejected", commandId, code };
  }

  private rejectWrite(commandId: string, code: AcquireWriteLeaseRejectionCode): AcquireWriteLeaseReceipt {
    return { status: "rejected", commandId, code };
  }

  private rejectRelease(commandId: string, code: ReleaseLeaseRejectionCode): ReleaseLeaseReceipt {
    return { status: "rejected", commandId, code };
  }
}
