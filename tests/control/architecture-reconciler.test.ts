/**
 * P1-12 lane A unit tests — ArchitectureReconcilerImpl.inspect.
 *
 * Drives the reconciler with a ScriptedControlEngine (records the P1-12
 * command calls) + FakeWorkspaceReaderAdapter + ScriptedStateLedger, over
 * the deterministic P1-12 fixture scenario. Covers:
 *   - mechanic source -> recorded inspection + delta-backed finding;
 *   - report source -> recorded inspection + finding with deltaRef null;
 *   - validation / unresolved pin / bad digest -> fail_closed, zero writes;
 *   - raw Delta determinism; candidate proposal digest determinism;
 *   - zero baseline side effects (no install/activate, no baseline commit).
 */
import { describe, expect, it } from "vitest";
import { ArchitectureReconcilerImpl } from "../../src/control/architecture-reconciler.js";
import { ScriptedControlEngine } from "../../src/contracts/testing/control.double.js";
import { ScriptedStateLedger } from "../../src/contracts/testing/state-ledger.double.js";
import { FakeWorkspaceReaderAdapter } from "../../src/data/workspace-reader-adapter.js";
import { CodeGraphPortImpl } from "../../src/verification/code-graph-port.js";
import { createArtifactVault } from "../../src/vault/artifact-vault.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  architectureFindingRefFor,
  architectureDecisionBriefRefFor,
  architectureCandidateProposalRefFor,
  architectureInspectionRefFor,
  computeArchitectureDelta,
  candidateProposalDigest,
} from "../../src/contracts/architecture-inspection.js";
import {
  buildP112InspectionIntent,
  buildP112BaselineGraph,
  buildP112CurrentGraph,
  buildP112Proposal,
  P112_PROJECT,
  P112_WORKSPACE,
  P112_INSPECTION,
  P112_INSPECTION_REPORT,
  P112_FINDING_DELTA,
  P112_FINDING_REPORT,
} from "../../src/contracts/fixtures/architecture-fixtures.js";
import type { ArchitectureInspectionIntentV1 } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselineRevisionRef, ArchitectureBaselineRevisionSnapshot } from "../../src/contracts/governance.js";
import type { StateLedger } from "../../src/contracts/ledger.js";
import type { ControlEngine } from "../../src/contracts/modules.js";
import type { WorkspaceReadPort } from "../../src/contracts/workspace-read.js";

const NOW = "2026-09-06T00:00:00.000Z";

function committedControl(): ScriptedControlEngine {
  return new ScriptedControlEngine({
    recordArchitectureInspection: (cmd) => ({ status: "committed", commandId: cmd.commandId, replayed: false, inspectionRef: cmd.payload.inspection.ref, eventIds: ["evt-insp"], commitCursor: makeCommitCursor(1) }),
    recordArchitectureFinding: (cmd) => ({ status: "committed", commandId: cmd.commandId, replayed: false, findingRef: architectureFindingRefFor(cmd.payload.finding.projectId, cmd.payload.finding.workspaceId, cmd.payload.finding.findingId), eventIds: ["evt-find"], commitCursor: makeCommitCursor(1) }),
    recordArchitectureDecisionBrief: (cmd) => ({ status: "committed", commandId: cmd.commandId, replayed: false, briefRef: architectureDecisionBriefRefFor(cmd.payload.brief.projectId, cmd.payload.brief.workspaceId, cmd.payload.brief.briefId), eventIds: ["evt-brief"], commitCursor: makeCommitCursor(1) }),
    recordCandidateBaselineProposal: (cmd) => ({ status: "committed", commandId: cmd.commandId, replayed: false, proposalRef: architectureCandidateProposalRefFor(cmd.payload.proposal.projectId, cmd.payload.proposal.workspaceId, cmd.payload.proposal.proposalId), eventIds: ["evt-proposal"], commitCursor: makeCommitCursor(1) }),
  });
}

