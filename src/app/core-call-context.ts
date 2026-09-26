/**
 * Host-bound `CoreCallContext` construction.
 *
 * The context is built ONLY from the trusted startup actor plus the scope the
 * HTTP request was resolved against. A request body can never supply the
 * principal, actor, material reader or signal, so `kind:'host'` here records
 * who called rather than granting anything: the domain version guards, Host
 * workspace policy and sandbox still run at each use.
 */
import type { ActorRef } from '../contracts/command-event.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { CoreScope } from './core-http-types.js';

/** The fixed startup actor; only `human`/`system` may act as the Host. */
export type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

export function createHostCoreCallContext(input: {
  scope: CoreScope;
  actor: HostActor;
  signal: AbortSignal;
}): CoreCallContext {
  const actor = { ...input.actor };
  return {
    projectId: input.scope.projectId,
    workspaceId: input.scope.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: {
      kind: 'host',
      projectId: input.scope.projectId,
      workspaceId: input.scope.workspaceId,
      actor: { ...input.actor },
    },
    signal: input.signal,
  };
}
