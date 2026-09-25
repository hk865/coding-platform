import type { ArtifactRef } from '../../contracts/artifact.js';
import type { CommandMeta } from '../../contracts/core/identity.js';
import type { CreateGoalInput } from '../../core/work-graph/tasks/contracts.js';

/** N0-only accepted shape. The full GoalInput proposal/decision protocol is
 * deliberately absent until WorkGraph publishes its real proposal Port. */
export type N0GoalInput = {
  meta: CommandMeta;
  goal: CreateGoalInput;
  requestBodyRef: ArtifactRef;
  text: string;
  action: { kind: 'request_work'; executeWithinRequest: boolean };
};
