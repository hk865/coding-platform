/**
 * B2 narrow next model-request Port (skeleton).
 *
 * Pure DTOs migrated from the read-only legacy reference
 * (`coding-platform/src/contracts/dispatch.ts`): stable permit identity and the
 * single-consumption semantics. No legacy Ledger/Control service is imported.
 * `ModelRequestPermit` is the existing call-evidence aggregate; it is not a new
 * execution truth table. A permit is one-shot: @1 issued -> @2 consumed.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WriteResult } from '../../../contracts/core/results.js';
import type {
  ModelRequestMaterialPinV1, ModelRequestPermitRef, RunRef,
} from '../../../contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GraphWrite } from './contracts.js';
import type { ExecutionEntryDependencies, TaskEntryPermit } from './execution-entry-contracts.js';

export type ActualModelRequest = {
  permit: TaskEntryPermit;
  requestId: string;
  requestDigest: string;
  contextInputDigest: string;
  manifestDigest: string;
};

export type IssuedModelRequest = {
  permitRef: ModelRequestPermitRef;
  permit: ModelRequestPermitV1;
  runRevision: number;
};

export interface ModelRequestPort {
  authorizeModelRequest(ctx: CoreCallContext,
    request: GraphWrite<ActualModelRequest>): Promise<WriteResult<IssuedModelRequest>>;
  recordModelRequestAttempt(ctx: CoreCallContext, request: GraphWrite<{
    request: ActualModelRequest;
    permitRef: ModelRequestPermitRef;
    attemptId: string;
    observedAt: string;
  }>): Promise<WriteResult<IssuedModelRequest>>;
}

/**
 * Historical permits may lack the request pins and therefore cannot authorize a
 * new actual call; a fresh consumption requires every pin.
 */
export type ModelRequestPermitV1 = {
  schemaVersion: 1;
  permitId: string;
  runRef: RunRef;
  requestId?: string;
  requestDigest?: string;
  contextInputDigest?: string;
  manifestDigest?: string;
  deliveryRefs: ModelRequestMaterialPinV1[];
  /** Exact authorization copied from the Run envelope at issuance time. */
  permissions: TaskEnvelopeV1['permissions'];
  consumedByAttemptId: string | null;
  issuedAt: string;
  consumedAt: string | null;
};

export type ModelRequestPermitSnapshot = {
  ref: ModelRequestPermitRef;
  revision: 1 | 2;
  schemaVersion: 1;
  permit: ModelRequestPermitV1;
  recordedAt: string;
};

/** Stable permit id: the caller cannot choose a different identity to bypass
 * request uniqueness. Byte-compatible with the legacy derivation. */
export function modelRequestPermitIdFor(runRef: RunRef, requestId: string): string {
  return 'call-' + sha256Hex(canonicalJson({ runRef, requestId } as unknown as JsonValue));
}

/** The same real Role/configuration/material authority is checked at issuance
 * and fresh consumption. A prior entry permit never grants a later model call. */
export type ModelCallServiceDependencies = Omit<ExecutionEntryDependencies, 'newId'>;
