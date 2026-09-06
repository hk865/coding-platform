/**
 * P1-07 Control entry: workspace lease engine (acquireReadLease /
 * acquireWriteLease / releaseLease) + read-only-capability enforcement.
 *
 * ENTRY FILE (shared baseline — exported signatures FROZEN; lane A fills the
 * implementation). Frozen semantics: IMPLEMENTATION-HANDOFF.md "P1-07 契约与
 * 存储语义" items 1/2/3/4. Every acquisition resolves the WorkspaceCapabilityPort
 * FIRST (unsupported -> capability_unsupported, NEVER a silent degrade); a
 * reader run can never obtain a write lease; write scopes must be ⊆
 * declaredWriteScope (scope_not_declared) and ⊆ the capability cap.
 */
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
} from "../contracts/workspace-lease.js";
import type { ControlEngineDeps } from "./control-engine.js";

export interface WorkspaceLeaseEngine {
  acquireReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  acquireWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  releaseLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
}

export class WorkspaceLeaseEngineImpl implements WorkspaceLeaseEngine {
  constructor(private readonly deps: ControlEngineDeps) {}

  acquireReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt> {
    throw new Error("P1-07 lane A: acquireReadLease not implemented yet");
  }

  acquireWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt> {
    throw new Error("P1-07 lane A: acquireWriteLease not implemented yet");
  }

  releaseLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt> {
    throw new Error("P1-07 lane A: releaseLease not implemented yet");
  }
}
