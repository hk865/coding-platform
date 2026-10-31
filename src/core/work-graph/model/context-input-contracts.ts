/**
 * Slice 3 exact task-input owner contracts. The page DTOs are pure and live in
 * `contracts/graph-context.ts`; only the port/dependencies stay with the model.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type {
  InputSelectionV1, TaskInputPageRequestV1, TaskInputPageV1,
} from '../../../contracts/graph-context.js';
import type { AggregateRef, GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { MaterialPort } from './material-contracts.js';

export interface TaskContextInputPort {
  readTaskInputs(ctx: CoreCallContext, request: {
    consumer: TaskTriple; planRef: PlanRevisionRef;
    declarationId?: string;
    candidateKey?: string;
  }): Promise<ReadResult<InputSelectionV1[]>>;
  readTaskInputPage(ctx: CoreCallContext, request: TaskInputPageRequestV1)
    : Promise<ReadResult<TaskInputPageV1>>;
}

/** L46 (§3.13 item 2): one exact v2 declaration resolved to the Task whose Run produced its artifact. */
export type TaskInputUpstreamV1 = {
  consumerTaskId: string;
  upstream: TaskTriple;
};

/** The thin read's value: only declarations that resolve to a Task, at one Plan revision (the read basis). */
export type TaskInputUpstreamsV1 = {
  planRef: PlanRevisionRef;
  upstreams: readonly TaskInputUpstreamV1[];
};

/** The upstream read the Workflow's L46 pre-pass uses; the context-input owner publishes it beside the two input
 *  reads. A declaration whose body/provenance cannot be read is a rejection, never "no dependency" (§3.13 item 2). */
export type TaskInputUpstreamPort = {
  readInputUpstreams(ctx: CoreCallContext, input: { goalRef: GoalRef; planRef: PlanRevisionRef }):
    Promise<ReadResult<TaskInputUpstreamsV1>>;
};

export type TaskContextInputDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials: MaterialPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  decisionApplications?: (ctx: CoreCallContext, messageRef: SessionMessageRef)
    => Promise<ReadResult<{ ref: AggregateRef; revision: number }[] | null>>;
};
