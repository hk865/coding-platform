import type { TaskEnvelopeV1 } from "../../../contracts/task-envelope.js";
import type { WorkspaceCapabilityPort, WorkspaceCapabilityResultV1 } from "../../../contracts/workspace-capability.js";
import type { ConflictScopeV1 } from "../../../contracts/workspace-lease.js";

/** Declared execution support supplied by the composition root, before the
 * Control admission policy intersects it with each task's permissions. */
export type WorkspaceCapabilitySupport = {
  workspaceRead: boolean;
  workspaceWrite: boolean;
  maxWriteScope: ConflictScopeV1 | null;
};

/** Control owns this admission decision. It consumes support configuration,
 * never a live Runtime callback, and does not authorize or execute operations. */
export class ConfiguredWorkspaceCapabilityPolicy implements WorkspaceCapabilityPort {
  private readonly support: WorkspaceCapabilitySupport | null;

  constructor(support: WorkspaceCapabilitySupport | null) {
    this.support = support === null ? null : {
      workspaceRead: support.workspaceRead,
      workspaceWrite: support.workspaceWrite,
      maxWriteScope: structuredClone(support.maxWriteScope),
    };
  }

  capabilitiesFor(envelope: TaskEnvelopeV1): Promise<WorkspaceCapabilityResultV1> {
    if (this.support === null) return Promise.resolve({ status: "unsupported" });
    const tools = envelope.permissions.tools;
    return Promise.resolve({ status: "ready", capabilities: {
      schemaVersion: 1,
      workspaceId: envelope.workspaceId,
      workspaceRead: this.support.workspaceRead && tools.includes("read"),
      workspaceWrite: this.support.workspaceWrite && tools.includes("write"),
      maxWriteScope: structuredClone(this.support.maxWriteScope),
      // Wire provenance of the support configuration, not the policy owner.
      source: "runtime",
    } });
  }
}
