/**
 * P1-13 Control entry: ArchitectureEvolutionPolicy install/activate (third governance
 * kind).
 *
 * ENTRY FILE (shared baseline — exported class signature FROZEN). Lane A fills the
 * implementation. The semantics mirror P1-02 governance-install.ts / governance-activate.ts:
 *
 *   install (schema -> digest -> fold the exact install commit -> ledger.commit -> map):
 *     - schema / structural issues -> "invalid" (ZERO write); digest mismatch ->
 *       "digest_mismatch";
 *     - install NEVER auto-activates; no built-in allowlist; a missing / invalid
 *       fixture is rejected as "invalid", never defaulted;
 *     - immutability (idempotent replay, CAS at revision 0) is decided by
 *       StateLedger.commit and mapped back here.
 *
 *   activate (schema -> exact installed-target resolution -> per-kind active CAS):
 *     - only an INSTALLED exact target ref (identity/revision/digest triple) is
 *       admissible; an absent ref or digest mismatch resolves to "not_found"
 *       (ZERO write);
 *     - CAS: Project@command.expectedRevision + per-kind active aggregate@k
 *       (first activation k=0 -> 1) -> fold -> ledger.commit -> map; a stale
 *       Project revision / active-aggregate movement => revision_conflict,
 *       never moves the active ref.
 *
 * Dependencies: only the frozen contracts (architecture-evolution-policy.js,
 * ledger.js), StateLedger.load/commit via ControlEngineDeps, and the shared
 * resolution helper. The deterministic folds are built inline replicating the
 * shared fixture-fold builders EXACTLY; the lane tests assert fold-equality.
 */
import type {
  ArchitectureEvolutionPolicyActivateReceipt,
  ArchitectureEvolutionPolicyActivatedEvent,
  ArchitectureEvolutionPolicyInstallReceipt,
  ArchitectureEvolutionPolicyInstalledEvent,
  ArchitectureEvolutionPolicyRevisionRef,
  ArchitectureEvolutionPolicyRevisionSnapshot,
  ActivateProjectArchitectureEvolutionPolicyCommand,
  InstallArchitectureEvolutionPolicyRevisionCommand,
  ProjectArchitectureEvolutionPolicyActiveRef,
  ProjectArchitectureEvolutionPolicyActiveSnapshot,
} from "../contracts/architecture-evolution-policy.js";
import {
  ARCHITECTURE_EVOLUTION_POLICY_MAX_ALLOWLIST_ENTRIES,
  ARCHITECTURE_EVOLUTION_POLICY_MAX_DRIFT_BUDGET,
  architectureEvolutionPolicyActivateFingerprint,
  architectureEvolutionPolicyContentDigest,
  architectureEvolutionPolicyInstallFingerprint,
  resolveArchitectureEvolutionPolicyRevision,
} from "../contracts/architecture-evolution-policy.js";
import type {
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  LedgerCommitReceipt,
  ProjectRef,
} from "../contracts/ledger.js";
import type { ControlEngineDeps } from "./control-engine.js";

const FINDING_CATEGORIES = new Set([
  "structure",
  "interface",
  "dependency",
  "performance",
  "permission",
  "runtime",
  "governance",
]);
const SCOPE_KINDS = new Set(["module", "interface", "runtime", "governance"]);
const RISKS = new Set(["high", "medium", "low"]);
const REVERSIBILITIES = new Set(["reversible", "manual_only"]);
const DIGEST_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isSafeNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function onlyKeys(record: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(record).every((k) => set.has(k));
}
function validActor(actor: unknown): boolean {
  if (!isRecord(actor)) return false;
  if (actor["kind"] !== "human" && actor["kind"] !== "system") return false;
  return isNonEmptyString(actor["id"]);
}
function validIdentity(identity: unknown): boolean {
  if (!isRecord(identity)) return false;
  return isNonEmptyString(identity["projectId"]) && validActor(identity["actor"]) && isNonEmptyString(identity["idempotencyKey"]);
}