function loadingLedger(intent: ArchitectureInspectionIntentV1, contentDigest?: string): ScriptedStateLedger {
  return new ScriptedStateLedger({
    load: (ref) => ({
      status: "found",
      snapshot: {
        ref: ref as ArchitectureBaselineRevisionRef,
        revision: 1,
        schemaVersion: 1,
        baselineId: (ref as ArchitectureBaselineRevisionRef).baselineId,
        contentRevision: 1,
        contentDigest: contentDigest ?? intent.baselinePin.digest,
        content: { schemaVersion: 1, description: "P1-12 fixture baseline", constraints: [] },
      } as ArchitectureBaselineRevisionSnapshot,
    }),
  });
}

function notFoundLedger(): ScriptedStateLedger {
  return new ScriptedStateLedger({ load: (ref) => ({ status: "not_found", ref }) });
}

type ReconcilerFixture = {
  reconciler: ArchitectureReconcilerImpl;
  control: ScriptedControlEngine;
  ledger: ScriptedStateLedger;
};

function makeReconciler(opts: {
  intent: ArchitectureInspectionIntentV1;
  ledger?: ScriptedStateLedger;
  control?: ScriptedControlEngine;
  reader?: WorkspaceReadPort;
}): ReconcilerFixture {
  const control = opts.control ?? committedControl();
  const ledger = opts.ledger ?? loadingLedger(opts.intent);
  const reader = opts.reader ?? new FakeWorkspaceReaderAdapter({ now: () => NOW });
  const reconciler = new ArchitectureReconcilerImpl({
    ledger,
    vault: createArtifactVault(),
    control,
    workspaceReader: reader,
    codeGraph: new CodeGraphPortImpl(),
    now: () => NOW,
    eventId: () => "evt-reconciler",
  });
  return { reconciler, control, ledger };
}

