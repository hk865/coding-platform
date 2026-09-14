import { readDispatchBacklog } from '../../src/data/read-model-index/dispatch-backlog-view.js';
import { expect, it, vi } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { setupP107Scenario } from '../coordination/runtime-concurrency-fixture.js';
import { buildCreateGoalCommand } from '../contract-support/fixtures/goal-fixtures.js';
import { buildApplyPlanCommand } from '../../src/fixtures/plan-fixtures.js';
import { buildDispatchClaimCommand } from '../../src/contracts/commands/dispatch.js';
import { P107_PROJECT, P107_SCHEMA, P107_PLAN_REVISION_FIXTURE_V1 } from '../contract-support/fixtures/workspace-fixtures.js';
import { p107GoalScope, P107_GOAL, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_DECLARED_READ_PERMISSIONS_V1, P107_BUDGET_READER_V1 } from '../contract-suite/p1-07-harness.js';

for(const rejectContext of [false,true]) for (const storage of ['memory', 'sqlite'] as const) it(storage + ': same local attempt across goals; context rejection=' + rejectContext, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm01-scoped-'));
  const persistent = storage === 'sqlite' ? await createPersistentPlatform({ dir, deps: { clock: () => P107_SCHEMA } }) : undefined;
  const h = persistent ?? createInMemoryHarness({ deps: { clock: () => P107_SCHEMA } });
  const ledger = h.ledger;
  try {
    await setupP107Scenario(h);
    const other = 'zz-other-goal';
    expect((await h.control.submit(buildCreateGoalCommand({ ...p107GoalScope(), goalId: other }, {
      commandId: 'other-goal', correlationId: 'scope-test', idempotencyKey: 'other-goal', submittedAt: P107_SCHEMA,
    }))).status).toBe('committed');
    expect((await h.applyPlan(buildApplyPlanCommand({ ...P107_PLAN_REVISION_FIXTURE_V1, goalId: other, planId: 'other-plan' }, {
      projectId: P107_PROJECT, expectedRevision: 1, commandId: 'other-plan', correlationId: 'scope-test', idempotencyKey: 'other-plan', submittedAt: P107_SCHEMA,
    }))).status).toBe('committed');
    for (const goalId of [P107_GOAL, other]) {
      const receipt = await h.claimTask(buildDispatchClaimCommand({ actor: { kind: 'human', id: 'user-1' }, projectId: P107_PROJECT, goalId, taskId: P107_TASK_READER_A,
        runId: 'run-' + goalId, attemptId: 'same-local-attempt', commandId: 'claim-' + goalId, idempotencyKey: 'claim-' + goalId,
        correlationId: 'scope-test', submittedAt: P107_SCHEMA, roleBinding: P107_ROLE_BINDING_READER_V1,
        declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1 }));
      expect(receipt.status, JSON.stringify(receipt)).toBe('committed');
    }
    if(rejectContext) vi.spyOn(h.contextCompiler,'assemble').mockResolvedValue({status:'rejected',issues:['acceptance injected unavailable material'] } as any);
    const result=await h.drive({reason:'same-local-attempt'});
    const remaining=await ledger.pendingDispatchIntents(20,{includeQuarantined:true});
    console.log(JSON.stringify({storage,rejectContext,result,remaining:remaining.map(e=>({goalId:e.intent.goalId,schedule:e.schedule}))}));
    if(rejectContext) {
      expect(remaining).toHaveLength(2);
      for (const entry of remaining) expect(entry.schedule).toMatchObject({
        attemptCount: 1, quarantined: false,
        lastFailure: 'context rejected: acceptance injected unavailable material',
        availableAt: new Date(Date.parse(P107_SCHEMA) + 1000).toISOString(),
      });
      expect(result.backlog).toMatchObject({ due: 0, delayed: 2, quarantined: 0 });
    }
    else expect(result.started).toBe(2);
  } finally { await persistent?.close(); await rm(dir, { recursive: true, force: true }); }
});

