/**
 * Governance contracts — P1-02 first consumption of CompletionPolicy and
 * ArchitectureBaseline.
 *
 * Authority:
 *   - dev_docs/interfaces/completion-policy.md (versions resolve via Project
 *     active refs; immutable digest/revision matching; no built-in defaults)
 *   - dev_docs/planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md
 *   - IMPLEMENTATION-HANDOFF.md "P1-02 契约与存储语义（冻结）"
 *
 * Frozen semantics (recorded in the handoff; versioned additions — the
 * Goal-create slice v1 semantics are unchanged):
 *   - Governance revisions are PROJECT-SCOPED immutable artifacts: identity =
 *     (projectId, policyId|baselineId, revision); install is a project-scoped
 *     command (CommandIdentity). contentDigest = JCS + SHA-256 over
 *     {schemaVersion, identity, revision, content} (full fixture).
 *   - A revision aggregate NEVER changes: it is created at aggregate
 *     revision 1 and cannot be overwritten (install CAS on expected
 *     revision 0 / idempotent replay for the SAME identity+fingerprint).
 *   - Project active refs are two INDEPENDENT aggregates per project
 *     (CompletionPolicy and ArchitectureBaseline); each is created/updated
 *     ONLY by the activation contract with CAS on the expected Project
 *     revision AND the active-aggregate revision.
 *   - Install NEVER auto-activates. There is NO default policy/baseline and
 *     NO ArchitectureEvolutionPolicy active ref in P1-02.
 *   - A ref resolves only when identity/revision/digest match EXACTLY the
 *     installed snapshot; otherwise the consumer must fail (zero-write).
 */
import type {
  ActorRef,
  CommandFingerprint,
  CommandIdentity,
  CommitCursor,
} from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { SnapshotResult, StateLedger } from "./ledger.js";

// ------------------------------------------------------------------------ //
// Revision identity / pins                                                  //
// ------------------------------------------------------------------------ //

export type CompletionPolicyRevisionRef = {
  aggregateType: "CompletionPolicyRevision";
  projectId: string;
  policyId: string;
  revision: number;
};

export type ArchitectureBaselineRevisionRef = {
  aggregateType: "ArchitectureBaselineRevision";
  projectId: string;
  baselineId: string;
  revision: number;
};

/** Exact pin: identity/revision/digest triple — the only admissible ref form. */
export type CompletionPolicyPin = {
  ref: CompletionPolicyRevisionRef;
  digest: string;
};

export type ArchitectureBaselinePin = {
  ref: ArchitectureBaselineRevisionRef;
  digest: string;
};

// ------------------------------------------------------------------------ //
// Fixtures                                                                 //
// ------------------------------------------------------------------------ //

export type CompletionPolicyContentV1 = {
  schemaVersion: 1;
  /**
   * Evidence requirement kinds this policy recognizes when an
   * AcceptanceObligation is compiled into VerificationRequirements.
   * (mutable array: canonicalJson requires JsonValue-compatible shapes)
   */
  requirementKinds: string[];
  /** Minimum number of REQUIRED VerificationRequirements per required obligation. */
  minimumRequiredRequirementsPerObligation: number;
};

/**
 * Versioned CompletionPolicy local fixture. Content semantics consumed in
 * P1-02 are exactly: requirementKinds + minimumRequiredRequirementsPerObligation
 * (the non-empty obligation-compilation guard). The policy body is authored
 * once per revision and never rewritten.
 */
export type VersionedCompletionPolicyFixture = {
  schemaVersion: 1;
  identity: { policyId: string };
  revision: number;
  content: CompletionPolicyContentV1;
};

export type ArchitectureBaselineContentV1 = {
  schemaVersion: 1;
  description: string;
  constraints: { name: string; scope: string }[];
};

export type VersionedArchitectureBaselineFixture = {
  schemaVersion: 1;
  identity: { baselineId: string };
  revision: number;
  content: ArchitectureBaselineContentV1;
};

