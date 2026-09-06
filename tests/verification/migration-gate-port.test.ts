/**
 * P1-14 lane B unit tests — MigrationGatePortImpl.run (VerificationEngine
 * seam). Covers the frozen verdict branches:
 *   - pass: candidate present + source consistent + workspace revision matches;
 *   - fail: workspace_revision_mismatch;
 *   - fail: plan_ref_missing;
 *   - stale: candidate not found / source baseline moved / workspace missing.
 */
import { describe, expect, it } from "vitest";
import {
  MigrationGatePortImpl,
  migrationGateIdFor,
  migrationGateEvidenceIdFor,
} from "../../src/verification/migration-gate-port.js";
import type { CandidateArchitectureBaselineSnapshot } from "../../src/contracts/baseline-evolution.js";
import { ScriptedStateLedger } from "../../src/contracts/testing/state-ledger.double.js";
import type { AggregateRef, AggregateSnapshot, SnapshotResult, WorkspaceSnapshot } from "../../src/contracts/ledger.js";
import type {
  ArchitectureBaselinePin,
  ArchitectureBaselineRevisionSnapshot,
  ProjectArchitectureBaselineActiveSnapshot,
} from "../../src/contracts/governance.js";
import { buildP112Proposal } from "../../src/contracts/fixtures/architecture-fixtures.js";
import { buildP114Candidate, p114CandidateRef, P114_PROJECT, P114_WORKSPACE, P114_SCHEMA } from "../../src/contracts/fixtures/baseline-evolution-fixtures.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";

const NOW = "2026-09-06T00:00:00.000Z";
const PLAN = "plan-mvp-1";
const WORKSPACE_REVISION = 2;

function seededLedger(snapshots: AggregateSnapshot[]): ScriptedStateLedger {
  return new ScriptedStateLedger({
    load: async (ref: AggregateRef): Promise<SnapshotResult> => {
      for (const s of snapshots) {
        if (canonicalJson(s.ref) === canonicalJson(ref)) return { status: "found", snapshot: s };
      }
      return { status: "not_found", ref };
    },
  });
}

function workspaceSnap(revision: number = WORKSPACE_REVISION): WorkspaceSnapshot {
  return { ref: { aggregateType: "Workspace", projectId: P114_PROJECT, workspaceId: P114_WORKSPACE }, revision };
}

function activeBaselineSnapshots(activePin: ArchitectureBaselinePin): AggregateSnapshot[] {
  const baselineRevSnap: ArchitectureBaselineRevisionSnapshot = {
    ref: activePin.ref,
    revision: 1,
    schemaVersion: 1,
    baselineId: activePin.ref.baselineId,
    contentRevision: activePin.ref.revision,
    contentDigest: activePin.digest,
    content: { schemaVersion: 1, description: "baseline", constraints: [] },
  };
  const activeSnap: ProjectArchitectureBaselineActiveSnapshot = {
    ref: { aggregateType: "ProjectArchitectureBaselineActive", projectId: P114_PROJECT },
    projectId: P114_PROJECT,
    activeRevision: activePin.ref,
    revision: 1,
  };
  return [baselineRevSnap, activeSnap];
}

const proposal = buildP112Proposal();
const candidate = buildP114Candidate(proposal);
const candidateSnap: CandidateArchitectureBaselineSnapshot = {
  ref: p114CandidateRef(P114_PROJECT),
  revision: 1,
  schemaVersion: 1,
  candidate,
  materializedAt: P114_SCHEMA,
};
const sourcePin = candidate.parentSourcePin;

function makePort(extra: AggregateSnapshot[] = []): MigrationGatePortImpl {
  const state: AggregateSnapshot[] = [
    candidateSnap,
    workspaceSnap(),
    ...activeBaselineSnapshots(sourcePin),
    ...extra,
  ];
  return new MigrationGatePortImpl({ ledger: seededLedger(state), now: () => NOW });
}

function input(overrides: { workspaceRevision?: number; planRef?: string } = {}) {
  return {
    candidateRef: p114CandidateRef(P114_PROJECT),
    workspaceRevision: overrides.workspaceRevision ?? WORKSPACE_REVISION,
    planRef: overrides.planRef ?? PLAN,
  };
}

