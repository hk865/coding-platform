import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { CONSOLE_MATRIX_MAX_TASKS, type PlanMatrixView } from '../../src/contracts/console-views.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { buildSyntheticArchitectureInspection } from '../../src/data/read-model-index/architecture-inspection-projection.js';
import { buildPlanMatrixView, buildPortfolioView, runDisplayStateForEvent } from '../../src/data/read-model-index/console-projection.js';
import { readModelHandlesEvent } from '../../src/data/read-model-index/handled-event-types.js';

const plan = {
  ref: { aggregateType: 'PlanRevision', projectId: 'performance-project', planId: 'performance-plan' },
  planRevision: 1,
  stages: [{ stageId: 'stage', title: 'Stage' }],
  tasks: Array.from({ length: 512 }, (_, index) => ({
    taskId: `task-${index}`,
    stageId: 'stage',
    title: `Task ${index}`,
    requirementLevel: 'required',
    taskKind: 'work',
    disposition: 'active',
    phase: 'pending',
    scope: { kind: 'goal' },
  })),
} as unknown as PlanRevisionSnapshot;

// Benchmark baseline: the storage adapters previously carried this calculation separately.
function buildPlanMatrixBaseline(
  projectId: string,
  workspaceId: string,
  goalId: string,
  snapshot: PlanRevisionSnapshot,
  cursor: CommitCursor,
  updatedAt: string,
): PlanMatrixView {
  const stageTitleOf = (stageId: string | undefined): string | null =>
    stageId === undefined ? null : (snapshot.stages.find((stage) => stage.stageId === stageId)?.title ?? null);
  const rows = snapshot.tasks.slice(0, CONSOLE_MATRIX_MAX_TASKS).map((task) => ({
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
    phaseSources: { planned: { planRef: snapshot.ref, planRevision: snapshot.planRevision, sourceCursor: cursor }, live: { reductionRevision: null, sourceCursor: null } },
    phaseMismatch: false,
    sourceCursor: cursor,
  }));
  return { projectId, workspaceId, goalId, planRef: snapshot.ref, planRevision: snapshot.planRevision, stages: snapshot.stages, rows, taskCount: snapshot.tasks.length, sourceCursor: cursor, updatedAt };
}

function measure(iterations: number, build: (cursor: CommitCursor) => unknown) {
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let index = 0; index < iterations; index++) build(makeCommitCursor(index + 1));
  const elapsedMs = performance.now() - started;
  return { elapsedMs, operationsPerSecond: Math.round(iterations / (elapsedMs / 1000)), heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap };
}

describe('shared read-model projection rules', () => {
  it('keeps storage-independent display rules deterministic', () => {
    const matrix = buildPlanMatrixView('performance-project', 'workspace', 'goal', plan, makeCommitCursor(1), '2026-09-14T00:00:00.000Z');
    expect(matrix.rows).toHaveLength(512);
    expect(matrix.rows[0]).toMatchObject({ taskId: 'task-0', stageTitle: 'Stage', livePhase: null });
    expect(runDisplayStateForEvent('run_budget_exhausted')).toBe('budget_exhausted');
    expect(buildPortfolioView([
      { projectId: 'p', workspaceId: 'w', projectRevision: 1, workspaceRevision: 1, sourceDigest: 'd1', scopeKey: 'p/w', bootstrappedAt: '2026-09-14T00:00:00.000Z', sourceCursor: makeCommitCursor(1) },
      { projectId: 'p2', workspaceId: 'w2', projectRevision: 1, workspaceRevision: 1, sourceDigest: 'd2', scopeKey: 'p2/w2', bootstrappedAt: '2026-09-14T00:00:01.000Z', sourceCursor: makeCommitCursor(2) },
    ], makeCommitCursor(2)).updatedAt).toBe('2026-09-14T00:00:01.000Z');
    expect(buildSyntheticArchitectureInspection('p', 'w', 'brief', { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 'b', revision: 1 }, digest: 'd' }, plan.ref, '2026-09-14T00:00:00.000Z', 'brief').intent.source).toBe('report');
    expect(readModelHandlesEvent('WorkContextBound')).toBe(true);
    expect(readModelHandlesEvent('UnknownEvent')).toBe(false);
  });

  it('records fixed-size pure-projection cost without adding storage reads', () => {
    const iterations = 2_000;
    const args = (cursor: CommitCursor) => ['performance-project', 'workspace', 'goal', plan, cursor, '2026-09-14T00:00:00.000Z'] as const;
    const baseline = measure(iterations, (cursor) => buildPlanMatrixBaseline(...args(cursor)));
    const shared = measure(iterations, (cursor) => buildPlanMatrixView(...args(cursor)));
    const report = {
      fixture: { iterations, tasksPerPlan: plan.tasks.length },
      beforeDuplicatedCalculation: baseline,
      afterSharedCalculation: shared,
      storageReadsInsideSharedRules: 0,
      note: 'Heap deltas include runtime GC noise. SQLite selection, indexes and transactions remain in SqliteReadModelIndex; this measures only deterministic calculation.',
    };
    if (process.env['READ_MODEL_BENCHMARK_OUTPUT']) writeFileSync(process.env['READ_MODEL_BENCHMARK_OUTPUT'], `${JSON.stringify(report, null, 2)}\n`);
    expect(buildPlanMatrixView(...args(makeCommitCursor(1)))).toEqual(buildPlanMatrixBaseline(...args(makeCommitCursor(1))));
    expect(shared.elapsedMs).toBeLessThan(10_000);
  });
});
