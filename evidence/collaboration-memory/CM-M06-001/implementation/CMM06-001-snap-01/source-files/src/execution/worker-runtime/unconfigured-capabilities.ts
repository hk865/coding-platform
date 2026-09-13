import type { HandoffControlPort } from '../../contracts/handoff-control.js';
import type { ContextContinuationPort } from '../../contracts/context-continuation-port.js';
import type { LifecycleControlPort } from '../../contracts/control-intent.js';

/** Explicit absence of optional real-kernel integrations. No companion Fake
 * adapter may acknowledge effects that were never delivered to the kernel. */
export function unconfiguredRuntimeCapabilities(now: () => string): {
  handoffControl: HandoffControlPort;
  contextContinuation: ContextContinuationPort;
  lifecycleControl: LifecycleControlPort;
} {
  return {
    handoffControl: {
      control: async () => ({ status: 'rejected', code: 'forbidden', issues: ['Runtime handoff control is not configured.'] }),
      snapshot: async () => ({ status: 'unsupported', reason: 'Public handoff snapshots are not configured.' }),
    },
    contextContinuation: {
      capabilities: async () => ({ status: 'unsupported' }),
      checkContinuation: async request => ({ schemaVersion: 1, workContextRef: { ...request.workContextRef },
        requestedByRunRef: request.requestedByRunRef ? { ...request.requestedByRunRef } : null,
        originalRunRef: request.originalRunRef ? { ...request.originalRunRef } : null,
        observed: 'unsupported', unsupportedCapabilities: ['session_restore', 'context_resume', 'takeover_run'],
        rejectionCode: null, summary: 'Runtime continuation has not been configured or executed.', observedAt: now(),
      }),
    },
    lifecycleControl: {
      capabilities: () => ({ safePointDelivery: false, pause: false, cancel: false, steer: false, maxSteerPayloadBytes: 0 }),
      apply: async () => { throw Error('Runtime safe-point delivery is not configured; no intent was applied.'); },
    },
  };
}
