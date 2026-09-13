import type { OperatorPlanningContextPort } from '../../contracts/operator-planning.js';
import type { ExplorationScope } from '../../contracts/exploration.js';
import type { GoalSnapshot, StateLedger } from '../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import { explorationSourceDigest } from '../workspace-reader/exploration-source.js';

export class OperatorPlanningContext implements OperatorPlanningContextPort {
  constructor(private readonly deps: { ledger: Pick<StateLedger, 'load'>; rootFor: (projectId: string, workspaceId: string) => string }) {}
  async goal(scope: ExplorationScope) {
    const loaded = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Goal') throw Error('目标不存在');
    const goal = loaded.snapshot as GoalSnapshot;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) throw Error('目标不属于当前工作区');
    return goal;
  }
  sourceDigest(scope: ExplorationScope) { return explorationSourceDigest(this.deps.rootFor(scope.projectId, scope.workspaceId)); }
  async activePlan(scope: ExplorationScope) {
    const goal = await this.goal(scope);
    if (!goal.activePlanRevision) return null;
    const loaded = await this.deps.ledger.load(goal.activePlanRevision);
    if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'PlanRevision') return null;
    return loaded.snapshot as PlanRevisionSnapshot;
  }
}
