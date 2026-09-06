/**
 * P1-13 ArchitectureEvolutionPolicy contracts — the THIRD governance kind.
 *
 * Authority: ticket 13-allowlisted-remediation.md (Acceptance; 09-06 extension)
 * + ARCHITECTURE.md (immutable revisions; activation never auto-; resolution
 * only through the canonical Project active ref; allowlist/drift/reversibility
 * gating; ArchitectureBaseline active ref NEVER moves in this ticket).
 *
 * Freeze: install persists digest/revision-exact immutable revisions (never
 * auto-activates; no built-in allowlist fallback); activation CAS = Project@N
 * + per-kind active aggregate@k; only local/deterministic/reversible findings
 * hitting the allowlist AND the drift budget enter remediation; all gates zero
 * write; the same commitKind union extension as P1-02 (one install/activate
 * commitKind carries third kind now).
 */
import type { CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { ArchitectureFindingV1 } from "./architecture-inspection.js";
import type { StateLedger, SnapshotResult } from "./ledger.js";

export const ARCHITECTURE_EVOLUTION_POLICY_MAX_ALLOWLIST_ENTRIES = 64;
export const ARCHITECTURE_EVOLUTION_POLICY_MAX_DRIFT_BUDGET = 12;
export const ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_MAX_BYTES = 32 * 1024;

export type ArchitectureEvolutionPolicyScopeKind = "module" | "interface" | "runtime" | "governance";

export type ArchitectureEvolutionPolicyAllowlistEntryV1 = {
  findingCategory: import("./architecture-inspection.js").ArchitectureFindingCategory;
  /** Scope the entry applies to (matched against the finding's affectedRefs). */
  scope: ArchitectureEvolutionPolicyScopeKind;
  /** Finding risk must be <= maxRisk (deterministic rank). */
  maxRisk: "high" | "medium" | "low";
  /** Only "reversible" findings are auto-remediable without a decision. */
  reversibility: "reversible" | "manual_only";
  note: string;
};

export type ArchitectureEvolutionPolicyContentV1 = {
  schemaVersion: 1;
  allowlist: ArchitectureEvolutionPolicyAllowlistEntryV1[];
  driftBudget: { maxRemediationsPerCycle: number };
  upgrade: { path: "manual-decision" | "proposal"; note: string };
};

export type VersionedArchitectureEvolutionPolicyFixture = {
  schemaVersion: 1;
  fixtureId: "architecture-evolution-policy-v1";
  contentType: "ArchitectureEvolutionPolicy";
  revision: 1;
  identity: { kind: "local"; fixtureId: string; source: string };
  content: ArchitectureEvolutionPolicyContentV1;
};

export type ArchitectureEvolutionPolicyRevisionRef = {
  aggregateType: "ArchitectureEvolutionPolicyRevision";
  projectId: string;
  policyId: string;
  revision: number;
};

export type ArchitectureEvolutionPolicyPin = {
  ref: ArchitectureEvolutionPolicyRevisionRef;
  /** identity/revision/digest triple — matches the P1-02 pin shape. */
  digest: string;
};

export type ArchitectureEvolutionPolicyRevisionSnapshot = {
  ref: ArchitectureEvolutionPolicyRevisionRef;
  /** Immutable revision aggregate: installed once -> revision 1. */
  revision: 1;
  schemaVersion: 1;
  policyId: string;
  contentRevision: number;
  content: ArchitectureEvolutionPolicyContentV1;
  contentDigest: string;
  installedAt: string;
};

export type ProjectArchitectureEvolutionPolicyActiveRef = {
  aggregateType: "ProjectArchitectureEvolutionPolicyActive";
  projectId: string;
};

export type ProjectArchitectureEvolutionPolicyActiveSnapshot = {
  ref: ProjectArchitectureEvolutionPolicyActiveRef;
  projectId: string;
  activeRevision: ArchitectureEvolutionPolicyRevisionRef;
  revision: number;
};

// ------------------------------------------------------------------------ //
// Digest / fingerprints (deterministic; volatile fields excluded)            //
// ------------------------------------------------------------------------ //

export function architectureEvolutionPolicyContentDigest(
  fixture: VersionedArchitectureEvolutionPolicyFixture,
): string {
  return sha256Hex(canonicalJson({
    schemaVersion: fixture.schemaVersion,
    identity: fixture.identity,
    revision: fixture.revision,
    content: fixture.content,
  }));
}

export function architectureEvolutionPolicyInstallFingerprint(
  command: InstallArchitectureEvolutionPolicyRevisionCommand,
): CommandFingerprint {
  return sha256Hex(canonicalJson({
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    fixture: { identity: command.payload.fixture.identity, revision: command.payload.fixture.revision, contentDigest: command.payload.contentDigest },
  })) as CommandFingerprint;
}

export function architectureEvolutionPolicyActivateFingerprint(
  command: ActivateProjectArchitectureEvolutionPolicyCommand,
): CommandFingerprint {
  return sha256Hex(canonicalJson({
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    expectedRevision: command.expectedRevision,
    target: command.payload.target,
  })) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// Commands / receipts                                                        //
// ------------------------------------------------------------------------ //

export type InstallArchitectureEvolutionPolicyRevisionCommand = {
  commandId: string;
  commandType: "InstallArchitectureEvolutionPolicyRevision";
  schemaVersion: 1;
  identity: CommandIdentity;
  correlationId: string;
  submittedAt: string;
  payload: {
    fixture: VersionedArchitectureEvolutionPolicyFixture;
    /** Must equal architectureEvolutionPolicyContentDigest(fixture). */
    contentDigest: string;
  };
};

export type ActivateProjectArchitectureEvolutionPolicyCommand = {
  commandId: string;
  commandType: "ActivateProjectArchitectureEvolutionPolicy";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** projectId — the local id of the per-kind active aggregate. */
  aggregateId: string;
  /** CAS window: the Project aggregate revision observed by the caller. */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: { target: ArchitectureEvolutionPolicyPin };
};

export type ArchitectureEvolutionPolicyInstallReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; revisionRef: ArchitectureEvolutionPolicyRevisionRef; contentDigest: string; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };

export type ArchitectureEvolutionPolicyActivateReceipt =
  | { status: "committed"; commandId: string; replayed: boolean; activeRef: ProjectArchitectureEvolutionPolicyActiveRef; activeRevision: ArchitectureEvolutionPolicyRevisionRef; eventIds: string[]; commitCursor: CommitCursor }
  | { status: "rejected"; commandId: string; code: "invalid" | "not_found" | "digest_mismatch" | "revision_conflict" | "idempotency_conflict" | "unavailable" };

// ------------------------------------------------------------------------ //
// Events                                                                    //
// ------------------------------------------------------------------------ //

export type ArchitectureEvolutionPolicyInstalledEvent = {
  eventId: string;
  eventType: "ArchitectureEvolutionPolicyInstalled";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string; // "" (project-scoped) — mirrors P1-02 install events
  aggregateType: "ArchitectureEvolutionPolicyRevision";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: import("./command-event.js").ActorRef;
  occurredAt: string;
  payload: { revision: ArchitectureEvolutionPolicyRevisionSnapshot };
};

export type ArchitectureEvolutionPolicyActivatedEvent = {
  eventId: string;
  eventType: "ArchitectureEvolutionPolicyActivated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "ProjectArchitectureEvolutionPolicyActive";
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: import("./command-event.js").ActorRef;
  occurredAt: string;
  payload: { activeRef: ProjectArchitectureEvolutionPolicyActiveRef; activeRevision: ArchitectureEvolutionPolicyRevisionRef };
};

// ------------------------------------------------------------------------ //
// Resolution (canonical only; no default / no built-in allowlist)            //
// ------------------------------------------------------------------------ //

export type ArchitectureEvolutionPolicyResolution =
  | { status: "found"; pin: ArchitectureEvolutionPolicyPin; snapshot: ArchitectureEvolutionPolicyRevisionSnapshot }
  | { status: "not_found" };

export type ProjectArchitectureEvolutionPolicyActiveResolution =
  | { status: "found"; snapshot: ProjectArchitectureEvolutionPolicyActiveSnapshot }
  | { status: "not_found" };

function isEvolutionPolicySnapshot(result: SnapshotResult): result is { status: "found"; snapshot: ArchitectureEvolutionPolicyRevisionSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "ArchitectureEvolutionPolicyRevision";
}

function isActiveEvolutionPolicySnapshot(result: SnapshotResult): result is { status: "found"; snapshot: ProjectArchitectureEvolutionPolicyActiveSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "ProjectArchitectureEvolutionPolicyActive";
}

/** Triple-match resolution of an installed ArchitectureEvolutionPolicy revision. */
export async function resolveArchitectureEvolutionPolicyRevision(ledger: StateLedger, ref: ArchitectureEvolutionPolicyRevisionRef, digest: string): Promise<ArchitectureEvolutionPolicyResolution> {
  const result = await ledger.load(ref);
  if (!isEvolutionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (snapshot.ref.projectId !== ref.projectId || snapshot.policyId !== ref.policyId || snapshot.contentRevision !== ref.revision || snapshot.contentDigest !== digest) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}

/** Project active-ref resolution — exact triple match, never a fallback. */
export async function resolveProjectArchitectureEvolutionPolicy(ledger: StateLedger, projectId: string): Promise<ArchitectureEvolutionPolicyResolution> {
  const activeRef: ProjectArchitectureEvolutionPolicyActiveRef = { aggregateType: "ProjectArchitectureEvolutionPolicyActive", projectId };
  const activeResult = await ledger.load(activeRef);
  if (!isActiveEvolutionPolicySnapshot(activeResult)) return { status: "not_found" };
  const active = activeResult.snapshot;
  const pin: ArchitectureEvolutionPolicyPin = { ref: active.activeRevision, digest: "" };
  // Load the revision snapshot to obtain the stored digest (triple match).
  const revResult = await ledger.load(active.activeRevision);
  if (!isEvolutionPolicySnapshot(revResult)) return { status: "not_found" };
  const rev = revResult.snapshot;
  if (rev.ref.projectId !== projectId || rev.policyId !== active.activeRevision.policyId || rev.contentRevision !== active.activeRevision.revision) return { status: "not_found" };
  pin.digest = rev.contentDigest;
  return { status: "found", pin, snapshot: rev };
}

// ------------------------------------------------------------------------ //
// Allowlist decision (PURE): local + deterministic + reversible + allowlist + drift
// ------------------------------------------------------------------------ //

export type EvolutionPolicyDecisionContext = {
  policyRevision: number;
  remediationCountThisCycle: number;
  pipelineWorkspaceRevision: number;
};

export type EvolutionPolicyDecision = {
  allowed: boolean;
  reasons: string[];
};

export function evolutionPolicyDecision(
  finding: ArchitectureFindingV1,
  content: ArchitectureEvolutionPolicyContentV1,
  ctx: EvolutionPolicyDecisionContext,
): EvolutionPolicyDecision {
  const reasons: string[] = [];
  if (finding.material || finding.ambiguous) {
    reasons.push("material_or_ambiguous_finding_requires_decision_brief");
    return { allowed: false, reasons };
  }
  if (finding.deltaRef === null) {
    reasons.push("finding_has_no_delta_ref_report_only");
    return { allowed: false, reasons };
  }
  if (content.driftBudget.maxRemediationsPerCycle <= 0 || ctx.remediationCountThisCycle >= content.driftBudget.maxRemediationsPerCycle) {
    reasons.push("drift_budget_exhausted");
    return { allowed: false, reasons };
  }
  const entry = content.allowlist.find((e) => e.findingCategory === finding.category);
  if (entry === undefined) {
    reasons.push("category_not_in_allowlist");
    return { allowed: false, reasons };
  }
  const rank = { high: 3, medium: 2, low: 1 } as const;
  if (rank[finding.risk] > rank[entry.maxRisk]) {
    reasons.push("risk_exceeds_allowlist_max");
    return { allowed: false, reasons };
  }
  if (entry.reversibility !== "reversible") {
    reasons.push("not_reversible_in_allowlist");
    return { allowed: false, reasons };
  }
  const scopeHit =
    (entry.scope === "module" && finding.affectedRefs.moduleRefs.length > 0) ||
    (entry.scope === "interface" && finding.affectedRefs.interfaceRefs.length > 0) ||
    (entry.scope === "runtime" && finding.affectedRefs.pathRefs.length > 0) ||
    (entry.scope === "governance" && finding.category === "governance");
  if (!scopeHit) {
    reasons.push("scope_not_matched");
    return { allowed: false, reasons };
  }
  return { allowed: true, reasons: [] };
}
