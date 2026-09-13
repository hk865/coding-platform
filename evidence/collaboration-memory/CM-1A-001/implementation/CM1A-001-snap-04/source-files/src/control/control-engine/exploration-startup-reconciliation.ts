import { createHash, randomUUID } from 'node:crypto';
import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { ExplorationPlan, ExplorationScope as Scope } from '../../contracts/exploration.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { ExplorationStartupReconciliationPort } from '../../contracts/exploration-session.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { buildReduceGoalCommand } from '../../contracts/commands/goal-phase.js';
import { buildGoalReductionInput } from './goal-reducer.js';
import { reduceGoalPhase } from './policies/goal-phase.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
function accepted<T extends {
  status: string;
}>(value: T, label: string): T {
  ensure(value.status !== 'rejected', label + '：' + JSON.stringify(value));
  return value;
}
/** Repairs only obsolete RUNNING projections by submitting normal canonical reduction commands. */
export class ExplorationStartupReconciler implements ExplorationStartupReconciliationPort {
  constructor(private readonly deps: {
    ledger: StateLedger;
    control: Pick<ControlEngine, 'reduceGoal'>;
  }) { }
  async reconcile(plans: readonly ExplorationPlan[]) {
    // Reconcile only obsolete RUNNING projections after a reducer upgrade.
    // The formal command appends a new fact; historical reviews and Runs stay intact.
    for (const scope of plans) {
      const prior = await this.deps.ledger.load({ aggregateType: 'GoalPhase', projectId: scope.projectId, goalId: scope.goalId });
      if (prior.status !== 'found' || !('phase' in prior.snapshot) || prior.snapshot.phase !== 'RUNNING')
        continue;
      const g = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
      ensure(g.status === 'found', '探索目标不存在');
      const goal = g.snapshot as GoalSnapshot;
      ensure(goal.workspaceRef.workspaceId === scope.workspaceId && goal.activePlanRevision?.planId === scope.planId, '探索计划或工作区已改变');
      const p = await this.deps.ledger.load(goal.activePlanRevision);
      ensure(p.status === 'found', '正式探索计划不存在');
      const w = await this.deps.ledger.load(goal.workspaceRef);
      ensure(w.status === 'found', '探索工作区不存在');
      const plan = p.snapshot as PlanRevisionSnapshot;
      const input = await buildGoalReductionInput({ ledger: this.deps.ledger, now: () => new Date().toISOString(), eventId: randomUUID }, { projectId: scope.projectId, goalId: scope.goalId, goal, plan });
      const next = reduceGoalPhase(input);
      if (next.phase === prior.snapshot.phase)
        continue;
      const key = 'exploration-frontier-reconcile-' + digest(canonicalJson([scopeKey(scope), prior.snapshot.revision, input]));
      const receipt = await this.deps.control.reduceGoal(buildReduceGoalCommand({
        commandId: key,
        correlationId: key,
        idempotencyKey: key,
        submittedAt: new Date().toISOString(),
        actor: { kind: 'system', id: 'control-engine' },
        projectId: scope.projectId,
        goalId: scope.goalId,
        expectedRevision: prior.snapshot.revision
      }));
      accepted(receipt, '探索目标状态对账失败');
    }
  }
}
