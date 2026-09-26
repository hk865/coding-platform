import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot,
  GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'r3c-project';
const workspaceId = 'r3c-workspace';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'r3c-host' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const schemas: RecordBackendSchemas = { records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events,
    { eventType: 'ScopeSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded', value: event }) }],
  lookups: PLAN_RECORD_SCHEMAS.lookups };
const seed: PreparedCommit = { identityKey: 'r3c-scope-seed', fingerprint: 'r3c-scope-seed-v1',
  guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
    { refKey: canonicalRefKey(workspace.ref), expectedRevision: null }],
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
  events: [{ eventId: 'r3c-scope-event', eventType: 'ScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'r3c-scope-event', eventType: 'ScopeSeeded', schemaVersion: 1,
      occurredAt: at }) }], claims: [], indexGuards: [], indexChanges: [] };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: plan reads the Goal created by the real WorkGraph entry', async kind => {
  const dir = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'next-r3c-plan-')) : null;
  if (dir !== null) dirs.push(dir);
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(dir!, 'records.sqlite'), schemas });
  try {
    expect(await backend.records.commit(seed)).toMatchObject({ status: 'committed' });
    let sequence = 0;
    const goals = createGoalService({ records: backend.records, now: () => at,
      eventId: () => `r3c-goal-${++sequence}` }).tasks;
    const plans = createPlanService({ records: backend.records, now: () => at,
      eventId: () => `r3c-plan-${++sequence}` });
    const created = await goals.createGoal(ctx, { meta: { requestId: 'r3c-create-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: 'goal-1', workspace: { projectId, workspaceId }, objective: 'Build the plan' } });
    expect(created).toMatchObject({ status: 'committed', replayed: false });
    if (created.status !== 'committed') throw Error('real Goal creation failed');
    const detail = await plans.queryGoal(ctx, created.value.ref);
    expect(detail).toMatchObject({ status: 'ready', value: { goal: created.value, pendingPlan: null } });
    expect(await plans.queryTaskGraph(ctx, { goalRef: created.value.ref })).toMatchObject({ status: 'not_found' });
    expect(await plans.readPlanProposal(ctx, { aggregateType: 'PlanProposal', projectId, workspaceId,
      proposalId: 'missing-proposal' })).toMatchObject({ status: 'not_found' });

    const draft: PlanRevisionDraft = { schemaVersion: 1, planId: 'plan-empty', planRevision: 1,
      goalId: 'goal-1', stages: [], tasks: [], obligations: [], assignments: [],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const proposed = await plans.proposePlan(ctx, { meta: { requestId: 'r3c-propose-empty',
      expected: [{ ref: created.value.ref, revision: 1 }] },
      input: { goalRef: created.value.ref, basedOn: null, draft,
        reason: { text: 'Capture an incomplete candidate for review', sources: [] } } });
    expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2',
      goalRef: created.value.ref, status: 'candidate', issues: expect.any(Array) } });
    if (proposed.status !== 'committed') throw Error('plan proposal was not recorded');
    expect(proposed.value.issues.length).toBeGreaterThan(0);
    expect(await plans.proposePlan(ctx, { meta: { requestId: 'r3c-propose-empty',
      expected: [{ ref: created.value.ref, revision: 1 }] },
      input: { goalRef: created.value.ref, basedOn: null, draft,
        reason: { text: 'Capture an incomplete candidate for review', sources: [] } } }))
      .toMatchObject({ status: 'committed', replayed: true, value: proposed.value });
    expect(await plans.proposePlan(ctx, { meta: { requestId: 'r3c-propose-empty',
      expected: [{ ref: created.value.ref, revision: 1 }] },
      input: { goalRef: created.value.ref, basedOn: null, draft,
        reason: { text: 'Different reason', sources: [] } } }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await plans.applyPlanChange(ctx, { meta: { requestId: 'r3c-apply-empty',
      expected: [{ ref: created.value.ref, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision,
        decisionRefs: [] } })).toMatchObject({ status: 'rejected' });
    expect(await plans.queryGoal(ctx, created.value.ref)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: null, revision: 1 } } });
  } finally { await backend.close(); }
});
