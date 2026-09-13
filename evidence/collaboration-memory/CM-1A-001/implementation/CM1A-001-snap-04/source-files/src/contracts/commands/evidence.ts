/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { CommandIdentity } from "../command-event.js";
import type { PlanRevisionRef } from "../plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../governance.js";
import type { ArtifactRef } from "../artifact.js";
import type { RunRef } from "../dispatch.js";
import type { EffectivityAnchorV1, EvidenceCoverageV1, EvidenceKind, EvidenceOutcome, EvidenceV1, SubmitEvidenceCommand } from "../evidence.js";
import type { ReduceTaskCommand } from "../reduction.js";

export type BuildEvidenceDeps = {
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  projectId: string;
  goalId: string;
  taskId: string;
  coverage: EvidenceCoverageV1[];
  anchor: EffectivityAnchorV1;
  verificationPlanRef: { planId: string; planDigest: string };
  runRef: RunRef | null;
  checkId: string | null;
  actor: { kind: "human" | "system"; id: string };
  summaryText: string;
  artifactRef: ArtifactRef | null;
};

export type BuildSubmitEvidenceDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  evidence: EvidenceV1;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
};

export type BuildReduceTaskDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  expectedRevision: number;
  projectId: string;
  goalId: string;
  taskId: string;
  actor: CommandIdentity["actor"];
  idempotencyKey: string;
};

export function buildEvidenceV1(deps: BuildEvidenceDeps): EvidenceV1 {
  return {
    schemaVersion: 1,
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    source: {
      actor: deps.actor,
      runRef: deps.runRef,
      checkId: deps.checkId,
    },
    subject: { projectId: deps.projectId, goalId: deps.goalId, taskId: deps.taskId },
    coverage: deps.coverage.map((c) => ({ ...c })),
    anchor: {
      schemaVersion: 1,
      planRef: { ...deps.anchor.planRef },
      planRevision: deps.anchor.planRevision,
      workspaceRevision: deps.anchor.workspaceRevision,
      pinnedCompletionPolicy: { ...deps.anchor.pinnedCompletionPolicy },
      pinnedArchitectureBaseline: { ...deps.anchor.pinnedArchitectureBaseline },
    },
    verificationPlanRef: { ...deps.verificationPlanRef },
    summary: {
      text: deps.summaryText,
      artifactRef: deps.artifactRef,
    },
  };
}

export function buildEffectivityAnchorV1(deps: {
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
}): EffectivityAnchorV1 {
  return {
    schemaVersion: 1,
    planRef: { ...deps.planRef },
    planRevision: deps.planRevision,
    workspaceRevision: deps.workspaceRevision,
    pinnedCompletionPolicy: { ...deps.pinnedCompletionPolicy },
    pinnedArchitectureBaseline: { ...deps.pinnedArchitectureBaseline },
  };
}

export function buildSubmitEvidenceCommand(deps: BuildSubmitEvidenceDeps): SubmitEvidenceCommand {
  return {
    commandId: deps.commandId,
    commandType: "SubmitEvidence",
    schemaVersion: 1,
    identity: {
      projectId: deps.evidence.subject.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.evidence.evidenceId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { evidence: deps.evidence },
  };
}

export function buildReduceTaskCommand(deps: BuildReduceTaskDeps): ReduceTaskCommand {
  return {
    commandId: deps.commandId,
    commandType: "ReduceTask",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor,
      idempotencyKey: deps.idempotencyKey,
    },
    aggregateId: deps.taskId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { goalId: deps.goalId },
  };
}
