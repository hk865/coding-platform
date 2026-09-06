/**
 * P1-14 VerificationEngine.MigrationGatePort — deterministic migration gate
 * (lane B implementation).
 *
 * FROZEN surface (lane-b field extension): run(input) returns
 *   pass  -> { status, gate } when candidate + current workspace revision agree;
 *   fail  -> { status, gate, reasons } on workspace revision mismatch or a
 *            missing/empty planRef (plan_ref_missing);
 *   stale -> { status, message } when the source/artifact is unavailable or the
 *            source baseline moved (must re-propose from the new active ref);
 *   unsupported -> reserved (not emitted by this lane; survives in the frozen
 *            interface for the integrator).
 *
 * The port is READ-ONLY: never writes the ledger. The recorded gate (and any
 * evidence chain) belongs to Control / the P1-14 integrator.
 *
 * Gate identity + gate evidence are DERIVED DETERMINISTICALLY from
 * { candidateRef, workspaceRevision, planRef } so identical inputs always yield
 * the same gateId and the same placeholder evidenceRef. The real evidence chain
 * is wired by the P1-14 integrator; here it is a stable citation handle.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type {
  CandidateArchitectureBaselineRef,
  CandidateArchitectureBaselineSnapshot,
  MigrationGatePort,
  MigrationGateTaskV1,
} from "../contracts/baseline-evolution.js";
import type { AggregateSnapshot, WorkspaceSnapshot } from "../contracts/ledger.js";
import { canonicalJson, sha256Hex } from "../contracts/fingerprint.js";
import { resolveProjectArchitectureBaseline } from "../contracts/governance.js";

export type MigrationGatePortDeps = {
  ledger: StateLedger;
  now: () => string;
};

export type MigrationGateRunInput = {
  candidateRef: CandidateArchitectureBaselineRef;
  workspaceRevision: number;
  planRef: string;
};

export type MigrationGateRunResult =
  | { status: "pass"; gate: MigrationGateTaskV1 }
  | { status: "fail"; gate: MigrationGateTaskV1; reasons: string[] }
  | { status: "stale"; message: string }
  | { status: "unsupported"; message: string };

/** Deterministic gate nonce over the full gate determination. */
export function migrationGateDigest(input: MigrationGateRunInput): string {
  return sha256Hex(canonicalJson({ candidateRef: input.candidateRef, workspaceRevision: input.workspaceRevision, planRef: input.planRef }));
}

/** Deterministic gate identity: "gate-" + first 16 hex of the gate digest. */
export function migrationGateIdFor(input: MigrationGateRunInput): string {
  return "gate-" + migrationGateDigest(input).slice(0, 16);
}

/** Deterministic placeholder gate-evidence identity: "gate-evidence-" + first 16 hex of the gate digest. */
export function migrationGateEvidenceIdFor(input: MigrationGateRunInput): string {
  return "gate-evidence-" + migrationGateDigest(input).slice(0, 16);
}

function isCandidateSnapshot(s: AggregateSnapshot): s is CandidateArchitectureBaselineSnapshot {
  return s.ref.aggregateType === "CandidateArchitectureBaseline";
}

function isWorkspaceSnapshot(s: AggregateSnapshot): s is WorkspaceSnapshot {
  return s.ref.aggregateType === "Workspace";
}

export class MigrationGatePortImpl implements MigrationGatePort {
  constructor(private readonly deps: MigrationGatePortDeps) {}

  async run(input: MigrationGateRunInput): Promise<MigrationGateRunResult> {
    // -- 0. Pure input shaping (deterministic gate identity/evidence).
    const now = this.deps.now();

    // -- 1. The candidate artifact must exist; a missing candidate is a stale
    //        source/artifact (the gate cannot be run against nothing).
    const candidateResult = await this.deps.ledger.load(input.candidateRef);
    if (candidateResult.status !== "found" || !isCandidateSnapshot(candidateResult.snapshot)) {
      return { status: "stale", message: "candidate not found" };
    }
    const candidateSnap = candidateResult.snapshot;
    const candidate = candidateSnap.candidate;
    const projectId = candidate.projectId;

    const buildGate = (status: MigrationGateTaskV1["status"], evidenceRefs: MigrationGateTaskV1["gateEvidenceRefs"]): MigrationGateTaskV1 => ({
      schemaVersion: 1,
      gateId: migrationGateIdFor(input),
      projectId,
      workspaceId: candidate.workspaceId,
      planRef: input.planRef,
      candidateRef: input.candidateRef,
      workspaceRevision: input.workspaceRevision,
      status,
      gateEvidenceRefs: evidenceRefs,
      createdAt: now,
      updatedAt: now,
    });

    // -- 2. planRef is REQUIRED. Missing/empty => fail (no plan to associate the
    //        change view with); the gate is still recorded as a fail.
    if (typeof input.planRef !== "string" || input.planRef.length === 0) {
      return { status: "fail", gate: buildGate("fail", []), reasons: ["plan_ref_missing"] };
    }

    // -- 3. Chain consistency: candidate.parentSourcePin must EQUAL the project's
    //        CURRENT active baseline pin. If the active baseline is unavailable
    //        (no active revision) or the pin moved, the candidate is STALE.
    const sourceResolve = await resolveProjectArchitectureBaseline(this.deps.ledger, projectId);
    if (
      sourceResolve.status !== "found" ||
      canonicalJson(sourceResolve.pin) !== canonicalJson(candidate.parentSourcePin)
    ) {
      return {
        status: "stale",
        message:
          sourceResolve.status !== "found"
            ? "active baseline unavailable; candidate is stale"
            : "source baseline moved; candidate is stale",
      };
    }

    // -- 4. The required workspace revision must match the candidate's workspace
    //        aggregate revision; otherwise the gate cannot run on that revision.
    const workspaceResult = await this.deps.ledger.load({ aggregateType: "Workspace", projectId, workspaceId: candidate.workspaceId });
    if (workspaceResult.status !== "found" || !isWorkspaceSnapshot(workspaceResult.snapshot)) {
      return { status: "stale", message: "workspace not found" };
    }
    const actualWorkspaceRevision = workspaceResult.snapshot.revision;
    if (input.workspaceRevision !== actualWorkspaceRevision) {
      return { status: "fail", gate: buildGate("fail", []), reasons: ["workspace_revision_mismatch"] };
    }

    // -- 5. All consistent => PASS; emit the deterministic gate evidence handle.
    return {
      status: "pass",
      gate: buildGate("pass", [
        { aggregateType: "Evidence", projectId, evidenceId: migrationGateEvidenceIdFor(input) },
      ]),
    };
  }
}

export function createMigrationGatePort(deps: MigrationGatePortDeps): MigrationGatePortImpl {
  return new MigrationGatePortImpl(deps);
}