describe("ArchitectureReconcilerImpl.inspect", () => {
  it("mechanic source records an inspection + delta-backed finding (fixture delta finding is not material/ambiguous)", async () => {
    const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
    const fixture = makeReconciler({ intent });
    const res = await fixture.reconciler.inspect(intent);
    expect(res.status).toBe("recorded");
    if (res.status !== "recorded") return;
    expect(res.outcome.status).toBe("recorded");
    if (res.outcome.status !== "recorded") return;
    expect(res.outcome.findingCount).toBe(1);
    expect(res.outcome.inspectionRef).toEqual(architectureInspectionRefFor(P112_PROJECT, P112_WORKSPACE, P112_INSPECTION));
    expect(fixture.control.recordArchitectureInspectionCalls).toHaveLength(1);
    expect(fixture.control.recordArchitectureFindingCalls).toHaveLength(1);
    const finding = fixture.control.recordArchitectureFindingCalls[0]!.payload.finding;
    expect(finding.findingId).toBe(P112_FINDING_DELTA);
    expect(finding.source).toBe("workspace_delta");
    expect(finding.deltaRef).not.toBeNull();
    expect(finding.category).toBe("structure");
    expect(fixture.control.recordArchitectureDecisionBriefCalls).toHaveLength(0);
    expect(fixture.control.recordCandidateBaselineProposalCalls).toHaveLength(0);
  });

  it("report source records an inspection + finding with deltaRef null + DecisionBrief, no proposal", async () => {
    const intent = buildP112InspectionIntent({
      inspectionId: P112_INSPECTION_REPORT,
      source: "report",
      reportInput: {
        description: "上报的数据/查询模块接口职责冲突",
        category: "interface",
        risk: "high",
        affectedRefs: { moduleRefs: ["src/data"], interfaceRefs: ["src/data/maps"], pathRefs: [] },
      },
    });
    const fixture = makeReconciler({ intent });
    const res = await fixture.reconciler.inspect(intent);
    expect(res.status).toBe("recorded");
    if (res.status !== "recorded") return;
    expect(res.outcome.status).toBe("recorded");
    if (res.outcome.status !== "recorded") return;
    expect(res.outcome.findingCount).toBe(1);
    expect(res.outcome.inspectionRef).toEqual(architectureInspectionRefFor(P112_PROJECT, P112_WORKSPACE, P112_INSPECTION_REPORT));
    expect(fixture.control.recordArchitectureInspectionCalls).toHaveLength(1);
    expect(fixture.control.recordArchitectureInspectionCalls[0]!.payload.inspection.deltaRef).toBeNull();
    expect(fixture.control.recordArchitectureFindingCalls).toHaveLength(1);
    const finding = fixture.control.recordArchitectureFindingCalls[0]!.payload.finding;
    expect(finding.findingId).toBe(P112_FINDING_REPORT);
    expect(finding.source).toBe("interface_report");
    expect(finding.deltaRef).toBeNull();
    expect(fixture.control.recordArchitectureDecisionBriefCalls).toHaveLength(1);
    expect(fixture.control.recordCandidateBaselineProposalCalls).toHaveLength(0);
  });

  it("fail-closes on an invalid intent (empty baseline digest) without any write", async () => {
    const intent = buildP112InspectionIntent({
      inspectionId: "insp-bad-pin",
      baselinePin: { ref: { aggregateType: "ArchitectureBaselineRevision", projectId: P112_PROJECT, baselineId: "base", revision: 1 }, digest: "" },
    });
    const fixture = makeReconciler({ intent });
    const res = await fixture.reconciler.inspect(intent);
    expect(res.status).toBe("fail_closed");
    if (res.status !== "fail_closed") return;
    expect(res.code).toBe("plan_pin_missing");
    expect(res.diagnostics.length).toBeGreaterThan(0);
    expect(fixture.control.recordArchitectureInspectionCalls).toHaveLength(0);
    expect(fixture.control.recordArchitectureFindingCalls).toHaveLength(0);
  });

  it("fail-closes with baseline_unresolved when the pinned baseline is not in the ledger", async () => {
    const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
    const fixture = makeReconciler({ intent, ledger: notFoundLedger() });
    const res = await fixture.reconciler.inspect(intent);
    expect(res.status).toBe("fail_closed");
    if (res.status !== "fail_closed") return;
    expect(res.code).toBe("baseline_unresolved");
    expect(fixture.control.recordArchitectureFindingCalls).toHaveLength(0);
  });

  it("fail-closes with baseline_digest_mismatch when the ledger digest does not match the pin", async () => {
    const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
    const fixture = makeReconciler({ intent, ledger: loadingLedger(intent, "not-the-pin-digest") });
    const res = await fixture.reconciler.inspect(intent);
    expect(res.status).toBe("fail_closed");
    if (res.status !== "fail_closed") return;
    expect(res.code).toBe("baseline_digest_mismatch");
    expect(fixture.control.recordArchitectureFindingCalls).toHaveLength(0);
  });

  it("produces the same raw Delta for identical baseline/current graph inputs (determinism)", () => {
    const base = buildP112BaselineGraph();
    const current = buildP112CurrentGraph();
    const a = computeArchitectureDelta(base, current);
    const b = computeArchitectureDelta(base, current);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.noVerdict).toBe(true);
    expect(a.changes.map((c) => c.structuralKey)).toContain("module:src/query");
  });

  it("derives a deterministic candidate proposal digest", () => {
    const proposal = buildP112Proposal();
    expect(candidateProposalDigest(proposal)).toBe(proposal.proposalDigest);
    expect(candidateProposalDigest(buildP112Proposal())).toBe(proposal.proposalDigest);
    expect(proposal.proposalDigest.length).toBe(64);
  });

  it("records inspection/finding with zero baseline side effects (no install/activate, no commit)", async () => {
    const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
    const fixture = makeReconciler({ intent });
    await fixture.reconciler.inspect(intent);
    expect(fixture.control.installCalls).toHaveLength(0);
    expect(fixture.control.activateCalls).toHaveLength(0);
    expect(fixture.ledger.commits).toHaveLength(0);
    expect(fixture.ledger.loads).toHaveLength(1);
    expect(fixture.ledger.loads[0]).toEqual(intent.baselinePin.ref);
  });
});
