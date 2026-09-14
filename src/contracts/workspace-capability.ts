/**
 * ControlEngine.WorkspaceCapabilityPort, the public
 * capability interface consumed by workspace concurrency. Control admission intersects configured execution
 * support with declared task permissions. The resulting run capability declares
 * workspaceRead / workspaceWrite + a max scope CAP. No capability ->
 * unsupported, NEVER a silent degrade (a lease guard receiving unsupported
 * rejects capability_unsupported, zero write).
 *
 * Authority: the workspace-concurrency contracts and ControlEngine module specification.
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

/** Control admission contract — async versioned v1 wire, without live Runtime calls.
 * `source` describes the support facts' provenance, not this policy's owner. */
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

export function workspaceCapabilityFingerprintInput(caps: WorkspaceCapabilitiesV1): string {
  return JSON.stringify(caps);
}
