import type { ModelClientPort } from '../../../vendor/coding-agent/dist/public-api.js';
import type { ModelInputCounter } from './model-budget.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { WorkspaceToolsPort, WorkspaceResult } from '../workspace/ports.js';

/** Host-prepared capability for one model loop. This is not a Run admission API:
 * the trusted caller binds identity and live authorization before providing it.
 * The model cannot set the context/root/revision; the loop closes its own handle. */
export type RuntimeSourceCaptureAccess = {
  port: WorkspaceToolsPort;
  workspace: WorkspaceRef;
  context(signal: AbortSignal): CoreCallContext;
  currentWorkspaceRevision(signal: AbortSignal): Promise<WorkspaceResult<number>>;
  close(): Promise<void>;
};
export type RuntimeSourceCaptureFactory = (runSignal: AbortSignal) => Promise<RuntimeSourceCaptureAccess>;
export type BoundModel = {
  configuration: { revision: string; provider: string; model: string; baseUrl: string };
  client: ModelClientPort;
  inputCounter?: ModelInputCounter;
  /** The trusted prompt selection the Host resolved for this binding. The Host
   * always fills it; a model a test builds directly may omit it and then keeps
   * the revision, `platform` pack and `current_run` replay. */
  selection?: { modelId: string; promptPack: string; reasoningReplay: 'current_run' | 'none' };
};