// ------------------------------------------------------------------------ //
// Snapshots (persisted via StateLedger)                                    //
// ------------------------------------------------------------------------ //

export type CompletionPolicyRevisionSnapshot = {
  ref: CompletionPolicyRevisionRef;
  /** Aggregate revision: an installed revision is immutable -> always 1. */
  revision: 1;
  schemaVersion: 1;
  policyId: string;
  /** Fixture content revision (part of the identity; never mutated). */
  contentRevision: number;
  contentDigest: string;
  content: CompletionPolicyContentV1;
};

export type ArchitectureBaselineRevisionSnapshot = {
  ref: ArchitectureBaselineRevisionRef;
  revision: 1;
  schemaVersion: 1;
  baselineId: string;
  contentRevision: number;
  contentDigest: string;
  content: ArchitectureBaselineContentV1;
};

export type ProjectCompletionPolicyActiveRef = {
  aggregateType: "ProjectCompletionPolicyActive";
  projectId: string;
};

export type ProjectArchitectureBaselineActiveRef = {
  aggregateType: "ProjectArchitectureBaselineActive";
  projectId: string;
};

export type ProjectCompletionPolicyActiveSnapshot = {
  ref: ProjectCompletionPolicyActiveRef;
  projectId: string;
  /** Always non-null: the aggregate only exists after the first activation. */
  activeRevision: CompletionPolicyRevisionRef;
  /** 1 on first activation, k+1 on each subsequent activation (kind-CAS). */
  revision: number;
};

export type ProjectArchitectureBaselineActiveSnapshot = {
  ref: ProjectArchitectureBaselineActiveRef;
  projectId: string;
  activeRevision: ArchitectureBaselineRevisionRef;
  revision: number;
};

// ------------------------------------------------------------------------ //
// Digest / fingerprints                                                     //
// ------------------------------------------------------------------------ //

/**
 * Canonical content digest of a governance fixture: JCS + SHA-256 over the
 * FULL fixture {schemaVersion, identity, revision, content}. The installed
 * snapshot stores it and every resolution must triple-match it.
 */
export function governanceContentDigest(
  fixture: VersionedCompletionPolicyFixture | VersionedArchitectureBaselineFixture,
): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: fixture.schemaVersion,
      identity: fixture.identity,
      revision: fixture.revision,
      content: fixture.content,
    }),
  );
}

/** Deterministic install fingerprint (JCS + SHA-256; volatile fields excluded). */
export function governanceInstallFingerprint(
  command:
    | InstallCompletionPolicyRevisionCommand
    | InstallArchitectureBaselineRevisionCommand,
): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    fixture: {
      identity: command.payload.fixture.identity,
      revision: command.payload.fixture.revision,
      contentDigest: command.payload.contentDigest,
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

/** Deterministic activation fingerprint (renamed target content is a new command). */
export function governanceActivateFingerprint(
  command:
    | ActivateProjectCompletionPolicyCommand
    | ActivateProjectArchitectureBaselineCommand,
): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    expectedRevision: command.expectedRevision,
    target: command.payload.target,
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// Commands (P1-02)                                                          //
// ------------------------------------------------------------------------ //

export type InstallCompletionPolicyRevisionCommand = {
  commandId: string;
  commandType: "InstallCompletionPolicyRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  correlationId: string;
  submittedAt: string;
  payload: {
    fixture: VersionedCompletionPolicyFixture;
    /** Must equal governanceContentDigest(fixture) — rejected otherwise. */
    contentDigest: string;
  };
};

export type InstallArchitectureBaselineRevisionCommand = {
  commandId: string;
  commandType: "InstallArchitectureBaselineRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  correlationId: string;
  submittedAt: string;
  payload: {
    fixture: VersionedArchitectureBaselineFixture;
    contentDigest: string;
  };
};

export type GovernanceInstallCommand =
  | InstallCompletionPolicyRevisionCommand
  | InstallArchitectureBaselineRevisionCommand;

export type ActivateProjectCompletionPolicyCommand = {
  commandId: string;
  commandType: "ActivateProjectCompletionPolicy";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** projectId — the local id of the per-kind active aggregate. */
  aggregateId: string;
  /** CAS window: the Project aggregate revision observed by the caller. */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    target: CompletionPolicyPin;
  };
};

