/**
 * R4.1/R4.3 Run control port and its raw dependencies.
 *
 * The public port stays deliberately narrow: it accepts a durable pause/cancel
 * request and reads an accepted request back. R4.3 adds the internal, trusted
 * observation writer the Runtime uses to persist what actually happened; it is
 * never exposed on `platform.controls`. Neither port delivers a signal, proves
 * Run ownership or resumes a Run by itself.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ControlIntentRef, ControlIntentSnapshotV1, ControlObservationV1, SubmitControlInput, SubmittedControl,
} from '../../../contracts/control-intent.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { MaterialAuthorityReads } from '../materials/record-ports.js';
import type { GraphWrite } from './contracts.js';

export interface RunControlPort {
  submitControl(
    ctx: CoreCallContext,
    request: GraphWrite<SubmitControlInput>,
  ): Promise<WriteResult<SubmittedControl>>;
  readControl(
    ctx: CoreCallContext,
    ref: ControlIntentRef,
  ): Promise<ReadResult<ControlIntentSnapshotV1>>;
}

/**
 * The internal trusted Runtime fact for ONE accepted control intent.
 *
 * Every observation field is produced by the existing Runtime observer from the
 * fixed Turn's original history and the Run's formal V2 authorization. The
 * public `deliverControl` caller supplies only `intentRef`; it can never pass
 * the Kernel identity, entry identity, position or conclusion.
 */
export type RecordControlObservationInput = {
  intentRef: ControlIntentRef;
  runRef: RunRef;
  observation: ControlObservationV1;
};

/**
 * The internal observation writer. It is part of the same raw control service
 * as `RunControlPort` (the factory returns their intersection) but is NOT
 * published through the public `platform.controls` surface. The R4.3a
 * implementation owner is `control-service.ts`; the stage-1 skeleton returns an
 * explicit `unsupported`.
 */
export interface ControlObservationPort {
  recordControlObservation(
    ctx: CoreCallContext,
    request: GraphWrite<RecordControlObservationInput>,
  ): Promise<WriteResult<ControlIntentSnapshotV1>>;
}

/**
 * Raw dependencies of the control service.
 *
 * `records` is the ONE RecordStore transaction port (control intent and the Run
 * `controlState` are committed together) and `authority` is the SAME
 * `MaterialAuthorityReads` exact Run loader the composition root already owns.
 * This is an internal trusted dependency, not a model material grant.
 */
export type RunControlServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  authority: MaterialAuthorityReads;
  now(): string;
  eventId(): string;
};
