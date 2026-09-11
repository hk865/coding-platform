/**
 * Shared P1-12 contract-suite harness: deterministic architecture inspection
 * scenario over the P1-08/P1-02 world + helpers, used by BOTH adapter suites
 * (InMemory + SQLite, same fixtures) and by the restart path.
 *
 * The helper surface below is FROZEN by the shared baseline: lane A fills the
 * inspect pipeline (workspace reader + reconciler + code-graph port), lane B
 * fills the record commands + projection; the helpers call frozen signatures.
 */
import { expect } from "vitest";
import type { P1_16HarnessLike, P1_16TestHarness } from "./p1-16-harness.js";
import { toP1_16Harness } from "./p1-16-harness.js";
import { runP108TwoProjectScenario, prepareP108Scenario, type P108ProjectPreview } from "./p1-08-harness.js";
import type { ArchitectureInspectionViewQuery, ArchitectureInspectionViewResult, RecordArchitectureInspectionCommand, RecordArchitectureInspectionReceipt, RecordArchitectureFindingCommand, RecordArchitectureFindingReceipt, RecordArchitectureDecisionBriefCommand, RecordArchitectureDecisionBriefReceipt, RecordCandidateBaselineProposalCommand, RecordCandidateBaselineProposalReceipt, ArchitectureInspectionIntentV1 } from "../../src/contracts/architecture-inspection.js";
import type { InspectResultV1, CodeGraphQueryV1, CodeGraphResultV1 } from "../../src/contracts/architecture-reconciler.js";
import type { CodeGraphReadQueryV1, CodeGraphReadResultV1 } from "../../src/contracts/workspace-read.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import {
  P112_PROJECT,
  P112_WORKSPACE,
  P112_INSPECTION,
  P112_INSPECTION_REPORT,
  P112_FINDING_DELTA,
  P112_FINDING_REPORT,
  P112_BRIEF,
  P112_PROPOSAL,
  p112BaselinePin,
  p112PlanRef,
  buildP112InspectionIntent,
  buildP112InspectionSnapshot,
  buildP112DeltaFinding,
  buildP112ReportFinding,
  buildP112Brief,
  buildP112Proposal,
  buildRecordArchitectureInspectionCommand,
  buildRecordArchitectureFindingCommand,
  buildRecordArchitectureDecisionBriefCommand,
  buildRecordCandidateBaselineProposalCommand,
  buildP112CurrentGraph,
  buildP112BaselineGraph,
} from "../../src/fixtures/architecture-fixtures.js";
import { computeArchitectureDelta } from "../../src/control/architecture-reconciler/architecture-delta.js";
import { architectureFindingRefFor } from "../../src/contracts/architecture-inspection.js";