describe("MigrationGatePortImpl.run", () => {
  it("passes when candidate + source + workspace revision are consistent", async () => {
    const port = makePort();
    const res = await port.run(input());
    expect(res.status).toBe("pass");
    if (res.status !== "pass") return;
    expect(res.gate.schemaVersion).toBe(1);
    expect(res.gate.gateId).toBe(migrationGateIdFor(input()));
    expect(res.gate.projectId).toBe(P114_PROJECT);
    expect(res.gate.workspaceId).toBe(P114_WORKSPACE);
    expect(res.gate.planRef).toBe(PLAN);
    expect(res.gate.candidateRef).toEqual(p114CandidateRef(P114_PROJECT));
    expect(res.gate.workspaceRevision).toBe(WORKSPACE_REVISION);
    expect(res.gate.status).toBe("pass");
    expect(res.gate.createdAt).toBe(NOW);
    expect(res.gate.updatedAt).toBe(NOW);
    // deterministic single gate-evidence handle
    expect(res.gate.gateEvidenceRefs).toHaveLength(1);
    expect(res.gate.gateEvidenceRefs[0]).toEqual({
      aggregateType: "Evidence",
      projectId: P114_PROJECT,
      evidenceId: migrationGateEvidenceIdFor(input()),
    });
  });

  it("fails with workspace_revision_mismatch when the required revision is stale", async () => {
    const port = makePort();
    const res = await port.run(input({ workspaceRevision: 3 }));
    expect(res.status).toBe("fail");
    if (res.status !== "fail") return;
    expect(res.reasons).toEqual(["workspace_revision_mismatch"]);
    expect(res.gate.status).toBe("fail");
    expect(res.gate.workspaceRevision).toBe(3);
    // a fail gate has no derived evidence
    expect(res.gate.gateEvidenceRefs).toEqual([]);
  });

  it("fails with plan_ref_missing when planRef is empty", async () => {
    const port = makePort();
    const res = await port.run(input({ planRef: "" }));
    expect(res.status).toBe("fail");
    if (res.status !== "fail") return;
    expect(res.reasons).toEqual(["plan_ref_missing"]);
    expect(res.gate.status).toBe("fail");
  });

  it("reports stale when the candidate does not exist", async () => {
    const port = makePort();
    const res = await port.run({ ...input(), candidateRef: { aggregateType: "CandidateArchitectureBaseline", projectId: P114_PROJECT, workspaceId: P114_WORKSPACE, candidateId: "candidate-absent" } });
    expect(res.status).toBe("stale");
    if (res.status !== "stale") return;
    expect(res.message).toBe("candidate not found");
  });

  it("reports stale when the source baseline moved", async () => {
    const movedPin: ArchitectureBaselinePin = {
      ref: { aggregateType: "ArchitectureBaselineRevision", projectId: P114_PROJECT, baselineId: "baseline-architecture-mvp", revision: 2 },
      digest: "moved-baseline-digest",
    };
    // only the MOVED active baseline is installed (the candidate's source pin is
    // no longer the current active pin).
    const state: AggregateSnapshot[] = [candidateSnap, workspaceSnap(), ...activeBaselineSnapshots(movedPin)];
    const port = new MigrationGatePortImpl({ ledger: seededLedger(state), now: () => NOW });
    const res = await port.run(input());
    expect(res.status).toBe("stale");
    if (res.status !== "stale") return;
    expect(res.message).toBe("source baseline moved; candidate is stale");
  });

  it("reports stale when the active baseline aggregate is unavailable", async () => {
    // no active baseline snapshots => resolveProjectArchitectureBaseline not_found
    const state: AggregateSnapshot[] = [candidateSnap, workspaceSnap()];
    const port = new MigrationGatePortImpl({ ledger: seededLedger(state), now: () => NOW });
    const res = await port.run(input());
    expect(res.status).toBe("stale");
    if (res.status !== "stale") return;
    expect(res.message).toBe("active baseline unavailable; candidate is stale");
  });

  it("reports stale when the candidate workspace is missing", async () => {
    const state: AggregateSnapshot[] = [candidateSnap, ...activeBaselineSnapshots(sourcePin)];
    const port = new MigrationGatePortImpl({ ledger: seededLedger(state), now: () => NOW });
    const res = await port.run(input());
    expect(res.status).toBe("stale");
    if (res.status !== "stale") return;
    expect(res.message).toBe("workspace not found");
  });
});