export type ActivateProjectArchitectureBaselineCommand = {
  commandId: string;
  commandType: "ActivateProjectArchitectureBaseline";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    target: ArchitectureBaselinePin;
  };
};

export type GovernanceActivateCommand =
  | ActivateProjectCompletionPolicyCommand
  | ActivateProjectArchitectureBaselineCommand;

// ------------------------------------------------------------------------ //
// Receipts                                                                  //
// ------------------------------------------------------------------------ //

export type GovernanceInstallReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      revisionRef: CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef;
      contentDigest: string;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "digest_mismatch"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
    };

export type GovernanceActivateReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      activeRef: ProjectCompletionPolicyActiveRef | ProjectArchitectureBaselineActiveRef;
      activeRevision: CompletionPolicyRevisionRef | ArchitectureBaselineRevisionRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "digest_mismatch"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
    };

// ------------------------------------------------------------------------ //
// Events (P1-02, v1)                                                        //
// ------------------------------------------------------------------------ //

export type CompletionPolicyInstalledEvent = {
  eventId: string;
  eventType: "CompletionPolicyInstalled";
  schemaVersion: 1;
  projectId: string;
  aggregateType: "CompletionPolicyRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    policyId: string;
    revision: number;
    contentDigest: string;
    content: CompletionPolicyContentV1;
  };
};

export type ArchitectureBaselineInstalledEvent = {
  eventId: string;
  eventType: "ArchitectureBaselineInstalled";
  schemaVersion: 1;
  projectId: string;
  aggregateType: "ArchitectureBaselineRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    baselineId: string;
    revision: number;
    contentDigest: string;
    content: ArchitectureBaselineContentV1;
  };
};

export type CompletionPolicyActivatedEvent = {
  eventId: string;
  eventType: "CompletionPolicyActivated";
  schemaVersion: 1;
  projectId: string;
  aggregateType: "ProjectCompletionPolicyActive";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    target: CompletionPolicyPin;
  };
};

export type ArchitectureBaselineActivatedEvent = {
  eventId: string;
  eventType: "ArchitectureBaselineActivated";
  schemaVersion: 1;
  projectId: string;
  aggregateType: "ProjectArchitectureBaselineActive";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    target: ArchitectureBaselinePin;
  };
};

// ------------------------------------------------------------------------ //
// Canonical resolution helpers (read-only; never write)                    //
// ------------------------------------------------------------------------ //

export type CompletionPolicyResolution =
  | { status: "found"; pin: CompletionPolicyPin; snapshot: CompletionPolicyRevisionSnapshot }
  | { status: "not_found" };

export type ArchitectureBaselineResolution =
  | { status: "found"; pin: ArchitectureBaselinePin; snapshot: ArchitectureBaselineRevisionSnapshot }
  | { status: "not_found" };

export type ProjectCompletionPolicyActiveResolution =
  | { status: "found"; snapshot: ProjectCompletionPolicyActiveSnapshot }
  | { status: "not_found" };

export type ProjectArchitectureBaselineActiveResolution =
  | { status: "found"; snapshot: ProjectArchitectureBaselineActiveSnapshot }
  | { status: "not_found" };

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

function isActivePolicySnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ProjectCompletionPolicyActiveSnapshot } {
  return (
    result.status === "found" && result.snapshot.ref.aggregateType === "ProjectCompletionPolicyActive"
  );
}

function isActiveBaselineSnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ProjectArchitectureBaselineActiveSnapshot } {
  return (
    result.status === "found" &&
    result.snapshot.ref.aggregateType === "ProjectArchitectureBaselineActive"
  );
}

/**
 * Resolve an installed CompletionPolicy revision by exact triple match
 * (ref identity/revision + digest). The loaded snapshot must carry the same
 * projectId/policyId/revision as the ref AND the same contentDigest.
 */
export async function resolveCompletionPolicyRevision(
  ledger: StateLedger,
  ref: CompletionPolicyRevisionRef,
  digest: string,
): Promise<CompletionPolicyResolution> {
  const result = await ledger.load(ref);
  if (!isCompletionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.policyId !== ref.policyId ||
    snapshot.contentRevision !== ref.revision ||
    snapshot.contentDigest !== digest
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}

export async function resolveArchitectureBaselineRevision(
  ledger: StateLedger,
  ref: ArchitectureBaselineRevisionRef,
  digest: string,
): Promise<ArchitectureBaselineResolution> {
  const result = await ledger.load(ref);
  if (!isArchitectureBaselineSnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.baselineId !== ref.baselineId ||
    snapshot.contentRevision !== ref.revision ||
    snapshot.contentDigest !== digest
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}

/** Load the project's active CompletionPolicy ref aggregate (if any). */
export async function loadProjectCompletionPolicyActive(
  ledger: StateLedger,
  projectId: string,
): Promise<ProjectCompletionPolicyActiveResolution> {
  const ref: ProjectCompletionPolicyActiveRef = {
    aggregateType: "ProjectCompletionPolicyActive",
    projectId,
  };
  const result = await ledger.load(ref);
  if (!isActivePolicySnapshot(result)) return { status: "not_found" };
  return { status: "found", snapshot: result.snapshot };
}

export async function loadProjectArchitectureBaselineActive(
  ledger: StateLedger,
  projectId: string,
): Promise<ProjectArchitectureBaselineActiveResolution> {
  const ref: ProjectArchitectureBaselineActiveRef = {
    aggregateType: "ProjectArchitectureBaselineActive",
    projectId,
  };
  const result = await ledger.load(ref);
  if (!isActiveBaselineSnapshot(result)) return { status: "not_found" };
  return { status: "found", snapshot: result.snapshot };
}

/**
 * Resolve an installed CompletionPolicy revision for the effective pin of a
 * project. The ACTIVE aggregate stores only the ref; resolution loads the
 * revision snapshot and verifies the identity triple AND that the snapshot's
 * canonical contentDigest matches the installed digest (the pin). P1-02 has
 * NO default and NO fallback — missing active ref or unresolvable revision is
 * a hard not_found (zero-write).
 */
export async function resolveProjectCompletionPolicy(
  ledger: StateLedger,
  projectId: string,
): Promise<CompletionPolicyResolution> {
  const active = await loadProjectCompletionPolicyActive(ledger, projectId);
  if (active.status === "not_found") return { status: "not_found" };
  const ref = active.snapshot.activeRevision;
  const result = await ledger.load(ref);
  if (!isCompletionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.policyId !== ref.policyId ||
    snapshot.contentRevision !== ref.revision
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest: snapshot.contentDigest }, snapshot };
}

/**
 * Effective ArchitectureBaseline for a project (same semantics: currently
 * active revision resolved to its exact pin; no default / no fallback).
 */
export async function resolveProjectArchitectureBaseline(
  ledger: StateLedger,
  projectId: string,
): Promise<ArchitectureBaselineResolution> {
  const active = await loadProjectArchitectureBaselineActive(ledger, projectId);
  if (active.status === "not_found") return { status: "not_found" };
  const ref = active.snapshot.activeRevision;
  const result = await ledger.load(ref);
  if (!isArchitectureBaselineSnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.baselineId !== ref.baselineId ||
    snapshot.contentRevision !== ref.revision
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest: snapshot.contentDigest }, snapshot };
}
