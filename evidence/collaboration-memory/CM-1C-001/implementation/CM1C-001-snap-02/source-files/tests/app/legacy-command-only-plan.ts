import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { buildApplyPlanCommand } from '../../src/contracts/commands/plan.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';

/** Historical accepted contract for import/reopen compatibility, not a production plan default. */
export async function installLegacyCommandOnlyPlan(directory: string, scope: { projectId: string; goalId: string }) {
  const harness = await createPersistentSqliteHarness({ dir: directory });
  try {
    const loaded = await harness.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    if (loaded.status !== 'found') throw Error('Legacy fixture requires an existing formal Goal');
    const goal = loaded.snapshot as GoalSnapshot;
    const taskId = 'coding-task';
    const draft: PlanRevisionDraft = {
      schemaVersion: 1, planId: 'real-plan-' + scope.goalId, planRevision: 1, goalId: scope.goalId,
      stages: [{ stageId: 'coding', title: 'Historical command-only task' }],
      tasks: [
        { taskId, stageId: 'coding', title: 'Historical task', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'coding' } },
        { taskId: 'gate-goal', title: 'Historical benchmark gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      obligations: [{ obligationId: 'coding-result', title: 'Historical explicitly tool-only acceptance', requirementLevel: 'required', taskIds: [taskId, 'gate-goal'], verificationRequirements: [
        { requirementId: 'independent-check', requirementLevel: 'required', kind: 'dynamic', description: 'The accepted historical contract requires independent command evidence only.' },
      ] }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: taskId }] },
      executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: taskId, requires: { kind: 'gate-result', label: 'Historical independent check' } }] },
    };
    const identity = 'legacy-command-only-' + scope.goalId;
    const receipt = await harness.applyPlan(buildApplyPlanCommand(draft, {
      ...scope, commandId: identity, correlationId: identity, idempotencyKey: identity,
      actor: { kind: 'human', id: 'user-1' }, expectedRevision: goal.revision, submittedAt: new Date().toISOString(),
    }));
    if (receipt.status !== 'committed') throw Error('Historical plan fixture rejected: ' + JSON.stringify(receipt));
  } finally { await harness.close(); }
}
