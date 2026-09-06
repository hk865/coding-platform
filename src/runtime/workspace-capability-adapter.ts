/**
 * P1-07 runtime face: FakeWorkspaceCapabilityAdapter — WorkerRuntime.
 * WorkspaceCapabilityPort implementation for the Fake run world.
 *
 * ENTRY FILE (shared baseline — exported shape FROZEN; lane A fills semantics).
 * Capability = runtime support matrix (per-envelope selector) ∩ declared
 * permissions (envelope.permissions.tools: "read" -> workspaceRead, "write" ->
 * workspaceWrite). support === null -> { status: "unsupported" } — never a
 * silent degrade. A reader run (tools = ["read"]) can NEVER declare
 * workspaceWrite.
 */
import type { TaskEnvelopeV1 } from "../contracts/task-envelope.js";
import type {
  WorkspaceCapabilitiesV1,
  WorkspaceCapabilityPort,
  WorkspaceCapabilityResultV1,
} from "../contracts/workspace-capability.js";
import type { ConflictScopeV1 } from "../contracts/workspace-lease.js";

export type FakeWorkspaceCapabilitySupport = {
  workspaceRead: boolean;
  workspaceWrite: boolean;
  maxWriteScope: ConflictScopeV1 | null;
};

export type FakeWorkspaceCapabilitySelector = (envelope: TaskEnvelopeV1) => FakeWorkspaceCapabilitySupport | null;

export class FakeWorkspaceCapabilityAdapter implements WorkspaceCapabilityPort {
  constructor(private readonly selector: FakeWorkspaceCapabilitySelector = () => ({
    workspaceRead: true,
    workspaceWrite: true,
    maxWriteScope: null,
  })) {}

  capabilitiesFor(envelope: TaskEnvelopeV1): Promise<WorkspaceCapabilityResultV1> {
    const support = this.selector(envelope);
    if (support === null) {
      return Promise.resolve({ status: "unsupported" });
    }
    const tools = envelope.permissions.tools;
    const capabilities: WorkspaceCapabilitiesV1 = {
      schemaVersion: 1,
      workspaceId: envelope.workspaceId,
      workspaceRead: support.workspaceRead && tools.includes("read"),
      workspaceWrite: support.workspaceWrite && tools.includes("write"),
      maxWriteScope: support.maxWriteScope,
      source: "runtime",
    };
    return Promise.resolve({ status: "ready", capabilities });
  }
}