export interface P1_12TestHarness extends P1_16TestHarness {
  architectureInspectionView(query: ArchitectureInspectionViewQuery): Promise<ArchitectureInspectionViewResult>;
  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt>;
  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt>;
  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt>;
  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt>;
  workspaceRead(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1>;
  codeGraphQuery(query: CodeGraphQueryV1): Promise<CodeGraphResultV1>;
  inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1>;
}

export type P1_12HarnessLike = P1_16HarnessLike & {
  architectureInspectionView: (query: ArchitectureInspectionViewQuery) => Promise<ArchitectureInspectionViewResult>;
  recordArchitectureInspection: (command: RecordArchitectureInspectionCommand) => Promise<RecordArchitectureInspectionReceipt>;
  recordArchitectureFinding: (command: RecordArchitectureFindingCommand) => Promise<RecordArchitectureFindingReceipt>;
  recordArchitectureDecisionBrief: (command: RecordArchitectureDecisionBriefCommand) => Promise<RecordArchitectureDecisionBriefReceipt>;
  recordCandidateBaselineProposal: (command: RecordCandidateBaselineProposalCommand) => Promise<RecordCandidateBaselineProposalReceipt>;
  workspaceRead: (query: CodeGraphReadQueryV1) => Promise<CodeGraphReadResultV1>;
  codeGraphQuery: (query: CodeGraphQueryV1) => Promise<CodeGraphResultV1>;
  inspect: (intent: ArchitectureInspectionIntentV1) => Promise<InspectResultV1>;
};

export function toP1_12Harness(h: P1_12HarnessLike): P1_12TestHarness {
  return h as unknown as P1_12TestHarness;
}

export async function p112Advance(h: P1_12HarnessLike): Promise<void> {
  await h.advanceProjection();
}

export type P112InspectionScenarioResult = {
  preview: P108ProjectPreview;
  currentGraph: ReturnType<typeof buildP112CurrentGraph>;
  baselineGraph: ReturnType<typeof buildP112BaselineGraph>;
  delta: ReturnType<typeof computeArchitectureDelta>;
  deltaFinding: ReturnType<typeof buildP112DeltaFinding>;
  reportFinding: ReturnType<typeof buildP112ReportFinding>;
  brief: ReturnType<typeof buildP112Brief>;
  proposal: ReturnType<typeof buildP112Proposal>;
  world: Awaited<ReturnType<typeof runP108TwoProjectScenario>>;
};

/**
 * Drives the P1-12 deterministic inspection scenario:
 *   world preparation (P1-02/03 world for project A — accepted plan with the
 *   pinned architecture baseline),
 *   mechanic inspection (baseline graph rev0 vs current graph rev2) ->
 *   deterministic delta -> structure finding (delta-backed),
 *   report-source inspection (no code change) -> material/ambiguous finding
 *   with deltaRef null + DecisionBrief,
 *   candidate baseline proposal (deterministic digest),
 *   view assertion + restart probe path.
 * NO remediation/gate/activation side effects anywhere in this scenario.
 */
export async function runP112InspectionScenario(h: P1_12HarnessLike): Promise<P112InspectionScenarioResult> {
  const world = await runP108TwoProjectScenario(h);
  const preview = world.previews.find((p) => p.projectId === P112_PROJECT)!;

  // 1) Deterministic mechanical delta (pure function — the reconciler's raw
  //    delta body IS this output; no verdicts).
  const baselineGraph = buildP112BaselineGraph();
  const currentGraph = buildP112CurrentGraph();
  const delta = computeArchitectureDelta(baselineGraph, currentGraph);
  expect(delta.noVerdict).toBe(true);
  expect(delta.changes.length).toBeGreaterThanOrEqual(2);

  // 2) mechanic inspection record + delta-backed finding.
  const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
  const inspection = buildP112InspectionSnapshot(intent);
  const recInspection = await h.recordArchitectureInspection(
    buildRecordArchitectureInspectionCommand(inspection, { commandId: "p112-cmd-insp-mechanic" }),
  );
  expect(recInspection.status).toBe("committed");
  const deltaFinding = buildP112DeltaFinding();
  const recFinding = await h.recordArchitectureFinding(
    buildRecordArchitectureFindingCommand(deltaFinding, { commandId: "p112-cmd-finding-delta" }),
  );
  expect(recFinding.status).toBe("committed");

  // 3) report-source inspection (no code change / no test failure) -> finding
  //    WITHOUT raw delta (deltaRef null — never fabricate) + DecisionBrief.
  const reportIntent = buildP112InspectionIntent({
    inspectionId: P112_INSPECTION_REPORT,
    source: "report",
    reportInput: {
      description: "执行者/包工头上报：数据与查询模块的接口职责冲突",
      category: "interface",
      risk: "high",
      affectedRefs: { moduleRefs: ["src/data"], interfaceRefs: ["src/data/maps"], pathRefs: [] },
    },
  });
  const reportInspection = buildP112InspectionSnapshot(reportIntent);
  const recReport = await h.recordArchitectureInspection(
    buildRecordArchitectureInspectionCommand(reportInspection, { commandId: "p112-cmd-insp-report" }),
  );
  expect(recReport.status).toBe("committed");
  const reportFinding = buildP112ReportFinding();
  expect(reportFinding.deltaRef).toBeNull();
  const recFinding2 = await h.recordArchitectureFinding(
    buildRecordArchitectureFindingCommand(reportFinding, { commandId: "p112-cmd-finding-report" }),
  );
  expect(recFinding2.status).toBe("committed");

  // 4) material/ambiguous finding -> DecisionBrief bound to the source baseline.
  const brief = buildP112Brief();
  const recBrief = await h.recordArchitectureDecisionBrief(
    buildRecordArchitectureDecisionBriefCommand(brief, { commandId: "p112-cmd-brief" }),
  );
  expect(recBrief.status).toBe("committed");

  // 5) deterministic candidate proposal (digest recompute matches).
  const proposal = buildP112Proposal();
  expect(proposal.proposalDigest).toBeTruthy();
  const recProposal = await h.recordCandidateBaselineProposal(
    buildRecordCandidateBaselineProposalCommand(proposal, { commandId: "p112-cmd-proposal" }),
  );
  expect(recProposal.status).toBe("committed");

  await p112Advance(h);
  return { preview, baselineGraph, currentGraph, delta, deltaFinding, reportFinding, brief, proposal, world };
}
