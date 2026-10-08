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
import type { AggregateRef } from '../../../contracts/ledger.js';
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
export type TaskContextInputDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials: MaterialPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  decisionApplications?: (ctx: CoreCallContext, messageRef: SessionMessageRef)
    => Promise<ReadResult<{ ref: AggregateRef; revision: number }[] | null>>;
};
