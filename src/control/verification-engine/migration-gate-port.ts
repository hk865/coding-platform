/**
 * VerificationEngine.MigrationGatePort — source guards for migration checking.
 *
 * FROZEN surface (lane-b field extension): run(input) returns
 *   unsupported -> source guards passed, but no actual migration check/evidence
 *                  provider has been configured;
 *   fail  -> { status, gate, reasons } on workspace revision mismatch or a
 *            missing/empty planRef (plan_ref_missing);
 *   stale -> { status, message } when the source/artifact is unavailable or the
 *            source baseline moved (must re-propose from the new active ref);
 *
 * The port is READ-ONLY: never writes the ledger. The recorded gate (and any
 * evidence chain) belongs to Control / the P1-14 integrator.
 *
 * Matching source versions proves applicability only. It must never fabricate
 * PASS or an Evidence reference. Historical identity helpers remain compatible.
 */
import type { VerificationMigrationContextPort } from "../../contracts/verification-context.js";
import type {
  CandidateArchitectureBaselineRef,
  MigrationGatePort,
  MigrationGateTaskV1,
} from "../../contracts/baseline-evolution.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";

export type MigrationGatePortDeps = {
  context: VerificationMigrationContextPort;
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

/** Legacy identity only; this function does not create or prove Evidence. */
export function migrationGateEvidenceIdFor(input: MigrationGateRunInput): string {
  return "gate-evidence-" + migrationGateDigest(input).slice(0, 16);
}

export class MigrationGatePortImpl implements MigrationGatePort {
  constructor(private readonly deps: MigrationGatePortDeps) {}

  async run(input: MigrationGateRunInput): Promise<MigrationGateRunResult> {
    // -- 0. Pure input shaping (deterministic gate identity/evidence).
    const now = this.deps.now();

    // -- 1. The candidate artifact must exist; a missing candidate is a stale
    //        source/artifact (the gate cannot be run against nothing).
    const candidate = await this.deps.context.migrationCandidate(input.candidateRef);
    if (!candidate) {
      return { status: "stale", message: "candidate not found" };
    }
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
    const material = await this.deps.context.migrationBasis(candidate);
    if (
      material.activeSourcePin === null ||
      canonicalJson(material.activeSourcePin) !== canonicalJson(candidate.parentSourcePin)
    ) {
      return {
        status: "stale",
        message:
          material.activeSourcePin === null
            ? "active baseline unavailable; candidate is stale"
            : "source baseline moved; candidate is stale",
      };
    }

    // -- 4. The required workspace revision must match the candidate's workspace
    //        aggregate revision; otherwise the gate cannot run on that revision.
    if (material.workspaceRevision === null) {
      return { status: "stale", message: "workspace not found" };
    }
    const actualWorkspaceRevision = material.workspaceRevision;
    if (input.workspaceRevision !== actualWorkspaceRevision) {
      return { status: "fail", gate: buildGate("fail", []), reasons: ["workspace_revision_mismatch"] };
    }

    return { status: 'unsupported', message: 'Migration sources are current, but no actual migration check or recorded Evidence provider is configured.' };
  }
}

export function createMigrationGatePort(deps: MigrationGatePortDeps): MigrationGatePortImpl {
  return new MigrationGatePortImpl(deps);
}
