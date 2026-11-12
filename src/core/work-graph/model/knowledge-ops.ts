/**
 * The platform's knowledge operations (`platform.knowledge`): reconciling a workspace's knowledge files with the
 * index, and the person's recovery of a knowledge notice's items. The Host's triggers and the two knowledge routes
 * call it; the composition root publishes it through `trackedCall`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  KnowledgeRecoverResult, KnowledgeRecoveryItemV1, ReconcileResult, ReconcileTrigger,
} from '../../../contracts/knowledge.js';

export interface KnowledgeOpsPort {
  /** One reconciliation of the line the workspace has checked out now ([2C1-10]–[2C1-18]). */
  reconcile(ctx: CoreCallContext, workspaceId: string, trigger: ReconcileTrigger): Promise<ReadResult<ReconcileResult>>;
  /** [2C1-19], [2C1-20]: writes one recovery item of this project's notice back, then reconciles its line once. */
  recover(ctx: CoreCallContext, input: { noticeId: string; itemNo: number }): Promise<WriteResult<KnowledgeRecoverResult>>;
  /** [2C1-23]: this project's recovery items of a notice, by `itemNo`; none is `not_found`. */
  recoveryItems(ctx: CoreCallContext, input: { noticeId: string }): Promise<ReadResult<{ items: readonly KnowledgeRecoveryItemV1[] }>>;
}
