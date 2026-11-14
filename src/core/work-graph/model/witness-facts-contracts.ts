/**
 * B06: the witness facts port. The Runtime proves only the subject Turn's final
 * text and its successful reads; applicability, paths, source and effects are
 * the Evidence owner's. The port has no rejection channel: whatever cannot be
 * read or reduced comes back as `unknown`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { WitnessFacts } from '../../../contracts/verification.js';
import type { KernelExecutionBinding } from './execution-entry-contracts.js';

export type WitnessFactsRequest = {
    runRef: RunRef;
    /** The subject Run's `executionHistory.kernel`; never the authorization's binding nor a history page field. */
    kernel: KernelExecutionBinding;
};

export interface WitnessFactsPort {
    read(ctx: CoreCallContext, request: WitnessFactsRequest): Promise<WitnessFacts>;
}
