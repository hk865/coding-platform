import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RuntimeCapabilities } from './contracts.js';

/** N0 cannot accept an execution DTO until WorkGraph freezes admission and
 * prepared execution types. `never` makes the unimplemented calls uncallable. */
export interface N0RuntimeExecutionPort {
  capabilities(ctx: CoreCallContext, workspace: WorkspaceScope): Promise<ReadResult<RuntimeCapabilities>>;
  prepareExecution(ctx: CoreCallContext, request: never): Promise<CoreRejection>;
  startRun(ctx: CoreCallContext, request: never): Promise<CoreRejection>;
}

export type N0AgentRuntimeService = { port: N0RuntimeExecutionPort };
