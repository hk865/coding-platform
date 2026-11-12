import type { CoreCallContext } from '../../../contracts/core/call-context.js';

/**
 * The context of a read-only check the platform makes for an Agent: the catalog trial of a structural proposal, the
 * workspace reads that check a note's files. The owners those checks read admit only the Host principal, so the check
 * runs under a fixed internal Host identity (`actor`) on the caller's own project, workspace and signal. A Host
 * caller keeps its own context. Only the check reads this way: the write, its admission and its stored author stay
 * the caller's.
 */
export function platformCheckContext(ctx: CoreCallContext, actor: { kind: 'system'; id: string }): CoreCallContext {
  if (ctx.principal.kind === 'host') return ctx;
  return {
    projectId: ctx.projectId,
    ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
    principal: { kind: 'host', actor },
    materialReader: ctx.workspaceId === undefined
      ? { kind: 'host', projectId: ctx.projectId, actor }
      : { kind: 'host', projectId: ctx.projectId, workspaceId: ctx.workspaceId, actor },
    signal: ctx.signal,
  };
}

/**
 * The context the platform acts in as one of its own fixed Host system identities (`actor`) on the caller's project,
 * workspace and signal, whoever the caller is (a member's creation, a knowledge conflict's request to an adviser).
 * A write the mailbox or a receipt keys by its sender is then the same write whichever caller made it.
 */
export function hostSystemContext(ctx: CoreCallContext, actor: { kind: 'system'; id: string }): CoreCallContext {
  return {
    ...ctx,
    principal: { kind: 'host', actor: { ...actor } },
    materialReader: {
      kind: 'host', projectId: ctx.projectId, actor: { ...actor },
      ...(ctx.workspaceId === undefined ? {} : { workspaceId: ctx.workspaceId }),
    },
  };
}
