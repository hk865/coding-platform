import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { WriteResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GraphWrite } from './contracts.js';

export type RecordExecutionHistoryInput = {
  runRef: RunRef;
  kernel: RunExecutionHistoryV1['kernel'];
  startPosition: number;
  observedThroughPosition: number;
  endPosition: number | null;
};
export type RecordedExecutionHistory = {
  runRef: RunRef;
  runRevision: number;
  history: RunExecutionHistoryV1;
};
/** Trusted Runtime/Host fact admission; no model-facing arbitrary history write.
 * meta.expected contains exactly the current Run revision. Claim owns Session.
 * This operation changes only the Run locator plus its event and unique binding.
 * It does not mark entered/completed or change Session occupancy/historyCursor. */
export interface ExecutionHistoryWritePort {
  recordExecutionHistory(ctx: CoreCallContext, request: GraphWrite<RecordExecutionHistoryInput>):
    Promise<WriteResult<RecordedExecutionHistory>>;
}
export type ExecutionHistoryWriteDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};
