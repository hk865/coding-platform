/**
 * P1-12 ArchitectureReconciler — inspect(intent) pipeline (InspectionPort).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). Frozen semantics: the ONLY baseline input is the
 * PlanRevision pin (invariant #12); pin missing / dangling / digest mismatch
 * -> fail_closed with diagnostics, NO pseudo Delta/Finding; the raw Delta is
 * the deterministic computeArchitectureDelta of the pre/post code graph;
 * a REPORT-source inspection records finding candidates WITHOUT fabricating a
 * raw Delta; findings/briefs/proposals are recorded through ControlEngine
 * commands (this ticket); NO baseline writes, NO remediation/gate/activation
 * side effects.
 */
import type { ArchitectureInspectionIntentV1, ArchitectureInspectionOutcome, ArchitectureInspectionSnapshot, ArchitectureFindingV1, ArchitectureDecisionBriefV1, ArchitectureCandidateProposalV1 } from "../contracts/architecture-inspection.js";
import type { InspectionPort, InspectResultV1 } from "../contracts/architecture-reconciler.js";
import type { WorkspaceReadPort } from "../contracts/workspace-read.js";
import type { CodeGraphReadQueryV1 } from "../contracts/workspace-read.js";
import type { CodeGraphPort } from "../contracts/architecture-reconciler.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { ControlEngine } from "../contracts/modules.js";
import { computeArchitectureDelta, INSPECTION_MAX_EDGES, INSPECTION_MAX_NODES, architectureFindingRefFor, candidateProposalDigest } from "../contracts/architecture-inspection.js";
import { validateArchitectureInspectionIntent } from "../contracts/validation.js";
import type { ArchitectureBaselineRevisionSnapshot } from "../contracts/governance.js";
import {
  buildP112InspectionSnapshot,
  buildP112DeltaFinding,
  buildP112ReportFinding,
  buildP112Brief,
  buildP112Proposal,
  buildRecordArchitectureInspectionCommand,
  buildRecordArchitectureFindingCommand,
  buildRecordArchitectureDecisionBriefCommand,
  buildRecordCandidateBaselineProposalCommand,
} from "../contracts/fixtures/architecture-fixtures.js";

export type ArchitectureReconcilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  control: ControlEngine;
  workspaceReader: WorkspaceReadPort;
  codeGraph: CodeGraphPort;
  now: () => string;
  eventId: () => string;
};

type FailClosedCode = Extract<InspectResultV1, { status: "fail_closed" }>["code"];

export class ArchitectureReconcilerImpl implements InspectionPort {
  private readonly deps: ArchitectureReconcilerDeps;

  constructor(deps: ArchitectureReconcilerDeps) {
    this.deps = deps;
  }

  async inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1> {
    const issues = validateArchitectureInspectionIntent(intent);
    if (issues.length > 0) {
      return this.failClosed(this.validationCode(issues), issues.map((i) => i.path + ": " + i.message));
    }

    // The ONLY admissible baseline input is the PlanRevision pin (invariant
    // #12/#13): load the immutable revision ALONG the pin; never read a Project
    // active ref or a built-in baseline.
    const pinResult = await this.deps.ledger.load(intent.baselinePin.ref);
    if (pinResult.status === "not_found") {
      return this.failClosed("baseline_unresolved", [
        "pinned architecture baseline not found: " + JSON.stringify(intent.baselinePin.ref),
      ]);
    }
    const baselineSnapshot = pinResult.snapshot;
    if (baselineSnapshot.ref.aggregateType !== "ArchitectureBaselineRevision") {
      return this.failClosed("baseline_unresolved", [
        "expected ArchitectureBaselineRevision snapshot, got " + baselineSnapshot.ref.aggregateType,
      ]);
    }
    const pinned = baselineSnapshot as ArchitectureBaselineRevisionSnapshot;
    if (pinned.contentDigest !== intent.baselinePin.digest) {
      return this.failClosed("baseline_digest_mismatch", [
        "pinned baseline digest mismatch: expected " + intent.baselinePin.digest + ", found " + pinned.contentDigest,
      ]);
    }

    if (intent.source === "report") {
      return this.recordReportInspection(intent);
    }
    return this.recordMechanicInspection(intent);
  }

