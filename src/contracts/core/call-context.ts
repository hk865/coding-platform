// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { ActorRef } from '../command-event.js';
import type { AgentPrincipalRefV1 } from '../coordination.js';
import type { RoleBindingRefV1, RunRef } from '../dispatch.js';
import type { ArtifactOwnerRunRef } from '../artifact.js';
import type { MaterialBasisV1 } from '../material-access.js';
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
    initiator: Extract<ActorRef, {
        kind: 'human' | 'system';
    }>;
};
export type MaterialReader = {
    kind: 'run';
    requester: ArtifactOwnerRunRef;
    currentBasis?: MaterialBasisV1;
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
