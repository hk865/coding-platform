/**
 * P1-07 frozen contract: WorkerRuntime.WorkspaceCapabilityPort (interfaces_to_freeze
 * #2 — first consumer P1-07). Explicit capability declaration: a run declares
 * workspaceRead / workspaceWrite + a max scope CAP. No capability ->
 * unsupported, NEVER a silent degrade (a lease guard receiving unsupported
 * rejects capability_unsupported, zero write).
 *
 * Authority: IMPLEMENTATION-HANDOFF.md "P1-07 契约与存储语义" item 4.
 */
import type { TaskEnvelopeV1 } from "./task-envelope.js";
import type { ConflictScopeV1 } from "./workspace-lease.js";

export const WORKSPACE_CAPABILITY_SCHEMA_VERSION = 1 as const;

export type WorkspaceCapabilitySource = "runtime" | "declared-permissions";

/** The explicit capabilities of ONE run (derived from runtime support ∩ declared permissions). */
export type WorkspaceCapabilitiesV1 = {
  schemaVersion: 1;
  workspaceId: string;
  /** workspaceRead capability (explicit). */
  workspaceRead: boolean;
  /** workspaceWrite capability (explicit). */
  workspaceWrite: boolean;
  /** Precedence cap: every write lease scope must be ⊆ this scope (null = no cap). */
  maxWriteScope: ConflictScopeV1 | null;
  source: WorkspaceCapabilitySource;
};

export type WorkspaceCapabilityResultV1 =
  | { status: "ready"; capabilities: WorkspaceCapabilitiesV1 }
  | { status: "unsupported" }
  | { status: "rejected"; reason: string };

/** WorkerRuntime.WorkspaceCapabilityPort — P1-07 first consumer (frozen v1). */
export interface WorkspaceCapabilityPort {
  capabilitiesFor(envelope: TaskEnvelopeV1): Promise<WorkspaceCapabilityResultV1>;
}

// ------------------------------------------------------------------------ //
// Pure operation evaluation                                                  //
// ------------------------------------------------------------------------ //

export type WorkspaceOperationV1 = {
  kind: "read" | "write";
  /** The scope the caller wants to operate on. */
  scope: ConflictScopeV1;
};

export type WorkspaceOperationVerdict =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "capability_unsupported"
        | "capability_readonly"
        | "scope_exceeds_capability"
        | "workspace_mismatch";
      message: string;
    };

/**
 * FROZEN pure capability check (read-only-capability-enforcement):
 *   - no capability (present=false) -> capability_unsupported (never silent);
 *   - write operation requires workspaceWrite (capability_readonly — a reader
 *     run can NEVER upgrade to a write);
 *   - write scope must be ⊆ maxWriteScope (scope_exceeds_capability);
 *   - read operation requires workspaceRead.
 * A read NEVER yields a write: verdicts are per-operation, no upgrades.
 */
export function evaluateWorkspaceOperation(
  capabilities: WorkspaceCapabilitiesV1 | null,
  operation: WorkspaceOperationV1,
): WorkspaceOperationVerdict {
  if (capabilities === null) {
    return {
      allowed: false,
      code: "capability_unsupported",
      message: "no workspace capability declared (unsupported — no silent degrade)",
    };
  }
  if (capabilities.workspaceId !== operation.scope.workspaceId) {
    return {
      allowed: false,
      code: "workspace_mismatch",
      message: "capability is for workspace " + capabilities.workspaceId + ", not " + operation.scope.workspaceId,
    };
  }
  if (operation.kind === "read") {
    if (!capabilities.workspaceRead) {
      return {
        allowed: false,
        code: "capability_readonly",
        message: "workspaceRead capability not declared",
      };
    }
    return { allowed: true };
  }
  if (!capabilities.workspaceWrite) {
    return {
      allowed: false,
      code: "capability_readonly",
      message: "workspaceWrite capability not declared (reader run cannot upgrade to write)",
    };
  }
  if (capabilities.maxWriteScope !== null && !scopeWithinCapability(capabilities.maxWriteScope, operation.scope)) {
    return {
      allowed: false,
      code: "scope_exceeds_capability",
      message: "write scope exceeds the declared capability cap",
    };
  }
  return { allowed: true };
}

/** scope ⊆ cap: label kinds require exact kind+id; path-like uses ancestor prefix. */
export function scopeWithinCapability(cap: ConflictScopeV1, scope: ConflictScopeV1): boolean {
  if (cap.kind === "workspace" || cap.kind === "path" || cap.kind === "module") {
    if (scope.kind === "task" || scope.kind === "stage" || scope.kind === "goal") {
      // A path-like cap cannot statically cover a label scope (no semantic inference).
      return false;
    }
    const capId = cap.id.replace(/\/+$/, "");
    const scopeId = scope.id.replace(/\/+$/, "");
    return capId === scopeId || scopeId.startsWith(capId + "/");
  }
  // label cap: exact kind + id only.
  return cap.kind === scope.kind && cap.id === scope.id;
}

export function workspaceCapabilityFingerprintInput(caps: WorkspaceCapabilitiesV1): string {
  return JSON.stringify(caps);
}
