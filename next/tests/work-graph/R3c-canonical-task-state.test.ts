import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { readCanonicalTaskFacts } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: an unregistered Run/Lease/Reduction reader cannot certify an empty task state', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3c-task-facts-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas: GOAL_RECORD_SCHEMAS })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas: GOAL_RECORD_SCHEMAS });
  try {
    const goalRef = { aggregateType: 'Goal' as const, projectId: 'task-facts', goalId: 'goal-1' };
    const plan: PlanRevisionSnapshot = { ref: { aggregateType: 'PlanRevision', projectId: 'task-facts', planId: 'plan-1' },
      revision: 1, schemaVersion: 1, goalRef, planId: 'plan-1', planRevision: 1,
      acceptedAt: '2026-09-24T00:00:00.000Z',
      effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: 'task-facts',
        policyId: 'policy-1', revision: 1 }, digest: 'a'.repeat(64) },
      effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'task-facts',
        baselineId: 'baseline-1', revision: 1 }, digest: 'b'.repeat(64) },
      stages: [], tasks: [{ taskId: 'work-1', title: 'Work', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    expect(await readCanonicalTaskFacts(backend.records, goalRef, plan))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });
  } finally { await backend.close(); }
});
