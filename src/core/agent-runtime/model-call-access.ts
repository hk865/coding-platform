/**
 * B2 model-call access adapter.
 *
 * A thin adapter over the existing WorkGraph `ModelRequestPort`. `bind` re-reads
 * the persisted Run input binding and refuses a mismatch. `beforeCall` issues a
 * one-shot durable permit for the exact final request and consumes it against
 * the same Role/Host/material authority; only a fresh (`replayed === false`)
 * consumption may call the provider. A replay or a lost response never retries
 * the provider and never returns a fabricated success.
 */
import { createHash } from 'node:crypto';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreError } from '../../contracts/core/results.js';
import type { TaskEntryPermit } from '../work-graph/tasks/execution-entry-contracts.js';
import type { ModelCallAccess } from '../../contracts/dispatch.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';

export type RuntimeModelCallAccessDependencies = Pick<RuntimeExecutionDependencies,
  'modelRequests' | 'executions' | 'now' | 'newId'> & {
  /** Trusted per-run binding; the model cannot set either value. */
  context: CoreCallContext;
  permit: TaskEntryPermit;
};

/** A model-call admission rejection the driver maps back to its caller. */
export class RuntimeModelCallRejected extends Error {
  readonly code: CoreError;
  constructor(code: CoreError, reason: string) {
    super(reason);
    this.name = 'RuntimeModelCallRejected';
    this.code = code;
  }
}

const attemptIdFor = (requestId: string): string => 'b2-model-attempt:' + createHash('sha256').update(requestId).digest('hex');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRuntimeModelCallAccess(deps: RuntimeModelCallAccessDependencies): ModelCallAccess {
  const { permit, context } = deps;
  const runRef = permit.claim.runRef;

  return {
    async bind(input): Promise<void> {
      let read;
      try {
        read = await deps.executions.readExecution(context, runRef);
      } catch (error) {
        throw new RuntimeModelCallRejected('unavailable', `the Run input binding could not be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') {
        throw new RuntimeModelCallRejected(read.status === 'not_found' ? 'not_found' : 'unavailable', 'the Run input binding is not readable');
      }
      const binding = read.value.run.inputBinding;
      if (binding === undefined) throw new RuntimeModelCallRejected('forbidden', 'the Run has no accepted input binding');
      if (binding.inputDigest !== input.inputDigest || binding.manifestDigest !== input.manifestDigest) {
        throw new RuntimeModelCallRejected('invalid', 'the requested input binding disagrees with the persisted Run binding');
      }
    },

    async beforeCall(input): Promise<void> {
      let read;
      try {
        read = await deps.executions.readExecution(context, runRef);
      } catch (error) {
        throw new RuntimeModelCallRejected('unavailable', `the Run revision could not be read before the model permit: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') {
        throw new RuntimeModelCallRejected(read.status === 'not_found' ? 'not_found' : 'unavailable', 'the Run is not readable before the model permit');
      }
      const run = read.value.run;
      let issued;
      try {
        issued = await deps.modelRequests.authorizeModelRequest(context, {
          input: { permit, requestId: input.requestId, requestDigest: input.requestDigest, contextInputDigest: input.contextInputDigest, manifestDigest: input.manifestDigest },
          meta: { requestId: `b2-model-authorize:${input.requestId}`, expected: [{ ref: runRef, revision: run.revision }] },
        });
      } catch (error) {
        throw new RuntimeModelCallRejected('unavailable', `issuing the model permit failed: ${messageOf(error)}`);
      }
      if (issued.status !== 'committed') throw new RuntimeModelCallRejected(issued.code, issued.reason);
      const attemptId = deps.newId() + ':' + attemptIdFor(input.requestId);
      let consumed;
      try {
        consumed = await deps.modelRequests.recordModelRequestAttempt(context, {
          input: { request: { permit, requestId: input.requestId, requestDigest: input.requestDigest, contextInputDigest: input.contextInputDigest, manifestDigest: input.manifestDigest }, permitRef: issued.value.permitRef, attemptId, observedAt: deps.now() },
          meta: { requestId: `b2-model-consume:${input.requestId}`, expected: [{ ref: runRef, revision: run.revision }, { ref: issued.value.permitRef, revision: 1 }] },
        });
      } catch (error) {
        throw new RuntimeModelCallRejected('unavailable', `consuming the model permit failed: ${messageOf(error)}`);
      }
      if (consumed.status !== 'committed') throw new RuntimeModelCallRejected(consumed.code, consumed.reason);
      // Only a fresh consumption authorizes the provider; a recovered receipt
      // proves the attempt already happened and must never call it again.
      if (consumed.replayed || issued.replayed && consumed.replayed) {
        throw new RuntimeModelCallRejected('forbidden', 'the model permit was already consumed; refusing to call the provider again');
      }
    },
  };
}