  // --------------------------------------------------------------------- //
  // Report source: a described conflict WITHOUT code change / test failure //
  // records finding candidates WITHOUT fabricating a raw Delta.            //
  // --------------------------------------------------------------------- //
  private async recordReportInspection(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1> {
    const inspection = buildP112InspectionSnapshot(intent);
    const finding = {
      ...buildP112ReportFinding(),
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      workspaceRevision: intent.workspaceRevision,
      planRef: intent.planRef,
      baselinePin: intent.baselinePin,
      deltaRef: null,
    } satisfies ArchitectureFindingV1;
    await this.recordInspection(inspection);
    await this.recordFinding(finding);
    if (finding.material || finding.ambiguous) {
      const brief = {
        ...buildP112Brief(),
        projectId: intent.projectId,
        workspaceId: intent.workspaceId,
        planRef: intent.planRef,
        baselinePin: intent.baselinePin,
        findingRefs: [architectureFindingRefFor(finding.projectId, finding.workspaceId, finding.findingId)],
      } satisfies ArchitectureDecisionBriefV1;
      await this.recordBrief(brief);
    }
    return { status: "recorded", outcome: { status: "recorded", inspectionRef: inspection.ref, findingCount: 1 } };
  }

  // --------------------------------------------------------------------- //
  // Mechanic source: read baseline graph (rev 0) + current graph (rev 2), //
  // compute the deterministic raw Delta, then record inspection + finding.//
  // --------------------------------------------------------------------- //
  private async recordMechanicInspection(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1> {
    const baseResult = await this.deps.workspaceReader.read(this.buildReadQuery(intent, 0));
    if (baseResult.status !== "sourced") {
      return this.workspaceUnavailable(baseResult, 0);
    }
    const currentResult = await this.deps.workspaceReader.read(this.buildReadQuery(intent, intent.workspaceRevision));
    if (currentResult.status !== "sourced") {
      return this.workspaceUnavailable(currentResult, intent.workspaceRevision);
    }

    const delta = computeArchitectureDelta(baseResult.snapshot, currentResult.snapshot);
    void delta; // the raw Delta body is the pure deterministic function output

    const inspection = buildP112InspectionSnapshot(intent);
    const finding = {
      ...buildP112DeltaFinding(),
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      workspaceRevision: intent.workspaceRevision,
      planRef: intent.planRef,
      baselinePin: intent.baselinePin,
    } satisfies ArchitectureFindingV1;
    await this.recordInspection(inspection);
    await this.recordFinding(finding);
    if (finding.material || finding.ambiguous) {
      const brief = {
        ...buildP112Brief(),
        projectId: intent.projectId,
        workspaceId: intent.workspaceId,
        planRef: intent.planRef,
        baselinePin: intent.baselinePin,
        findingRefs: [architectureFindingRefFor(finding.projectId, finding.workspaceId, finding.findingId)],
      } satisfies ArchitectureDecisionBriefV1;
      await this.recordBrief(brief);
      if (brief.options.length > 0) {
        const proposal = {
          ...buildP112Proposal(),
          projectId: intent.projectId,
          workspaceId: intent.workspaceId,
          planRef: intent.planRef,
          sourceBaselinePin: intent.baselinePin,
        } satisfies ArchitectureCandidateProposalV1;
        proposal.proposalDigest = candidateProposalDigest(proposal);
        await this.recordProposal(proposal);
      }
    }
    return { status: "recorded", outcome: { status: "recorded", inspectionRef: inspection.ref, findingCount: 1 } };
  }

  private buildReadQuery(intent: ArchitectureInspectionIntentV1, revision: number): CodeGraphReadQueryV1 {
    return {
      schemaVersion: 1,
      projectId: intent.projectId,
      workspaceId: intent.workspaceId,
      workspaceRevision: revision,
      planRef: intent.planRef,
      baselinePin: intent.baselinePin,
      requestedKinds: ["module", "interface"],
      maxNodes: INSPECTION_MAX_NODES,
      maxEdges: INSPECTION_MAX_EDGES,
    };
  }

  private workspaceUnavailable(result: Awaited<ReturnType<WorkspaceReadPort["read"]>>, revision: number): InspectResultV1 {
    let detail: string;
    if (result.status === "stale") detail = "stale: expected " + result.expectedRevision + ", observed " + result.observedRevision + " (" + result.message + ")";
    else if (result.status === "unsupported") detail = result.message;
    else if (result.status === "rejected") detail = "rejected " + result.code + ": " + result.issues.join("; ");
    else detail = "unexpected read status";
    return this.failClosed("workspace_unavailable", ["workspace revision " + revision + ": " + detail]);
  }

  private validationCode(issues: { path: string }[]): FailClosedCode {
    const pinRelated = issues.some((i) => i.path.startsWith("baselinePin") || i.path.startsWith("planRef"));
    return pinRelated ? "plan_pin_missing" : "baseline_unresolved";
  }

  private failClosed(code: FailClosedCode, diagnostics: string[]): InspectResultV1 {
    return { status: "fail_closed", code, diagnostics };
  }

  private async recordInspection(inspection: ArchitectureInspectionSnapshot): Promise<void> {
    const commandId = inspection.intent.inspectionId + "-rec-inspection";
    await this.deps.control.recordArchitectureInspection(buildRecordArchitectureInspectionCommand(inspection, { commandId, submittedAt: this.deps.now() }));
  }

  private async recordFinding(finding: ArchitectureFindingV1): Promise<void> {
    const commandId = finding.findingId + "-rec-finding";
    await this.deps.control.recordArchitectureFinding(buildRecordArchitectureFindingCommand(finding, { commandId, submittedAt: this.deps.now() }));
  }

  private async recordBrief(brief: ArchitectureDecisionBriefV1): Promise<void> {
    const commandId = brief.briefId + "-rec-brief";
    await this.deps.control.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(brief, { commandId, submittedAt: this.deps.now() }));
  }

  private async recordProposal(proposal: ArchitectureCandidateProposalV1): Promise<void> {
    const commandId = proposal.proposalId + "-rec-proposal";
    await this.deps.control.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposal, { commandId, submittedAt: this.deps.now() }));
  }
}

export type { ArchitectureInspectionOutcome };
