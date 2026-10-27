import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type {
  CompletionPolicyRevisionSnapshot, ProjectCompletionPolicyActiveSnapshot,
} from '../../../contracts/governance.js';

export type CurrentCompletionPolicyRead = {
  active: ProjectCompletionPolicyActiveSnapshot;
  policy: CompletionPolicyRevisionSnapshot;
};
export interface CompletionPolicyReadPort {
  readCurrentCompletionPolicy(
    ctx: CoreCallContext, input: { projectId: string },
  ): Promise<ReadResult<CurrentCompletionPolicyRead>>;
}
