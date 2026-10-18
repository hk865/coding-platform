/**
 * K3 model contracts: the two narrow read ports the L19a disposition uses (lead
 * ruling 2/K8-6). Types only; the shared Kernel reader is in
 * `core/agent-runtime/context-assembler.ts` and the workspace port is the one
 * platform implementation.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { KernelCallRefV1 } from '../../../contracts/unknown-call-review.js';
import type { WorkspaceToolsPort } from '../../workspace/ports.js';

/** One original Kernel call's command and cwd (null only when the record did not carry it). */
export type KernelCommandFactV1 = { command: string | null; cwd: string | null };

/** Reads the ORIGINAL Run's Kernel calls in the same window the continuation brief uses (K L9). */
export type KernelCommandReader = (
  ctx: CoreCallContext,
  input: { session: SessionRecord; calls: readonly KernelCallRefV1[]; signal?: AbortSignal },
) => Promise<ReadResult<ReadonlyMap<string, KernelCommandFactV1>>>;

/** The platform's one workspace read port (L19a K8-6); the caller passes maxBytes. */
export type WorkspaceFileReader = Pick<WorkspaceToolsPort, 'readWorkspace'>;
