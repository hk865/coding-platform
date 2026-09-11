import type { GoalSnapshot } from './ledger.js';
import type { ExplorationScope, ExplorationPlan } from './exploration.js';

export type PublicExplorationPlan = Pick<ExplorationPlan, 'planOrigin' | 'planId' | 'tasks' | 'gateTaskId' | 'sourceDigest' | 'createdAt'>;
export interface OperatorPlanningContextPort {
  goal(scope: ExplorationScope): Promise<GoalSnapshot>;
  sourceDigest(scope: ExplorationScope): Promise<string>;
  /** The canonical active plan revision of the scope's Goal, or null when the
   * Goal has no accepted plan yet. Callers must decide from this canonical
   * content, never from an identifier prefix. */
  activePlan(scope: ExplorationScope): Promise<import('./plan.js').PlanRevisionSnapshot | null>;
}

/** Explicit human-authored plans. The module owns the pending proposal journal,
 * replay identity, graph validation and Control admission. */
export interface OperatorPlanningPort {
  init(): Promise<void>;
  exploration(scope: ExplorationScope, input: Record<string, unknown>): Promise<PublicExplorationPlan & { replayed: boolean }>;
  ensureTaskPlan(scope: ExplorationScope, instruction: string): Promise<void>;
  plan(scope: ExplorationScope): ExplorationPlan;
  acceptedPlans(): ExplorationPlan[];
}
