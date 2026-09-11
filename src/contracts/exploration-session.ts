import type { ArtifactPort, ArtifactRef } from './artifact.js';
import type { RunSnapshot } from './dispatch.js';
import type { ExplorationScope, ExplorationPlan, ExplorationReport, ExplorationReview } from './exploration.js';
import type { PlanRevisionSnapshot } from './plan.js';
import type { RuntimeBudget } from './runtime-budget.js';
import type { PreparedRunFact, RunSpec } from './runtime-preparation.js';
import type { RuntimeContextMaterials } from './runtime-context-materials.js';
import type { TaskEnvelopeV1 } from './task-envelope.js';
import type { OperatorPlanningPort } from './operator-planning.js';
import type { RecordedVerificationPort } from './verification-service.js';
import type { ControlEngine } from './modules.js';
/** Public execution observations; no model hidden context or concrete Runtime record. */
export type ExplorationRunObservation = PreparedRunFact & {
  trace: Array<{
    type: string;
    sequence: number;
    at: string;
    data: unknown;
  }>;
};
export interface ExplorationObservationPort {
  all(): ExplorationRunObservation[];
}
export type ExplorationSessionMaterial = {
  manifest: ExplorationPlan;
  plan: PlanRevisionSnapshot;
  workspaceRevision: number;
  root: string;
};
export interface ExplorationSessionContextPort {
  current(scope: ExplorationScope, manifest: ExplorationPlan): Promise<ExplorationSessionMaterial>;
  compileRunSpec(material: ExplorationSessionMaterial, request: { runId: string; taskId: string; budget: RuntimeBudget }): RunSpec;
  assertSource(scope: ExplorationScope, expected: string): Promise<void>;
  run(scope: ExplorationScope, runId: string): Promise<RunSnapshot | null>;
  record(scope: ExplorationScope, runId: string, taskId?: string): ExplorationRunObservation | undefined;
  completedRuns(scope: ExplorationScope): Promise<ExplorationRunObservation[]>;
  replaySpec(scope: ExplorationScope, runId: string, taskId: string, budget: RuntimeBudget): Promise<{
    spec: RunSpec;
    existing: RunSnapshot['status'];
  } | null>;
  taskPhase(scope: ExplorationScope, taskId: string): Promise<string | null>;
}
export interface ExplorationReportPort {
  capture(scope: ExplorationScope, manifest: ExplorationPlan, record: ExplorationRunObservation): Promise<ExplorationReport>;
  reportArtifact(report: Omit<ExplorationReport, 'artifactRef'> | ExplorationReport): Promise<ArtifactRef>;
  satisfiedReports(scope: ExplorationScope, plan: ExplorationPlan, reports: readonly ExplorationReport[], reviews: readonly ExplorationReview[]): Promise<ExplorationReport[]>;
}
/** Dispatch grants selected predecessor materials; this interface does not expose its concrete implementation. */
export interface ExplorationContextDrivePort {
  prerequisites(plan: ExplorationPlan, taskId: string, reports: readonly ExplorationReport[], reviews: readonly ExplorationReview[]): Array<{
    report: ExplorationReport;
    review: ExplorationReview;
  }>;
  assembleRun(spec: RunSpec, envelope: TaskEnvelopeV1): Promise<RuntimeContextMaterials>;
}
export interface ExplorationStartupReconciliationPort {
  reconcile(plans: readonly ExplorationPlan[]): Promise<void>;
}
export type ExplorationSessionDeps = {
  directory: string;
  planning: OperatorPlanningPort;
  context: ExplorationSessionContextPort;
  verification: ExplorationReportPort;
  recordedVerification: RecordedVerificationPort;
  contextDrive: Pick<ExplorationContextDrivePort, 'prerequisites'>;
  startup: ExplorationStartupReconciliationPort;
  vault: Pick<ArtifactPort, 'put'>;
  control: Pick<ControlEngine, 'dispatchReadiness'>;
};
export type ExplorationSessionView = Pick<ExplorationPlan, 'planOrigin' | 'planId' | 'tasks' | 'gateTaskId' | 'sourceDigest' | 'createdAt'> & {
  reports: ExplorationReport[];
  reviews: Array<Omit<ExplorationReview, 'fingerprint'>>;
  reportErrors: Array<{
    runId: string;
    error: string;
  }>;
};
export interface ExplorationSessionPort {
  init(): Promise<void>;
  install(scope: ExplorationScope, input: Record<string, unknown>): ReturnType<OperatorPlanningPort['exploration']>;
  view(scope: ExplorationScope): Promise<ExplorationSessionView | null>;
  prepareRun(scope: ExplorationScope, input: Record<string, unknown>, budget: RuntimeBudget): Promise<{
    spec: RunSpec;
    requestId: string;
    existing: RunSnapshot['status'] | null;
  }>;
  review(scope: ExplorationScope, input: Record<string, unknown>): Promise<{
    review: ExplorationReview;
    replayed: boolean;
  }>;
}
