// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/**
 * Core identity/scoping contracts (skeleton/CONTRACTS.md §2).
 *
 * Only the subset this migration batch actually consumes is published here.
 * Later batches widen these declarations (Session/Operation refs, WorkLink
 * targets, ...) in this same file; they are NOT pre-declared here so that no
 * consumer can depend on a capability that has no implementation yet.
 */
import type { VersionedRef } from "../ledger.js";
/** Scope of a project-wide fact. */
export type ProjectScope = {
    projectId: string;
};
/** Scope of a fact that exists only inside one project's workspace. */
export type WorkspaceScope = ProjectScope & {
    workspaceId: string;
};
/**
 * A version pin supplied by a trusted caller.
 *
 * Each domain validates its own accepted subset; shared identities do not
 * authorize a caller to write every aggregate type.
 */
export type VersionPin = VersionedRef;
/**
 * Metadata a trusted call context attaches to a write request.
 *
 * `requestId` is the idempotency key of the *request*, not a global unique id
 * and not the target aggregate id: a Goal's `goalId` and the requestId of the
 * command that created it stay independent values.
 */
export type CommandMeta = {
    requestId: string;
    expected: readonly VersionPin[];
};

/** Stable platform identity; never a Kernel Run or a filesystem path. */
export type SessionRef = ProjectScope & { sessionId: string };
export type SessionAggregateRef = SessionRef & { aggregateType: 'Session' };
export type ModuleRef = ProjectScope & { moduleId: string };
export type TaskRef = import('../dispatch.js').TaskTriple;
export type ExecutionRef = import('../dispatch.js').RunRef | import('../query-job.js').QueryRunRef;
export type WorkLinkTarget =
  | { kind: 'task'; ref: TaskRef }
  | { kind: 'work'; ref: import('../context-continuity.js').WorkContextRef }
  | { kind: 'module'; ref: ModuleRef };
export type WorkLinkRelation = 'responsible' | 'participates' | 'investigated';
export type SessionWorkLinkRef = SessionRef & { aggregateType: 'SessionWorkLink'; target: WorkLinkTarget; relation: WorkLinkRelation };
export type RoleConfigurationRef =
  | { kind: 'role_spec'; pin: import('../role-spec.js').RoleSpecPinV1 }
  | { kind: 'legacy_template'; templateId: string; templateRevision: string };
