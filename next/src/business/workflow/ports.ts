import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { GoalTaskPort } from '../../core/work-graph/tasks/contracts.js';
import type { N0GoalInput } from './contracts.js';

/** N0's narrow, non-operational publishing surface. `never` prevents a caller
 * from inventing an AdvanceTrigger before the real graph protocol exists. */
export interface N0WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: N0GoalInput): Promise<CoreRejection>;
  advanceWork(ctx: CoreCallContext, trigger: never): Promise<CoreRejection>;
}

export type N0WorkflowDependencies = { tasks: GoalTaskPort };
