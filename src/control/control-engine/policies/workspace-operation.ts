/** Control-owned deterministic domain policy. */
import type { ConflictScopeV1 } from "../../../contracts/workspace-lease.js";
import type { WorkspaceCapabilitiesV1, WorkspaceOperationV1, WorkspaceOperationVerdict } from "../../../contracts/workspace-capability.js";



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