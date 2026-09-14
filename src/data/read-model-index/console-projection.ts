import type { CommitCursor } from '../../contracts/command-event.js';
import type {
  EvidenceFormalMarker,
  PlanMatrixRow,
  PlanMatrixView,
  PortfolioEntry,
  PortfolioView,
  RunDisplayState,
  TaskEvidenceEntry,
} from '../../contracts/console-views.js';
import { CONSOLE_MATRIX_MAX_TASKS } from '../../contracts/console-views.js';
import type { EvidenceApplicability, EvidenceV1 } from '../../contracts/evidence.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';

export function runDisplayStateForEvent(eventType: string): RunDisplayState {
  switch (eventType) {
    case 'run_completed': return 'completed_run';
    case 'run_crashed': return 'crashed';
    case 'run_cancelled': return 'cancelled';
    case 'run_budget_exhausted': return 'budget_exhausted';
    default: return 'ongoing';
  }
}

export function buildPlanMatrixView(
  projectId: string,
  workspaceId: string,
  goalId: string,
  snapshot: PlanRevisionSnapshot,
  cursor: CommitCursor,
  updatedAt: string,
): PlanMatrixView {
  const stages = snapshot.stages;
  const stageTitleOf = (stageId: string | undefined): string | null =>
    stageId === undefined ? null : (stages.find((stage) => stage.stageId === stageId)?.title ?? null);
  const rows: PlanMatrixRow[] = snapshot.tasks.slice(0, CONSOLE_MATRIX_MAX_TASKS).map((task) => ({
    taskId: task.taskId,
    title: task.title,
    stageId: task.stageId ?? null,
    stageTitle: stageTitleOf(task.stageId),
    requirementLevel: task.requirementLevel,
    taskKind: task.taskKind,
    disposition: task.disposition,
    taskScope: task.scope,
    plannedPhase: task.phase,
    livePhase: null,
    phaseSources: {
      planned: { planRef: snapshot.ref, planRevision: snapshot.planRevision, sourceCursor: cursor },
      live: { reductionRevision: null, sourceCursor: null },
    },
    phaseMismatch: false,
    sourceCursor: cursor,
  }));
  return {
    projectId,
    workspaceId,
    goalId,
    planRef: snapshot.ref,
    planRevision: snapshot.planRevision,
    stages,
    rows,
    taskCount: snapshot.tasks.length,
    sourceCursor: cursor,
    updatedAt,
  };
}

export function toTaskEvidenceEntry(
  projected: { evidence: EvidenceV1; admittedAt: string; evidenceIndex: number; sourceCursor: CommitCursor },
  applicability: EvidenceApplicability | null,
): TaskEvidenceEntry {
  const evidence = projected.evidence;
  const marker: EvidenceFormalMarker =
    evidence.kind === 'claim' || evidence.kind === 'verdict' ? 'unverified_report' : 'observed_fact';
  return {
    evidenceId: evidence.evidenceId,
    kind: evidence.kind,
    marker,
    outcome: evidence.outcome,
    coverage: evidence.coverage.map((item) => ({ ...item })),
    applicability,
    anchor: { ...evidence.anchor },
    sourceRunRef: evidence.source.runRef,
    checkId: evidence.source.checkId,
    artifactRef: evidence.summary.artifactRef,
    summary: evidence.summary.text,
    admittedAt: projected.admittedAt,
    evidenceIndex: projected.evidenceIndex,
    sourceCursor: projected.sourceCursor,
  };
}

export function buildPortfolioView(entries: PortfolioEntry[], sourceCursor: CommitCursor): PortfolioView {
  let updatedAt: string | null = null;
  for (const entry of entries) {
    if (updatedAt === null || entry.bootstrappedAt > updatedAt) updatedAt = entry.bootstrappedAt;
  }
  return { entries: entries.map((entry) => ({ ...entry })), sourceCursor, updatedAt };
}
