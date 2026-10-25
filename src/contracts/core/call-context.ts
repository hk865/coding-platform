import type { ActorRef } from '../command-event.js';
import type { AgentPrincipalRefV1 } from '../coordination.js';
import type { RoleBindingRefV1, RunRef } from '../dispatch.js';
import type { ArtifactOwnerRunRef } from '../artifact.js';
import type { JsonValue } from '../fingerprint.js';
import type { QueryRunRef } from '../query-job.js';
/**
 * Core call context (CONTRACTS §3): bound by the trusted Host or a tool adapter,
 * never by model input. It records identity and actual scope; it does not grant
 * capabilities by `kind` — the Host policy, workspace sandbox and domain version
 * guards still run at each use.
 */
export type CorePrincipal = {
    kind: 'host';
    actor: Extract<ActorRef, {
        kind: 'human' | 'system';
    }>;
} | {
    kind: 'work_run';
    runRef: RunRef;
    roleBinding: RoleBindingRefV1;
    agentPrincipal?: AgentPrincipalRefV1;
} | {
    kind: 'query_run';
    queryRunRef: QueryRunRef;
    /** The frozen request goal of a secretary round; never a model argument. */
    goalId?: string | null;
    initiator: Extract<ActorRef, {
        kind: 'human' | 'system';
    }>;
};
export type MaterialReader = {
    kind: 'run';
    requester: ArtifactOwnerRunRef;
} | {
    kind: 'host';
    projectId: string;
    workspaceId?: string;
    actor: Extract<ActorRef, {
        kind: 'human' | 'system';
    }>;
};
export type PlatformMaterialOrigin = {
    kind: 'platform_operation';
    projectId: string;
    workspaceId?: string;
    requestId: string;
    actor: Extract<ActorRef, {
        kind: 'human' | 'system';
    }>;
};
export type CoreCallContext = {
    projectId: string;
    workspaceId?: string;
    principal: CorePrincipal;
    materialReader: MaterialReader;
    signal: AbortSignal;
};
/**
 * The trusted caller folded into a command's replay identity and fingerprint, built from the principal only (the
 * model can never name another caller), so two principals never replay each other. A Host caller is its actor; a
 * Run its RunRef; a QueryRun its QueryRunRef.
 */
export function principalIdentity(principal: CorePrincipal): JsonValue {
    if (principal.kind === 'host') return { kind: 'host', actor: { kind: principal.actor.kind, id: principal.actor.id } };
    if (principal.kind === 'work_run') {
        return { kind: 'work_run', runRef: { projectId: principal.runRef.projectId, goalId: principal.runRef.goalId,
            runId: principal.runRef.runId } };
    }
    return { kind: 'query_run', queryRunRef: { ...principal.queryRunRef } };
}
/** The trusted Host principal a Host command runs under. */
export type HostPrincipal = Extract<CorePrincipal, { kind: 'host' }>;
/**
 * The authorization check: the caller's Host principal when its actor is of the kind the command needs (the person
 * for a public command, the trusted system for an internal one), else null. Every later step takes the returned
 * principal, so nothing after the check can meet a caller that is not the Host.
 */
export function hostPrincipalOf(ctx: CoreCallContext, actorKind: 'human' | 'system'): HostPrincipal | null {
    return ctx.principal.kind === 'host' && ctx.principal.actor.kind === actorKind ? ctx.principal : null;
}
