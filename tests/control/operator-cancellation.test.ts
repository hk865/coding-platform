import { expect, it } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { OperatorTaskDispatch } from '../../src/control/dispatch-engine/operator-task-dispatch.js';
import { setupP107Scenario } from '../coordination/runtime-concurrency-fixture.js';
import { buildDispatchClaimCommand } from '../../src/contracts/commands/dispatch.js';
import { P107_PROJECT, P107_SCHEMA } from '../contract-support/fixtures/workspace-fixtures.js';
import { p107GoalScope, P107_GOAL, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_DECLARED_READ_PERMISSIONS_V1, P107_BUDGET_READER_V1 } from '../contract-suite/p1-07-harness.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { OperatorPlanningPort } from '../../src/contracts/operator-planning.js';

it.each(['unsupported', 'outcome_unknown'] as const)('persists cancellation before capability handling and preserves %s', async result => {
  const h = createInMemoryHarness(); await setupP107Scenario(h);
  expect((await h.claimTask(buildDispatchClaimCommand({ actor: { kind: 'human', id: 'user-1' }, projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_READER_A,
    runId: 'cancel-run', attemptId: 'cancel-attempt', commandId: 'cancel-claim', idempotencyKey: 'cancel-claim', correlationId: 'cancel-test', submittedAt: P107_SCHEMA,
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1 }))).status).toBe('committed');
  const ref = { aggregateType: 'Run' as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: 'cancel-run' };
  const canonical = async () => { const r = await h.ledger.load(ref); if (r.status !== 'found') throw Error('missing'); return r.snapshot as RunSnapshot; };
  const dispatch = new OperatorTaskDispatch({ ledger: h.ledger, control: h.control,
    runtime: { all: () => [], preflight: async () => {}, prepare: async () => {}, ...(result === 'unsupported' ? {} : {
      cancel: async () => { expect((await canonical()).controlState?.desiredState).toBe('cancelled'); return { status: 'outcome_unknown' }; },
    }) }, planning: {} as OperatorPlanningPort, launch: () => {}, now: () => P107_SCHEMA });
  expect(await dispatch.cancel(p107GoalScope(), 'cancel-run')).toMatchObject({ status: result });
  expect((await canonical()).controlState?.desiredState).toBe('cancelled');
  expect((await canonical()).outcome).not.toBe('cancelled');
  expect(await dispatch.cancel(p107GoalScope(), 'cancel-run')).toMatchObject({ status: result });
  expect((await h.drive({ reason: 'after-cancel' })).started).toBe(0);
});