/** Structural validity of an install command (schema 校验). true = invalid. */
function invalidInstall(command: unknown): boolean {
  if (!isRecord(command)) return true;
  if (command["schemaVersion"] !== 1) return true;
  if (command["commandType"] !== "InstallArchitectureEvolutionPolicyRevision") return true;
  if (!isNonEmptyString(command["commandId"])) return true;
  if (!validIdentity(command["identity"])) return true;
  if (!isNonEmptyString(command["correlationId"])) return true;
  if (!isNonEmptyString(command["submittedAt"])) return true;
  if (!isRecord(command["payload"])) return true;
  const fixture = command["payload"]["fixture"];
  if (!isRecord(fixture)) return true;
  if (!onlyKeys(fixture, ["schemaVersion", "fixtureId", "contentType", "revision", "identity", "content"])) return true;
  if (fixture["schemaVersion"] !== 1) return true;
  if (fixture["contentType"] !== "ArchitectureEvolutionPolicy") return true;
  if (fixture["revision"] !== 1) return true;
  if (!isRecord(fixture["identity"])) return true;
  const fident = fixture["identity"];
  if (fident["kind"] !== "local") return true;
  if (!isNonEmptyString(fident["fixtureId"])) return true;
  if (!onlyKeys(fident, ["kind", "fixtureId", "source"])) return true;
  if (!isRecord(fixture["content"])) return true;
  const content = fixture["content"];
  if (!onlyKeys(content, ["schemaVersion", "allowlist", "driftBudget", "upgrade"])) return true;
  if (content["schemaVersion"] !== 1) return true;
  if (!Array.isArray(content["allowlist"])) return true;
  if (content["allowlist"].length > ARCHITECTURE_EVOLUTION_POLICY_MAX_ALLOWLIST_ENTRIES) return true;
  for (const entry of content["allowlist"]) {
    if (!isRecord(entry)) return true;
    if (!onlyKeys(entry, ["findingCategory", "scope", "maxRisk", "reversibility", "note"])) return true;
    if (!FINDING_CATEGORIES.has(entry["findingCategory"] as string)) return true;
    if (!SCOPE_KINDS.has(entry["scope"] as string)) return true;
    if (!RISKS.has(entry["maxRisk"] as string)) return true;
    if (!REVERSIBILITIES.has(entry["reversibility"] as string)) return true;
    if (!isNonEmptyString(entry["note"])) return true;
  }
  if (!isRecord(content["driftBudget"])) return true;
  const db = content["driftBudget"];
  if (!onlyKeys(db, ["maxRemediationsPerCycle"])) return true;
  if (typeof db["maxRemediationsPerCycle"] !== "number" || !Number.isSafeInteger(db["maxRemediationsPerCycle"]) || db["maxRemediationsPerCycle"] < 0) return true;
  if (db["maxRemediationsPerCycle"] > ARCHITECTURE_EVOLUTION_POLICY_MAX_DRIFT_BUDGET) return true;
  if (!isRecord(content["upgrade"])) return true;
  if (content["upgrade"]["path"] !== "manual-decision" && content["upgrade"]["path"] !== "proposal") return true;
  if (!isNonEmptyString(content["upgrade"]["note"])) return true;
  return false;
}

/** Structural validity of an activate command. true = invalid. */
function invalidActivate(command: unknown): boolean {
  if (!isRecord(command)) return true;
  if (command["schemaVersion"] !== 1) return true;
  if (command["commandType"] !== "ActivateProjectArchitectureEvolutionPolicy") return true;
  if (!isNonEmptyString(command["commandId"])) return true;
  if (!validIdentity(command["identity"])) return true;
  if (!isNonEmptyString(command["aggregateId"])) return true;
  if (!isSafeNonNegInt(command["expectedRevision"])) return true;
  if (!isNonEmptyString(command["correlationId"])) return true;
  if (!isNonEmptyString(command["submittedAt"])) return true;
  if (!isRecord(command["payload"])) return true;
  const target = command["payload"]["target"];
  if (!isRecord(target)) return true;
  if (!onlyKeys(target, ["ref", "contentDigest"])) return true;
  if (!isRecord(target["ref"])) return true;
  const ref = target["ref"];
  if (!onlyKeys(ref, ["aggregateType", "projectId", "policyId", "revision"])) return true;
  if (ref["aggregateType"] !== "ArchitectureEvolutionPolicyRevision") return true;
  if (!isNonEmptyString(ref["projectId"])) return true;
  if (!isNonEmptyString(ref["policyId"])) return true;
  if (!isPositiveInt(ref["revision"])) return true;
  if (typeof target["contentDigest"] !== "string" || !DIGEST_RE.test(target["contentDigest"])) return true;
  return false;
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
// Mapping: ledger receipt -> P1-13 receipts                                  //
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
    // 1) schema: structural issues are an invalid command (ZERO write).
    if (invalidInstall(command)) {
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
    // 1) schema: structural issues are an invalid command (ZERO write).
    if (invalidActivate(command)) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // 2) exact installed-target resolution (pre-CAS, ZERO write). Only an
    //    INSTALLED revision whose identity/revision/digest triple matches is
    //    admissible; an absent ref or digest mismatch collapses to not_found.
    const target = command.payload.target;
    const resolved = await resolveArchitectureEvolutionPolicyRevision(this.deps.ledger, target.ref, target.contentDigest);
    if (resolved.status !== "found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
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
