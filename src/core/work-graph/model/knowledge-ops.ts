/**
 * The platform's knowledge operations (`platform.knowledge`): reconciling a workspace's knowledge files with the
 * index, the person's recovery of a knowledge notice's items, the knowledge directory's git status and commit
 * (kls-design §2.2.11) and the mark of a checkout another project already had (§2.2.12). The Host's triggers and the
 * knowledge routes call it; the composition root publishes it through `trackedCall`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  KnowledgeCommitResult, KnowledgeCommitStatus, KnowledgeRecoverResult, KnowledgeRecoveryItemV1, ReconcileResult,
  ReconcileTrigger,
} from '../../../contracts/knowledge.js';

export interface KnowledgeOpsPort {
  /** One reconciliation of the line the workspace has checked out now ([2C1-10]–[2C1-18]). */
  reconcile(ctx: CoreCallContext, workspaceId: string, trigger: ReconcileTrigger): Promise<ReadResult<ReconcileResult>>;
  /** [2C1-19], [2C1-20]: writes one recovery item of this project's notice back, then reconciles its line once. */
  recover(ctx: CoreCallContext, input: { noticeId: string; itemNo: number }): Promise<WriteResult<KnowledgeRecoverResult>>;
  /** [2C1-23]: this project's recovery items of a notice, by `itemNo`; none is `not_found`. */
  recoveryItems(ctx: CoreCallContext, input: { noticeId: string }): Promise<ReadResult<{ items: readonly KnowledgeRecoveryItemV1[] }>>;
  /** [2C2-08]: the knowledge directory's uncommitted count on the workspace's line, and whether it stays local. */
  status(ctx: CoreCallContext, workspaceId: string): Promise<ReadResult<KnowledgeCommitStatus>>;
  /**
   * [2C2-07], [2C2-08]: the person's commit of the workspace line's knowledge directory, then one reconciliation of
   * that line. No record is written, so the answer is `ready`, never `committed`.
   */
  commit(ctx: CoreCallContext, input: { workspaceId: string; message?: string | null }):
    Promise<{ status: 'ready'; value: KnowledgeCommitResult } | CoreRejection>;
  /**
   * R6 [2C2-11]: the workspace's root already belongs to another project: every note file of its line waits to be
   * verified in this project's index (`joined_existing_checkout`). No file, record or other project is touched.
   */
  markJoinedCheckout(ctx: CoreCallContext, workspaceId: string):
    Promise<{ status: 'ready'; value: { marked: number } } | CoreRejection>;
}
